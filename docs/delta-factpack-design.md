# Delta FactPack Design

> Comprehensive plan for intelligent, incremental page state updates in Athena Browser MCP

## Overview

This document specifies how the MCP server delivers page state (FactPack) to agents efficiently using **deltas** instead of full snapshots when appropriate. The goal is to minimize token usage while ensuring agents always have accurate, actionable information about the current page state.

### Design Principles

1. **Fool-proof references**: Element references must be scoped and validated to prevent agents from targeting stale/wrong elements
2. **Bounded operations**: All async operations have hard timeouts to prevent tool stalls
3. **Explicit invalidation**: When references become invalid, explicitly tell the agent
4. **Baseline integrity**: Delta computation always uses the correct baseline (page vs overlay)
5. **Graceful degradation**: Fall back to full snapshots when deltas are unreliable

---

## 1. Frame-Scoped Element References

### Problem

CDP's `backend_node_id` is only unique within a frame's execution context. The same ID could refer to different elements:

- Across different iframes
- After a frame navigates (same frame, new document)

### Solution: Compound References with LoaderId

Use `frame.loaderId` from CDP's `Page.frameNavigated` event as the document identifier. This is assigned by Chrome and changes on every navigation.

```typescript
/**
 * Globally unique element reference.
 * Safe across frames and navigations.
 */
interface ScopedElementRef {
  /** CDP backend node ID (unique within frame + document) */
  backend_node_id: number;

  /** CDP frame ID */
  frame_id: string;

  /** CDP loader ID - changes on frame navigation */
  loader_id: string;
}

/**
 * Serialized form for agent communication.
 * ALWAYS includes loaderId to prevent stale ref collisions after navigation.
 * Format: "loaderId:backendNodeId" (main frame) or "frameId:loaderId:backendNodeId" (iframes)
 */
type SerializedRef = string;

/**
 * Composite key for node lookup maps.
 * Prevents collisions across frames.
 * Format: "frameId:loaderId:backendNodeId"
 */
type CompositeNodeKey = string;

function makeCompositeKey(ref: ScopedElementRef): CompositeNodeKey {
  return `${ref.frame_id}:${ref.loader_id}:${ref.backend_node_id}`;
}

/**
 * Create composite key from a node.
 * IMPORTANT: Uses the node's own loader_id (not mainFrame's) to handle iframes correctly.
 * ReadableNode must include loader_id from the snapshot compiler.
 */
function makeCompositeKeyFromNode(node: ReadableNode): CompositeNodeKey {
  return `${node.frame_id}:${node.loader_id}:${node.backend_node_id}`;
}
```

### Frame Lifecycle Tracker

```typescript
interface FrameState {
  frameId: string;
  loaderId: string;
  url: string;
  isMainFrame: boolean;
}

class FrameTracker {
  private frames = new Map<string, FrameState>();
  private mainFrameId: string | null = null;

  // All refs ever issued, keyed by composite key (frameId:loaderId:backendNodeId)
  // CONTRACT: Callers MUST call pruneRefs() when refs are removed/invalidated
  // to prevent unbounded growth. Frame navigation automatically prunes via
  // invalidateFrameRefs(), but element removal requires explicit pruning.
  private issuedRefs = new Map<CompositeNodeKey, ScopedElementRef>();

  // Refs invalidated since last delta emission
  private pendingInvalidations: ScopedElementRef[] = [];

  // Initialization state - MUST be awaited before createRef calls
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(private cdp: CdpClient) {}

  /**
   * Initialize frame tracker. MUST be awaited before any createRef calls.
   * Safe to call multiple times - returns same promise.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        await this.doInitialize();
        this.initialized = true;
      } catch (error) {
        // Reset promise so next call can retry
        this.initPromise = null;
        throw error;
      }
    })();

    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    await this.cdp.send('Page.enable', {});

    // Get initial frame tree
    const { frameTree } = await this.cdp.send('Page.getFrameTree', {});
    this.processFrameTree(frameTree);

    // Listen for frame events
    this.cdp.on('Page.frameNavigated', this.onFrameNavigated.bind(this));
    this.cdp.on('Page.frameDetached', this.onFrameDetached.bind(this));
  }

  /**
   * Ensure initialized before operations.
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private processFrameTree(frameTree: FrameTree): void {
    const frame = frameTree.frame;
    this.frames.set(frame.id, {
      frameId: frame.id,
      loaderId: frame.loaderId,
      url: frame.url,
      isMainFrame: !frame.parentId,
    });

    if (!frame.parentId) {
      this.mainFrameId = frame.id;
    }

    for (const child of frameTree.childFrames ?? []) {
      this.processFrameTree(child);
    }
  }

  private onFrameNavigated(event: { frame: FrameInfo }): void {
    const { frame } = event;
    const previousState = this.frames.get(frame.id);

    // If loaderId changed, invalidate all refs in this frame
    if (previousState && previousState.loaderId !== frame.loaderId) {
      this.invalidateFrameRefs(frame.id, previousState.loaderId);
    }

    this.frames.set(frame.id, {
      frameId: frame.id,
      loaderId: frame.loaderId,
      url: frame.url,
      isMainFrame: !frame.parentId,
    });

    if (!frame.parentId) {
      this.mainFrameId = frame.id;
    }
  }

  private onFrameDetached(event: { frameId: string }): void {
    const state = this.frames.get(event.frameId);
    if (state) {
      this.invalidateFrameRefs(event.frameId, state.loaderId);
      this.frames.delete(event.frameId);
    }
  }

  private invalidateFrameRefs(frameId: string, loaderId: string): void {
    for (const [compositeKey, ref] of this.issuedRefs.entries()) {
      if (ref.frame_id === frameId && ref.loader_id === loaderId) {
        this.pendingInvalidations.push(ref);
        this.issuedRefs.delete(compositeKey);
      }
    }
  }

  /**
   * Create and register a scoped reference.
   * Returns null if frame doesn't exist or tracker not initialized.
   */
  createRef(backendNodeId: number, frameId: string): ScopedElementRef | null {
    if (!this.initialized) {
      console.warn('FrameTracker.createRef called before initialization');
      return null;
    }

    const frameState = this.frames.get(frameId);
    if (!frameState) {
      return null; // Frame doesn't exist
    }

    const ref: ScopedElementRef = {
      backend_node_id: backendNodeId,
      frame_id: frameId,
      loader_id: frameState.loaderId,
    };

    // Use composite key for internal tracking
    const compositeKey = makeCompositeKey(ref);
    this.issuedRefs.set(compositeKey, ref);

    return ref;
  }

  /**
   * Validate a reference is still valid.
   */
  isValid(ref: ScopedElementRef): boolean {
    const frameState = this.frames.get(ref.frame_id);
    if (!frameState) return false;
    return frameState.loaderId === ref.loader_id;
  }

  /**
   * Serialize ref for agent communication.
   * ALWAYS includes loaderId to prevent stale ref collisions.
   * Format: "loaderId:backendNodeId" (main frame) or "frameId:loaderId:backendNodeId" (iframes)
   */
  serializeRef(ref: ScopedElementRef): SerializedRef {
    if (ref.frame_id === this.mainFrameId) {
      // Main frame: shorter form but STILL includes loaderId
      return `${ref.loader_id}:${ref.backend_node_id}`;
    }
    // Iframe: full form
    return `${ref.frame_id}:${ref.loader_id}:${ref.backend_node_id}`;
  }

  /**
   * Parse serialized ref back to structured form.
   * Validates loaderId matches current frame state.
   */
  parseRef(serialized: SerializedRef): ScopedElementRef | null {
    const parts = serialized.split(':');

    if (parts.length === 2) {
      // Main frame format: "loaderId:backendNodeId"
      const [loaderId, backendNodeIdStr] = parts;
      const mainFrame = this.frames.get(this.mainFrameId!);

      if (!mainFrame) return null;

      // CRITICAL: Validate loaderId matches current frame
      if (mainFrame.loaderId !== loaderId) {
        // Stale ref from previous navigation
        return null;
      }

      return {
        backend_node_id: parseInt(backendNodeIdStr, 10),
        frame_id: this.mainFrameId!,
        loader_id: loaderId,
      };
    }

    if (parts.length === 3) {
      // Iframe format: "frameId:loaderId:backendNodeId"
      const [frameId, loaderId, backendNodeIdStr] = parts;
      const frameState = this.frames.get(frameId);

      if (!frameState) return null;

      // CRITICAL: Validate loaderId matches current frame
      if (frameState.loaderId !== loaderId) {
        // Stale ref from previous navigation
        return null;
      }

      return {
        frame_id: frameId,
        loader_id: loaderId,
        backend_node_id: parseInt(backendNodeIdStr, 10),
      };
    }

    return null;
  }

  /**
   * Get and clear pending invalidations.
   * Call before computing delta to include frame-navigation invalidations.
   */
  drainInvalidations(): ScopedElementRef[] {
    const invalidations = [...this.pendingInvalidations];
    this.pendingInvalidations = [];
    return invalidations;
  }

  /**
   * Remove refs from tracking (called when delta reports them as removed).
   * Prevents unbounded growth of issuedRefs.
   */
  pruneRefs(refs: ScopedElementRef[]): void {
    for (const ref of refs) {
      const compositeKey = makeCompositeKey(ref);
      this.issuedRefs.delete(compositeKey);
    }
  }

  /**
   * Clear all refs (called on full page navigation).
   */
  clearAllRefs(): void {
    this.issuedRefs.clear();
    this.pendingInvalidations = [];
  }

  get mainFrame(): FrameState | undefined {
    return this.mainFrameId ? this.frames.get(this.mainFrameId) : undefined;
  }
}
```

