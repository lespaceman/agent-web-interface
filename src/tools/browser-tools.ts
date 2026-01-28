/**
 * Browser Tools
 *
 * MCP tool handlers for browser automation.
 */

import type { SessionManager } from '../browser/session-manager.js';
import {
  SnapshotStore,
  clickByBackendNodeId,
  typeByBackendNodeId,
  pressKey,
  selectOption,
  hoverByBackendNodeId,
  scrollIntoView,
  scrollPage as scrollPageByAmount,
} from '../snapshot/index.js';
import { observationAccumulator } from '../observation/index.js';
import { ATTACHMENT_SIGNIFICANCE_THRESHOLD } from '../observation/observation.types.js';
import type { NodeDetails } from './tool-schemas.js';
import {
  ClosePageInputSchema,
  CloseSessionInputSchema,
  NavigateInputSchema,
  GoBackInputSchema,
  GoForwardInputSchema,
  ReloadInputSchema,
  CaptureSnapshotInputSchema,
  FindElementsInputSchema,
  GetNodeDetailsInputSchema,
  ScrollElementIntoViewInputSchema,
  ScrollPageInputSchema,
  ClickInputSchema,
  TypeInputSchema,
  PressInputSchema,
  SelectInputSchema,
  HoverInputSchema,
} from './tool-schemas.js';
import { QueryEngine } from '../query/query-engine.js';
import type { FindElementsRequest } from '../query/types/query.types.js';
import type { BaseSnapshot, NodeKind, SemanticRegion } from '../snapshot/snapshot.types.js';
import { isReadableNode, isStructuralNode } from '../snapshot/snapshot.types.js';
import { computeEid } from '../state/element-identity.js';
import {
  captureWithStabilization,
  determineHealthCode,
  type CaptureWithStabilizationResult,
} from '../snapshot/snapshot-health.js';
import {
  executeAction,
  executeActionWithRetry,
  executeActionWithOutcome,
  stabilizeAfterNavigation,
  type CaptureSnapshotFn,
  getStateManager,
  removeStateManager,
  clearAllStateManagers,
} from './execute-action.js';
import type { PageHandle } from '../browser/page-registry.js';
import { createHealthyRuntime, createRecoveredCdpRuntime } from '../state/health.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import {
  buildClosePageResponse,
  buildCloseSessionResponse,
  buildListTabsResponse,
  buildFindElementsResponse,
  buildGetNodeDetailsResponse,
  type FindElementsMatch,
} from './response-builder.js';
import { ElementNotFoundError, StaleElementError, SnapshotRequiredError } from './errors.js';
import type { ReadableNode } from '../snapshot/snapshot.types.js';
import { getDependencyTracker } from '../form/index.js';

// Module-level state
let sessionManager: SessionManager | null = null;
const snapshotStore = new SnapshotStore();

/**
 * Initialize tools with a session manager instance.
 * Must be called before using any tool handlers.
 *
 * @param manager - SessionManager instance
 */
export function initializeTools(manager: SessionManager): void {
  sessionManager = manager;
}

/**
 * Get the session manager, throwing if not initialized.
 */
function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error('Tools not initialized. Call initializeTools() first.');
  }
  return sessionManager;
}

/**
 * Get the snapshot store.
 */
export function getSnapshotStore(): SnapshotStore {
  return snapshotStore;
}

/**
 * Resolve page_id to a PageHandle, throwing if not found.
 * Also touches the page to mark it as MRU.
 *
 * @param session - SessionManager instance
 * @param page_id - Optional page identifier
 * @returns PageHandle for the resolved page
 * @throws Error if no page available
 */
function resolveExistingPage(session: SessionManager, page_id: string | undefined): PageHandle {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    if (page_id) {
      throw new Error(`Page not found: ${page_id}`);
    } else {
      throw new Error('No page available. Navigate to a URL first.');
    }
  }
  session.touchPage(handle.page_id);
  return handle;
}

/**
 * Ensure CDP session is healthy, attempting repair if needed.
 *
 * Call this before any CDP operation to auto-repair dead sessions.
 *
 * @param session - SessionManager instance
 * @param handle - Current page handle
 * @returns Updated handle (may be same or new if recovered) and recovery status
 */
