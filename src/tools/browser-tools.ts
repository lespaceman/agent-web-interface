/**
 * Browser Tools
 *
 * MCP tool handlers for browser automation.
 */

import type { SessionManager } from '../browser/session-manager.js';
import { SnapshotStore, compileSnapshot, clickByBackendNodeId } from '../snapshot/index.js';
import {
  BrowserLaunchInputSchema,
  BrowserNavigateInputSchema,
  BrowserCloseInputSchema,
  SnapshotCaptureInputSchema,
  ActionClickInputSchema,
  GetNodeDetailsInputSchema,
  FindElementsInputSchema,
  GetFactPackInputSchema,
  type BrowserLaunchOutput,
  type BrowserNavigateOutput,
  type BrowserCloseOutput,
  type SnapshotCaptureOutput,
  type ActionClickOutput,
  type GetNodeDetailsOutput,
  type FindElementsOutput,
  type GetFactPackOutput,
  type NodeDetails,
} from './tool-schemas.js';
import { QueryEngine } from '../query/query-engine.js';
import type { FindElementsRequest } from '../query/types/query.types.js';
import type { NodeKind, SemanticRegion } from '../snapshot/snapshot.types.js';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import { extractFactPack, type FactPackOptions } from '../factpack/index.js';
import { generatePageBrief } from '../renderer/index.js';

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
 * Build CDP endpoint URL from environment variables.
 */
function buildEndpointUrl(): string {
  const host = process.env.CEF_BRIDGE_HOST ?? '127.0.0.1';
  const port = process.env.CEF_BRIDGE_PORT ?? '9223';
  return `http://${host}:${port}`;
}

/**
 * Build node summary array from a snapshot.
 */
function buildNodeSummary(snapshot: BaseSnapshot): {
  node_id: string;
  kind: string;
  label: string;
  selector: string;
}[] {
  return snapshot.nodes.map((node) => ({
    node_id: node.node_id,
    kind: node.kind,
    label: node.label,
    selector: node.find?.primary ?? '',
  }));
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
      throw new Error('No page available. Use browser_launch first.');
    }
  }
  session.touchPage(handle.page_id);
  return handle;
}

/**
 * Launch a new browser or connect to an existing one.
 * Automatically captures a snapshot of the page.
 *
 * @param rawInput - Launch options (will be validated)
 * @returns Page info with snapshot data
 */
export async function browserLaunch(rawInput: unknown): Promise<BrowserLaunchOutput> {
  const input = BrowserLaunchInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle;
  let mode: 'launched' | 'connected';

  if (input.mode === 'connect') {
    const endpointUrl = input.endpoint_url ?? buildEndpointUrl();
    await session.connect({ endpointUrl });

    // Try to adopt existing page, or create one if none exist
    // Use try-catch to handle race condition where page count changes between check and adopt
    try {
      if (session.getPageCount() > 0) {
        handle = await session.adoptPage(0);
      } else {
        // No pages in connected browser, create a new one
        handle = await session.createPage();
      }
    } catch (error) {
      // If adoptPage fails due to race condition (pages changed), create new page
      if (error instanceof Error && error.message.includes('Invalid page index')) {
        handle = await session.createPage();
      } else {
        throw error;
      }
    }
    mode = 'connected';
  } else {
    // Launch mode
    await session.launch({ headless: input.headless });
    handle = await session.createPage();
    mode = 'launched';
  }

  // Auto-capture snapshot
  const snapshot = await compileSnapshot(handle.cdp, handle.page, handle.page_id);
  snapshotStore.store(handle.page_id, snapshot);

  // Extract FactPack
  const factpackOptions: FactPackOptions = {
    max_actions: input.factpack_options?.max_actions,
    min_action_score: input.factpack_options?.min_action_score,
    include_disabled_fields: input.factpack_options?.include_disabled_fields,
  };
  const factpack = extractFactPack(snapshot, factpackOptions);

  // Generate page_brief (always included)
  const pageBriefResult = generatePageBrief(factpack);

  const result: BrowserLaunchOutput = {
    page_id: handle.page_id,
    url: handle.url ?? handle.page.url(),
    title: await handle.page.title(),
    mode,
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_brief: pageBriefResult.page_brief,
    page_brief_tokens: pageBriefResult.page_brief_tokens,
  };

  // Only include factpack if explicitly requested
  if (input.include_factpack) {
    result.factpack = factpack;
  }

  // Only include nodes if explicitly requested
  if (input.include_nodes) {
    result.nodes = buildNodeSummary(snapshot);
  }

  return result;
}

