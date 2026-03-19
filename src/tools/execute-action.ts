/**
 * Execute Action
 *
 * Action execution wrapper with StateManager integration.
 * Captures snapshot and generates StateHandle + Diff + Actionables response.
 * Includes automatic retry logic for stale element errors.
 *
 * Navigation-aware click outcome model for better error classification.
 */

import type { ReadableNode, BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { PageHandle } from '../browser/page-registry.js';
import type { StateResponse } from '../state/types.js';
import type { ClickOutcome } from '../state/element-ref.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import { observationAccumulator } from '../observation/index.js';
import { ATTACHMENT_SIGNIFICANCE_THRESHOLD } from '../observation/observation.types.js';
import { getDependencyTracker } from '../form/index.js';

// Re-export from extracted modules for backward compatibility
export { getStateManager, removeStateManager, clearAllStateManagers } from './state-manager-registry.js';
export { stabilizeAfterNavigation } from './action-stabilization.js';

import { getStateManager } from './state-manager-registry.js';
import { computeObservedEffect } from './effect-tracker.js';
import { stabilizeAfterAction, captureSnapshotFallback } from './action-stabilization.js';
import { isStaleElementError, handleStaleElementRetry } from './stale-element-retry.js';
import { captureNavigationState, checkNavigationOccurred } from './navigation-detection.js';

// ============================================================================
// Action Result Types
// ============================================================================

/**
 * Result of executing an action.
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Snapshot ID for the captured page state */
  snapshot_id: string;
  /** Total nodes captured */
  node_count: number;
  /** Interactive nodes captured */
  interactive_count: number;

  /** State response (StateHandle + Diff + Actionables) */
  state_response: StateResponse;

  /** Error message if action failed */
  error?: string;
  /** The full snapshot (for internal use) */
  snapshot: BaseSnapshot;

  /** Runtime health information for CDP and snapshot capture */
  runtime_health?: RuntimeHealth;
}

/**
 * Result of executing a click action with navigation awareness.
 * Extends ActionResult with ClickOutcome for better error classification.
 */
export interface ActionResultWithOutcome extends ActionResult {
  /** Click outcome with navigation awareness */
  outcome: ClickOutcome;
}

/**
 * Snapshot capture function for action flows.
 */
export type CaptureSnapshotFn = () => Promise<{
  snapshot: BaseSnapshot;
  runtime_health: RuntimeHealth;
}>;

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute a mutating action with automatic snapshot capture and state response generation.
 *
 * Simple flow:
 * 1. Record pre-action timestamp for observation capture
 * 2. Execute action (try/catch with retry for stale elements)
 * 3. Stabilize DOM
 * 4. Capture observations from the action window
 * 5. Capture snapshot
 * 6. Generate state_response
 * 7. Return {success, state_response, metadata}
 *
 * @param handle - Page handle with CDP client
 * @param action - The action to execute
 * @returns Action result with page brief and metadata
 */
export async function executeAction(
  handle: PageHandle,
  action: () => Promise<void>,
  captureSnapshot?: CaptureSnapshotFn
): Promise<ActionResult> {
  let success = true;
  let error: string | undefined;

  // Record pre-action timestamp for observation capture
  const actionStartTime = Date.now();

  // Ensure observation accumulator is injected
  await observationAccumulator.ensureInjected(handle.page);

  // Execute action - if this throws, we catch and return error
  try {
    await action();
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
  }

  // Stabilize page after action (handles both SPA updates and full navigations)
  await stabilizeAfterAction(handle.page);

  // Capture observations from the action window
  const observations = await observationAccumulator.getObservations(handle.page, actionStartTime);

  // Capture snapshot
  const capture = captureSnapshot ?? (() => captureSnapshotFallback(handle));
  const captureResult = await capture();
  const snapshot = captureResult.snapshot;

  // Filter observations to reduce noise (threshold 5 requires semantic signals)
  const filteredObservations = observationAccumulator.filterBySignificance(
    observations,
    ATTACHMENT_SIGNIFICANCE_THRESHOLD
  );

  // Attach observations to snapshot if any were captured
  if (
    filteredObservations.duringAction.length > 0 ||
    filteredObservations.sincePrevious.length > 0
  ) {
    snapshot.observations = filteredObservations;
  }

  // Generate state response using StateManager
  const stateManager = getStateManager(handle.page_id);
  const state_response = stateManager.generateResponse(snapshot);

  return {
    success,
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    state_response,
    error,
    snapshot,
    runtime_health: captureResult.runtime_health,
  };
}