---

## 2. Bounded DOM Stabilization

### Problem

MutationObserver-based "wait for quiet" can hang indefinitely on:

- Pages with ads/analytics (constant mutations)
- SPAs with animation loops
- Timer-based updates

Additionally, `page.evaluate` can fail if navigation occurs mid-wait.

### Solution: Hard Bounds with Graceful Failure

```typescript
interface StabilizationResult {
  status: 'stable' | 'timeout' | 'error';
  waitTimeMs: number;
  mutationCount?: number;
  warning?: string;
}

/**
 * Wait for DOM to stabilize with guaranteed termination.
 */
async function stabilizeDom(
  page: Page,
  options: {
    /** Quiet window - no mutations for this duration = stable (default: 100ms) */
    quietWindowMs?: number;
    /** Hard timeout - return regardless of mutations (default: 2000ms) */
    maxTimeoutMs?: number;
  } = {}
): Promise<StabilizationResult> {
  const quietWindowMs = options.quietWindowMs ?? 100;
  const maxTimeoutMs = options.maxTimeoutMs ?? 2000;
  const startTime = Date.now();

  try {
    const result = await page.evaluate(
      ({ quietWindowMs, maxTimeoutMs }) => {
        return new Promise<{
          stable: boolean;
          elapsed: number;
          mutationCount: number;
        }>((resolve) => {
          // Guard: document.body may not exist during navigation
          if (!document.body) {
            resolve({ stable: false, elapsed: 0, mutationCount: 0 });
            return;
          }

          let quietTimer: number | null = null;
          let mutationCount = 0;
          const start = performance.now();

          // Hard timeout - always resolves
          const hardTimeout = window.setTimeout(() => {
            cleanup();
            resolve({
              stable: false,
              elapsed: performance.now() - start,
              mutationCount,
            });
          }, maxTimeoutMs);

          const observer = new MutationObserver(() => {
            mutationCount++;

            // Reset quiet timer on each mutation
            if (quietTimer !== null) {
              clearTimeout(quietTimer);
            }

            quietTimer = window.setTimeout(() => {
              cleanup();
              resolve({
                stable: true,
                elapsed: performance.now() - start,
                mutationCount,
              });
            }, quietWindowMs);
          });

          function cleanup() {
            if (quietTimer !== null) clearTimeout(quietTimer);
            clearTimeout(hardTimeout);
            observer.disconnect();
          }

          // Start observing
          try {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          } catch {
            // Observer failed (rare edge case)
            cleanup();
            resolve({ stable: false, elapsed: 0, mutationCount: 0 });
            return;
          }

          // Initial quiet timer (page may already be stable)
          quietTimer = window.setTimeout(() => {
            cleanup();
            resolve({
              stable: true,
              elapsed: performance.now() - start,
              mutationCount,
            });
          }, quietWindowMs);
        });
      },
      { quietWindowMs, maxTimeoutMs }
    );

    const waitTimeMs = Date.now() - startTime;

    if (result.stable) {
      return {
        status: 'stable',
        waitTimeMs,
        mutationCount: result.mutationCount,
      };
    }

    return {
      status: 'timeout',
      waitTimeMs,
      mutationCount: result.mutationCount,
      warning: `DOM still mutating after ${maxTimeoutMs}ms (${result.mutationCount} mutations observed). Snapshot may be incomplete.`,
    };
  } catch (error) {
    // page.evaluate failed - likely navigation occurred
    const waitTimeMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    return {
      status: 'error',
      waitTimeMs,
      warning: `Stabilization interrupted: ${message}. Page may have navigated.`,
    };
  }
}
```

---

## 3. Snapshot Versioning

### Problem

- Page can mutate after response is sent
- Agent may have stale state when executing next tool
- Double version increments waste version space
- No history means old versions can't be diffed

### Solution: Monotonic Versioning with Peek/Capture

```typescript
interface VersionedSnapshot {
  /** Monotonically increasing version number */
  version: number;

  /** The snapshot data */
  snapshot: Snapshot;

  /** Content hash for quick equality check */
  hash: string;

  /** Capture timestamp */
  timestamp: number;
}

class SnapshotVersionManager {
  private currentVersion = 0;
  private current: VersionedSnapshot | null = null;

  // Keep last N versions for delta computation against old agent state
  private history: VersionedSnapshot[] = [];
  private readonly maxHistorySize = 3;

  /**
   * Peek at current state without incrementing version.
   * Use to check if state changed before deciding to capture.
   */
  async peek(page: Page, cdp: CdpClient): Promise<{ hash: string; changed: boolean }> {
    const snapshot = await compileSnapshot(page, cdp);
    const hash = hashSnapshot(snapshot);
    const changed = !this.current || this.current.hash !== hash;
    return { hash, changed };
  }

  /**
   * Capture new snapshot only if state changed.
   * Avoids double version increments.
   */
  async captureIfChanged(
    page: Page,
    cdp: CdpClient
  ): Promise<{ versioned: VersionedSnapshot; isNew: boolean }> {
    const snapshot = await compileSnapshot(page, cdp);
    const hash = hashSnapshot(snapshot);

    // No change - return existing
    if (this.current && this.current.hash === hash) {
      return { versioned: this.current, isNew: false };
    }

    // State changed - create new version
    this.currentVersion++;
    const versioned: VersionedSnapshot = {
      version: this.currentVersion,
      snapshot,
      hash,
      timestamp: Date.now(),
    };

    // Archive current to history before replacing
    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }

    this.current = versioned;
    return { versioned, isNew: true };
  }

  /**
   * Get snapshot for a specific version.
   * Returns current if version matches, searches history otherwise.
   */
  getVersion(version: number): VersionedSnapshot | null {
    if (this.current?.version === version) {
      return this.current;
    }
    return this.history.find((h) => h.version === version) ?? null;
  }

  /**
   * Validate agent's assumed version against current state.
   * Returns appropriate response strategy.
   */
  async validateAgentState(
    page: Page,
    cdp: CdpClient,
    agentVersion?: number
  ): Promise<ValidationResult> {
    const { versioned, isNew } = await this.captureIfChanged(page, cdp);

    // No agent version provided - assume they want current
    if (agentVersion === undefined) {
      return {
        status: 'current',
        currentVersion: versioned,
      };
    }

    // Agent has current version
    if (agentVersion === versioned.version) {
      return {
        status: 'current',
        currentVersion: versioned,
      };
    }

    // Agent has old version - try to compute delta from their version
    const agentSnapshot = this.getVersion(agentVersion);

    if (agentSnapshot) {
      // Can compute delta from agent's known state
      return {
        status: 'stale_with_history',
        currentVersion: versioned,
        agentVersion: agentSnapshot,
        canComputeDelta: true,
      };
    }

    // Agent version too old (not in history) - must send full
    return {
      status: 'stale_no_history',
      currentVersion: versioned,
      agentVersionNumber: agentVersion,
      canComputeDelta: false,
    };
  }

  /**
   * Force capture (ignores hash check).
   * Use after actions that definitely changed state.
   */
  async forceCapture(page: Page, cdp: CdpClient): Promise<VersionedSnapshot> {
    const snapshot = await compileSnapshot(page, cdp);
    const hash = hashSnapshot(snapshot);

    this.currentVersion++;
    const versioned: VersionedSnapshot = {
      version: this.currentVersion,
      snapshot,
      hash,
      timestamp: Date.now(),
    };

    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }

    this.current = versioned;
    return versioned;
  }

  /**
   * Reset all state (call on full page navigation).
   */
  reset(): void {
    this.current = null;
    this.history = [];
    // Don't reset currentVersion - keep it monotonic across navigations
  }
}

interface ValidationResult {
  status: 'current' | 'stale_with_history' | 'stale_no_history';
  currentVersion: VersionedSnapshot;
  agentVersion?: VersionedSnapshot;
  agentVersionNumber?: number;
  /** Only present when status is 'stale_with_history' or 'stale_no_history' */
  canComputeDelta?: boolean;
}
```

