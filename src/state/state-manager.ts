/**
 * State Manager
 *
 * Central orchestrator for state tracking and response generation.
 * Coordinates layer detection, diff computation, actionables filtering, and atoms extraction.
 *
 * Security: Masks sensitive values (passwords, tokens) and sanitizes URLs.
 * Reliability: Includes concurrency protection and error recovery.
 */

import { randomUUID } from 'crypto';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  StateResponse,
  StateResponseObject,
  StateHandle,
  StateManagerContext,
  StateManagerConfig,
  ActionableInfo,
  BaselineResponse,
  DiffResponse,
  ScoringContext,
  ElementTargetRef,
  Atoms,
  RenderOptions,
} from './types.js';
import { computeEid, resolveEidCollision } from './element-identity.js';
import { detectLayers } from './layer-detector.js';
import { computeDiff } from './diff-engine.js';
import { selectActionables, isInteractiveKind, isLiveRegionKind } from './actionables-filter.js';
import { getNodeLayer, INCLUSIVE_OVERLAY_LAYERS } from './node-layer.js';
import { extractAtoms } from './atoms-extractor.js';
import { linkObservationsToSnapshot } from '../observation/index.js';
import { generateLocator } from './locator-generator.js';
import { ElementRegistry } from './element-registry.js';
import { validateSnapshotHealth, isErrorHealth } from '../snapshot/snapshot-health.js';
import { renderStateXml } from './state-renderer.js';
import { maskValue } from './value-masking.js';
import { sanitizeUrl, sanitizeHref } from './url-sanitization.js';
import { computeDocId, computeUiHash, computeLayerHash } from './hash-utils.js';
import { extractRegionEidMapping } from './region-mapping.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: StateManagerConfig = {
  maxActionables: 1000, // Show all elements (practically unlimited)
};

// ============================================================================
// State Manager Class
// ============================================================================

/**
 * State manager for a single page.
 * Tracks snapshots and generates state responses.
 */
export class StateManager {
  private context: StateManagerContext;
  private isProcessing = false;
  private pendingSnapshot: BaseSnapshot | null = null;
  private elementRegistry: ElementRegistry;

  /**
   * Create a new state manager.
   *
   * @param options - Initialization options
   */
  constructor(options: {
    sessionId?: string;
    pageId: string;
    config?: Partial<StateManagerConfig>;
  }) {
    this.context = {
      sessionId: options.sessionId ?? randomUUID(),
      pageId: options.pageId,
      stepCounter: 0,
      currentSnapshot: null,
      previousSnapshot: null,
      currentDocId: null,
      previousResponseRegions: null,
      config: { ...DEFAULT_CONFIG, ...options.config },
    };
    this.elementRegistry = new ElementRegistry();
  }

  /**
   * Get the element registry for this page.
   * Used by action tools to resolve eid to ElementRef.
   */
  getElementRegistry(): ElementRegistry {
    return this.elementRegistry;
  }

  /**
   * Get the previous snapshot for this page.
   * Used for dependency tracking to compute effects.
   */
  getPreviousSnapshot(): BaseSnapshot | null {
    return this.context.previousSnapshot;
  }

  /**
   * Get the active layer for the current snapshot.
   * Returns 'main' if no snapshot is available.
   */
  getActiveLayer(): string {
    if (!this.context.currentSnapshot) {
      return 'main';
    }
    const layerResult = detectLayers(this.context.currentSnapshot);
    return layerResult.active;
  }

  /**
   * Generate an error response.
   *
   * @param errorMessage - The error message to include
   * @returns XML state response with error baseline
   */
  generateErrorResponse(errorMessage: string): StateResponse {
    return this.createErrorBaseline('error', errorMessage);
  }

