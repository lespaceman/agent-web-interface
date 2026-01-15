/**
 * Execute Action
 *
 * Action execution wrapper with StateManager integration.
 * Captures snapshot and generates StateHandle + Diff + Actionables response.
 * Includes automatic retry logic for stale element errors.
 *
 * NEW: Navigation-aware click outcome model for better error classification.
 */

import type { Page } from 'playwright';
import type { PageHandle } from '../browser/page-registry.js';
import { compileSnapshot } from '../snapshot/index.js';
import { stabilizeDom, type StabilizationResult } from '../delta/dom-stabilizer.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import { StateManager } from '../state/state-manager.js';
import type { StateResponse } from '../state/types.js';
import type { ClickOutcome } from '../state/element-ref.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import { createHealthyRuntime } from '../state/health.types.js';
import { observationAccumulator } from '../observation/index.js';

// ============================================================================
// State Manager Registry
// ============================================================================

/**
 * Global registry of state managers (one per page).
 */
const stateManagers = new Map<string, StateManager>();

/**
 * Get or create state manager for a page.
 *
 * @param pageId - Page ID
 * @returns State manager instance
 */
export function getStateManager(pageId: string): StateManager {
  if (!stateManagers.has(pageId)) {
    stateManagers.set(pageId, new StateManager({ pageId }));
  }
  return stateManagers.get(pageId)!;
}

/**
 * Remove state manager for a page (call on page close).
 *
 * @param pageId - Page ID
 */
export function removeStateManager(pageId: string): void {
  stateManagers.delete(pageId);
}

/**
 * Clear all state managers (call on session close).
 */
export function clearAllStateManagers(): void {
  stateManagers.clear();
}

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

/**
 * Check if an error is a stale element error.
 */
function isStaleElementError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes('no node found for given backend id') ||
    message.includes('protocol error (dom.scrollintoviewifneeded)') ||
    message.includes('node is detached from document') ||
    message.includes('node has been deleted')
  );
}

/**
 * Capture snapshot without recovery (fallback path).
 */
async function captureSnapshotFallback(
  handle: PageHandle
): Promise<{ snapshot: BaseSnapshot; runtime_health: RuntimeHealth }> {
  const snapshot = await compileSnapshot(handle.cdp, handle.page, handle.page_id);
  return { snapshot, runtime_health: createHealthyRuntime() };
}

// ============================================================================
// Navigation-Aware Stabilization
// ============================================================================

/**
 * Stabilize page after an action using Playwright's waiting strategy.
 *
 * This addresses the core issue: our MutationObserver-based stabilizeDom() fails
 * when a navigation occurs (execution context destroyed). This function:
 *
 * 1. Tries stabilizeDom() first (handles SPA-style DOM updates)
 * 2. If stabilizeDom() fails with 'error' status (likely navigation), falls back
 *    to Playwright's waitForLoadState('domcontentloaded')
 *
 * This gives us the best of both worlds:
 * - Fast response for SPA interactions (MutationObserver)
 * - Proper handling of full navigations (Playwright)
 *
 * @param page - Playwright Page instance
 * @returns Stabilization result with status
 */
async function stabilizeAfterAction(page: Page): Promise<StabilizationResult> {
  // Try MutationObserver-based stabilization first
  const result = await stabilizeDom(page);

  // If stabilization succeeded or timed out (DOM still mutating), we're done
  if (result.status === 'stable' || result.status === 'timeout') {
    return result;
  }

  // status === 'error' means page.evaluate() failed, likely due to navigation
  // Fall back to Playwright's load state waiting
  try {
    // Wait for the new document to be ready
    // Using 'domcontentloaded' as it's faster than 'load' and sufficient for DOM access
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });

    return {
      status: 'stable',
      waitTimeMs: result.waitTimeMs,
      warning: 'Navigation detected; waited for domcontentloaded',
    };
  } catch (waitError) {
    // If waitForLoadState also fails, the page might be in an unusual state
    // Return the original error but with additional context
    const message = waitError instanceof Error ? waitError.message : String(waitError);
    return {
      status: 'error',
      waitTimeMs: result.waitTimeMs,
      warning: `${result.warning}. Fallback waitForLoadState also failed: ${message}`,
    };
  }
}