---

## 4. Baseline and Overlay Management

### Problem

- Baseline must exist before first delta computation
- Overlay detection must be deterministic
- Nested overlays must not misclassify base changes
- Advancing baseline during overlay causes incorrect deltas

### Solution: Explicit State Machine

```typescript
type PageStateMode = 'uninitialized' | 'base' | 'overlay';

interface OverlayState {
  /** Root element of the overlay */
  rootRef: ScopedElementRef;

  /** Snapshot of overlay content at time of detection */
  snapshot: Snapshot;

  /** Hash for change detection */
  contentHash: string;

  /** Detection confidence (for debugging) */
  confidence: number;

  /** Overlay type for response formatting */
  overlayType: 'modal' | 'dialog' | 'dropdown' | 'tooltip' | 'unknown';

  /**
   * Refs captured at overlay-open time for invalidation on close.
   * Uses original loaderId to match refs the agent received.
   */
  capturedRefs: ScopedElementRef[];
}

class PageSnapshotState {
  private mode: PageStateMode = 'uninitialized';

  // Base page state (excludes overlay content)
  private baseline: VersionedSnapshot | null = null;
  // FIXED: Use composite key to prevent cross-frame collisions
  private baselineNodes = new Map<CompositeNodeKey, KnownNodeState>();

  // Track main frame loaderId for navigation detection
  private baselineMainFrameLoaderId: string | null = null;

  // Overlay stack
  private overlayStack: OverlayState[] = [];

  // Nodes in current context (base or top overlay)
  // FIXED: Use composite key to prevent cross-frame collisions
  private contextNodes = new Map<CompositeNodeKey, KnownNodeState>();

  // Frame tracker (injected) - exposed for formatting
  private _frameTracker: FrameTracker;

  // Version manager (injected)
  private _versionManager: SnapshotVersionManager;

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
      // FIXED: Don't modify baseline during overlay - only update overlay snapshot
      // This preserves "overlay isolates baseline" invariant while preventing
      // double-counting of pre-validation changes in post-action delta.
      const topOverlay = this.overlayStack[this.overlayStack.length - 1];
      const newOverlayNodes = this.extractOverlayNodes(versioned.snapshot, topOverlay.rootRef);

      // Update overlay snapshot so handleOverlayContentChange diffs from current state
      topOverlay.snapshot = { ...versioned.snapshot, nodes: newOverlayNodes };
      topOverlay.contentHash = hashNodes(newOverlayNodes);

      // Also update capturedRefs to include any new nodes
      const newRefs = newOverlayNodes
        .map((n) => this._frameTracker.createRef(n.backend_node_id, n.frame_id))
        .filter((ref): ref is ScopedElementRef => ref !== null);
      topOverlay.capturedRefs = newRefs;

      this.updateContextNodes(newOverlayNodes);
      return false;
    }

    this.baseline = versioned;
    this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
    this.updateBaselineNodes(versioned.snapshot.nodes);
    this.updateContextNodes(versioned.snapshot.nodes);
    return true;
  }

  /** Check if currently in overlay mode. */
  get isInOverlayMode(): boolean {
    return this.mode === 'overlay';
  }

  /**
   * Initialize baseline. MUST be called before any delta computation.
   * Ensures frame tracker is initialized first.
   */
  async initialize(page: Page, cdp: CdpClient): Promise<SnapshotResponse> {
    // FIXED: Ensure frame tracker is ready before creating refs
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
    actionType: ActionType
  ): Promise<SnapshotResponse> {
    // Guard: must be initialized
    if (this.mode === 'uninitialized') {
      return this.initialize(page, cdp);
    }

    // FIXED: Ensure frame tracker is ready
    await this._frameTracker.ensureInitialized();

    // Get frame invalidations first
    const frameInvalidations = this._frameTracker.drainInvalidations();

    // FIXED: Detect full page navigation by checking main frame loaderId
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
        content: '✓ Action completed. No visible changes.',
        version: versioned.version,
      };
    }

    // Detect overlay changes BEFORE computing delta
    const overlayChange = this.detectOverlayChange(versioned.snapshot);

    if (overlayChange?.type === 'opened') {
      return this.handleOverlayOpened(versioned, overlayChange, frameInvalidations);
    }

    if (overlayChange?.type === 'closed') {
      return this.handleOverlayClosed(versioned, overlayChange, frameInvalidations);
    }

    // Compute delta based on current mode
    if (this.mode === 'overlay') {
      return this.handleOverlayContentChange(versioned, frameInvalidations);
    }

    // Base page change
    return this.handleBasePageChange(versioned, frameInvalidations);
  }

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

  // ============================================
  // Overlay Detection (Deterministic Rules)
  // ============================================

  /**
   * Detect overlay state changes with deterministic rules.
   *
   * Overlay detection priority (first match wins):
   * 1. Element with role="dialog" or role="alertdialog" + aria-modal="true"
   * 2. Element with role="dialog" or role="alertdialog" (non-modal)
   * 3. Element with [data-overlay], [data-modal], [data-dialog] attribute
   * 4. Element matching common class patterns with high z-index
   */
  private detectOverlayChange(snapshot: Snapshot): OverlayChangeResult | null {
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

      // FIXED: Compare full ref (frame_id + loader_id + backend_node_id)
      // to handle overlays in different frames or after navigation
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

  private findOverlays(snapshot: Snapshot): DetectedOverlay[] {
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
    const ariaModal = node.attributes?.['aria-modal'];
    const className = node.attributes?.class ?? '';

    // FIXED: Build ref directly from node's captured data instead of using createRef()
    // This avoids null issues if frame is detached and ensures correct loader_id
    const buildRef = (): ScopedElementRef => ({
      backend_node_id: node.backend_node_id,
      frame_id: node.frame_id,
      loader_id: node.loader_id,
    });

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

    // Rule 3: Data attributes
    if (
      node.attributes?.['data-overlay'] !== undefined ||
      node.attributes?.['data-modal'] !== undefined ||
      node.attributes?.['data-dialog'] !== undefined
    ) {
      return {
        rootRef: buildRef(),
        overlayType: 'modal',
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

    const matchesPattern = overlayClassPatterns.some((p) => p.test(className));
    const hasHighZIndex = (this.extractZIndex(node) ?? 0) >= 1000;
    const hasBackdrop = this.hasBackdropSibling(node);

    if (matchesPattern && (hasHighZIndex || hasBackdrop)) {
      const isDropdown = /dropdown/i.test(className);
      return {
        rootRef: buildRef(),
        overlayType: isDropdown ? 'dropdown' : 'modal',
        confidence: 0.7,
        zIndex: this.extractZIndex(node),
      };
    }

    return null;
  }

  // ============================================
  // State Change Handlers
  // ============================================

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
    const capturedRefs = overlayNodes
      .map((n) => this._frameTracker.createRef(n.backend_node_id, n.frame_id))
      .filter((ref): ref is ScopedElementRef => ref !== null);

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

    // FIXED: Call standalone format function with frameTracker
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
    change: OverlayChangeResult,
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

    // FIXED: Compute delta BEFORE updating maps, so we can look up removed refs
    const delta = this.computeDeltaFromNodes(
      currentOverlay.snapshot.nodes,
      newOverlayNodes,
      this.contextNodes
    );

    // FIXED: Collect removed refs BEFORE clearing the maps
    // delta.removed is already ScopedElementRef[] from computeDeltaFromNodes
    const allRemovedRefs = [...frameInvalidations, ...delta.removed];

    // NOW update overlay state (NOT baseline)
    currentOverlay.snapshot = { ...versioned.snapshot, nodes: newOverlayNodes };
    currentOverlay.contentHash = hashNodes(newOverlayNodes);
    this.updateContextNodes(newOverlayNodes);

    // Prune removed refs
    this.pruneRemovedRefs(allRemovedRefs);

    // FIXED: Call standalone format function with frameTracker
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
    // FIXED: Compute delta BEFORE updating maps, so we can look up removed refs
    const delta = this.computeDeltaFromNodes(
      this.baseline!.snapshot.nodes,
      versioned.snapshot.nodes,
      this.baselineNodes
    );

    // Check if delta is reliable
    if (!this.isDeltaReliable(delta, versioned.snapshot)) {
      // Fall back to full snapshot
      this.baseline = versioned;
      this.baselineMainFrameLoaderId = this._frameTracker.mainFrame?.loaderId ?? null;
      this.updateBaselineNodes(versioned.snapshot.nodes);
      this.updateContextNodes(versioned.snapshot.nodes);
      this._frameTracker.clearAllRefs();

      // FIXED: Call standalone format function with frameTracker
      return {
        type: 'full',
        content: formatFullSnapshot(versioned.snapshot, this._frameTracker),
        version: versioned.version,
        reason: 'Delta unreliable - sending full snapshot',
      };
    }

    // FIXED: Collect removed refs BEFORE clearing the maps
    // delta.removed is already ScopedElementRef[] from computeDeltaFromNodes
    const allRemovedRefs = [...frameInvalidations, ...delta.removed];

    // NOW advance baseline AFTER delta computation
    this.baseline = versioned;
    this.updateBaselineNodes(versioned.snapshot.nodes);
    this.updateContextNodes(versioned.snapshot.nodes);

    // Prune removed refs
    this.pruneRemovedRefs(allRemovedRefs);

    // FIXED: Call standalone format function with frameTracker
    return {
      type: 'delta',
      content: formatDelta(delta, frameInvalidations, { context: 'base' }, this._frameTracker),
      version: versioned.version,
    };
  }

  // ============================================
  // Delta Computation
  // ============================================

  /**
   * Compute delta between old and new node lists.
   * FIXED: Returns ScopedElementRef[] for removed (not raw IDs).
   * FIXED: Uses per-node loader_id (not mainFrame's) for correct iframe handling.
   */
  private computeDeltaFromNodes(
    oldNodes: ReadableNode[],
    newNodes: ReadableNode[],
    knownNodes: Map<CompositeNodeKey, KnownNodeState>
  ): ComputedDelta {
    // FIXED: Use per-node loader_id, not mainFrameLoaderId
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
        // Build ref directly from node's captured data
        const ref: ScopedElementRef = {
          backend_node_id: node.backend_node_id,
          frame_id: node.frame_id,
          loader_id: node.loader_id,
        };
        modified.push({
          ref,
          previousLabel: known.label,
          currentLabel: node.label,
          changeType: 'text',
        });
      }
    }

    // Compute confidence
    const totalNodes = newNodes.length;
    const changedNodes = added.length + removed.length + modified.length;
    const confidence = 1 - Math.min((changedNodes / Math.max(totalNodes, 1)) * 2, 1);

    return { added, removed, modified, confidence };
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * FIXED: Build refs directly from node's stored loader_id, NOT via createRef()
   * which would use current frame state. This ensures refs are consistent with
   * what was captured at snapshot time.
   */
  private updateContextNodes(nodes: ReadableNode[]): void {
    this.contextNodes.clear();
    for (const node of nodes) {
      const key = makeCompositeKeyFromNode(node);
      // Build ref directly from node's captured data
      const ref: ScopedElementRef = {
        backend_node_id: node.backend_node_id,
        frame_id: node.frame_id,
        loader_id: node.loader_id,
      };
      this.contextNodes.set(key, {
        backend_node_id: node.backend_node_id,
        label: node.label,
        kind: node.kind,
        contentHash: hashNodeContent(node),
        ref,
      });
    }
  }

  /**
   * FIXED: Build refs directly from node's stored loader_id, NOT via createRef()
   * which would use current frame state. This ensures refs are consistent with
   * what was captured at snapshot time.
   */
  private updateBaselineNodes(nodes: ReadableNode[]): void {
    this.baselineNodes.clear();
    for (const node of nodes) {
      const key = makeCompositeKeyFromNode(node);
      // Build ref directly from node's captured data
      const ref: ScopedElementRef = {
        backend_node_id: node.backend_node_id,
        frame_id: node.frame_id,
        loader_id: node.loader_id,
      };
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

  private isDeltaReliable(delta: ComputedDelta, snapshot: Snapshot): boolean {
    // FIXED: Use delta.confidence directly (computed in computeDeltaFromNodes)
    // This aligns with spec which says "confidence < 0.6" triggers fallback
    if (delta.confidence < 0.6) {
      return false;
    }

    // Also check absolute change count for small snapshots where
    // percentage-based confidence might be misleading
    const totalNodes = snapshot.nodes.length;
    const changedNodes = delta.added.length + delta.removed.length + delta.modified.length;

    // If more than 40% of nodes changed, unreliable regardless of confidence
    if (changedNodes / Math.max(totalNodes, 1) > 0.4) {
      return false;
    }

    // Unreliable if too many consecutive deltas (accumulated drift risk)
    // This would require tracking delta count - simplified here

    return true;
  }
}
```

