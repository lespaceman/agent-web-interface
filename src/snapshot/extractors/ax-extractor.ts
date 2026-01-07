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

import type {
  ExtractorContext,
  AxExtractionResult,
  RawAxNode,
  AxProperty,
} from './types.js';
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
 * Extract accessibility tree from page via CDP.
 *
 * @param ctx - Extractor context with CDP client and options
 * @returns AxExtractionResult with nodes map and classification sets
 */
export async function extractAx(ctx: ExtractorContext): Promise<AxExtractionResult> {
  const { cdp } = ctx;

  // Request full accessibility tree
  const response = await cdp.send<AxGetFullTreeResponse>('Accessibility.getFullAXTree', {
    depth: -1, // Full depth
  });

  const nodes = new Map<number, RawAxNode>();
  const interactiveIds = new Set<number>();
  const readableIds = new Set<number>();

  for (const cdpNode of response.nodes) {
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

  return {
    nodes,
    interactiveIds,
    readableIds,
  };
}
