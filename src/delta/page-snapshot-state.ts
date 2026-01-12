/**
 * Page Snapshot State
 *
 * State machine managing page context for delta computation.
 * Handles baseline tracking, overlay detection, and response generation.
 */

import type { Page } from 'playwright';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  ScopedElementRef,
  CompositeNodeKey,
  KnownNodeState,
  ComputedDelta,
  ModifiedNode,
  VersionedSnapshot,
  SnapshotResponse,
  ValidationResult,
  PageStateMode,
  OverlayState,
  OverlayChangeResult,
  DetectedOverlay,
  ActionType,
} from './types.js';
import { FrameTracker } from './frame-tracker.js';
import { SnapshotVersionManager } from './snapshot-version-manager.js';
import {
  makeCompositeKeyFromNode,
  hashNodeContent,
  hashNodes,
  isDeltaReliable,
  computeDeltaConfidence,
  buildRefFromNode,
} from './utils.js';
import {
  formatFullSnapshot,
  formatDelta,
  formatOverlayOpened,
  formatOverlayClosed,
  formatNoChange,
} from './delta-formatter.js';

/**
 * PageSnapshotState class
 *
 * State machine managing page context (uninitialized -> base <-> overlay).
 * Handles delta computation with baseline/overlay separation.
 */
export class PageSnapshotState {
  private mode: PageStateMode = 'uninitialized';

  /** Base page state (excludes overlay content) */
  private baseline: VersionedSnapshot | null = null;
  /** Use composite key to prevent cross-frame collisions */
  private baselineNodes = new Map<CompositeNodeKey, KnownNodeState>();

  /** Track main frame loaderId for navigation detection */
  private baselineMainFrameLoaderId: string | null = null;

  /** Overlay stack */
  private overlayStack: OverlayState[] = [];

  /** Nodes in current context (base or top overlay) */
  private contextNodes = new Map<CompositeNodeKey, KnownNodeState>();

  /** Frame tracker (injected) - exposed for formatting */
  private readonly _frameTracker: FrameTracker;

  /** Version manager (injected) */
  private readonly _versionManager: SnapshotVersionManager;

  constructor(frameTracker: FrameTracker, versionManager: SnapshotVersionManager) {
    this._frameTracker = frameTracker;
    this._versionManager = versionManager;
  }

  // ============================================
  // Public Accessors
  // ============================================

  /** Get frame tracker for serialization. */
  get frameTracker(): FrameTracker {
    return this._frameTracker;
  }

  /** Get version manager for internal use. */
  private get versionManager(): SnapshotVersionManager {
    return this._versionManager;
  }

  /** Ensure frame tracker is initialized. */
  async ensureInitialized(): Promise<void> {
    await this._frameTracker.ensureInitialized();
  }

  /** Check if currently in overlay mode. */
  get isInOverlayMode(): boolean {
    return this.mode === 'overlay';
  }

  /** Get current version. */
  get currentVersion(): number {
    return this._versionManager.version;
  }

  /**
   * Validate agent's version and capture current state.
   * Call before executing action to detect pre-existing staleness.
   */
  async validateAndCapture(
    page: Page,
    cdp: CdpClient,
    agentVersion?: number
  ): Promise<ValidationResult> {
    await this.ensureInitialized();
    return this._versionManager.validateAgentState(page, cdp, agentVersion);
  }

  /**
   * Advance baseline to a specific version.
   * Call when pre-validation detected staleness and we want to
   * start fresh from current state before executing action.
   *
   * IMPORTANT: In 'overlay' mode, baseline is frozen but we update
   * the top overlay's snapshot to avoid double-counting changes.
   *
   * @returns true if baseline was advanced, false if in overlay mode
   */
  advanceBaselineTo(versioned: VersionedSnapshot): boolean {
    if (this.mode === 'overlay') {
      // Don't modify baseline during overlay - only update overlay snapshot
      // This preserves "overlay isolates baseline" invariant while preventing
      // double-counting of pre-validation changes in post-action delta.
      const topOverlay = this.overlayStack[this.overlayStack.length - 1];
      if (topOverlay) {
        const newOverlayNodes = this.extractOverlayNodes(versioned.snapshot, topOverlay.rootRef);

        // Update overlay snapshot so handleOverlayContentChange diffs from current state
        topOverlay.snapshot = { ...versioned.snapshot, nodes: newOverlayNodes };
        topOverlay.contentHash = hashNodes(newOverlayNodes);

        // Also update capturedRefs to include any new nodes
        const newRefs = newOverlayNodes.map((n) => buildRefFromNode(n));
        topOverlay.capturedRefs = newRefs;

        this.updateContextNodes(newOverlayNodes);
      }
      return false;
    }

    this.baseline = versioned;
    this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
    this.updateBaselineNodes(versioned.snapshot.nodes);
    this.updateContextNodes(versioned.snapshot.nodes);
    return true;
  }