/**
 * Execute an element-based action with automatic retry on stale element errors.
 *
 * If the element becomes stale, this will:
 * 1. Capture a fresh snapshot
 * 2. Find the element by label
 * 3. Retry the action once with the fresh backend_node_id
 *
 * Also captures DOM observations during the action window.
 *
 * @param handle - Page handle with CDP client
 * @param node - The target node from snapshot
 * @param action - The action to execute (takes backend_node_id)
 * @param snapshotStore - Snapshot store to update with fresh snapshot
 * @returns Action result with page brief and metadata
 */
export async function executeActionWithRetry(
  handle: PageHandle,
  node: ReadableNode,
  action: (backendNodeId: number) => Promise<void>,
  snapshotStore?: { store: (pageId: string, snapshot: BaseSnapshot) => void },
  captureSnapshot?: CaptureSnapshotFn
): Promise<ActionResult> {
  let success = true;
  let error: string | undefined;
  let retried = false;

  // Record pre-action timestamp for observation capture
  const actionStartTime = Date.now();

  // Ensure observation accumulator is injected
  await observationAccumulator.ensureInjected(handle.page);

  const capture = captureSnapshot ?? (() => captureSnapshotFallback(handle));

  // Try the action
  try {
    await action(node.backend_node_id);
  } catch (err) {
    // Check if this is a stale element error
    if (isStaleElementError(err)) {
      retried = true;
      try {
        // Capture fresh snapshot
        const freshSnapshot = (await capture()).snapshot;

        // Update snapshot store if provided
        if (snapshotStore) {
          snapshotStore.store(handle.page_id, freshSnapshot);
        }

        // Find element by label in fresh snapshot
        const freshNode = freshSnapshot.nodes.find(
          (n) => n.label === node.label && n.kind === node.kind
        );

        if (!freshNode) {
          throw new Error(`Element no longer found after refresh: ${node.label}`);
        }

        // Retry action with fresh backend_node_id
        await action(freshNode.backend_node_id);
      } catch (retryErr) {
        success = false;
        error =
          retryErr instanceof Error
            ? `Retry failed: ${retryErr.message}`
            : `Retry failed: ${String(retryErr)}`;
      }
    } else {
      // Not a stale element error - propagate immediately
      success = false;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Stabilize page after action (handles both SPA updates and full navigations)
  await stabilizeAfterAction(handle.page);

  // Capture observations from the action window
  const observations = await observationAccumulator.getObservations(handle.page, actionStartTime);

  // Capture final snapshot
  const captureResult = await capture();
  const snapshot = captureResult.snapshot;

  // Filter observations to reduce noise (threshold 5 requires semantic signals)
  const filteredObservations = observationAccumulator.filterBySignificance(
    observations,
    ATTACHMENT_SIGNIFICANCE_THRESHOLD
  );

  // Attach observations to snapshot if any were captured
  if (
    filteredObservations.duringAction.length > 0 ||
    filteredObservations.sincePrevious.length > 0
  ) {
    snapshot.observations = filteredObservations;
  }

  // Generate state response using StateManager
  const stateManager = getStateManager(handle.page_id);
  // Get previous snapshot BEFORE generateResponse shifts it
  const prevSnapshot = stateManager.getPreviousSnapshot();
  const state_response = stateManager.generateResponse(snapshot);

  // Record effect for dependency tracking (after state response, so we have prevSnapshot)
  if (success) {
    const effect = computeObservedEffect(node.node_id, 'type', prevSnapshot, snapshot);
    if (effect) {
      getDependencyTracker().recordEffect(handle.page_id, effect);
    }
  }

  // Add note about retry if it happened
  if (retried && success) {
    error = 'Element was stale; automatically retried with fresh reference';
  }

  return {
    success,
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    state_response,
    error,
    snapshot,
    runtime_health: captureResult.runtime_health,
  };
}

// ============================================================================
// Navigation-Aware Click Outcome
// ============================================================================

/**
 * Execute an element-based click action with navigation-aware outcome detection.
 *
 * This extends executeActionWithRetry with:
 * - Pre-click URL/loaderId capture
 * - Post-click navigation detection
 * - ClickOutcome classification (success/navigated vs stale_element)
 * - DOM observation capture during the action window
 *
 * @param handle - Page handle with CDP client
 * @param node - The target node from snapshot
 * @param action - The action to execute (takes backend_node_id)
 * @param snapshotStore - Snapshot store to update with fresh snapshot
 * @returns ActionResultWithOutcome including ClickOutcome
 */
export async function executeActionWithOutcome(
  handle: PageHandle,
  node: ReadableNode,
  action: (backendNodeId: number) => Promise<void>,
  snapshotStore?: { store: (pageId: string, snapshot: BaseSnapshot) => void },
  captureSnapshot?: CaptureSnapshotFn
): Promise<ActionResultWithOutcome> {
  let success = true;
  let error: string | undefined;
  let retried = false;
  let outcome: ClickOutcome;

  // Record pre-action timestamp for observation capture
  const actionStartTime = Date.now();

  // Ensure observation accumulator is injected
  await observationAccumulator.ensureInjected(handle.page);

  const capture = captureSnapshot ?? (() => captureSnapshotFallback(handle));

  // Capture pre-click navigation state
  const preClickState = await captureNavigationState(handle);

  // Try the action
  try {
    await action(node.backend_node_id);

    // Action succeeded - check if navigation occurred
    const postClickState = await captureNavigationState(handle);
    const navigated = checkNavigationOccurred(preClickState, postClickState);

    // Clear dependency tracker on navigation (old dependencies no longer valid)
    if (navigated) {
      getDependencyTracker().clearPage(handle.page_id);
    }

    outcome = { status: 'success', navigated };
  } catch (err) {
    // Check if this is a stale element error
    if (isStaleElementError(err)) {
      // Check if navigation caused the staleness
      const currentState = await captureNavigationState(handle);
      const isNavigation = checkNavigationOccurred(preClickState, currentState);

      if (isNavigation) {
        // Element gone due to navigation - this is often success!
        // Clear dependency tracker on navigation (old dependencies no longer valid)
        getDependencyTracker().clearPage(handle.page_id);
        outcome = { status: 'success', navigated: true };
        // Don't retry - navigation happened
      } else {
        // Element stale due to DOM mutation - try retry
        retried = true;
        const retryResult = await handleStaleElementRetry(
          handle,
          node,
          action,
          capture,
          snapshotStore
        );
        success = retryResult.success;
        error = retryResult.error;
        outcome = retryResult.outcome;
      }
    } else {
      // Not a stale element error - propagate immediately
      success = false;
      error = err instanceof Error ? err.message : String(err);
      outcome = { status: 'error', message: error };
    }
  }

  // Stabilize page after action (handles both SPA updates and full navigations)
  await stabilizeAfterAction(handle.page);

  // Capture observations from the action window
  const observations = await observationAccumulator.getObservations(handle.page, actionStartTime);

  // Capture final snapshot
  const captureResult = await capture();
  const snapshot = captureResult.snapshot;

  // Filter observations to reduce noise (threshold 5 requires semantic signals)
  const filteredObservations = observationAccumulator.filterBySignificance(
    observations,
    ATTACHMENT_SIGNIFICANCE_THRESHOLD
  );

  // Attach observations to snapshot if any were captured
  if (
    filteredObservations.duringAction.length > 0 ||
    filteredObservations.sincePrevious.length > 0
  ) {
    snapshot.observations = filteredObservations;
  }

  // Late navigation detection: SPA/Turbo frameworks change URL asynchronously
  // after the click resolves but before stabilization completes.
  // Re-check URL now that the page has stabilized.
  if (outcome.status === 'success' && !outcome.navigated) {
    const postStabilizeUrl = handle.page.url();
    if (postStabilizeUrl !== preClickState.url) {
      outcome = { status: 'success', navigated: true };
      getDependencyTracker().clearPage(handle.page_id);
    }
  }

  // Determine if click caused a navigation (used for trimming and dependency tracking)
  const didNavigate = outcome.status === 'success' && outcome.navigated;

  // Generate state response using StateManager
  // Trim regions when navigation occurred (same rationale as navigate() tool)
  const stateManager = getStateManager(handle.page_id);
  // Get previous snapshot BEFORE generateResponse shifts it
  const prevSnapshot = stateManager.getPreviousSnapshot();
  const state_response = stateManager.generateResponse(
    snapshot,
    didNavigate ? { trimRegions: true } : undefined
  );

  // Record effect for dependency tracking (skip if navigation occurred - tracker was cleared)
  if (success && !didNavigate) {
    const effect = computeObservedEffect(node.node_id, 'click', prevSnapshot, snapshot);
    if (effect) {
      getDependencyTracker().recordEffect(handle.page_id, effect);
    }
  }

  // Add note about retry if it happened and we recovered
  if (retried && success) {
    error = 'Element was stale; automatically retried with fresh reference';
  }

  return {
    success,
    outcome,
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    state_response,
    error,
    snapshot,
    runtime_health: captureResult.runtime_health,
  };
}