async function ensureCdpSession(
  session: SessionManager,
  handle: PageHandle
): Promise<{ handle: PageHandle; recovered: boolean; runtime_health: RuntimeHealth }> {
  // Fast path: CDP is active and responds to a lightweight probe
  if (handle.cdp.isActive()) {
    try {
      await handle.cdp.send('Page.getFrameTree', undefined);
      return { handle, recovered: false, runtime_health: createHealthyRuntime() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[RECOVERY] CDP probe failed for ${handle.page_id}: ${message}. Attempting rebind`
      );
    }
  }

  // Slow path: CDP needs repair
  console.warn(`[RECOVERY] CDP session dead for ${handle.page_id}, attempting rebind`);

  const newHandle = await session.rebindCdpSession(handle.page_id);
  return {
    handle: newHandle,
    recovered: true,
    runtime_health: createRecoveredCdpRuntime('HEALTHY'),
  };
}

/**
 * Build runtime health details from a capture attempt.
 */
function buildRuntimeHealth(
  cdpHealth: RuntimeHealth['cdp'],
  result: CaptureWithStabilizationResult
): RuntimeHealth {
  const code = determineHealthCode(result);

  return {
    cdp: cdpHealth,
    snapshot: {
      ok: code === 'HEALTHY',
      code,
      attempts: result.attempts,
      message: result.health.message,
    },
  };
}

/**
 * Capture a snapshot with stabilization and CDP recovery when empty.
 */
async function captureSnapshotWithRecovery(
  session: SessionManager,
  handle: PageHandle,
  pageId: string
): Promise<{ snapshot: BaseSnapshot; handle: PageHandle; runtime_health: RuntimeHealth }> {
  const ensureResult = await ensureCdpSession(session, handle);
  handle = ensureResult.handle;

  let result = await captureWithStabilization(handle.cdp, handle.page, pageId);
  let runtime_health = buildRuntimeHealth(ensureResult.runtime_health.cdp, result);

  if (!result.health.valid) {
    const healthCode = determineHealthCode(result);
    console.warn(`[RECOVERY] Empty snapshot for ${pageId} (${healthCode}); rebinding CDP session`);

    handle = await session.rebindCdpSession(pageId);
    result = await captureWithStabilization(handle.cdp, handle.page, pageId, { maxRetries: 1 });
    runtime_health = buildRuntimeHealth(
      { ok: true, recovered: true, recovery_method: 'rebind' },
      result
    );
  }

  return { snapshot: result.snapshot, handle, runtime_health };
}

/**
 * Create a capture function that keeps the handle updated after recovery.
 */
function createActionCapture(
  session: SessionManager,
  handleRef: { current: PageHandle },
  pageId: string
): CaptureSnapshotFn {
  return async () => {
    const captureResult = await captureSnapshotWithRecovery(session, handleRef.current, pageId);
    handleRef.current = captureResult.handle;
    return {
      snapshot: captureResult.snapshot,
      runtime_health: captureResult.runtime_health,
    };
  };
}

// ============================================================================
// Action Context Helpers
// ============================================================================

/**
 * Context for action execution.
 */
interface ActionContext {
  /** Mutable reference to page handle (updated on recovery) */
  handleRef: { current: PageHandle };
  /** Resolved page ID */
  pageId: string;
  /** Snapshot capture function */
  captureSnapshot: CaptureSnapshotFn;
  /** Session manager instance */
  session: SessionManager;
}

/**
 * Prepare context for action execution.
 * Resolves page, ensures CDP session health, and creates capture function.
 *
 * @param pageId - Optional page ID to resolve
 * @returns Action context with handle, capture function, and session
 */
async function prepareActionContext(pageId: string | undefined): Promise<ActionContext> {
  const session = getSessionManager();
  const handleRef = { current: resolveExistingPage(session, pageId) };
  const resolvedPageId = handleRef.current.page_id;

  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, resolvedPageId);

  return { handleRef, pageId: resolvedPageId, captureSnapshot, session };
}

/**
 * Resolve element by eid for action tools.
 * Looks up element in registry and finds corresponding node in snapshot.
 * Includes proactive staleness detection before CDP interaction.
 *
 * @param pageId - Page ID for registry lookup
 * @param eid - Element ID to resolve
 * @param snapshot - Current snapshot to search
 * @returns Resolved node from snapshot
 * @throws {ElementNotFoundError} If eid not found in registry
 * @throws {StaleElementError} If eid reference is stale or element not in current snapshot
 */
function resolveElementByEid(pageId: string, eid: string, snapshot: BaseSnapshot): ReadableNode {
  const stateManager = getStateManager(pageId);
  const registry = stateManager.getElementRegistry();
  const elementRef = registry.getByEid(eid);

  if (!elementRef) {
    throw new ElementNotFoundError(eid);
  }

  // Proactive staleness check - detect stale elements before CDP interaction
  // This catches elements that haven't been seen in recent snapshots
  if (registry.isStale(eid)) {
    throw new StaleElementError(eid);
  }

  const node = snapshot.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
  if (!node) {
    throw new StaleElementError(eid);
  }

  return node;
}

/**
 * Require snapshot for action, throwing consistent error if missing.
 *
 * @param pageId - Page ID to look up snapshot
 * @returns Snapshot for the page
 * @throws {SnapshotRequiredError} If no snapshot exists
 */
function requireSnapshot(pageId: string): BaseSnapshot {
  const snap = snapshotStore.getByPageId(pageId);
  if (!snap) {
    throw new SnapshotRequiredError(pageId);
  }
  return snap;
}

/**
 * Navigation action types.
 */
type NavigationAction = 'back' | 'forward' | 'reload';

/**
 * Execute a navigation action with snapshot capture.
 * Consolidates goBack, goForward, and reload handlers.
 *
 * Waits for both DOM stabilization and network idle after navigation
 * to ensure the page is fully loaded before capturing snapshot.
 *
 * @param pageId - Optional page ID
 * @param action - Navigation action to execute
 * @returns State response after navigation
 */
async function executeNavigationAction(
  pageId: string | undefined,
  action: NavigationAction
): Promise<string> {
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(pageId);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  getDependencyTracker().clearPage(page_id);

  // Execute navigation
  switch (action) {
    case 'back':
      await handle.page.goBack();
      break;
    case 'forward':
      await handle.page.goForward();
      break;
    case 'reload':
      await handle.page.reload();
      break;
  }

  // Wait for page to stabilize (DOM + network idle)
  await stabilizeAfterNavigation(handle.page);

  // Re-inject observation accumulator (new document context after navigation)
  await observationAccumulator.inject(handle.page);

  // Auto-capture snapshot after navigation
  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(page_id, snapshot);

  // Return XML state response
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot);
}

// ============================================================================
// SIMPLIFIED API - Tool handlers with clearer contracts
// ============================================================================

/**
 * List all open browser tabs with their metadata.
 *
 * @returns XML result with tab list
 */
export function listTabs(): import('./tool-schemas.js').ListTabsOutput {
  const session = getSessionManager();
  const pages = session.listPages();
  const tabs = pages.map((h) => ({
    page_id: h.page_id,
    url: h.url ?? '',
    title: h.title ?? '',
  }));
  return buildListTabsResponse(tabs);
}

/**
 * Close a specific page.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function closePage(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ClosePageOutput> {
  const input = ClosePageInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.closePage(input.page_id);
  snapshotStore.removeByPageId(input.page_id);
  removeStateManager(input.page_id); // Clean up state manager
  getDependencyTracker().clearPage(input.page_id); // Clean up dependencies

  return buildClosePageResponse(input.page_id);
}

/**
 * Close the entire browser session.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function closeSession(
  rawInput: unknown
): Promise<import('./tool-schemas.js').CloseSessionOutput> {
  CloseSessionInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.shutdown();
  snapshotStore.clear();
  clearAllStateManagers(); // Clean up all state managers
  getDependencyTracker().clearAll(); // Clean up all dependencies

  return buildCloseSessionResponse();
}

/**
 * Navigate to a URL.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function navigate(
  rawInput: unknown
): Promise<import('./tool-schemas.js').NavigateOutput> {
  const input = NavigateInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  getDependencyTracker().clearPage(page_id);

  await session.navigateTo(page_id, input.url);

  // Auto-capture snapshot after navigation
  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(page_id, snapshot);

  // Return XML state response directly
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot);
}

/**
 * Go back in browser history.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function goBack(rawInput: unknown): Promise<import('./tool-schemas.js').GoBackOutput> {
  const input = GoBackInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'back');
}

/**
 * Go forward in browser history.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function goForward(
  rawInput: unknown
): Promise<import('./tool-schemas.js').GoForwardOutput> {
  const input = GoForwardInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'forward');
}

/**
 * Reload the current page.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function reload(rawInput: unknown): Promise<import('./tool-schemas.js').ReloadOutput> {
  const input = ReloadInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'reload');
}

/**
 * Capture a fresh snapshot of the current page.
 *
 * @param rawInput - Capture options (will be validated)
 * @returns Snapshot data for the current page
 */
export async function captureSnapshot(
  rawInput: unknown
): Promise<import('./tool-schemas.js').CaptureSnapshotOutput> {
  const input = CaptureSnapshotInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Capture any accumulated observations (no action window)
  const observations = await observationAccumulator.getAccumulatedObservations(handle.page);

  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;

  // Filter observations to reduce noise (threshold 5 requires semantic signals)
  const filteredObservations = observationAccumulator.filterBySignificance(
    observations,
    ATTACHMENT_SIGNIFICANCE_THRESHOLD
  );

  // Attach accumulated observations to snapshot if any
  if (filteredObservations.sincePrevious.length > 0) {
    snapshot.observations = filteredObservations;
  }

  snapshotStore.store(page_id, snapshot);

  // Return XML state response directly
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot);
}

/**
 * Find elements by semantic criteria.
 *
 * @param rawInput - Query filters (will be validated)
 * @returns Matched nodes
 */
export function findElements(rawInput: unknown): import('./tool-schemas.js').FindElementsOutput {
  const input = FindElementsInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Build query request from input
  const request: FindElementsRequest = {
    limit: input.limit,
  };

  if (input.kind) {
    request.kind = input.kind as NodeKind | NodeKind[];
  }
  if (input.label) {
    request.label = { text: input.label, mode: 'contains', caseSensitive: false };
  }
  if (input.region) {
    request.region = input.region as SemanticRegion | SemanticRegion[];
  }

  const engine = new QueryEngine(snap);
  const response = engine.find(request);

  // Get registry and state manager for EID lookup
  const stateManager = getStateManager(page_id);
  const registry = stateManager.getElementRegistry();
  const activeLayer = stateManager.getActiveLayer();

  const matches: FindElementsMatch[] = response.matches.map((m) => {
    // Check if this is a readable/structural (non-interactive) node
    const isNonInteractive = isReadableNode(m.node) || isStructuralNode(m.node);

    // Look up EID from registry (for interactive nodes)
    const registryEid = registry.getEidBySnapshotAndBackendNodeId(
      snap.snapshot_id,
      m.node.backend_node_id
    );

    // Determine EID:
    // - Interactive nodes: use registry EID
    // - Non-interactive nodes with include_readable: compute rd-* ID on-demand
    // - Non-interactive nodes without include_readable: use unknown-* fallback
    let eid: string;
    if (registryEid) {
      eid = registryEid;
    } else if (isNonInteractive && input.include_readable) {
      // Compute on-demand semantic ID for readable content with rd- prefix
      eid = `rd-${computeEid(m.node, activeLayer).substring(0, 10)}`;
    } else {
      eid = `unknown-${m.node.backend_node_id}`;
    }

    const match: FindElementsMatch = {
      eid,
      kind: m.node.kind,
      label: m.node.label,
      selector: m.node.find?.primary ?? '',
      region: m.node.where.region,
    };

    // Include state if present (type-safe assignment via NodeState interface)
    if (m.node.state) {
      match.state = m.node.state;
    }

    // Include attributes if present (filter to common ones)
    if (m.node.attributes) {
      const attrs: Record<string, string> = {};
      if (m.node.attributes.input_type) attrs.input_type = m.node.attributes.input_type;
      if (m.node.attributes.placeholder) attrs.placeholder = m.node.attributes.placeholder;
      if (m.node.attributes.value) attrs.value = m.node.attributes.value;
      if (m.node.attributes.href) attrs.href = m.node.attributes.href;
      if (m.node.attributes.alt) attrs.alt = m.node.attributes.alt;
      if (m.node.attributes.src) attrs.src = m.node.attributes.src;
      if (Object.keys(attrs).length > 0) {
        match.attributes = attrs;
      }
    }

    return match;
  });

  return buildFindElementsResponse(page_id, snap.snapshot_id, matches);
}

/**
 * Get full details for a specific node.
 *
 * @param rawInput - Node details request (will be validated)
 * @returns Full node details
 */
export function getNodeDetails(
  rawInput: unknown
): import('./tool-schemas.js').GetNodeDetailsOutput {
  const input = GetNodeDetailsInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Look up element by EID from registry
  const stateManager = getStateManager(page_id);
  const elementRef = stateManager.getElementRegistry().getByEid(input.eid);
  if (!elementRef) {
    throw new Error(`Element with eid ${input.eid} not found in registry`);
  }

  // Find the node by backend_node_id
  const node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
  if (!node) {
    throw new Error(`Element with eid ${input.eid} has stale reference`);
  }

  const details: NodeDetails = {
    eid: input.eid,
    kind: node.kind,
    label: node.label,
    where: {
      region: node.where.region,
      group_id: node.where.group_id,
      group_path: node.where.group_path,
      heading_context: node.where.heading_context,
    },
    layout: {
      bbox: node.layout.bbox,
      display: node.layout.display,
      screen_zone: node.layout.screen_zone,
    },
  };

  if (node.state) {
    details.state = { ...node.state };
  }
  if (node.find) {
    details.find = { primary: node.find.primary, alternates: node.find.alternates };
  }
  if (node.attributes) {
    details.attributes = { ...node.attributes };
  }

  return buildGetNodeDetailsResponse(page_id, snap.snapshot_id, details);
}

/**
 * Scroll an element into view.
 *
 * @param rawInput - Scroll options (will be validated)
 * @returns Scroll result with delta
 */
export async function scrollElementIntoView(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ScrollElementIntoViewOutput> {
  const input = ScrollElementIntoViewInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await scrollIntoView(handleRef.current.cdp, backendNodeId);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Scroll the page up or down.
 *
 * @param rawInput - Scroll options (will be validated)
 * @returns Scroll result with delta
 */
export async function scrollPage(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ScrollPageOutput> {
  const input = ScrollPageInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  // Execute action with new simplified wrapper
  const result = await executeAction(
    handleRef.current,
    async () => {
      await scrollPageByAmount(handleRef.current.cdp, input.direction, input.amount);
    },
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Click an element.
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result with navigation-aware outcome
 */
export async function click(rawInput: unknown): Promise<import('./tool-schemas.js').ClickOutput> {
  const input = ClickInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with navigation-aware outcome detection
  const result = await executeActionWithOutcome(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await clickByBackendNodeId(handleRef.current.cdp, backendNodeId);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Type text into an element.
 *
 * @param rawInput - Type options (will be validated)
 * @returns Type result with delta
 */
export async function type(rawInput: unknown): Promise<import('./tool-schemas.js').TypeOutput> {
  const input = TypeInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await typeByBackendNodeId(handleRef.current.cdp, backendNodeId, input.text, {
        clear: input.clear,
      });
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Press a keyboard key (no agent_version).
 *
 * @param rawInput - Press options (will be validated)
 * @returns Press result with delta
 */
export async function press(rawInput: unknown): Promise<import('./tool-schemas.js').PressOutput> {
  const input = PressInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  // Execute action with new simplified wrapper
  const result = await executeAction(
    handleRef.current,
    async () => {
      await pressKey(handleRef.current.cdp, input.key, input.modifiers);
    },
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Select a dropdown option.
 *
 * @param rawInput - Select options (will be validated)
 * @returns Select result with delta
 */
export async function select(rawInput: unknown): Promise<import('./tool-schemas.js').SelectOutput> {
  const input = SelectInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await selectOption(handleRef.current.cdp, backendNodeId, input.value);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Hover over an element.
 *
 * @param rawInput - Hover options (will be validated)
 * @returns Hover result with delta
 */
export async function hover(rawInput: unknown): Promise<import('./tool-schemas.js').HoverOutput> {
  const input = HoverInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await hoverByBackendNodeId(handleRef.current.cdp, backendNodeId);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}
