/**
 * State Manager
 *
 * Central orchestrator for state tracking and response generation.
 * Coordinates layer detection, diff computation, actionables filtering, and atoms extraction.
 *
 * Security: Masks sensitive values (passwords, tokens) and sanitizes URLs.
 * Reliability: Includes concurrency protection and error recovery.
 */

import { createHash, randomUUID } from 'crypto';
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
} from './types.js';
import { computeEid, resolveEidCollision } from './element-identity.js';
import { detectLayers } from './layer-detector.js';
import { computeDiff } from './diff-engine.js';
import { selectActionables, isInteractiveKind } from './actionables-filter.js';
import { extractAtoms } from './atoms-extractor.js';
import { generateLocator } from './locator-generator.js';
import { ElementRegistry } from './element-registry.js';
import { validateSnapshotHealth, isErrorHealth } from '../snapshot/snapshot-health.js';
import { renderStateXml } from './state-renderer.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: StateManagerConfig = {
  maxActionables: 1000, // Show all elements (practically unlimited)
};

// ============================================================================
// Security: Sensitive Field Detection
// ============================================================================

/**
 * Sensitive field name patterns (case-insensitive).
 * Values in these fields will be masked.
 */
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'auth',
  'key',
  'api_key',
  'apikey',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'ssn',
  'social',
  'credit',
  'card',
];

/**
 * Input types that should always be masked.
 */
const MASKED_INPUT_TYPES = ['password'];

/**
 * Input types with partial masking (show first/last chars).
 */
const PARTIAL_MASK_TYPES = ['email', 'tel', 'phone'];

/**
 * URL query parameters that are safe to keep.
 * All others will be stripped.
 */