  /**
   * Initialize baseline. MUST be called before any delta computation.
   * Ensures frame tracker is initialized first.
   */
  async initialize(page: Page, cdp: CdpClient): Promise<SnapshotResponse> {
    // Ensure frame tracker is ready before creating refs
    await this._frameTracker.ensureInitialized();

    const versioned = await this.versionManager.forceCapture(page, cdp);

    this.baseline = versioned;
    this.mode = 'base';
    this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
    this.updateContextNodes(versioned.snapshot.nodes);
    this.updateBaselineNodes(versioned.snapshot.nodes);

    return {
      type: 'full',
      content: formatFullSnapshot(versioned.snapshot, this._frameTracker),
      version: versioned.version,
    };
  }

  /**
   * Main entry point: compute response for current state.
   */
  async computeResponse(
    page: Page,
    cdp: CdpClient,
    _actionType: ActionType
  ): Promise<SnapshotResponse> {
    // Guard: must be initialized
    if (this.mode === 'uninitialized') {
      return this.initialize(page, cdp);
    }

    // Ensure frame tracker is ready
    await this._frameTracker.ensureInitialized();

    // Get frame invalidations first
    const frameInvalidations = this._frameTracker.drainInvalidations();

    // Detect full page navigation by checking main frame loaderId
    const currentMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId;
    if (currentMainFrameLoaderId !== this.baselineMainFrameLoaderId) {
      // Main frame navigated - this is a full page navigation
      // Reset everything and return full snapshot
      return this.handleFullNavigation(page, cdp);
    }

    // Capture current state
    const { versioned, isNew } = await this.versionManager.captureIfChanged(page, cdp);

    // No change and no frame invalidations
    if (!isNew && frameInvalidations.length === 0) {
      return {
        type: 'no_change',
        content: formatNoChange(),
        version: versioned.version,
      };
    }

    // Detect overlay changes BEFORE computing delta
    const overlayChange = this.detectOverlayChange(versioned.snapshot);

    if (overlayChange?.type === 'opened') {
      return this.handleOverlayOpened(versioned, overlayChange, frameInvalidations);
    }

    if (overlayChange?.type === 'closed') {
      return this.handleOverlayClosed(versioned, frameInvalidations);
    }

    // Compute delta based on current mode
    if (this.mode === 'overlay') {
      return this.handleOverlayContentChange(versioned, frameInvalidations);
    }

    // Base page change
    return this.handleBasePageChange(versioned, frameInvalidations);
  }

  // ============================================
  // State Change Handlers
  // ============================================

  /**
   * Handle full page navigation (main frame loaderId changed).
   * Resets all state and returns full snapshot.
   */
  private async handleFullNavigation(page: Page, cdp: CdpClient): Promise<SnapshotResponse> {
    // Clear all state
    this.overlayStack = [];
    this.baselineNodes.clear();
    this.contextNodes.clear();
    this._frameTracker.clearAllRefs();
    this.versionManager.reset();

    // Capture fresh state
    const versioned = await this.versionManager.forceCapture(page, cdp);

    this.baseline = versioned;
    this.mode = 'base';
    this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
    this.updateContextNodes(versioned.snapshot.nodes);
    this.updateBaselineNodes(versioned.snapshot.nodes);

    return {
      type: 'full',
      content: formatFullSnapshot(versioned.snapshot, this._frameTracker),
      version: versioned.version,
      reason: 'Full page navigation detected',
    };
  }

