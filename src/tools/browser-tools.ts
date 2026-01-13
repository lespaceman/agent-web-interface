/**
 * Browser Tools
 *
 * MCP tool handlers for browser automation.
 */

import type { SessionManager } from '../browser/session-manager.js';
import {
  SnapshotStore,
  compileSnapshot,
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
import type { NodeKind, SemanticRegion } from '../snapshot/snapshot.types.js';
import { extractFactPack } from '../factpack/index.js';
import { generatePageSummary } from '../renderer/index.js';
import {
  executeAction,
  executeActionWithRetry,
  removeStateManager,
  clearAllStateManagers,
} from './execute-action.js';

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
): import('../browser/page-registry.js').PageHandle {
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
  const handle = await session.createPage();

  // Auto-capture snapshot
  const snapshot = await compileSnapshot(handle.cdp, handle.page, handle.page_id);
  snapshotStore.store(handle.page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    session_id: 'default', // TODO: Track actual session ID
    page_id: handle.page_id,
    url: handle.url ?? handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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
  const snapshot = await compileSnapshot(handle.cdp, handle.page, handle.page_id);
  snapshotStore.store(handle.page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    session_id: 'default', // TODO: Track actual session ID
    page_id: handle.page_id,
    url: handle.url ?? handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  return {
    closed: true,
    page_id: input.page_id,
  };
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

  return { closed: true };
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

  const handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await session.navigateTo(page_id, input.url);

  // Auto-capture snapshot after navigation
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  const handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.goBack();

  // Auto-capture snapshot after navigation
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  const handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.goForward();

  // Auto-capture snapshot after navigation
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  const handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await handle.page.reload();

  // Auto-capture snapshot after navigation
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack and generate page_summary
  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  const factpack = extractFactPack(snapshot);
  const { page_summary, page_summary_tokens } = generatePageSummary(snapshot, factpack);

  return {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_summary,
    page_summary_tokens,
  };
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

  const matches = response.matches.map((m) => {
    const match: {
      node_id: string;
      backend_node_id: number;
      kind: string;
      label: string;
      selector: string;
      region: string;
      state?: Record<string, boolean | undefined>;
      attributes?: Record<string, string>;
    } = {
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

  return {
    page_id,
    snapshot_id: snap.snapshot_id,
    matches,
  };
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

  return {
    page_id,
    snapshot_id: snap.snapshot_id,
    node: details,
  };
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
  const { ScrollElementIntoViewInputSchema } = await import('./tool-schemas.js');
  const input = ScrollElementIntoViewInputSchema.parse(rawInput);
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

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handle,
    node,
    async (backendNodeId) => {
      await scrollIntoView(handle.cdp, backendNodeId);
    },
    snapshotStore
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    node_id: input.node_id,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
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

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Execute action with new simplified wrapper
  const result = await executeAction(handle, async () => {
    await scrollPageByAmount(handle.cdp, input.direction, input.amount);
  });

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    direction: input.direction,
    amount: input.amount ?? 500,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
}

/**
 * Click an element (no agent_version).
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result with delta
 */
export async function click(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ClickOutput> {
  const { ClickInputSchema } = await import('./tool-schemas.js');
  const input = ClickInputSchema.parse(rawInput);
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

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handle,
    node,
    async (backendNodeId) => {
      await clickByBackendNodeId(handle.cdp, backendNodeId);
    },
    snapshotStore
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    node_id: input.node_id,
    clicked_element: node.label,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
}

/**
 * Type text into an element (node_id required, no agent_version).
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

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handle,
    node,
    async (backendNodeId) => {
      await typeByBackendNodeId(handle.cdp, backendNodeId, input.text, { clear: input.clear });
    },
    snapshotStore
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    typed_text: input.text,
    node_id: input.node_id,
    element_label: node.label,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
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

  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Execute action with new simplified wrapper
  const result = await executeAction(handle, async () => {
    await pressKey(handle.cdp, input.key, input.modifiers);
  });

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    key: input.key,
    modifiers: input.modifiers,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
}

/**
 * Select a dropdown option (no agent_version).
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

  let selectedText = '';

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handle,
    node,
    async (backendNodeId) => {
      selectedText = await selectOption(handle.cdp, backendNodeId, input.value);
    },
    snapshotStore
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    node_id: input.node_id,
    selected_value: input.value,
    selected_text: selectedText,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
}

/**
 * Hover over an element (no agent_version).
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

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handle,
    node,
    async (backendNodeId) => {
      await hoverByBackendNodeId(handle.cdp, backendNodeId);
    },
    snapshotStore
  );

  // Store snapshot for future queries
  snapshotStore.store(page_id, result.snapshot);

  return {
    success: result.success,
    node_id: input.node_id,
    element_label: node.label,
    snapshot_id: result.snapshot_id,
    node_count: result.node_count,
    interactive_count: result.interactive_count,
    page_summary: result.page_summary,
    page_summary_tokens: result.page_summary_tokens,
    error: result.error,
  };
}
