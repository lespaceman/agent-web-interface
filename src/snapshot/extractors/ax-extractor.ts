/**
 * AX Extractor
 *
 * Extracts accessibility tree and correlates with DOM nodes.
 *
 * @module snapshot/extractors/ax-extractor
 *
 * CDP Domains:
 * - Accessibility.getFullAXTree: Full accessibility tree
 * - Accessibility.getPartialAXTree: Targeted extraction (optimization)
 */

import type { ExtractorContext, AxExtractionResult, RawAxNode, AxProperty } from './types.js';
import { INTERACTIVE_AX_ROLES, READABLE_AX_ROLES, STRUCTURAL_AX_ROLES } from './types.js';

/**
 * CDP AX node value structure
 */
interface CdpAxNodeValue {
  type?: string;
  value?: unknown;
}

/**
 * CDP AX property structure
 */
interface CdpAxProperty {
  name: string;
  value: CdpAxNodeValue;
}

/**
 * CDP AX node structure (as returned by Accessibility.getFullAXTree)
 */
interface CdpAxNode {
  nodeId: string;
  backendDOMNodeId?: number;
  role?: CdpAxNodeValue;
  name?: CdpAxNodeValue;
  properties?: CdpAxProperty[];
  ignored?: boolean;
  childIds?: string[];
}

/**
 * CDP Accessibility.getFullAXTree response
 */
interface AxGetFullTreeResponse {
  nodes: CdpAxNode[];
}

/**
 * Role classification result
 */
export type RoleClassification = 'interactive' | 'readable' | 'structural' | 'unknown';

/**
 * Classify an AX role into category.
 *
 * @param role - AX role string
 * @returns Role classification
 */
export function classifyAxRole(role: string | undefined): RoleClassification {
  if (!role) {
    return 'unknown';
  }

  const normalized = role.toLowerCase();

  if (INTERACTIVE_AX_ROLES.has(normalized)) {
    return 'interactive';
  }

  if (READABLE_AX_ROLES.has(normalized)) {
    return 'readable';
  }

  if (STRUCTURAL_AX_ROLES.has(normalized)) {
    return 'structural';
  }

  return 'unknown';
}

/**
 * Convert CDP AX property to our internal format.
 *
 * @param cdpProp - CDP property structure
 * @returns Internal AxProperty
 */
function convertProperty(cdpProp: CdpAxProperty): AxProperty {
  return {
    name: cdpProp.name,
    value: {
      type: cdpProp.value.type ?? 'unknown',
      value: cdpProp.value.value,
    },
  };
}

/**
 * Process CDP AX nodes and add them to result collections.
 *
 * @param cdpNodes - Array of CDP AX nodes
 * @param nodes - Map to add processed nodes to
 * @param interactiveIds - Set to add interactive node IDs to
 * @param readableIds - Set to add readable node IDs to
 */
function processAxNodes(
  cdpNodes: CdpAxNode[],
  nodes: Map<number, RawAxNode>,
  interactiveIds: Set<number>,
  readableIds: Set<number>
): void {
  for (const cdpNode of cdpNodes) {
    // Skip ignored nodes
    if (cdpNode.ignored) {
      continue;
    }

    // Skip nodes without DOM correlation
    if (cdpNode.backendDOMNodeId === undefined) {
      continue;
    }

    const backendDOMNodeId = cdpNode.backendDOMNodeId;
    const role = cdpNode.role?.value as string | undefined;
    const name = cdpNode.name?.value as string | undefined;

    // Convert properties
    const properties = cdpNode.properties?.map(convertProperty);

    // Create the raw AX node
    const rawNode: RawAxNode = {
      nodeId: cdpNode.nodeId,
      backendDOMNodeId,
      role,
      name,
      properties,
      ignored: cdpNode.ignored,
      childIds: cdpNode.childIds,
    };

    nodes.set(backendDOMNodeId, rawNode);

    // Classify the node
    const classification = classifyAxRole(role);
    if (classification === 'interactive') {
      interactiveIds.add(backendDOMNodeId);
    } else if (classification === 'readable') {
      readableIds.add(backendDOMNodeId);
    }
    // Structural nodes are tracked implicitly in the nodes map
  }
}

/**
 * Extract accessibility tree from page via CDP.
 *
 * Supports multi-frame extraction for pages with iframes (e.g., cookie consent
 * dialogs, embedded widgets). When frameIds are provided, the function extracts
 * AX trees from each frame and merges them into a single result.
 *
 * @param ctx - Extractor context with CDP client and options
 * @param frameIds - Optional array of iframe frame IDs to also extract from
 * @returns AxExtractionResult with nodes map and classification sets
 */
export async function extractAx(
  ctx: ExtractorContext,
  frameIds?: string[]
): Promise<AxExtractionResult> {
  const { cdp } = ctx;

  const nodes = new Map<number, RawAxNode>();
  const interactiveIds = new Set<number>();
  const readableIds = new Set<number>();

  // Request full accessibility tree for main frame
  const mainResponse = await cdp.send<AxGetFullTreeResponse>('Accessibility.getFullAXTree', {
    depth: -1, // Full depth
  });
  processAxNodes(mainResponse.nodes, nodes, interactiveIds, readableIds);

  // Extract AX trees from additional frames (iframes)
  if (frameIds && frameIds.length > 0) {
    // Process frames in parallel for better performance
    const framePromises = frameIds.map(async (frameId) => {
      try {
        const frameResponse = await cdp.send<AxGetFullTreeResponse>('Accessibility.getFullAXTree', {
          depth: -1,
          frameId, // Scope to specific frame
        });
        return frameResponse.nodes;
      } catch {
        // Frame may have been removed, navigated away, or be cross-origin
        // Silently skip failed frames - this is expected for some iframe types
        return [];
      }
    });

    const frameResults = await Promise.all(framePromises);
    for (const frameNodes of frameResults) {
      processAxNodes(frameNodes, nodes, interactiveIds, readableIds);
    }
  }

  return {
    nodes,
    interactiveIds,
    readableIds,
  };
}
