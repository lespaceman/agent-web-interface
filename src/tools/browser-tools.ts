/**
 * Browser Tools
 *
 * MCP tool handlers for browser automation.
 */

import type { SessionManager } from '../browser/session-manager.js';
import {
  clickByBackendNodeId,
  clickAtCoordinates,
  clickAtElementOffset,
  getElementTopLeft,
  dragBetweenCoordinates,
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
  TakeScreenshotInputSchema,
  DragInputSchema,
} from './tool-schemas.js';
import { captureScreenshot, getElementBoundingBox } from '../screenshot/index.js';
import { cleanupTempFiles } from '../lib/temp-file.js';
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
import type { RuntimeHealth } from '../state/health.types.js';
import {
  buildClosePageResponse,
  buildCloseSessionResponse,
  buildListPagesResponse,
  buildFindElementsResponse,
  buildGetElementDetailsResponse,
  type FindElementsMatch,
} from './response-builder.js';
import { getDependencyTracker } from '../form/index.js';
import {
  initializeToolContext,
  getSessionManager,
  getSnapshotStore,
  resolveExistingPage,
  ensureCdpSession,
  requireSnapshot,
  resolveElementByEid,
} from './tool-context.js';

// Re-export for backward compatibility (external consumers import from browser-tools)
export { getSnapshotStore } from './tool-context.js';

/**
 * Initialize tools with a session manager instance.
 * Must be called before using any tool handlers.
 */
export function initializeTools(manager: SessionManager): void {
  initializeToolContext(manager);
}

// Convenience alias for module-internal use
const snapshotStore = getSnapshotStore();

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

  // Return XML state response (trimmed for navigation snapshots)
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
}

// ============================================================================
// SIMPLIFIED API - Tool handlers with clearer contracts
// ============================================================================

/**
 * List all open browser pages with their metadata.
 *
 * Syncs with browser context to ensure all tabs are registered,
 * including tabs opened externally or after reconnection.
 *
 * @returns XML result with page list
 */
export async function listPages(): Promise<import('./tool-schemas.js').ListPagesOutput> {
  const session = getSessionManager();
  // Sync to pick up any unregistered browser tabs
  const pages = await session.syncPages();
  const pageInfos = pages.map((h) => ({
    page_id: h.page_id,
    url: h.url ?? '',
    title: h.title ?? '',
  }));
  return buildListPagesResponse(pageInfos);
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
  await cleanupTempFiles(); // Clean up screenshot temp files

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

  // Return XML state response directly (trimmed for navigation snapshots)
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
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

  // Return XML state response directly (trimmed for observation snapshots)
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
}

/**
 * Map schema kind values to internal NodeKind values.
 *
 * The find_elements schema uses user-friendly names that don't always match
 * internal NodeKind values. For example, 'textbox' in the schema maps to
 * both 'input' and 'textarea' internally.
 *
 * @param schemaKind - Kind value from the find_elements schema
 * @returns Matching NodeKind value(s)
 */
export function mapSchemaKindToNodeKind(schemaKind: string): NodeKind | NodeKind[] {
  switch (schemaKind) {
    case 'textbox':
      return ['input', 'textarea'];
    default:
      return schemaKind as NodeKind;
  }
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
    request.kind = mapSchemaKindToNodeKind(input.kind);
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

  return buildGetElementDetailsResponse(page_id, snap.snapshot_id, details);
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
 * Click an element or at viewport coordinates.
 *
 * Three modes:
 * 1. eid only → click element center (existing behavior)
 * 2. eid + x/y → click at offset relative to element top-left
 * 3. x/y only → click at absolute viewport coordinates
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result with navigation-aware outcome
 */
export async function click(rawInput: unknown): Promise<import('./tool-schemas.js').ClickOutput> {
  const input = ClickInputSchema.parse(rawInput);
  const hasEid = input.eid !== undefined;
  const hasCoords = input.x !== undefined && input.y !== undefined;

  if (!hasEid && !hasCoords) {
    throw new Error('Either eid or both x and y coordinates must be provided.');
  }

  if ((input.x !== undefined) !== (input.y !== undefined)) {
    throw new Error('Both x and y coordinates must be provided together.');
  }

  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  let result: { snapshot: BaseSnapshot; state_response: string };

  if (hasEid) {
    // Mode 1 & 2: element-based click (center or offset)
    const snap = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid!, snap);

    result = await executeActionWithOutcome(
      handleRef.current,
      node,
      async (backendNodeId) => {
        if (hasCoords) {
          await clickAtElementOffset(handleRef.current.cdp, backendNodeId, input.x!, input.y!);
        } else {
          await clickByBackendNodeId(handleRef.current.cdp, backendNodeId);
        }
      },
      snapshotStore,
      captureSnapshot
    );
  } else {
    // Mode 3: x/y only → absolute viewport click
    result = await executeAction(
      handleRef.current,
      async () => {
        await clickAtCoordinates(handleRef.current.cdp, input.x!, input.y!);
      },
      captureSnapshot
    );
  }

  snapshotStore.store(pageId, result.snapshot);
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

/**
 * Drag from one point to another.
 *
 * If eid is provided, coordinates are relative to the element's top-left corner.
 * Otherwise, coordinates are absolute viewport coordinates.
 *
 * @param rawInput - Drag options (will be validated)
 * @returns Drag result with updated snapshot
 */
export async function drag(rawInput: unknown): Promise<import('./tool-schemas.js').DragOutput> {
  const input = DragInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  let sourceX = input.source_x;
  let sourceY = input.source_y;
  let targetX = input.target_x;
  let targetY = input.target_y;

  if (input.eid) {
    const snap = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid, snap);

    const { x, y } = await getElementTopLeft(handleRef.current.cdp, node.backend_node_id);
    sourceX = x + input.source_x;
    sourceY = y + input.source_y;
    targetX = x + input.target_x;
    targetY = y + input.target_y;
  }

  const result = await executeAction(
    handleRef.current,
    async () => {
      await dragBetweenCoordinates(handleRef.current.cdp, sourceX, sourceY, targetX, targetY);
    },
    captureSnapshot
  );

  snapshotStore.store(pageId, result.snapshot);
  return result.state_response;
}

/**
 * Take a screenshot of the page or a specific element.
 *
 * Observation tool - does not mutate page state.
 * Returns inline image (<2MB) or temp file path (>=2MB).
 *
 * @param rawInput - Screenshot options (will be validated)
 * @returns ImageResult or FileResult
 */
export async function takeScreenshot(
  rawInput: unknown
): Promise<import('./tool-schemas.js').TakeScreenshotOutput> {
  const input = TakeScreenshotInputSchema.parse(rawInput);

  if (input.eid && input.fullPage) {
    throw new Error(
      "Cannot use both 'eid' and 'fullPage'. Use eid for element screenshots OR fullPage for full-page capture."
    );
  }

  const session = getSessionManager();
  let handle = resolveExistingPage(session, input.page_id);
  const pageId = handle.page_id;

  // Ensure CDP session is healthy (auto-repair if needed)
  const ensureResult = await ensureCdpSession(session, handle);
  handle = ensureResult.handle;

  let clip: import('devtools-protocol').Protocol.Page.Viewport | undefined;
  if (input.eid) {
    const snapshot = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid, snapshot);
    clip = await getElementBoundingBox(handle.cdp, node.backend_node_id);
  }

  return captureScreenshot(handle.cdp, {
    format: input.format ?? 'png',
    quality: input.quality,
    clip,
    captureBeyondViewport: input.fullPage ?? false,
  });
}

// Canvas inspection: see canvas-tools.ts