---

## 5. Response Formatting

### Full Snapshot Response

```typescript
/**
 * Format full snapshot for agent communication.
 * FIXED: Accepts frameTracker for node serialization.
 */
function formatFullSnapshot(snapshot: Snapshot, frameTracker: FrameTracker): string {
  const parts: string[] = [];

  parts.push(`# Page: ${snapshot.title}`);
  parts.push(`URL: ${snapshot.url}`);
  parts.push('');

  // Group by semantic region if available
  const regions = groupByRegion(snapshot.nodes);

  for (const [region, nodes] of Object.entries(regions)) {
    if (nodes.length === 0) continue;

    parts.push(`## ${region}`);
    for (const node of nodes) {
      parts.push(formatNode(node, frameTracker));
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Format a node for display.
 * FIXED: Use node's stored loader_id directly, NOT frameTracker.createRef()
 * which would use current frame state. This ensures refs match what was
 * captured at snapshot time, even if frame navigated since.
 */
function formatNode(node: ReadableNode, frameTracker: FrameTracker): string {
  // Build ref directly from node's captured data - NOT from current frame state
  const ref: ScopedElementRef = {
    backend_node_id: node.backend_node_id,
    frame_id: node.frame_id,
    loader_id: node.loader_id,
  };
  const serialized = frameTracker.serializeRef(ref);
  const stateIndicators = formatState(node.state);
  return `- ${node.kind}[${serialized}]: "${node.label}"${stateIndicators}`;
}
```

### Delta Response

```typescript
/**
 * Format delta for agent communication.
 * FIXED: Accepts frameTracker for serialization.
 */
function formatDelta(
  delta: ComputedDelta,
  frameInvalidations: ScopedElementRef[],
  options: { context: 'base' | 'overlay' },
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  // Header based on context
  if (options.context === 'overlay') {
    parts.push('## Overlay Updated');
  } else {
    parts.push('## Page Updated');
  }

  // CRITICAL: Invalidations first (agent must stop using these)
  const allInvalidations = [
    ...frameInvalidations.map((r) => frameTracker.serializeRef(r)),
    ...delta.removed.map((r) => frameTracker.serializeRef(r)),
  ];

  if (allInvalidations.length > 0) {
    parts.push('');
    parts.push('### ⚠️ Invalidated References');
    parts.push('These element IDs are no longer valid. Do NOT use them:');
    parts.push(`\`${allInvalidations.join(', ')}\``);
  }

  // Additions
  if (delta.added.length > 0) {
    parts.push('');
    parts.push('### + Added');
    for (const node of delta.added) {
      parts.push(formatNode(node, frameTracker));
    }
  }

  // Modifications
  if (delta.modified.length > 0) {
    parts.push('');
    parts.push('### ~ Modified');
    for (const mod of delta.modified) {
      parts.push(
        `- [${frameTracker.serializeRef(mod.ref)}]: "${mod.previousLabel}" → "${mod.currentLabel}"`
      );
    }
  }

  // Removals (already in invalidations, but provide context)
  if (delta.removed.length > 0) {
    parts.push('');
    parts.push('### - Removed');
    parts.push(`${delta.removed.length} element(s) removed from page.`);
  }

  return parts.join('\n');
}
```

### Overlay Responses

```typescript
/**
 * Format overlay opened response.
 * FIXED: Accepts frameTracker for serialization.
 */
function formatOverlayOpened(
  overlay: OverlayState,
  nodes: ReadableNode[],
  frameInvalidations: ScopedElementRef[],
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  const typeLabel = {
    modal: '🔲 Modal',
    dialog: '💬 Dialog',
    dropdown: '📋 Dropdown',
    tooltip: '💡 Tooltip',
    unknown: '📦 Overlay',
  }[overlay.overlayType];

  parts.push(`## ${typeLabel} Opened`);
  parts.push('');

  // Invalidations
  if (frameInvalidations.length > 0) {
    parts.push('### ⚠️ Invalidated References');
    parts.push(`\`${frameInvalidations.map((r) => frameTracker.serializeRef(r)).join(', ')}\``);
    parts.push('');
  }

  // Overlay content
  parts.push('### Overlay Content');
  for (const node of nodes) {
    parts.push(formatNode(node, frameTracker));
  }

  parts.push('');
  parts.push('> Base page is accessible behind this overlay.');

  return parts.join('\n');
}

/**
 * Format overlay closed response.
 * FIXED: Accepts frameTracker for serialization.
 */
function formatOverlayClosed(
  closedOverlay: OverlayState,
  invalidations: ScopedElementRef[],
  baseDelta: ComputedDelta | null,
  frameTracker: FrameTracker
): string {
  const parts: string[] = [];

  parts.push('## ✓ Overlay Closed');
  parts.push('');

  // All overlay refs are now invalid
  parts.push('### ⚠️ Invalidated References');
  parts.push('All overlay element IDs are now invalid:');
  parts.push(`\`${invalidations.map((r) => frameTracker.serializeRef(r)).join(', ')}\``);

  // Base page changes while overlay was open
  if (baseDelta && (baseDelta.added.length > 0 || baseDelta.modified.length > 0)) {
    parts.push('');
    parts.push('### Base Page Changes');
    parts.push('The following changed while the overlay was open:');

    if (baseDelta.added.length > 0) {
      parts.push('');
      parts.push('**Added:**');
      for (const node of baseDelta.added) {
        parts.push(formatNode(node, frameTracker));
      }
    }

    if (baseDelta.modified.length > 0) {
      parts.push('');
      parts.push('**Modified:**');
      for (const mod of baseDelta.modified) {
        parts.push(
          `- [${frameTracker.serializeRef(mod.ref)}]: "${mod.previousLabel}" → "${mod.currentLabel}"`
        );
      }
    }
  } else {
    parts.push('');
    parts.push('Base page unchanged.');
  }

  return parts.join('\n');
}
```

---

## 6. Tool Integration

### Wrapper for Mutating Tools

```typescript
/**
 * Execute a mutating tool action with automatic delta computation.
 *
 * @param handle - Page handle with CDP client
 * @param toolName - Name of the tool for display
 * @param action - The action to execute
 * @param actionType - Type of action for response formatting
 * @param agentVersion - Agent's last known version (RECOMMENDED but optional)
 *
 * NOTE on agentVersion:
 * - If provided and stale: pre-validation detects drift and reports it
 * - If omitted: assumed current; any pre-action drift won't be reported,
 *   but post-action deltas are still correct (computed from current baseline)
 * - Recommendation: Always pass agentVersion for best agent experience
 */
async function executeWithDelta(
  handle: PageHandle,
  toolName: string,
  action: () => Promise<void>,
  actionType: ActionType,
  agentVersion?: number
): Promise<ToolResult> {
  // FIXED: Await to ensure initialization is complete
  const state = await getPageSnapshotState(handle);

  // Pre-execution: validate agent isn't working with stale state
  const preValidation = await state.validateAndCapture(handle.page, handle.cdp, agentVersion);

  // FIXED: If agent version is too old (not in history), short-circuit the action
  // and return full snapshot. This keeps the agent consistent - we don't want to
  // execute actions when we can't tell them what changed since their last known state.
  if (preValidation.status === 'stale_no_history') {
    // Reset state and return full snapshot - agent must re-sync before acting
    const fullResponse = await state.initialize(handle.page, handle.cdp);
    return {
      content: [
        {
          type: 'text',
          text:
            `⚠️ Action not executed: Your page state (v${preValidation.agentVersionNumber}) is too stale to reconcile.\n\n` +
            `Here is the current page state. Please review and retry your action.\n\n` +
            `${fullResponse.content}\n\n_v${fullResponse.version}_`,
        },
      ],
    };
  }

  let preNotice = '';
  let pendingBaselineAdvance: VersionedSnapshot | null = null;

  // For stale_with_history, we can show what changed and proceed
  if (preValidation.status === 'stale_with_history') {
    pendingBaselineAdvance = preValidation.currentVersion;
    const preDelta = computeDeltaBetweenSnapshots(
      preValidation.agentVersion!.snapshot,
      preValidation.currentVersion.snapshot,
      state.frameTracker
    );
    const context = state.isInOverlayMode ? 'overlay' : 'base';
    preNotice = `⚠️ ${context === 'overlay' ? 'Overlay' : 'Page'} changed before action:\n${formatDelta(preDelta, [], { context }, state.frameTracker)}\n\n`;
  }

  // Execute action - if this throws, baseline is NOT advanced (invariant preserved)
  try {
    await action();
  } catch (error) {
    // Action failed - do NOT advance baseline, return error
    // Agent still has their old version which is still valid
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `✗ ${toolName} failed: ${message}\n\nPage state unchanged. Your element references remain valid.`,
        },
      ],
      isError: true,
    };
  }

  // Action succeeded - NOW advance baseline if needed (before computing post-delta)
  if (pendingBaselineAdvance) {
    state.advanceBaselineTo(pendingBaselineAdvance);
  }

  // Stabilize DOM
  const stability = await stabilizeDom(handle.page);

  // Compute response (delta will be from advanced baseline)
  const response = await state.computeResponse(handle.page, handle.cdp, actionType);

  // Build final result
  const parts: string[] = [];

  if (preNotice) {
    parts.push(preNotice);
  }

  parts.push(`✓ ${toolName} completed`);

  if (stability.warning) {
    parts.push(`\n⚠️ ${stability.warning}`);
  }

  parts.push(`\n\n${response.content}`);
  parts.push(`\n\n_v${response.version}_`);

  return {
    content: [{ type: 'text', text: parts.join('') }],
  };
}

