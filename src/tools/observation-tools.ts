/**
 * Observation Tools
 *
 * MCP tool handlers for page observation: snapshots, find, get_element, scroll.
 */

import {
  scrollIntoView,
  scrollPage as scrollPageByAmount,
} from '../snapshot/index.js';
import { observationAccumulator } from '../observation/index.js';
import { ATTACHMENT_SIGNIFICANCE_THRESHOLD } from '../observation/observation.types.js';
import type { NodeDetails } from './tool-schemas.js';
import {
  CaptureSnapshotInputSchema,
  FindElementsInputSchema,
  GetNodeDetailsInputSchema,
  ScrollElementIntoViewInputSchema,
  ScrollPageInputSchema,
} from './tool-schemas.js';
import { QueryEngine } from '../query/query-engine.js';
import type { FindElementsRequest } from '../query/types/query.types.js';
import type { NodeKind, SemanticRegion } from '../snapshot/snapshot.types.js';
import { isReadableNode, isStructuralNode, isLiveRegionNode } from '../snapshot/snapshot.types.js';
import { computeEid } from '../state/element-identity.js';
import { LIVE_REGION_KINDS } from '../state/actionables-filter.js';
import {
  executeAction,
  executeActionWithRetry,
  getStateManager,
} from './execute-action.js';
import {
  buildFindElementsResponse,
  buildGetElementDetailsResponse,
  type FindElementsMatch,
} from './response-builder.js';
import {
  getSessionManager,
  getSnapshotStore,
  resolveExistingPage,
  requireSnapshot,
  resolveElementByEid,
} from './tool-context.js';
import { captureSnapshotWithRecovery, prepareActionContext } from './action-context.js';

// Convenience alias for module-internal use
const snapshotStore = getSnapshotStore();

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
 * The find schema uses user-friendly names that don't always match
 * internal NodeKind values. For example, 'textbox' in the schema maps to
 * both 'input' and 'textarea' internally.
 *
 * @param schemaKind - Kind value from the find schema
 * @returns Matching NodeKind value(s)
 */
export function mapSchemaKindToNodeKind(schemaKind: string): NodeKind | NodeKind[] {
  switch (schemaKind) {
    case 'textbox':
      return ['input', 'textarea'];
    case 'alert':
      return [...LIVE_REGION_KINDS];
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
    const isNonInteractive = isReadableNode(m.node) || isStructuralNode(m.node) || isLiveRegionNode(m.node);

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
