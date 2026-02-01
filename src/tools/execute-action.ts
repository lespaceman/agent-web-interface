/**
 * Execute Action
 *
 * Action execution wrapper with StateManager integration.
 * Captures snapshot and generates StateHandle + Diff + Actionables response.
 * Includes automatic retry logic for stale element errors.
 *
 * Navigation-aware click outcome model for better error classification.
 */

import type { Page } from 'puppeteer-core';
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
import { ATTACHMENT_SIGNIFICANCE_THRESHOLD } from '../observation/observation.types.js';
import {
  waitForNetworkQuiet,
  ACTION_NETWORK_IDLE_TIMEOUT_MS,
  NAVIGATION_NETWORK_IDLE_TIMEOUT_MS,
} from '../browser/page-stabilization.js';
import { getDependencyTracker, createObservedEffect, type ObservedEffect } from '../form/index.js';

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
// Dependency Tracking Helpers
// ============================================================================

/**
 * Compute an ObservedEffect by comparing snapshots before and after an action.
 *
 * This function analyzes differences between two snapshots to determine:
 * - Which elements became enabled/disabled
 * - Which elements appeared/disappeared
 * - Which elements had their values change
 *
 * @param triggerEid - EID of the element that triggered the action
 * @param actionType - Type of action performed
 * @param prevSnapshot - Snapshot before the action (null if first action)
 * @param currSnapshot - Snapshot after the action
 * @returns ObservedEffect if meaningful changes detected, null otherwise
 */
function computeObservedEffect(
  triggerEid: string,
  actionType: 'click' | 'type' | 'select' | 'focus' | 'blur',
  prevSnapshot: BaseSnapshot | null,
  currSnapshot: BaseSnapshot
): ObservedEffect | null {
  // Skip if no previous snapshot to compare
  if (!prevSnapshot) {
    return null;
  }

  // Build maps of enabled/visible states
  const beforeEids = new Map<string, boolean>();
  const beforeVisible = new Set<string>();
  const beforeValues = new Map<string, string>();

  for (const node of prevSnapshot.nodes) {
    beforeEids.set(node.node_id, node.state?.enabled ?? true);
    if (node.state?.visible) {
      beforeVisible.add(node.node_id);
    }
    if (node.attributes?.value !== undefined) {
      beforeValues.set(node.node_id, node.attributes.value);
    }
  }

  const afterEids = new Map<string, boolean>();
  const afterVisible = new Set<string>();
  const valueChanges: string[] = [];

  for (const node of currSnapshot.nodes) {
    afterEids.set(node.node_id, node.state?.enabled ?? true);
    if (node.state?.visible) {
      afterVisible.add(node.node_id);
    }
    // Detect value changes
    const prevValue = beforeValues.get(node.node_id);
    const currValue = node.attributes?.value;
    if (currValue !== undefined && currValue !== prevValue) {
      // Skip if this is the trigger element itself (self-change from typing)
      if (node.node_id !== triggerEid) {
        valueChanges.push(node.node_id);
      }
    }
  }

  // Create the observed effect
  const effect = createObservedEffect(
    triggerEid,
    actionType,
    beforeEids,
    afterEids,
    beforeVisible,
    afterVisible,
    valueChanges
  );

  // Only return if there are meaningful changes
  const hasChanges =
    effect.enabled.length > 0 ||
    effect.disabled.length > 0 ||
    effect.appeared.length > 0 ||
    effect.disappeared.length > 0 ||
    effect.value_changed.length > 0;

  return hasChanges ? effect : null;
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
 * Stabilize page after an action using tiered waiting strategy.
 *
 * This addresses the core issue: actions may trigger API calls that complete
 * after DOM mutations settle. The tiered approach:
 *
 * 1. Wait for DOM to stabilize (MutationObserver) - catches SPA rendering
 * 2. Wait for network to quiet down (networkidle) - catches pending API calls
 * 3. If DOM stabilization fails (navigation), fall back to network idle wait
 *
 * Timeouts are generous but never throw - we proceed even if network stays busy
 * (common with analytics, long-polling, websockets).
 *
 * @param page - Puppeteer Page instance
 * @param networkTimeoutMs - Optional custom timeout for network idle (default: 3000ms)
 * @returns Stabilization result with status
 */
async function stabilizeAfterAction(
  page: Page,
  networkTimeoutMs: number = ACTION_NETWORK_IDLE_TIMEOUT_MS
): Promise<StabilizationResult> {
  // Step 1: Try MutationObserver-based DOM stabilization first
  const result = await stabilizeDom(page);

  // Step 2: Handle based on DOM stabilization result
  if (result.status === 'stable' || result.status === 'timeout') {
    // DOM settled (or timed out) - now wait for network to quiet down
    // This catches API calls that haven't rendered to DOM yet
    const networkIdle = await waitForNetworkQuiet(page, networkTimeoutMs);

    if (!networkIdle && result.status === 'stable') {
      // DOM was stable but network didn't idle - add a note
      return {
        ...result,
        warning: result.warning ?? 'Network did not reach idle state within timeout',
      };
    }

    return result;
  }

  // status === 'error' means page.evaluate() failed, likely due to navigation
  // Fall back to waiting for network idle on the new page
  try {
    // Wait for network to settle on the new page
    await waitForNetworkQuiet(page, networkTimeoutMs);

    return {
      status: 'stable',
      waitTimeMs: result.waitTimeMs,
      warning: 'Navigation detected; waited for networkidle',
    };
  } catch (waitError) {
    // If network wait also fails, the page might be in an unusual state
    // Return the original error but with additional context
    const message = waitError instanceof Error ? waitError.message : String(waitError);
    return {
      status: 'error',
      waitTimeMs: result.waitTimeMs,
      warning: `${result.warning}. Fallback network wait also failed: ${message}`,
    };
  }
}

/**
 * Stabilize page after explicit navigation (goto, back, forward, reload).
 *
 * Uses a longer network timeout since navigations typically trigger more
 * requests than in-page actions.
 *
 * @param page - Puppeteer Page instance
 * @returns Stabilization result with status
 */
export async function stabilizeAfterNavigation(page: Page): Promise<StabilizationResult> {
  return stabilizeAfterAction(page, NAVIGATION_NETWORK_IDLE_TIMEOUT_MS);
}

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