/**
 * Compute delta between two snapshots (standalone, for pre-validation).
 *
 * FIXED: For removed nodes, create refs directly from the node's loader_id
 * (not the current frame's loaderId), since the node was valid at the
 * time of the old snapshot, not now.
 */
function computeDeltaBetweenSnapshots(
  oldSnapshot: Snapshot,
  newSnapshot: Snapshot,
  frameTracker: FrameTracker
): ComputedDelta {
  const oldKeys = new Set(oldSnapshot.nodes.map((n) => makeCompositeKeyFromNode(n)));
  const newKeys = new Set(newSnapshot.nodes.map((n) => makeCompositeKeyFromNode(n)));

  const added: ReadableNode[] = [];
  const removed: ScopedElementRef[] = [];
  const modified: ModifiedNode[] = [];

  for (const node of newSnapshot.nodes) {
    if (!oldKeys.has(makeCompositeKeyFromNode(node))) {
      added.push(node);
    }
  }

  for (const node of oldSnapshot.nodes) {
    if (!newKeys.has(makeCompositeKeyFromNode(node))) {
      // FIXED: Create ref directly from node data, using the node's loader_id
      // (from when the snapshot was captured), NOT the current frame's loaderId.
      // This ensures the invalidation message shows the ref the agent knows.
      removed.push({
        backend_node_id: node.backend_node_id,
        frame_id: node.frame_id,
        loader_id: node.loader_id,
      });
    }
  }

  // Simplified: skip modification detection for pre-validation

  const totalNodes = newSnapshot.nodes.length;
  const changedNodes = added.length + removed.length;
  const confidence = 1 - Math.min((changedNodes / Math.max(totalNodes, 1)) * 2, 1);

  return { added, removed, modified, confidence };
}
```

### Per-Page State Management

```typescript
// Use WeakMap for automatic cleanup when Page is garbage collected
const pageStates = new WeakMap<Page, PageSnapshotState>();