/**
 * Navigate a page to a URL.
 * Automatically captures a snapshot after navigation.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function browserNavigate(rawInput: unknown): Promise<BrowserNavigateOutput> {
  const input = BrowserNavigateInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id with auto-create if not specified
  const handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  await session.navigateTo(page_id, input.url);

  // Auto-capture snapshot after navigation
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack
  const factpackOptions: FactPackOptions = {
    max_actions: input.factpack_options?.max_actions,
    min_action_score: input.factpack_options?.min_action_score,
    include_disabled_fields: input.factpack_options?.include_disabled_fields,
  };
  const factpack = extractFactPack(snapshot, factpackOptions);

  // Generate page_brief (always included)
  const pageBriefResult = generatePageBrief(factpack);

  const result: BrowserNavigateOutput = {
    page_id,
    url: handle.page.url(),
    title: await handle.page.title(),
    snapshot_id: snapshot.snapshot_id,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_brief: pageBriefResult.page_brief,
    page_brief_tokens: pageBriefResult.page_brief_tokens,
  };

  // Only include factpack if explicitly requested
  if (input.include_factpack) {
    result.factpack = factpack;
  }

  // Only include nodes if explicitly requested
  if (input.include_nodes) {
    result.nodes = buildNodeSummary(snapshot);
  }

  return result;
}

/**
 * Close a page or the entire browser session.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function browserClose(rawInput: unknown): Promise<BrowserCloseOutput> {
  const input = BrowserCloseInputSchema.parse(rawInput);
  const session = getSessionManager();

  if (input.page_id) {
    await session.closePage(input.page_id);
    // Also remove any cached snapshot for this page
    snapshotStore.removeByPageId(input.page_id);
  } else {
    await session.shutdown();
    // Clear all snapshots on full shutdown
    snapshotStore.clear();
  }

  return { closed: true };
}

/**
 * Capture a fresh snapshot of the page's interactive elements.
 * Use this to refresh the snapshot if page content has changed dynamically.
 *
 * @param rawInput - Snapshot options (will be validated)
 * @returns Snapshot info with node summaries
 */
export async function snapshotCapture(rawInput: unknown): Promise<SnapshotCaptureOutput> {
  const input = SnapshotCaptureInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id (no auto-create for snapshot)
  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Extract snapshot using CDP
  const snapshot = await compileSnapshot(handle.cdp, handle.page, page_id);

  // Store for later use by actions
  snapshotStore.store(page_id, snapshot);

  // Extract FactPack
  const factpackOptions: FactPackOptions = {
    max_actions: input.factpack_options?.max_actions,
    min_action_score: input.factpack_options?.min_action_score,
    include_disabled_fields: input.factpack_options?.include_disabled_fields,
  };
  const factpack = extractFactPack(snapshot, factpackOptions);

  // Generate page_brief (always included)
  const pageBriefResult = generatePageBrief(factpack);

  const result: SnapshotCaptureOutput = {
    snapshot_id: snapshot.snapshot_id,
    url: snapshot.url,
    title: snapshot.title,
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    page_brief: pageBriefResult.page_brief,
    page_brief_tokens: pageBriefResult.page_brief_tokens,
  };

  // Only include factpack if explicitly requested
  if (input.include_factpack) {
    result.factpack = factpack;
  }

  // Only include nodes if explicitly requested
  if (input.include_nodes) {
    result.nodes = buildNodeSummary(snapshot);
  }

  return result;
}

/**
 * Click an element identified by node_id from a previous snapshot.
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result
 */
export async function actionClick(rawInput: unknown): Promise<ActionClickOutput> {
  const input = ActionClickInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id (no auto-create for click)
  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Get snapshot for this page
  const snapshot = snapshotStore.getByPageId(page_id);
  if (!snapshot) {
    throw new Error(`No snapshot for page ${page_id} - call snapshot_capture first`);
  }

  // Find node in snapshot
  const node = snapshot.nodes.find((n) => n.node_id === input.node_id);
  if (!node) {
    throw new Error(`Node ${input.node_id} not found in snapshot`);
  }

  // Click using CDP backendNodeId (guaranteed unique, avoids Playwright strict mode violation)
  await clickByBackendNodeId(handle.cdp, node.backend_node_id);

  return {
    success: true,
    node_id: input.node_id,
    clicked_element: node.label,
  };
}

/**
 * Get detailed information for specific node(s) from the current snapshot.
 * Use this when you need full node details (layout, state, attributes).
 *
 * @param rawInput - Node details request (will be validated)
 * @returns Full node details
 */
export function getNodeDetails(rawInput: unknown): GetNodeDetailsOutput {
  const input = GetNodeDetailsInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id (no auto-create for read-only operation)
  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Get snapshot for this page
  const snapshot = snapshotStore.getByPageId(page_id);
  if (!snapshot) {
    throw new Error(`No snapshot for page ${page_id} - navigate to a page first`);
  }

  // Find the node
  const node = snapshot.nodes.find((n) => n.node_id === input.node_id);

  if (!node) {
    return {
      page_id,
      snapshot_id: snapshot.snapshot_id,
      nodes: [],
      not_found: [input.node_id],
    };
  }

  // Build full node details
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

  // Add optional state if present
  if (node.state) {
    details.state = {
      visible: node.state.visible,
      enabled: node.state.enabled,
      checked: node.state.checked,
      expanded: node.state.expanded,
      selected: node.state.selected,
      focused: node.state.focused,
      required: node.state.required,
      invalid: node.state.invalid,
      readonly: node.state.readonly,
    };
  }

  // Add optional find if present
  if (node.find) {
    details.find = {
      primary: node.find.primary,
      alternates: node.find.alternates,
    };
  }

  // Add optional attributes if present
  if (node.attributes) {
    details.attributes = {
      input_type: node.attributes.input_type,
      placeholder: node.attributes.placeholder,
      value: node.attributes.value,
      href: node.attributes.href,
      alt: node.attributes.alt,
      src: node.attributes.src,
      heading_level: node.attributes.heading_level,
      action: node.attributes.action,
      method: node.attributes.method,
      autocomplete: node.attributes.autocomplete,
      role: node.attributes.role,
      test_id: node.attributes.test_id,
    };
  }

  return {
    page_id,
    snapshot_id: snapshot.snapshot_id,
    nodes: [details],
  };
}