  private handleOverlayOpened(
    versioned: VersionedSnapshot,
    change: OverlayChangeResult,
    frameInvalidations: ScopedElementRef[]
  ): SnapshotResponse {
    const overlay = change.overlay!;

    // Extract overlay content nodes
    const overlayNodes = this.extractOverlayNodes(versioned.snapshot, overlay.rootRef);

    // Capture refs at open time - these use current loaderId which is correct
    // because this is when the agent first sees them. Store for use at close time.
    const capturedRefs = overlayNodes.map((n) => buildRefFromNode(n));

    // Push to stack (DO NOT modify baseline)
    const overlayState: OverlayState = {
      rootRef: overlay.rootRef,
      snapshot: { ...versioned.snapshot, nodes: overlayNodes },
      contentHash: hashNodes(overlayNodes),
      confidence: overlay.confidence,
      overlayType: overlay.overlayType,
      capturedRefs,
    };
    this.overlayStack.push(overlayState);

    // Switch to overlay mode
    this.mode = 'overlay';
    this.updateContextNodes(overlayNodes);

    // Prune issued refs that are removed
    this.pruneRemovedRefs(frameInvalidations);

    return {
      type: 'overlay_opened',
      content: formatOverlayOpened(
        overlayState,
        overlayNodes,
        frameInvalidations,
        this._frameTracker
      ),
      version: versioned.version,
    };
  }

  private handleOverlayClosed(
    versioned: VersionedSnapshot,
    frameInvalidations: ScopedElementRef[]
  ): SnapshotResponse {
    const closedOverlay = this.overlayStack.pop()!;

    // Use capturedRefs from open time - these have the correct loaderId
    // that matches what the agent received, even if frame navigated since.
    const allInvalidations = [...frameInvalidations, ...closedOverlay.capturedRefs];

    // Check if there's another overlay underneath
    if (this.overlayStack.length > 0) {
      // Stay in overlay mode with previous overlay as context
      const newTop = this.overlayStack[this.overlayStack.length - 1];
      this.updateContextNodes(newTop.snapshot.nodes);

      this.pruneRemovedRefs(allInvalidations);

      return {
        type: 'overlay_closed',
        content: formatOverlayClosed(closedOverlay, allInvalidations, null, this._frameTracker),
        version: versioned.version,
      };
    }

    // Return to base mode
    this.mode = 'base';

    // Check if base page changed while overlay was open
    const baseNodes = this.extractNonOverlayNodes(versioned.snapshot);
    const baseDelta = this.computeDeltaFromNodes(
      this.baseline!.snapshot.nodes,
      baseNodes,
      this.baselineNodes
    );

    // NOW update baseline (after delta computation)
    this.baseline = { ...versioned, snapshot: { ...versioned.snapshot, nodes: baseNodes } };
    this.updateBaselineNodes(baseNodes);
    this.updateContextNodes(baseNodes);

    this.pruneRemovedRefs(allInvalidations);

    return {
      type: 'overlay_closed',
      content: formatOverlayClosed(closedOverlay, allInvalidations, baseDelta, this._frameTracker),
      version: versioned.version,
    };
  }

  private handleOverlayContentChange(
    versioned: VersionedSnapshot,
    frameInvalidations: ScopedElementRef[]
  ): SnapshotResponse {
    const currentOverlay = this.overlayStack[this.overlayStack.length - 1];
    const newOverlayNodes = this.extractOverlayNodes(versioned.snapshot, currentOverlay.rootRef);

    // Compute delta BEFORE updating maps, so we can look up removed refs
    const delta = this.computeDeltaFromNodes(
      currentOverlay.snapshot.nodes,
      newOverlayNodes,
      this.contextNodes
    );

    // Collect removed refs BEFORE clearing the maps
    const allRemovedRefs = [...frameInvalidations, ...delta.removed];

    // NOW update overlay state (NOT baseline)
    currentOverlay.snapshot = { ...versioned.snapshot, nodes: newOverlayNodes };
    currentOverlay.contentHash = hashNodes(newOverlayNodes);
    this.updateContextNodes(newOverlayNodes);

    // Prune removed refs
    this.pruneRemovedRefs(allRemovedRefs);

    return {
      type: 'delta',
      content: formatDelta(delta, frameInvalidations, { context: 'overlay' }, this._frameTracker),
      version: versioned.version,
    };
  }