/**
 * Get or create PageSnapshotState for a page handle.
 * FIXED: Returns a promise to ensure initialization is complete.
 */
async function getPageSnapshotState(handle: PageHandle): Promise<PageSnapshotState> {
  let state = pageStates.get(handle.page);

  if (!state) {
    const frameTracker = new FrameTracker(handle.cdp);
    const versionManager = new SnapshotVersionManager();
    state = new PageSnapshotState(frameTracker, versionManager);
    pageStates.set(handle.page, state);
  }

  // FIXED: Always ensure initialization is complete before returning
  // This is safe to call multiple times - it's idempotent
  await state.frameTracker.ensureInitialized();

  return state;
}
```

---

## 7. Safety Invariants

### Must Hold True

1. **Baseline exists before delta**: `computeResponse()` initializes on first call
2. **Baseline advances after delta**: Never before, to ensure correct diff base
3. **Overlay isolates baseline**: While overlay open, baseline is frozen; `advanceBaselineTo()` updates overlay snapshot (not baseline) to prevent double-counting
4. **Refs scoped by frame+loader**: Prevents cross-frame/navigation collisions
5. **Invalidations explicit**: Agent always told which refs are dead
6. **Stabilization bounded**: Hard timeout prevents hangs
7. **Version monotonic**: Never decreases, even across navigations
8. **Frame tracker initialized**: All createRef calls happen after initialization
9. **Removals captured before map clear**: Delta computation extracts removed refs before updating maps
10. **Format functions receive frameTracker**: All formatting functions require frameTracker for proper serialization
11. **Removed refs use original loaderId**: Invalidation messages use node's loader_id (from when captured), not current
12. **Overlay refs captured at open**: `capturedRefs` stored when overlay opens; used at close for correct invalidation
13. **Stale-no-history short-circuits**: When agent version not in history, action is NOT executed; full snapshot returned for re-sync
14. **Refs built from node data**: All ref construction uses node's stored `loader_id`, never `frameTracker.createRef()` for formatting

### Acceptable Risks

1. **Hash collision in version manager**: `captureIfChanged` uses hash equality to skip version bumps. Hash collisions are theoretically possible but extremely rare with cryptographic hashes. If this occurs, a "no change" response is sent incorrectly. This is accepted as the probability is negligible and impact is minor (agent would see stale data until next action).

### Fallback Triggers

Send full snapshot instead of delta when:

- First interaction (no baseline)
- Full page navigation (main frame loaderId changed)
- Delta confidence < 0.6 (too many changes)
- Agent version not in history (action short-circuited)
- Frame tracker reports major invalidations
- Snapshot has unknown frames (`hasUnknownFrames` flag)
- Explicit agent request

**Note on full snapshots and invalidation**: Full snapshots implicitly invalidate all prior refs. The "explicit invalidation" principle is satisfied because:

1. The response type is `'full'`, signaling a complete state reset
2. The agent receives all current refs with current loaderIds
3. Any ref the agent held that doesn't appear in the full snapshot is implicitly invalid

### Design Decisions

**Q: What happens when createRef returns null during formatting/delta computation?**

A: With Fix 20/23 (v6), we no longer use `createRef()` during formatting. Refs are built directly from node's captured data (`loader_id` stored at snapshot time). This eliminates the null case entirely - if a node exists in the snapshot, it has valid ref data.

**Q: Should hashNodeContent include state/attributes for modified-node detection?**

A: Yes. `hashNodeContent(node)` should include:

- `node.label` (text content)
- `node.state` (enabled, checked, selected, focused, expanded)
- `node.attributes` (relevant attributes like value, placeholder, aria-\*)

This ensures modifications to interactive state (e.g., checkbox checked) are detected. Implementation detail - not specified in this design doc but required for correct behavior.

---

## 8. Key Design Fixes (v2/v3/v4/v5/v6)

This section documents critical fixes made to address review feedback:

### Fix 1: Serialized Refs Always Include LoaderId

**Problem**: Main-frame short-form refs dropped `loader_id`, causing stale refs from previous navigations to be treated as valid.

**Solution**: All serialized refs now include `loader_id`:

- Main frame: `"loaderId:backendNodeId"` (was just `"backendNodeId"`)
- Iframe: `"frameId:loaderId:backendNodeId"` (unchanged)

`parseRef()` validates that the loaderId matches the current frame state, rejecting stale refs.

### Fix 2: Composite Keys for Node Maps

**Problem**: `baselineNodes` and `contextNodes` used only `backend_node_id` as key, which collides across frames.

**Solution**: All node maps now use `CompositeNodeKey` (`"frameId:loaderId:backendNodeId"`):

```typescript
private baselineNodes = new Map<CompositeNodeKey, KnownNodeState>();
private contextNodes = new Map<CompositeNodeKey, KnownNodeState>();
```

### Fix 3: Consistent Removal Type

**Problem**: `delta.removed` was inconsistently typed as IDs vs `ScopedElementRef[]`, and lookups happened after maps were refreshed.

**Solution**:

1. `ComputedDelta.removed` is always `ScopedElementRef[]`
2. `computeDeltaFromNodes()` looks up refs from `knownNodes` map BEFORE it's cleared
3. Removed refs are collected BEFORE `updateContextNodes()`/`updateBaselineNodes()` is called

### Fix 4: Frame Tracker Initialization

**Problem**: `FrameTracker.initialize()` was async but not awaited; `createRef()` could return null on early tool calls.

**Solution**:

1. `FrameTracker` tracks initialization state with `initialized` flag
2. `ensureInitialized()` method is idempotent and safe to call multiple times
3. `PageSnapshotState.initialize()` awaits `frameTracker.ensureInitialized()`
4. `getPageSnapshotState()` is now async and awaits initialization

### Fix 5: Explicit Navigation Detection

**Problem**: Full navigation was listed as a fallback trigger but there was no explicit URL/loader change check.

**Solution**:

1. `PageSnapshotState` tracks `baselineMainFrameLoaderId`
2. `computeResponse()` compares current `mainFrame.loaderId` to baseline
3. If loaderId changed → `handleFullNavigation()` resets all state and returns full snapshot

### Fix 6: Per-Frame LoaderId in Composite Keys (v3)

**Problem**: Composite keys used `mainFrameLoaderId` for all nodes, so iframe nodes got wrong loaderId.

**Solution**:

1. `ReadableNode` now includes `loader_id` captured at snapshot time
2. `makeCompositeKeyFromNode(node)` uses `node.loader_id` (not mainFrame's)
3. Snapshot compiler must capture each node's frame's loaderId

### Fix 7: formatNode Serialization (v3)

**Problem**: `formatNode` called `serializeRef(node)` but `serializeRef` takes `ScopedElementRef`.

**Solution**:

1. `formatNode(node, frameTracker)` now takes frameTracker parameter
2. Creates ref via `frameTracker.createRef(node.backend_node_id, node.frame_id)`
3. Serializes via `frameTracker.serializeRef(ref)`

### Fix 8: Public Methods for External Access (v3)

**Problem**: `executeWithDelta` accessed private `versionManager` and `frameTracker`.

**Solution**:

1. Renamed private fields to `_frameTracker` and `_versionManager`
2. Added public getter `get frameTracker()` for serialization
3. Added `validateAndCapture()` method for pre-validation
4. Added `advanceBaselineTo()` method for baseline updates

### Fix 9: Pre-Validation Baseline Advancement (v3)

**Problem**: Pre-validation captured new version but baseline wasn't updated, causing double-counting.

**Solution**:

1. After pre-validation detects staleness, call `state.advanceBaselineTo(preValidation.currentVersion)`
2. Post-action delta is computed from the advanced baseline
3. Changes detected in pre-validation are reported separately and not double-counted

### Fix 10: formatNode and Format Function Signatures (v4)

**Problem**: `formatNode(node)` and other format functions were called without `frameTracker`, and `serializeRef()` was called directly instead of via frameTracker.

**Solution**:

1. All format functions now accept `frameTracker: FrameTracker` parameter
2. `formatFullSnapshot(snapshot, frameTracker)` - requires frameTracker
3. `formatDelta(delta, invalidations, options, frameTracker)` - requires frameTracker
4. `formatOverlayOpened(overlay, nodes, invalidations, frameTracker)` - requires frameTracker
5. `formatOverlayClosed(overlay, invalidations, delta, frameTracker)` - requires frameTracker
6. All call sites updated to pass `this._frameTracker`

### Fix 11: advanceBaselineTo Respects Overlay Mode (v4)

**Problem**: `advanceBaselineTo()` was called during pre-validation regardless of overlay state, violating "overlay isolates baseline" invariant.

**Solution**:

1. `advanceBaselineTo()` now returns `boolean` indicating if baseline was advanced
2. In overlay mode, only context is updated (baseline frozen) - returns `false`
3. In base mode, both baseline and context are updated - returns `true`
4. `executeWithDelta` checks return value and adjusts notification message
5. Added `get isInOverlayMode()` accessor for external state checks

### Fix 12: computeDeltaBetweenSnapshots Uses Node's LoaderId (v4)

**Problem**: For removed nodes, `computeDeltaBetweenSnapshots` used `frameTracker.createRef()` which uses the current frame's loaderId, not the old snapshot's loaderId.

**Solution**:

1. For removed nodes, create `ScopedElementRef` directly from node data:
   ```typescript
   removed.push({
     backend_node_id: node.backend_node_id,
     frame_id: node.frame_id,
     loader_id: node.loader_id, // From old snapshot, not current frame
   });
   ```
2. This ensures invalidation messages reference the refs the agent actually knows

### Fix 13: versionManager Getter Added (v5)

**Problem**: Lines 792, 839, 880 called `this.versionManager.*` but field was `_versionManager`. Code wouldn't compile.

**Solution**: Added private getter:

```typescript
private get versionManager(): SnapshotVersionManager {
  return this._versionManager;
}
```

### Fix 14: Pre-validation Double-Counting in Overlay Mode (v5)

**Problem**: `advanceBaselineTo()` in overlay mode only updated `contextNodes`, leaving overlay snapshot stale. `handleOverlayContentChange` then diffed against stale snapshot, re-reporting pre-validation changes.

**Solution**: `advanceBaselineTo()` now updates the top overlay's snapshot when in overlay mode:

```typescript
if (this.mode === 'overlay') {
  const topOverlay = this.overlayStack[this.overlayStack.length - 1];
  const newOverlayNodes = this.extractOverlayNodes(versioned.snapshot, topOverlay.rootRef);
  topOverlay.snapshot = { ...versioned.snapshot, nodes: newOverlayNodes };
  topOverlay.contentHash = hashNodes(newOverlayNodes);
  topOverlay.capturedRefs = /* updated refs */;
  this.updateContextNodes(newOverlayNodes);
  return false;
}
```

### Fix 15: Overlay-Close Invalidations Use Captured Refs (v5)

**Problem**: `handleOverlayClosed` regenerated refs via `createRef()` (current loaderId), violating invariant #11. If frame navigated while overlay was open, invalidations wouldn't match refs agent saw.

**Solution**:

1. Added `capturedRefs: ScopedElementRef[]` to `OverlayState` interface
2. `handleOverlayOpened` captures refs at open time with current (correct) loaderId
3. `handleOverlayClosed` uses `closedOverlay.capturedRefs` instead of regenerating

### Fix 16: FrameTracker Initialize Race Condition (v5)

**Problem**: `initialized = true` was set after await. If `doInitialize()` threw, subsequent calls saw rejected `initPromise` but `initialized` was still false.

**Solution**: Wrapped initialization in try/catch, reset `initPromise` on failure:

```typescript
this.initPromise = (async () => {
  try {
    await this.doInitialize();
    this.initialized = true;
  } catch (error) {
    this.initPromise = null; // Allow retry
    throw error;
  }
})();
```

### Fix 17: handleOverlayClosed Control Flow Clarity (v5)

**Problem**: Method had confusing control flow with shared code between if-branch and fall-through.

**Solution**: Restructured to have explicit early return for nested overlay case, making the two paths (nested vs return-to-base) clearly separated.

### Fix 18: Baseline Advance Deferred Until After Action Success (v6)

**Problem**: `executeWithDelta` advanced baseline during pre-validation before action ran. If action threw, baseline moved without a delivered delta, breaking "advance only after delivery" invariant.

**Solution**:

1. Store `pendingBaselineAdvance` instead of immediately calling `advanceBaselineTo()`
2. Wrap action in try/catch - on failure, return error without advancing baseline
3. Only call `advanceBaselineTo()` after action succeeds
4. Agent's old refs remain valid on action failure

### Fix 19: Stale-No-History Short-Circuits Action (v6)

**Problem**: When agent's version is too old (not in history), we can't tell them what changed. Proceeding with action on unreconcilable state risks incorrect behavior.

**Solution**: `stale_no_history` now short-circuits the action entirely:

```typescript
if (preValidation.status === 'stale_no_history') {
  const fullResponse = await state.initialize(handle.page, handle.cdp);
  return {
    content: [{
      type: 'text',
      text: `⚠️ Action not executed: Your page state (v${...}) is too stale...`
    }],
  };
}
```

Agent must re-sync and retry.

### Fix 20: Refs Built From Node's Stored loader_id (v6)

**Problem**: `formatNode`, `updateContextNodes`, `updateBaselineNodes`, and `computeDeltaFromNodes` used `frameTracker.createRef()` which looks up current frame state. If frame navigated between snapshot and formatting, refs would have wrong loaderId.

**Solution**: Build `ScopedElementRef` directly from node's captured data:

```typescript
const ref: ScopedElementRef = {
  backend_node_id: node.backend_node_id,
  frame_id: node.frame_id,
  loader_id: node.loader_id, // From snapshot, not current frame
};
```

### Fix 21: Overlay Replacement Compares Full Ref (v6)

**Problem**: `detectOverlayChange` compared only `backend_node_id`, ignoring `frame_id`/`loader_id`. An overlay in a new document could be treated as the same one.

**Solution**: Compare all three components:

```typescript
const isSameOverlay =
  topCurrent.rootRef.backend_node_id === topPrevious.rootRef.backend_node_id &&
  topCurrent.rootRef.frame_id === topPrevious.rootRef.frame_id &&
  topCurrent.rootRef.loader_id === topPrevious.rootRef.loader_id;