const SAFE_QUERY_PARAMS = new Set([
  'page',
  'p',
  'sort',
  'order',
  'q',
  'query',
  'search',
  'tab',
  'view',
  'limit',
  'offset',
  'lang',
  'locale',
]);

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
  generateResponse(snapshot: BaseSnapshot): StateResponse {
    // Concurrency protection: if already processing, use latest snapshot
    if (this.isProcessing) {
      this.pendingSnapshot = snapshot;
      // Return a minimal baseline response while processing
      return this.createErrorBaseline('concurrent_call', 'Response generation in progress');
    }

    this.isProcessing = true;

    try {
      const response = this.doGenerateResponse(snapshot);

      // Check if there's a pending snapshot that came in during processing
      if (this.pendingSnapshot) {
        const pending = this.pendingSnapshot;
        this.pendingSnapshot = null;
        // Process the pending snapshot (recursively, but now isProcessing will be false)
        this.isProcessing = false;
        return this.generateResponse(pending);
      }

      return response;
    } catch (err) {
      // Error recovery: return baseline with error reason
      const errorMessage = err instanceof Error ? err.message : String(err);
      return this.createErrorBaseline('error', errorMessage);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Internal response generation (called with concurrency protection).
   */
  private doGenerateResponse(snapshot: BaseSnapshot): StateResponse {
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
    const totalInLayer = snapshot.nodes.filter(
      (n) => isInteractiveKind(n.kind) && n.state?.visible && getNodeLayer(n) === layerResult.active
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

    // Return dense XML representation
    return renderStateXml(response);
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

    // Find focused element first
    const focusedNode = snapshot.nodes.find(
      (n) =>
        n.state?.focused &&
        isInteractiveKind(n.kind) &&
        n.state?.visible &&
        getNodeLayer(n) === activeLayer
    );

    // Find modal close/cancel affordances (high priority in modal layer)
    const closeAffordances: ReadableNode[] = [];
    if (activeLayer === 'modal') {
      for (const node of snapshot.nodes) {
        if (!isInteractiveKind(node.kind) || !node.state?.visible) continue;
        if (getNodeLayer(node) !== activeLayer) continue;

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
          layer: getNodeLayer(node),
          region: node.where.region ?? 'unknown',
        },
      };

      // Optional state flags (only if true)
      if (node.state?.checked) actionable.chk = true;
      if (node.state?.selected) actionable.sel = true;
      if (node.state?.expanded) actionable.exp = true;
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

// ============================================================================
// Security: Value Masking
// ============================================================================

/**
 * Mask sensitive values in val_hint.
 *
 * Rules:
 * - password type: always full mask
 * - sensitive field names: always full mask
 * - email/tel: partial mask (show first/last chars)
 * - default: truncate to 12 chars, mask middle
 */
function maskValue(value: string, inputType?: string, label?: string): string {
  // Strip newlines first
  const cleanValue = value.replace(/[\r\n]/g, ' ').trim();

  if (!cleanValue) return '';

  // Password type: always full mask
  if (inputType && MASKED_INPUT_TYPES.includes(inputType.toLowerCase())) {
    return '••••••••';
  }

  // Check sensitive field names
  const lowerLabel = (label ?? '').toLowerCase();
  for (const pattern of SENSITIVE_FIELD_PATTERNS) {
    if (lowerLabel.includes(pattern)) {
      return '***';
    }
  }

  // Email/tel: partial mask
  if (inputType && PARTIAL_MASK_TYPES.includes(inputType.toLowerCase())) {
    return partialMask(cleanValue);
  }

  // Default: truncate and partial mask if long
  if (cleanValue.length <= 12) {
    return cleanValue;
  }

  return partialMask(cleanValue.substring(0, 12));
}

/**
 * Partial mask: show first 2 and last 2 chars.
 * Example: "example@email.com" -> "ex•••om"
 */
function partialMask(value: string): string {
  if (value.length <= 4) {
    return '••••';
  }

  const first = value.substring(0, 2);
  const last = value.substring(value.length - 2);
  return `${first}•••${last}`;
}

// ============================================================================
// Security: URL Sanitization
// ============================================================================

/**
 * Sanitize URL by stripping sensitive query parameters.
 * Only keeps safe params like page, sort, q.
 */
function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // Build new search params with only safe ones
    const safeParams = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (SAFE_QUERY_PARAMS.has(key.toLowerCase())) {
        safeParams.set(key, value);
      }
    }

    // Reconstruct URL with sanitized params
    url.search = safeParams.toString();
    return url.toString();
  } catch {
    // If URL parsing fails, return origin only
    return rawUrl.split('?')[0];
  }
}

/**
 * Sanitize href attribute (remove tokens from URLs).
 */
function sanitizeHref(href: string): string {
  // For relative URLs, return as-is
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return href;
  }

  return sanitizeUrl(href);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Compute document ID from snapshot.
 *
 * Uses only URL origin + pathname for navigation detection.
 * This ensures DOM mutations (like autocomplete suggestions appearing)
 * are NOT falsely detected as navigation events.
 *
 * NOTE: Previously this included a hash of the first 10 interactive node IDs,
 * which caused false navigation detection when typing triggered autocomplete
 * or other dynamic UI updates. See: https://github.com/anthropics/athena-browser-mcp/issues/XXX
 */
function computeDocId(snapshot: BaseSnapshot): string {
  const url = new URL(snapshot.url);
  // Only use origin + pathname for navigation detection
  // Query params and fragments are ignored (same page, different state)
  return hash(`${url.origin}:${url.pathname}`);
}

function computeUiHash(snapshot: BaseSnapshot): string {
  const interactiveNodeIds = snapshot.nodes
    .filter((n) => isInteractiveKind(n.kind) && n.state?.visible)
    .map((n) => computeEid(n))
    .join(',');

  return hash(interactiveNodeIds).substring(0, 6);
}

function computeLayerHash(stack: string[]): string {
  return hash(stack.join(',')).substring(0, 6);
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 12);
}

function getNodeLayer(node: ReadableNode): string {
  const region = node.where.region ?? 'unknown';
  return region === 'dialog' ? 'modal' : 'main';
}
