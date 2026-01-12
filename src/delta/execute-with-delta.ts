/**
 * Execute With Delta
 *
 * Wrapper for mutation tools that computes and returns delta FactPack.
 * Handles pre-validation, action execution, stabilization, and response generation.
 */

import type { Page } from 'playwright';
import type { PageHandle } from '../browser/page-registry.js';
import type { ActionDeltaPayload, ActionType, DeltaToolResult, SnapshotResponseType } from './types.js';
import { FrameTracker } from './frame-tracker.js';
import { SnapshotVersionManager } from './snapshot-version-manager.js';
import { PageSnapshotState } from './page-snapshot-state.js';
import { stabilizeDom } from './dom-stabilizer.js';
import { formatDelta, formatNoChange } from './delta-formatter.js';
import { makeCompositeKeyFromNode, buildRefFromNode, computeDeltaConfidence } from './utils.js';
import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { ScopedElementRef, ComputedDelta, ModifiedNode } from './types.js';

// ============================================================================
// Per-Page State Management
// ============================================================================

/**
 * Use WeakMap for automatic cleanup when Page is garbage collected.
 */
const pageStates = new WeakMap<Page, PageSnapshotState>();

/**
 * Get or create PageSnapshotState for a page handle.
 * Returns a promise to ensure initialization is complete.
 */
export async function getPageSnapshotState(handle: PageHandle): Promise<PageSnapshotState> {
  let state = pageStates.get(handle.page);

  if (!state) {
    const frameTracker = new FrameTracker(handle.cdp);
    const versionManager = new SnapshotVersionManager(handle.page_id);
    state = new PageSnapshotState(frameTracker, versionManager);
    pageStates.set(handle.page, state);
  }

  // Always ensure initialization is complete before returning
  // This is safe to call multiple times - it's idempotent
  await state.ensureInitialized();

  return state;
}

/**
 * Clear page state (call on page close).
 */
export function clearPageState(page: Page): void {
  pageStates.delete(page);
}

// ============================================================================
// Execute With Delta
// ============================================================================

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
export async function executeWithDelta(
  handle: PageHandle,
  toolName: string,
  action: () => Promise<void>,
  actionType: ActionType,
  agentVersion?: number
): Promise<DeltaToolResult> {
  // Await to ensure initialization is complete
  const state = await getPageSnapshotState(handle);

  // Pre-execution: validate agent isn't working with stale state
  const preValidation = await state.validateAndCapture(handle.page, handle.cdp, agentVersion);

  // If agent version is too old (not in history), short-circuit the action
  // and return full snapshot. This keeps the agent consistent - we don't want to
  // execute actions when we can't tell them what changed since their last known state.
  if (preValidation.status === 'stale_no_history') {
    // Reset state and return full snapshot - agent must re-sync before acting
    const fullResponse = await state.initialize(handle.page, handle.cdp);
    const errorMessage = `Action not executed: your page state (v${preValidation.agentVersionNumber}) is too stale to reconcile. Review the full snapshot and retry.`;
    const resultPayload = {
      ...fullResponse.content,
      summary: 'Full snapshot: action skipped due to stale agent state.',
      reason: 'Action skipped due to stale agent state.',
    };
    const payload: ActionDeltaPayload = {
      action: { name: toolName, status: 'skipped' },
      error: errorMessage,
      result: resultPayload,
    };
    return {
      version: fullResponse.version,
      content: payload,
      type: fullResponse.type,
      isError: true,
    };
  }

  let preAction: ActionDeltaPayload['pre_action'];
  let pendingBaselineAdvance = false;

  // For stale_with_history, we can show what changed and proceed
  if (preValidation.status === 'stale_with_history' && preValidation.agentVersion) {
    pendingBaselineAdvance = true;
    const preDelta = computeDeltaBetweenSnapshots(
      preValidation.agentVersion.snapshot.nodes,
      preValidation.currentVersion.snapshot.nodes,
      state.frameTracker
    );
    const context = state.isInOverlayMode ? 'overlay' : 'base';
    const preDeltaPayload = formatDelta(preDelta, [], { context }, state.frameTracker);
    preAction = {
      ...preDeltaPayload,
      summary: `Before action: ${preDeltaPayload.summary}`,
    };
  }

  // Execute action - if this throws, baseline is NOT advanced (invariant preserved)
  try {
    await action();
  } catch (error) {
    // Action failed - do NOT advance baseline, return error
    // Agent still has their old version which is still valid
    const message = error instanceof Error ? error.message : String(error);
    const payload: ActionDeltaPayload = {
      action: { name: toolName, status: 'failed' },
      error: `${toolName} failed: ${message}`,
      result: formatNoChange(
        'Action failed. Page state unchanged; existing element references remain valid.'
      ),
    };
    return {
      version: state.currentVersion,
      content: payload,
      type: 'no_change' as SnapshotResponseType,
      isError: true,
    };
  }

  // Action succeeded - NOW advance baseline if needed (before computing post-delta)
  if (pendingBaselineAdvance) {
    state.advanceBaselineTo(preValidation.currentVersion);
  }

  // Stabilize DOM
  const stability = await stabilizeDom(handle.page);

  // Compute response (delta will be from advanced baseline)
  const response = await state.computeResponse(handle.page, handle.cdp, actionType);

  const payload: ActionDeltaPayload = {
    action: { name: toolName, status: 'completed' },
    result: response.content,
  };

  if (preAction) {
    payload.pre_action = preAction;
  }

  if (stability.warning) {
    payload.warnings = [stability.warning];
  }

  return {
    version: response.version,
    content: payload,
    type: response.type,
  };
}

// ============================================================================
// Delta Computation Helper
// ============================================================================

/**
 * Compute delta between two snapshot node arrays (standalone, for pre-validation).
 *
 * For removed nodes, create refs directly from the node's loader_id
 * (not the current frame's loaderId), since the node was valid at the
 * time of the old snapshot, not now.
 */
function computeDeltaBetweenSnapshots(
  oldNodes: ReadableNode[],
  newNodes: ReadableNode[],
  _frameTracker: FrameTracker
): ComputedDelta {
  const oldKeys = new Set(oldNodes.map((n) => makeCompositeKeyFromNode(n)));
  const newKeys = new Set(newNodes.map((n) => makeCompositeKeyFromNode(n)));

  const added: ReadableNode[] = [];
  const removed: ScopedElementRef[] = [];
  const modified: ModifiedNode[] = [];

  for (const node of newNodes) {
    if (!oldKeys.has(makeCompositeKeyFromNode(node))) {
      added.push(node);
    }
  }

  for (const node of oldNodes) {
    if (!newKeys.has(makeCompositeKeyFromNode(node))) {
      // Create ref directly from node data, using the node's loader_id
      // (from when the snapshot was captured), NOT the current frame's loaderId.
      removed.push(buildRefFromNode(node));
    }
  }

  // Simplified: skip modification detection for pre-validation

  const confidence = computeDeltaConfidence(added.length, removed.length, 0, newNodes.length);

  return { added, removed, modified, confidence };
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Extract delta fields from tool result for response merging.
 */
export function extractDeltaFields(result: DeltaToolResult): {
  version?: number;
  delta?: ActionDeltaPayload;
  response_type?: SnapshotResponseType;
} {
  return {
    version: result.version,
    delta: result.content,
    response_type: result.type,
  };
}