```

### Fix 22: Unknown Frame Forces Full Snapshot (v6)

**Problem**: Snapshot compiler used `'unknown'` when frame lookup failed, breaking ref uniqueness/invalidation guarantees.

**Solution**:

1. Compiler sets `hasUnknownFrames: true` flag instead of using 'unknown'
2. Nodes with unknown frames are skipped
3. Caller forces full snapshot when flag is set

### Fix 23: Overlay Classification Builds Refs Directly (v6)

**Problem**: `classifyAsOverlay` used `createRef(...)!` which could throw if frame is missing/detached.

**Solution**: Build ref directly from node's captured data (which always exists):

```typescript
const buildRef = (): ScopedElementRef => ({
  backend_node_id: node.backend_node_id,
  frame_id: node.frame_id,
  loader_id: node.loader_id,
});
```

### Fix 24: Delta Reliability Uses Confidence Score (v6)

**Problem**: Spec said "confidence < 0.6" but `isDeltaReliable` only checked 40% change ratio and ignored `delta.confidence`.

**Solution**: Check both:

```typescript
if (delta.confidence < 0.6) return false;
if (changedNodes / totalNodes > 0.4) return false;
```

---

## Implementation Requirements

### Snapshot Compiler Must Capture loader_id

The `ReadableNode` interface requires `loader_id` to be captured at snapshot time. The snapshot compiler must:

1. Query `Page.getFrameTree()` to get current frame states
2. For each node, look up the frame's `loaderId` using `node.frame_id`
3. Include `loader_id` in the serialized node data

```typescript
// In snapshot compiler
async function compileSnapshot(page: Page, cdp: CdpClient): Promise<Snapshot> {
  // Get frame tree for loaderId lookup
  const { frameTree } = await cdp.send('Page.getFrameTree', {});
  const frameLoaderIds = new Map<string, string>();
  collectFrameLoaderIds(frameTree, frameLoaderIds);

  const nodes: ReadableNode[] = [];
  let hasUnknownFrames = false;

  for (const rawNode of domNodes) {
    const loaderId = frameLoaderIds.get(rawNode.frameId);

    // FIXED: If frame lookup fails, mark for full snapshot fallback
    // instead of silently degrading with 'unknown' loader_id
    if (!loaderId) {
      hasUnknownFrames = true;
      console.warn(`Frame ${rawNode.frameId} not found in frame tree`);
      continue; // Skip this node - cannot guarantee ref uniqueness
    }

    nodes.push({
      node_id: rawNode.nodeId,
      backend_node_id: rawNode.backendNodeId,
      frame_id: rawNode.frameId,
      loader_id: loaderId,
      kind: rawNode.kind,
      label: rawNode.label,
    });
  }

  return {
    nodes,
    // Signal to caller that delta computation should be skipped
    hasUnknownFrames,
  };
}
```

**Note**: When `hasUnknownFrames` is true, the caller should force a full snapshot response instead of attempting delta computation, as ref uniqueness cannot be guaranteed.

---

## 9. Testing Strategy

### Unit Tests

1. **FrameTracker**
   - Invalidates refs on frame navigation
   - Handles frame detach
   - Serializes/parses refs correctly
   - Prunes refs on removal
   - Initialize succeeds on first call
   - Initialize retries after failure (reset initPromise)
   - Initialize is idempotent (multiple calls safe)

2. **SnapshotVersionManager**
   - Increments version on change
   - Doesn't increment when unchanged (peek)
   - Maintains history up to limit
   - Validates agent versions correctly

3. **PageSnapshotState**
   - Initializes on first call
   - Detects overlay open/close
   - Computes correct deltas
   - Advances baseline at right time
   - Handles nested overlays
   - `advanceBaselineTo()` returns false in overlay mode
   - `advanceBaselineTo()` returns true in base mode
   - `advanceBaselineTo()` in overlay mode updates overlay snapshot (not baseline)
   - `advanceBaselineTo()` in overlay mode updates `capturedRefs`
   - `handleOverlayOpened` captures refs with current loaderId
   - `handleOverlayClosed` uses `capturedRefs` (not regenerated refs)

4. **stabilizeDom**
   - Returns stable when quiet
   - Returns timeout when perpetual mutations
   - Handles missing document.body
   - Handles navigation mid-wait

5. **Format Functions**
   - `formatNode` requires frameTracker parameter
   - `formatFullSnapshot` serializes refs via frameTracker
   - `formatDelta` serializes all refs via frameTracker
   - No direct `serializeRef()` calls (use `frameTracker.serializeRef()`)

6. **computeDeltaBetweenSnapshots**
   - Removed refs use node's loader_id (not current frame's)
   - Invalidation messages reference agent's known refs

### Integration Tests

1. **Modal flow**: Open modal → interact → close → verify base state
2. **Navigation flow**: Navigate → full snapshot → interact → delta
3. **Frame navigation**: iframe navigates → old refs invalidated
4. **Stale agent**: Agent with old version gets appropriate response
5. **Unstable page**: Page with animations → bounded response
6. **Overlay baseline isolation**: Pre-validation staleness during overlay doesn't corrupt base
7. **Iframe loader_id**: Nodes in iframes have correct loader_id in refs
8. **Pre-validation in overlay mode**: Changes reported in preNotice not double-counted in post-delta
9. **Overlay close after frame navigation**: Invalidations use original loaderId from open time
10. **FrameTracker init failure recovery**: After init failure, next call retries successfully
11. **Stale-no-history short-circuit**: Action NOT executed, full snapshot returned, agent must retry
12. **Action failure preserves baseline**: Thrown error does NOT advance baseline, old refs valid
13. **Unknown frame forces full snapshot**: Snapshot with `hasUnknownFrames` triggers full response
14. **Overlay replacement across frames**: Different frame/loaderId treated as different overlay

---

## Appendix: Type Definitions

```typescript
// Core types referenced throughout