  private handleBasePageChange(
    versioned: VersionedSnapshot,
    frameInvalidations: ScopedElementRef[]
  ): SnapshotResponse {
    // Compute delta BEFORE updating maps, so we can look up removed refs
    const delta = this.computeDeltaFromNodes(
      this.baseline!.snapshot.nodes,
      versioned.snapshot.nodes,
      this.baselineNodes
    );

    // Check if delta is reliable
    if (
      !isDeltaReliable(
        delta.confidence,
        delta.added.length,
        delta.removed.length,
        delta.modified.length,
        versioned.snapshot.nodes.length
      )
    ) {
      // Fall back to full snapshot
      this.baseline = versioned;
      this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
      this.updateBaselineNodes(versioned.snapshot.nodes);
      this.updateContextNodes(versioned.snapshot.nodes);
      this._frameTracker.clearAllRefs();

      return {
        type: 'full',
        content: formatFullSnapshot(versioned.snapshot, this._frameTracker),
        version: versioned.version,
        reason: 'Delta unreliable - sending full snapshot',
      };
    }

    // Collect removed refs BEFORE clearing the maps
    const allRemovedRefs = [...frameInvalidations, ...delta.removed];

    // NOW advance baseline AFTER delta computation
    this.baseline = versioned;
    this.updateBaselineNodes(versioned.snapshot.nodes);
    this.updateContextNodes(versioned.snapshot.nodes);

    // Prune removed refs
    this.pruneRemovedRefs(allRemovedRefs);

    return {
      type: 'delta',
      content: formatDelta(delta, frameInvalidations, { context: 'base' }, this._frameTracker),
      version: versioned.version,
    };
  }

  // ============================================
  // Overlay Detection
  // ============================================

  /**
   * Detect overlay state changes with deterministic rules.
   */
  private detectOverlayChange(snapshot: BaseSnapshot): OverlayChangeResult | null {
    const currentOverlays = this.findOverlays(snapshot);
    const previousOverlayCount = this.overlayStack.length;

    // New overlay appeared
    if (currentOverlays.length > previousOverlayCount) {
      const newOverlay = currentOverlays[currentOverlays.length - 1];
      return {
        type: 'opened',
        overlay: newOverlay,
      };
    }

    // Overlay disappeared
    if (currentOverlays.length < previousOverlayCount) {
      return {
        type: 'closed',
        closedOverlay: this.overlayStack[this.overlayStack.length - 1],
      };
    }

    // Same count but different overlays (rare: one closed, another opened)
    if (currentOverlays.length > 0 && previousOverlayCount > 0) {
      const topCurrent = currentOverlays[currentOverlays.length - 1];
      const topPrevious = this.overlayStack[this.overlayStack.length - 1];

      // Compare full ref (frame_id + loader_id + backend_node_id)
      const isSameOverlay =
        topCurrent.rootRef.backend_node_id === topPrevious.rootRef.backend_node_id &&
        topCurrent.rootRef.frame_id === topPrevious.rootRef.frame_id &&
        topCurrent.rootRef.loader_id === topPrevious.rootRef.loader_id;

      if (!isSameOverlay) {
        // Treat as close + open
        return {
          type: 'replaced',
          closedOverlay: topPrevious,
          newOverlay: topCurrent,
        };
      }
    }

    return null;
  }

  private findOverlays(snapshot: BaseSnapshot): DetectedOverlay[] {
    const overlays: DetectedOverlay[] = [];

    for (const node of snapshot.nodes) {
      const detection = this.classifyAsOverlay(node);
      if (detection) {
        overlays.push(detection);
      }
    }

    // Sort by z-index/DOM order for consistent stacking
    overlays.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

    return overlays;
  }

  private classifyAsOverlay(node: ReadableNode): DetectedOverlay | null {
    const role = node.attributes?.role;
    const ariaModal = node.attributes?.['aria-modal' as keyof typeof node.attributes];
    const className = node.attributes?.['class' as keyof typeof node.attributes] ?? '';

    // Build ref directly from node's captured data
    const buildRef = (): ScopedElementRef => buildRefFromNode(node);

    // Rule 1: ARIA dialog with modal
    if ((role === 'dialog' || role === 'alertdialog') && ariaModal === 'true') {
      return {
        rootRef: buildRef(),
        overlayType: 'modal',
        confidence: 1.0,
        zIndex: this.extractZIndex(node),
      };
    }

    // Rule 2: ARIA dialog without modal
    if (role === 'dialog' || role === 'alertdialog') {
      return {
        rootRef: buildRef(),
        overlayType: 'dialog',
        confidence: 0.9,
        zIndex: this.extractZIndex(node),
      };
    }

    // Rule 3: Node kind is 'dialog'
    if (node.kind === 'dialog') {
      return {
        rootRef: buildRef(),
        overlayType: 'dialog',
        confidence: 0.85,
        zIndex: this.extractZIndex(node),
      };
    }

    // Rule 4: Class pattern matching with z-index check
    const overlayClassPatterns = [
      /\bmodal\b/i,
      /\bdialog\b/i,
      /\boverlay\b/i,
      /\bpopup\b/i,
      /\bdropdown-menu\b/i,
    ];

    const classStr = String(className);
    const matchesPattern = overlayClassPatterns.some((p) => p.test(classStr));
    const hasHighZIndex = (this.extractZIndex(node) ?? 0) >= 1000;

    if (matchesPattern && hasHighZIndex) {
      const isDropdown = /dropdown/i.test(classStr);
      return {
        rootRef: buildRef(),
        overlayType: isDropdown ? 'dropdown' : 'modal',
        confidence: 0.7,
        zIndex: this.extractZIndex(node),
      };
    }

    return null;
  }