  /**
   * Generate state response for a new snapshot.
   * Includes concurrency protection and error recovery.
   *
   * @param snapshot - Current snapshot
   * @returns State response with StateHandle + Diff/Baseline + Actionables + Atoms
   */
  generateResponse(snapshot: BaseSnapshot, options?: RenderOptions): StateResponse {
    // Concurrency protection: if already processing, use latest snapshot
    if (this.isProcessing) {
      this.pendingSnapshot = snapshot;
      // Return a minimal baseline response while processing
      return this.createErrorBaseline('concurrent_call', 'Response generation in progress');
    }

    this.isProcessing = true;

    try {
      const response = this.doGenerateResponse(snapshot, options);

      // Check if there's a pending snapshot that came in during processing
      if (this.pendingSnapshot) {
        const pending = this.pendingSnapshot;
        this.pendingSnapshot = null;
        // Process the pending snapshot (recursively, but now isProcessing will be false)
        this.isProcessing = false;
        return this.generateResponse(pending, options);
      }

      return response;
    } catch (err) {
      // Error recovery: return baseline with error reason
      // Clear dedup state to prevent stale comparisons after error recovery
      this.context.previousResponseRegions = null;
      const errorMessage = err instanceof Error ? err.message : String(err);
      return this.createErrorBaseline('error', errorMessage);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Internal response generation (called with concurrency protection).
   */
  private doGenerateResponse(snapshot: BaseSnapshot, options?: RenderOptions): StateResponse {
    // Increment step counter
    this.context.stepCounter++;

    // Shift current snapshot to previous BEFORE baseline check
    // This ensures the second call has previousSnapshot set correctly
    this.context.previousSnapshot = this.context.currentSnapshot;

    // Validate snapshot health (Bug #2: handle empty snapshots)
    const health = validateSnapshotHealth(snapshot);
    if (isErrorHealth(health)) {
      // Return error baseline for empty/failed snapshots
      return this.createErrorBaseline('error', health.message ?? 'Empty snapshot');
    }

    // Compute document ID
    const docId = computeDocId(snapshot);
    const isNavigation = docId !== this.context.currentDocId;
    this.context.currentDocId = docId;

    // Detect layers
    const layerResult = detectLayers(snapshot);

    // Update element registry with new snapshot
    this.elementRegistry.updateFromSnapshot(snapshot, layerResult.active);

    // Link observations to snapshot nodes (set eid for interactivity)
    if (snapshot.observations) {
      linkObservationsToSnapshot(snapshot.observations, snapshot, this.elementRegistry);
    }

    // Decide baseline vs diff and get reason
    const baselineInfo = this.getBaselineInfo(snapshot, isNavigation);

    // Generate state handle (with sanitized URL)
    const state = this.generateStateHandle(snapshot, layerResult);

    // Generate diff or baseline
    const diff: DiffResponse | BaselineResponse = baselineInfo.sendBaseline
      ? { mode: 'baseline', reason: baselineInfo.reason }
      : computeDiff(this.context.previousSnapshot!, snapshot);

    // Select actionables (scoped to active layer)
    const context: ScoringContext = {
      activeLayer: layerResult.active,
    };

    // Get actionable nodes with focused element guarantee
    const actionableNodes = this.selectActionablesWithFocusGuarantee(
      snapshot,
      layerResult.active,
      context
    );

    // Format actionables (with sensitive value masking and ref for direct targeting)
    const actionables = this.formatActionables(
      actionableNodes,
      layerResult.active,
      snapshot.snapshot_id
    );

    // Count total actionables in active layer
    const skipLayerFilter = INCLUSIVE_OVERLAY_LAYERS.has(layerResult.active);
    const totalInLayer = snapshot.nodes.filter(
      (n) =>
        (isInteractiveKind(n.kind) || isLiveRegionKind(n.kind)) &&
        n.state?.visible &&
        (skipLayerFilter || getNodeLayer(n, layerResult.active) === layerResult.active)
    ).length;

    const counts = {
      shown: actionables.length,
      total_in_layer: totalInLayer,
    };

    // Limits applied
    const limits = {
      max_actionables: this.context.config.maxActionables,
      actionables_capped: totalInLayer > this.context.config.maxActionables,
    };

    // Extract atoms
    const atoms = extractAtoms(snapshot);

    // Store current snapshot (previous was already shifted at the start)
    this.context.currentSnapshot = snapshot;

    // Estimate tokens
    const tokens = this.estimateTokens({ state, diff, actionables, atoms, counts, limits });

    const response: StateResponseObject = {
      state,
      diff,
      actionables,
      counts,
      limits,
      atoms,
      tokens,
    };

    // Add observations if present in snapshot
    if (snapshot.observations) {
      response.observations = snapshot.observations;
    }

    // Extract current region → eid mapping for deduplication
    // NOTE: This must use the unfiltered actionables (before renderStateXml filters for diff mode)
    const currentRegions = extractRegionEidMapping(actionables);

    // Return dense XML representation with deduplication support
    const xml = renderStateXml(response, {
      ...options,
      previousResponseRegions: this.context.previousResponseRegions ?? undefined,
    });

    // Update region map for next response (all responses update the map)
    this.context.previousResponseRegions = currentRegions;

    return xml;
  }

  /**
   * Get baseline decision info with reason.
   *
   * Baselines are only sent when absolutely necessary:
   * - first: No previous snapshot (LLM has no context)
   * - navigation: URL changed (old elements no longer exist)
   * - error: State corrupted, need to resync
   *
   * For same-page mutations (autocomplete, dropdowns, modals), we always
   * send diffs regardless of how many elements changed. The LLM already
   * has context from the previous response - repeating unchanged elements
   * wastes context window tokens.
   */
  private getBaselineInfo(
    _snapshot: BaseSnapshot,
    isNavigation: boolean
  ): { sendBaseline: boolean; reason: BaselineResponse['reason'] } {
    if (!this.context.previousSnapshot) {
      return { sendBaseline: true, reason: 'first' };
    }

    if (isNavigation) {
      return { sendBaseline: true, reason: 'navigation' };
    }

    // Always use diff for same-page mutations - no threshold or periodic baselines
    return { sendBaseline: false, reason: 'first' }; // reason unused when not baseline
  }

  /**
   * Create error baseline response for recovery.
   * Always uses 'error' reason - the specific error type is in the message.
   */
  private createErrorBaseline(
    _reason: 'error' | 'concurrent_call',
    errorMessage: string
  ): StateResponse {
    // Minimal state for error baseline
    const state: StateHandle = {
      sid: this.context.sessionId,
      step: this.context.stepCounter,
      doc: {
        url: '',
        origin: '',
        title: '',
        doc_id: '',
        nav_type: 'soft',
        history_idx: 0,
      },
      layer: {
        active: 'main',
        stack: ['main'],
        pointer_lock: false,
      },
      timing: {
        ts: new Date().toISOString(),
        dom_ready: false,
        network_busy: false,
      },
      hash: {
        ui: '',
        layer: '',
      },
    };

    const atoms: Atoms = { viewport: { w: 0, h: 0, dpr: 1 }, scroll: { x: 0, y: 0 } };

    const response: StateResponseObject = {
      state,
      diff: { mode: 'baseline', reason: 'error', error: errorMessage },
      actionables: [],
      counts: { shown: 0, total_in_layer: 0 },
      limits: { max_actionables: this.context.config.maxActionables, actionables_capped: false },
      atoms,
      tokens: 0,
    };

    return renderStateXml(response);
  }

  /**
   * Select actionables with guaranteed focus element inclusion.
   * Also prioritizes modal close/cancel affordances.
   */
  private selectActionablesWithFocusGuarantee(
    snapshot: BaseSnapshot,
    activeLayer: string,
    context: ScoringContext
  ): ReadableNode[] {
    const maxCount = this.context.config.maxActionables;
    const skipLayerFilter = INCLUSIVE_OVERLAY_LAYERS.has(activeLayer);

    // Find focused element first
    const focusedNode = snapshot.nodes.find(
      (n) =>
        n.state?.focused &&
        isInteractiveKind(n.kind) &&
        n.state?.visible &&
        (skipLayerFilter || getNodeLayer(n, activeLayer) === activeLayer)
    );

    // Find modal close/cancel affordances (high priority in modal layer)
    const closeAffordances: ReadableNode[] = [];
    if (activeLayer === 'modal') {
      for (const node of snapshot.nodes) {
        if (!isInteractiveKind(node.kind) || !node.state?.visible) continue;
        if (getNodeLayer(node, activeLayer) !== activeLayer) continue;

        const label = node.label.toLowerCase();
        const isCloseAffordance =
          label.includes('close') ||
          label.includes('cancel') ||
          label.includes('dismiss') ||
          label === 'x' ||
          label === '×';

        if (isCloseAffordance) {
          closeAffordances.push(node);
        }
      }
    }

    // Get regular scored actionables
    const regularActionables = selectActionables(snapshot, activeLayer, maxCount, context);

    // Build final list: focused first, then close affordances, then others
    const result: ReadableNode[] = [];
    const includedNodeIds = new Set<string>();

    // 1. Add focused element if present
    if (focusedNode) {
      result.push(focusedNode);
      includedNodeIds.add(focusedNode.node_id);
    }

    // 2. Add close affordances (up to 2)
    for (const node of closeAffordances.slice(0, 2)) {
      if (!includedNodeIds.has(node.node_id)) {
        result.push(node);
        includedNodeIds.add(node.node_id);
      }
    }

    // 3. Fill remaining slots with regular actionables
    for (const node of regularActionables) {
      if (result.length >= maxCount) break;
      if (!includedNodeIds.has(node.node_id)) {
        result.push(node);
        includedNodeIds.add(node.node_id);
      }
    }

    return result;
  }

  /**
   * Generate state handle with sanitized URL.
   */
  private generateStateHandle(
    snapshot: BaseSnapshot,
    layerResult: ReturnType<typeof detectLayers>
  ): StateHandle {
    const sanitizedUrl = sanitizeUrl(snapshot.url);
    const url = new URL(snapshot.url);
    const dom_ready =
      snapshot.meta.node_count > 0 &&
      !snapshot.meta.warnings?.some((warning) =>
        warning.toLowerCase().includes('dom extraction failed')
      );

    return {
      sid: this.context.sessionId,
      step: this.context.stepCounter,
      doc: {
        url: sanitizedUrl,
        origin: url.origin,
        title: snapshot.title,
        doc_id: this.context.currentDocId ?? '',
        nav_type: this.context.stepCounter === 1 ? 'hard' : 'soft',
        history_idx: 0,
      },
      layer: {
        active: layerResult.active,
        stack: layerResult.stack.map((l) => l.type),
        focus_eid: layerResult.focusEid,
        pointer_lock: layerResult.pointerLock,
      },
      timing: {
        ts: new Date().toISOString(),
        dom_ready,
        network_busy: false,
      },
      hash: {
        ui: computeUiHash(snapshot),
        layer: computeLayerHash(layerResult.stack.map((l) => l.type)),
      },
    };
  }

  /**
   * Format actionables with sensitive value masking.
   * Now includes ref for direct element targeting.
   */
  private formatActionables(
    nodes: ReadableNode[],
    activeLayer: string,
    snapshotId: string
  ): ActionableInfo[] {
    const actionables: ActionableInfo[] = [];
    // Used only for fallback case when element not in registry
    const fallbackUsedEids = new Set<string>();

    for (const node of nodes) {
      // Look up EID from registry - single source of truth
      // Registry was updated in generateResponse() before this method is called
      let eid = this.elementRegistry.getEidBySnapshotAndBackendNodeId(
        snapshotId,
        node.backend_node_id
      );

      if (!eid) {
        // Defensive fallback: compute if not in registry
        // This can happen for non-interactive elements or edge cases
        const baseEid = computeEid(node, activeLayer);
        eid = resolveEidCollision(baseEid, fallbackUsedEids);
        fallbackUsedEids.add(eid);
      }

      const loc = generateLocator(node, activeLayer);

      // Build element target ref for direct interaction
      const ref: ElementTargetRef = {
        snapshot_id: snapshotId,
        backend_node_id: node.backend_node_id,
      };

      const actionable: ActionableInfo = {
        eid,
        kind: node.kind,
        name: node.label,
        role: node.attributes?.role ?? node.kind,
        vis: node.state?.visible ?? false,
        ena: node.state?.enabled ?? false,
        ref,
        loc,
        ctx: {
          layer: getNodeLayer(node, activeLayer),
          region: node.where.region ?? 'unknown',
        },
      };

      // Optional state flags (only if true)
      if (node.state?.checked) actionable.chk = node.state.checked;
      if (node.state?.selected) actionable.sel = true;
      if (node.state?.expanded) actionable.exp = true;
      if (node.state?.pressed) actionable.prs = true;
      if (node.state?.focused) actionable.foc = true;
      if (node.state?.required) actionable.req = true;
      if (node.state?.invalid) actionable.inv = true;
      if (node.state?.readonly) actionable.rdo = true;

      // Masked value hint (P0 security fix)
      if (node.attributes?.value) {
        actionable.val_hint = maskValue(
          node.attributes.value,
          node.attributes?.input_type,
          node.label
        );
      }

      if (node.attributes?.placeholder) {
        actionable.placeholder = node.attributes.placeholder;
      }
      if (node.attributes?.href) {
        actionable.href = sanitizeHref(node.attributes.href);
      }
      if (node.attributes?.input_type) {
        actionable.type = node.attributes.input_type;
      }

      actionables.push(actionable);
    }

    return actionables;
  }

  /**
   * Estimate token count for response.
   */
  private estimateTokens(response: Omit<StateResponseObject, 'tokens'>): number {
    const jsonString = JSON.stringify(response);
    return Math.ceil(jsonString.length / 4);
  }
}