/**
 * Globally unique element reference.
 * Includes frame_id and loader_id to prevent cross-frame/navigation collisions.
 */
interface ScopedElementRef {
  backend_node_id: number;
  frame_id: string;
  loader_id: string;
}

/**
 * Serialized ref format for agent communication.
 * Main frame: "loaderId:backendNodeId"
 * Iframe: "frameId:loaderId:backendNodeId"
 */
type SerializedRef = string;

/**
 * Composite key for node lookup maps.
 * Format: "frameId:loaderId:backendNodeId"
 * Prevents collisions across frames.
 */
type CompositeNodeKey = string;

/**
 * Tracked state for a known node.
 * Stored in baseline/context maps with CompositeNodeKey.
 */
interface KnownNodeState {
  backend_node_id: number;
  label: string;
  kind: string;
  contentHash: string;
  ref: ScopedElementRef;
}

/**
 * Computed delta between two snapshots.
 * IMPORTANT: `removed` contains ScopedElementRef (not raw IDs)
 * to ensure proper invalidation formatting.
 */
interface ComputedDelta {
  /** Nodes that were added (new in current snapshot) */
  added: ReadableNode[];

  /** Refs that were removed (present in old, absent in new) - fully scoped */
  removed: ScopedElementRef[];

  /** Nodes that were modified (same ref, different content) */
  modified: ModifiedNode[];

  /** Confidence score 0-1; low confidence triggers full snapshot fallback */
  confidence: number;
}

interface ModifiedNode {
  ref: ScopedElementRef;
  previousLabel: string;
  currentLabel: string;
  changeType: 'text' | 'state' | 'attributes';
}

interface SnapshotResponse {
  type: 'full' | 'delta' | 'no_change' | 'overlay_opened' | 'overlay_closed';
  content: string;
  version: number;
  reason?: string;
}

interface OverlayChangeResult {
  type: 'opened' | 'closed' | 'replaced';
  overlay?: DetectedOverlay;
  closedOverlay?: OverlayState;
  newOverlay?: DetectedOverlay;
}

interface DetectedOverlay {
  rootRef: ScopedElementRef;
  overlayType: 'modal' | 'dialog' | 'dropdown' | 'tooltip' | 'unknown';
  confidence: number;
  zIndex?: number;
}

interface OverlayState {
  rootRef: ScopedElementRef;
  snapshot: Snapshot;
  contentHash: string;
  confidence: number;
  overlayType: 'modal' | 'dialog' | 'dropdown' | 'tooltip' | 'unknown';
  /**
   * Refs captured at overlay-open time for invalidation on close.
   * Uses original loaderId to match refs the agent received.
   */
  capturedRefs: ScopedElementRef[];
}

interface ValidationResult {
  status: 'current' | 'stale_with_history' | 'stale_no_history';
  currentVersion: VersionedSnapshot;
  agentVersion?: VersionedSnapshot;
  agentVersionNumber?: number;
  /** Only present when status is 'stale_with_history' or 'stale_no_history' */
  canComputeDelta?: boolean;
}

interface FrameState {
  frameId: string;
  loaderId: string;
  url: string;
  isMainFrame: boolean;
}

type ActionType = 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'select' | 'query';

/**
 * Readable node from snapshot.
 * IMPORTANT: Includes loader_id for proper frame-scoped keying.
 * The snapshot compiler must capture loader_id from CDP frame info.
 */
interface ReadableNode {
  node_id: string;
  backend_node_id: number;
  frame_id: string;
  /** REQUIRED: loader_id from the frame at snapshot time */
  loader_id: string;
  kind: string;
  label: string;
  attributes?: Record<string, string>;
  state?: NodeState;
  layout?: NodeLayout;
}

interface NodeState {
  enabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  focused?: boolean;
  expanded?: boolean;
}

interface NodeLayout {
  bbox?: { x: number; y: number; width: number; height: number };
  zIndex?: number;
}
```