/**
 * Execute a mutating action with automatic snapshot capture and FactPack generation.
 *
 * Simple flow:
 * 1. Record pre-action timestamp for observation capture
 * 2. Execute action (try/catch with retry for stale elements)
 * 3. Stabilize DOM
 * 4. Capture observations from the action window
 * 5. Capture snapshot
 * 6. Generate page_summary
 * 7. Return {success, page_summary, metadata}
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

  // Attach observations to snapshot if any were captured
  if (observations.duringAction.length > 0 || observations.sincePrevious.length > 0) {
    snapshot.observations = observations;
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

  // Attach observations to snapshot if any were captured
  if (observations.duringAction.length > 0 || observations.sincePrevious.length > 0) {
    snapshot.observations = observations;
  }

  // Generate state response using StateManager
  const stateManager = getStateManager(handle.page_id);
  const state_response = stateManager.generateResponse(snapshot);

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
// Navigation State Helpers
// ============================================================================

/**
 * Navigation state for detecting URL/loaderId changes.
 */
interface NavigationState {
  url: string;
  loaderId?: string;
}

/**
 * Capture current navigation state (URL and loaderId).
 *
 * @param handle - Page handle with CDP client
 * @returns Navigation state with URL and optional loaderId
 */
async function captureNavigationState(handle: PageHandle): Promise<NavigationState> {
  const url = handle.page.url();
  let loaderId: string | undefined;

  try {
    const frameTree = await handle.cdp.send('Page.getFrameTree', undefined);
    loaderId = frameTree.frameTree.frame.loaderId;
  } catch {
    // Ignore - we can still detect navigation via URL
  }

  return { url, loaderId };
}

/**
 * Check if navigation occurred between two states.
 *
 * @param before - State before action
 * @param after - State after action
 * @returns True if navigation detected
 */
function checkNavigationOccurred(before: NavigationState, after: NavigationState): boolean {
  // URL changed = navigation
  if (before.url !== after.url) {
    return true;
  }

  // LoaderId changed (and both defined) = navigation
  if (
    before.loaderId !== undefined &&
    after.loaderId !== undefined &&
    before.loaderId !== after.loaderId
  ) {
    return true;
  }

  return false;
}

/**
 * Result of handling a stale element retry.
 */
interface StaleElementRetryResult {
  success: boolean;
  error?: string;
  outcome: ClickOutcome;
}

/**
 * Handle stale element retry logic.
 *
 * @param handle - Page handle
 * @param node - Original target node
 * @param action - Action to retry
 * @param capture - Snapshot capture function
 * @param snapshotStore - Optional snapshot store to update
 * @returns Retry result with success/error/outcome
 */
async function handleStaleElementRetry(
  handle: PageHandle,
  node: ReadableNode,
  action: (backendNodeId: number) => Promise<void>,
  capture: CaptureSnapshotFn,
  snapshotStore?: { store: (pageId: string, snapshot: BaseSnapshot) => void }
): Promise<StaleElementRetryResult> {
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
      return {
        success: false,
        error: `Element no longer found after refresh: ${node.label}`,
        outcome: {
          status: 'element_not_found',
          eid: '', // Will be filled by caller if available
          last_known_label: node.label,
        },
      };
    }

    // Retry action with fresh backend_node_id
    await action(freshNode.backend_node_id);

    return {
      success: true,
      outcome: { status: 'stale_element', reason: 'dom_mutation', retried: true },
    };
  } catch (retryErr) {
    return {
      success: false,
      error:
        retryErr instanceof Error
          ? `Retry failed: ${retryErr.message}`
          : `Retry failed: ${String(retryErr)}`,
      outcome: { status: 'stale_element', reason: 'dom_mutation', retried: true },
    };
  }
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

    outcome = { status: 'success', navigated };
  } catch (err) {
    // Check if this is a stale element error
    if (isStaleElementError(err)) {
      // Check if navigation caused the staleness
      const currentState = await captureNavigationState(handle);
      const isNavigation = checkNavigationOccurred(preClickState, currentState);

      if (isNavigation) {
        // Element gone due to navigation - this is often success!
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

  // Attach observations to snapshot if any were captured
  if (observations.duringAction.length > 0 || observations.sincePrevious.length > 0) {
    snapshot.observations = observations;
  }

  // Generate state response using StateManager
  const stateManager = getStateManager(handle.page_id);
  const state_response = stateManager.generateResponse(snapshot);

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