/**
 * Find elements in a snapshot using semantic filters.
 * Supports filtering by kind, label, region, state, group_id, and heading_context.
 *
 * @param rawInput - Query filters (will be validated)
 * @returns Matched nodes with query statistics
 */
export function findElements(rawInput: unknown): FindElementsOutput {
  const input = FindElementsInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id (no auto-create for query)
  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Get snapshot for this page
  const snapshot = snapshotStore.getByPageId(page_id);
  if (!snapshot) {
    throw new Error(`No snapshot for page ${page_id} - call snapshot_capture first`);
  }

  // Build query request from input
  const request: FindElementsRequest = {
    limit: input.limit,
  };

  // Cast kind to NodeKind type (schema validates string format)
  if (input.kind !== undefined) {
    request.kind = input.kind as NodeKind | NodeKind[];
  }

  // Label can be string or LabelFilter
  if (input.label !== undefined) {
    request.label = input.label;
  }

  // Cast region to SemanticRegion type (schema validates string format)
  if (input.region !== undefined) {
    request.region = input.region as SemanticRegion | SemanticRegion[];
  }

  // State constraints
  if (input.state !== undefined) {
    request.state = input.state;
  }

  // Group ID (exact match)
  if (input.group_id !== undefined) {
    request.group_id = input.group_id;
  }

  // Heading context (exact match)
  if (input.heading_context !== undefined) {
    request.heading_context = input.heading_context;
  }

  // New options: min_score, sort_by_relevance, include_suggestions
  if (input.min_score !== undefined) {
    request.min_score = input.min_score;
  }
  if (input.sort_by_relevance !== undefined) {
    request.sort_by_relevance = input.sort_by_relevance;
  }
  if (input.include_suggestions !== undefined) {
    request.include_suggestions = input.include_suggestions;
  }

  // Create query engine and execute query
  const engine = new QueryEngine(snapshot);
  const response = engine.find(request);

  // Build output with simplified node info (including relevance)
  const matches = response.matches.map((m) => ({
    node_id: m.node.node_id,
    backend_node_id: m.node.backend_node_id,
    kind: m.node.kind,
    label: m.node.label,
    selector: m.node.find?.primary ?? '',
    region: m.node.where.region,
    group_id: m.node.where.group_id,
    heading_context: m.node.where.heading_context,
    relevance: m.relevance,
  }));

  return {
    page_id,
    snapshot_id: snapshot.snapshot_id,
    matches,
    stats: response.stats,
    suggestions: response.suggestions,
  };
}

/**
 * Get FactPack for an existing snapshot.
 * Useful for re-analyzing with different options or getting fresh semantic analysis
 * without re-capturing the page.
 *
 * @param rawInput - FactPack request options (will be validated)
 * @returns FactPack extraction result
 */
export function getFactPack(rawInput: unknown): GetFactPackOutput {
  const input = GetFactPackInputSchema.parse(rawInput);
  const session = getSessionManager();

  // Resolve page_id (no auto-create for FactPack extraction)
  const handle = resolveExistingPage(session, input.page_id);
  const page_id = handle.page_id;

  // Get snapshot (by ID or latest for page)
  let snapshot: BaseSnapshot | undefined;
  if (input.snapshot_id) {
    snapshot = snapshotStore.get(input.snapshot_id);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${input.snapshot_id}`);
    }
  } else {
    snapshot = snapshotStore.getByPageId(page_id);
    if (!snapshot) {
      throw new Error(`No snapshot for page ${page_id} - navigate to a page first`);
    }
  }

  // Extract FactPack with options
  const options: FactPackOptions = {
    max_actions: input.max_actions,
    min_action_score: input.min_action_score,
    include_disabled_fields: input.include_disabled_fields,
  };
  const factpack = extractFactPack(snapshot, options);

  const result: GetFactPackOutput = {
    page_id,
    snapshot_id: snapshot.snapshot_id,
    factpack,
  };

  // Include page_brief if requested
  if (input.include_page_brief) {
    const pageBriefResult = generatePageBrief(factpack);
    result.page_brief = pageBriefResult.page_brief;
    result.page_brief_tokens = pageBriefResult.page_brief_tokens;
  }

  return result;
}
