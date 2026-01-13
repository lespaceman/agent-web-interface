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
import type { NodeDetails } from './tool-schemas.js';
import { QueryEngine } from '../query/query-engine.js';
import type { FindElementsRequest } from '../query/types/query.types.js';
import type { BaseSnapshot, NodeKind, SemanticRegion } from '../snapshot/snapshot.types.js';
import {
  captureWithStabilization,
  determineHealthCode,
  type CaptureWithStabilizationResult,
} from '../snapshot/snapshot-health.js';
import {
  executeAction,
  executeActionWithRetry,
  executeActionWithOutcome,
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
  buildFindElementsResponse,
  buildGetNodeDetailsResponse,
  type FindElementsMatch,
} from './response-builder.js';

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
function resolveExistingPage(
  session: SessionManager,
  page_id: string | undefined
): PageHandle {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    if (page_id) {
      throw new Error(`Page not found: ${page_id}`);
    } else {
      throw new Error('No page available. Use launch_browser first.');
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
    console.warn(
      `[RECOVERY] Empty snapshot for ${pageId} (${healthCode}); rebinding CDP session`
    );

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
// SIMPLIFIED API - Tool handlers with clearer contracts
// ============================================================================

/**
 * Launch a new browser instance.
 *
 * @param rawInput - Launch options (will be validated)
 * @returns Page info with snapshot data
 */
export async function launchBrowser(
  rawInput: unknown
): Promise<import('./tool-schemas.js').LaunchBrowserOutput> {
  const { LaunchBrowserInputSchema } = await import('./tool-schemas.js');
  const input = LaunchBrowserInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.launch({ headless: input.headless });
  let handle = await session.createPage();

  // Auto-capture snapshot
  const captureResult = await captureSnapshotWithRecovery(
    session,
    handle,
    handle.page_id
  );
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(handle.page_id, snapshot);

  // Return XML state response directly
  const stateManager = getStateManager(handle.page_id);
  return stateManager.generateResponse(snapshot);
}

/**
 * Connect to an existing browser instance.
 *
 * @param rawInput - Connection options (will be validated)
 * @returns Page info with snapshot data
 */
export async function connectBrowser(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ConnectBrowserOutput> {
  const { ConnectBrowserInputSchema } = await import('./tool-schemas.js');
  const input = ConnectBrowserInputSchema.parse(rawInput);
  const session = getSessionManager();

  if (input.endpoint_url) {
    await session.connect({ endpointUrl: input.endpoint_url });
  } else {
    await session.connect();
  }

  // Try to adopt existing page, or create one if none exist
  let handle;
  try {
    if (session.getPageCount() > 0) {
      handle = await session.adoptPage(0);
    } else {
      handle = await session.createPage();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid page index')) {
      handle = await session.createPage();
    } else {
      throw error;
    }
  }

  // Auto-capture snapshot
  const captureResult = await captureSnapshotWithRecovery(
    session,
    handle,
    handle.page_id
  );
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(handle.page_id, snapshot);

  // Return XML state response directly
  const stateManager = getStateManager(handle.page_id);
  return stateManager.generateResponse(snapshot);
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
  const { ClosePageInputSchema } = await import('./tool-schemas.js');
  const input = ClosePageInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.closePage(input.page_id);
  snapshotStore.removeByPageId(input.page_id);
  removeStateManager(input.page_id); // Clean up state manager

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
  const { CloseSessionInputSchema } = await import('./tool-schemas.js');
  CloseSessionInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.shutdown();
  snapshotStore.clear();
  clearAllStateManagers(); // Clean up all state managers

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
  const { NavigateInputSchema } = await import('./tool-schemas.js');
  const input = NavigateInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

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
export async function goBack(
  rawInput: unknown
): Promise<import('./tool-schemas.js').GoBackOutput> {
  const { GoBackInputSchema } = await import('./tool-schemas.js');
  const input = GoBackInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.goBack();

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
 * Go forward in browser history.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function goForward(
  rawInput: unknown
): Promise<import('./tool-schemas.js').GoForwardOutput> {
  const { GoForwardInputSchema } = await import('./tool-schemas.js');
  const input = GoForwardInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.goForward();

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
 * Reload the current page.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function reload(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ReloadOutput> {
  const { ReloadInputSchema } = await import('./tool-schemas.js');
  const input = ReloadInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.reload();

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
 * Capture a fresh snapshot of the current page.
 *
 * @param rawInput - Capture options (will be validated)
 * @returns Snapshot data for the current page
 */
export async function captureSnapshot(
  rawInput: unknown
): Promise<import('./tool-schemas.js').CaptureSnapshotOutput> {
  const { CaptureSnapshotInputSchema } = await import('./tool-schemas.js');
  const input = CaptureSnapshotInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
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
export async function findElements(
  rawInput: unknown
): Promise<import('./tool-schemas.js').FindElementsOutput> {
  const { FindElementsInputSchema } = await import('./tool-schemas.js');
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

  const matches: FindElementsMatch[] = response.matches.map((m) => {
    const match: FindElementsMatch = {
      node_id: m.node.node_id,
      backend_node_id: m.node.backend_node_id,
      kind: m.node.kind,
      label: m.node.label,
      selector: m.node.find?.primary ?? '',
      region: m.node.where.region,
    };

    // Include state if present
    if (m.node.state) {
      match.state = m.node.state as unknown as Record<string, boolean | undefined>;
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
export async function getNodeDetails(
  rawInput: unknown
): Promise<import('./tool-schemas.js').GetNodeDetailsOutput> {
  const { GetNodeDetailsInputSchema } = await import('./tool-schemas.js');
  const input = GetNodeDetailsInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  const node = snap.nodes.find((n) => n.node_id === input.node_id);
  if (!node) {
    throw new Error(`Node ${input.node_id} not found in snapshot`);
  }

  const details: NodeDetails = {
    node_id: node.node_id,
    backend_node_id: node.backend_node_id,
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
 * Accepts either eid (preferred) or node_id (deprecated) for element targeting.
 *
 * @param rawInput - Scroll options (will be validated)
 * @returns Scroll result with delta
 */
export async function scrollElementIntoView(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ScrollElementIntoViewOutput> {
  const { ScrollElementIntoViewInputSchema } = await import('./tool-schemas.js');
  const input = ScrollElementIntoViewInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Resolve target element (eid preferred, node_id deprecated)
  let node;
  if (input.eid) {
    const stateManager = getStateManager(page_id);
    const elementRef = stateManager.getElementRegistry().getByEid(input.eid);
    if (!elementRef) {
      throw new Error(`Element with eid ${input.eid} not found`);
    }
    node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new Error(`Element with eid ${input.eid} has stale reference`);
    }
  } else if (input.node_id) {
    node = snap.nodes.find((n) => n.node_id === input.node_id);
    if (!node) {
      throw new Error(`Node ${input.node_id} not found in snapshot`);
    }
    console.warn(`[DEPRECATED] scrollElementIntoView with node_id - use eid instead`);
  } else {
    throw new Error('Either eid or node_id is required');
  }

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
  snapshotStore.store(page_id, result.snapshot);

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
  const { ScrollPageInputSchema } = await import('./tool-schemas.js');
  const input = ScrollPageInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  // Execute action with new simplified wrapper
  const result = await executeAction(
    handleRef.current,
    async () => {
      await scrollPageByAmount(handleRef.current.cdp, input.direction, input.amount);
    },
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Click an element.
 * Accepts either eid (preferred) or node_id (deprecated) for element targeting.
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result with navigation-aware outcome
 */
export async function click(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ClickOutput> {
  const { ClickInputSchema } = await import('./tool-schemas.js');
  const input = ClickInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Resolve target element (eid preferred, node_id deprecated)
  let node;

  if (input.eid) {
    // New path: use eid to look up via ElementRegistry
    const stateManager = getStateManager(page_id);
    const elementRef = stateManager.getElementRegistry().getByEid(input.eid);

    if (!elementRef) {
      throw new Error(`Element with eid ${input.eid} not found`);
    }

    // Find node by backend_node_id
    node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new Error(`Element with eid ${input.eid} has stale reference`);
    }
  } else if (input.node_id) {
    // Legacy path: use node_id directly (deprecated)
    node = snap.nodes.find((n) => n.node_id === input.node_id);
    if (!node) {
      throw new Error(`Node ${input.node_id} not found in snapshot`);
    }
    // Log deprecation warning
    console.warn(`[DEPRECATED] click with node_id - use eid instead`);
  } else {
    throw new Error('Either eid or node_id is required');
  }

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
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Type text into an element.
 * Accepts either eid (preferred) or node_id (deprecated) for element targeting.
 *
 * @param rawInput - Type options (will be validated)
 * @returns Type result with delta
 */
export async function type(
  rawInput: unknown
): Promise<import('./tool-schemas.js').TypeOutput> {
  const { TypeInputSchema } = await import('./tool-schemas.js');
  const input = TypeInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Resolve target element (eid preferred, node_id deprecated)
  let node;
  if (input.eid) {
    const stateManager = getStateManager(page_id);
    const elementRef = stateManager.getElementRegistry().getByEid(input.eid);
    if (!elementRef) {
      throw new Error(`Element with eid ${input.eid} not found`);
    }
    node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new Error(`Element with eid ${input.eid} has stale reference`);
    }
  } else if (input.node_id) {
    node = snap.nodes.find((n) => n.node_id === input.node_id);
    if (!node) {
      throw new Error(`Node ${input.node_id} not found in snapshot`);
    }
    console.warn(`[DEPRECATED] type with node_id - use eid instead`);
  } else {
    throw new Error('Either eid or node_id is required');
  }

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
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Press a keyboard key (no agent_version).
 *
 * @param rawInput - Press options (will be validated)
 * @returns Press result with delta
 */
export async function press(
  rawInput: unknown
): Promise<import('./tool-schemas.js').PressOutput> {
  const { PressInputSchema } = await import('./tool-schemas.js');
  const input = PressInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  // Execute action with new simplified wrapper
  const result = await executeAction(
    handleRef.current,
    async () => {
      await pressKey(handleRef.current.cdp, input.key, input.modifiers);
    },
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Select a dropdown option.
 * Accepts either eid (preferred) or node_id (deprecated) for element targeting.
 *
 * @param rawInput - Select options (will be validated)
 * @returns Select result with delta
 */
export async function select(
  rawInput: unknown
): Promise<import('./tool-schemas.js').SelectOutput> {
  const { SelectInputSchema } = await import('./tool-schemas.js');
  const input = SelectInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Resolve target element (eid preferred, node_id deprecated)
  let node;
  if (input.eid) {
    const stateManager = getStateManager(page_id);
    const elementRef = stateManager.getElementRegistry().getByEid(input.eid);
    if (!elementRef) {
      throw new Error(`Element with eid ${input.eid} not found`);
    }
    node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new Error(`Element with eid ${input.eid} has stale reference`);
    }
  } else if (input.node_id) {
    node = snap.nodes.find((n) => n.node_id === input.node_id);
    if (!node) {
      throw new Error(`Node ${input.node_id} not found in snapshot`);
    }
    console.warn(`[DEPRECATED] select with node_id - use eid instead`);
  } else {
    throw new Error('Either eid or node_id is required');
  }

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
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Hover over an element.
 * Accepts either eid (preferred) or node_id (deprecated) for element targeting.
 *
 * @param rawInput - Hover options (will be validated)
 * @returns Hover result with delta
 */
export async function hover(
  rawInput: unknown
): Promise<import('./tool-schemas.js').HoverOutput> {
  const { HoverInputSchema } = await import('./tool-schemas.js');
  const input = HoverInputSchema.parse(rawInput);
  const session = getSessionManager();

  const handleRef = { current: resolveExistingPage(session, input.page_id) };
  const page_id = handleRef.current.page_id;
  handleRef.current = (await ensureCdpSession(session, handleRef.current)).handle;
  const captureSnapshot = createActionCapture(session, handleRef, page_id);

  const snap = snapshotStore.getByPageId(page_id);
  if (!snap) {
    throw new Error(`No snapshot for page ${page_id} - capture a snapshot first`);
  }

  // Resolve target element (eid preferred, node_id deprecated)
  let node;
  if (input.eid) {
    const stateManager = getStateManager(page_id);
    const elementRef = stateManager.getElementRegistry().getByEid(input.eid);
    if (!elementRef) {
      throw new Error(`Element with eid ${input.eid} not found`);
    }
    node = snap.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new Error(`Element with eid ${input.eid} has stale reference`);
    }
  } else if (input.node_id) {
    node = snap.nodes.find((n) => n.node_id === input.node_id);
    if (!node) {
      throw new Error(`Node ${input.node_id} not found in snapshot`);
    }
    console.warn(`[DEPRECATED] hover with node_id - use eid instead`);
  } else {
    throw new Error('Either eid or node_id is required');
  }

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
  snapshotStore.store(page_id, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}