  private extractZIndex(_node: ReadableNode): number | undefined {
    // z-index might be in layout or computed styles
    // For now, return undefined - would need CSS extraction for proper z-index
    return undefined;
  }

  // ============================================
  // Node Extraction
  // ============================================

  /**
   * Extract nodes belonging to an overlay.
   * For simplicity, returns all nodes with the overlay's region or kind.
   */
  private extractOverlayNodes(
    snapshot: BaseSnapshot,
    _overlayRef: ScopedElementRef
  ): ReadableNode[] {
    // Return nodes in dialog region or with dialog kind
    return snapshot.nodes.filter(
      (node) => node.where.region === 'dialog' || node.kind === 'dialog'
    );
  }

  /**
   * Extract nodes NOT in any overlay.
   */
  private extractNonOverlayNodes(snapshot: BaseSnapshot): ReadableNode[] {
    return snapshot.nodes.filter(
      (node) => node.where.region !== 'dialog' && node.kind !== 'dialog'
    );
  }

  // ============================================
  // Delta Computation
  // ============================================

  /**
   * Compute delta between old and new node lists.
   * Returns ScopedElementRef[] for removed (not raw IDs).
   * Uses per-node loader_id (not mainFrame's) for correct iframe handling.
   */
  private computeDeltaFromNodes(
    oldNodes: ReadableNode[],
    newNodes: ReadableNode[],
    knownNodes: Map<CompositeNodeKey, KnownNodeState>
  ): ComputedDelta {
    // Build sets of composite keys for comparison
    const oldKeys = new Set(oldNodes.map((n) => makeCompositeKeyFromNode(n)));
    const newKeys = new Set(newNodes.map((n) => makeCompositeKeyFromNode(n)));

    const added: ReadableNode[] = [];
    const removed: ScopedElementRef[] = [];
    const modified: ModifiedNode[] = [];

    // Find added nodes
    for (const node of newNodes) {
      const key = makeCompositeKeyFromNode(node);
      if (!oldKeys.has(key)) {
        added.push(node);
      }
    }

    // Find removed nodes - look them up in knownNodes BEFORE maps are cleared
    for (const node of oldNodes) {
      const key = makeCompositeKeyFromNode(node);
      if (!newKeys.has(key)) {
        const known = knownNodes.get(key);
        if (known?.ref) {
          removed.push(known.ref);
        }
      }
    }

    // Find modified nodes
    for (const node of newNodes) {
      const key = makeCompositeKeyFromNode(node);
      const known = knownNodes.get(key);
      if (known && hashNodeContent(node) !== known.contentHash) {
        modified.push({
          ref: buildRefFromNode(node),
          previousLabel: known.label,
          currentLabel: node.label,
          changeType: 'text',
        });
      }
    }

    // Compute confidence
    const confidence = computeDeltaConfidence(
      added.length,
      removed.length,
      modified.length,
      newNodes.length
    );

    return { added, removed, modified, confidence };
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Build refs directly from node's stored loader_id, NOT via createRef()
   * which would use current frame state.
   */
  private updateContextNodes(nodes: ReadableNode[]): void {
    this.contextNodes.clear();
    for (const node of nodes) {
      const key = makeCompositeKeyFromNode(node);
      const ref = buildRefFromNode(node);
      this.contextNodes.set(key, {
        backend_node_id: node.backend_node_id,
        label: node.label,
        kind: node.kind,
        contentHash: hashNodeContent(node),
        ref,
      });
    }
  }

  private updateBaselineNodes(nodes: ReadableNode[]): void {
    this.baselineNodes.clear();
    for (const node of nodes) {
      const key = makeCompositeKeyFromNode(node);
      const ref = buildRefFromNode(node);
      this.baselineNodes.set(key, {
        backend_node_id: node.backend_node_id,
        label: node.label,
        kind: node.kind,
        contentHash: hashNodeContent(node),
        ref,
      });
    }
  }

  private pruneRemovedRefs(refs: ScopedElementRef[]): void {
    this._frameTracker.pruneRefs(refs);
  }
}
