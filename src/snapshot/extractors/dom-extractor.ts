/**
 * DOM Extractor
 *
 * Extracts DOM tree structure via CDP, handling shadow DOM and iframes.
 *
 * @module snapshot/extractors/dom-extractor
 *
 * CDP Domains:
 * - DOM.getDocument: Get document root with full tree
 * - DOM.describeNode: Get details for a specific node (if needed)
 * - DOM.requestChildNodes: Expand children (for incremental loading)
 */

import type {
  ExtractorContext,
  DomExtractionResult,
  RawDomNode,
} from './types.js';

/**
 * CDP DOM node structure (as returned by DOM.getDocument)
 */
interface CdpDomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpDomNode[];
  shadowRoots?: CdpDomNode[];
  contentDocument?: CdpDomNode;
  frameId?: string;
  shadowRootType?: 'open' | 'closed';
}

/**
 * CDP DOM.getDocument response
 */
interface DomGetDocumentResponse {
  root: CdpDomNode;
}

/**
 * Parse CDP attributes array into key-value object.
 * CDP returns attributes as flat array: [name1, value1, name2, value2, ...]
 *
 * @param attributes - Flat array of attribute name-value pairs
 * @returns Record of attribute names to values
 */
function parseAttributes(attributes?: string[]): Record<string, string> | undefined {
  if (!attributes || attributes.length === 0) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (let i = 0; i < attributes.length; i += 2) {
    const name = attributes[i];
    const value = attributes[i + 1] ?? '';
    result[name] = value;
  }
  return result;
}

/**
 * Recursively traverse DOM tree and extract nodes.
 *
 * @param cdpNode - CDP DOM node
 * @param parentId - Parent node's backendNodeId (undefined for root)
 * @param nodes - Map to accumulate extracted nodes
 * @param frameIds - Set to accumulate discovered frame IDs
 * @param shadowRoots - Array to accumulate shadow root host backendNodeIds
 */
function traverseNode(
  cdpNode: CdpDomNode,
  parentId: number | undefined,
  nodes: Map<number, RawDomNode>,
  frameIds: Set<string>,
  shadowRoots: number[]
): void {
  const backendNodeId = cdpNode.backendNodeId;

  // Determine shadow root type if this node hosts a shadow root
  let shadowRootType: 'open' | 'closed' | undefined;
  if (cdpNode.shadowRoots && cdpNode.shadowRoots.length > 0) {
    // Get the shadow root type from the first shadow root
    const firstShadowRoot = cdpNode.shadowRoots[0];
    shadowRootType = firstShadowRoot.shadowRootType;
    shadowRoots.push(backendNodeId);
  }

  // Track frame ID if this is an iframe
  let frameId: string | undefined;
  if (cdpNode.frameId) {
    frameId = cdpNode.frameId;
    frameIds.add(frameId);
  }

  // Collect child backendNodeIds
  const childNodeIds: number[] = [];
  if (cdpNode.children) {
    for (const child of cdpNode.children) {
      childNodeIds.push(child.backendNodeId);
    }
  }

  // Create the raw DOM node
  const rawNode: RawDomNode = {
    nodeId: cdpNode.nodeId,
    backendNodeId,
    nodeName: cdpNode.nodeName,
    nodeType: cdpNode.nodeType,
    attributes: parseAttributes(cdpNode.attributes),
    childNodeIds: childNodeIds.length > 0 ? childNodeIds : undefined,
    shadowRootType,
    frameId,
    parentId,
    nodeValue: cdpNode.nodeValue,
  };

  nodes.set(backendNodeId, rawNode);

  // Recursively process children
  if (cdpNode.children) {
    for (const child of cdpNode.children) {
      traverseNode(child, backendNodeId, nodes, frameIds, shadowRoots);
    }
  }

  // Process shadow roots (open shadow DOM)
  if (cdpNode.shadowRoots) {
    for (const shadowRoot of cdpNode.shadowRoots) {
      traverseNode(shadowRoot, backendNodeId, nodes, frameIds, shadowRoots);
    }
  }

  // Process content document (iframes)
  if (cdpNode.contentDocument) {
    traverseNode(cdpNode.contentDocument, backendNodeId, nodes, frameIds, shadowRoots);
  }
}

/**
 * Extract DOM tree from page via CDP.
 *
 * @param ctx - Extractor context with CDP client and options
 * @returns DomExtractionResult with nodes map, root ID, and metadata
 */
export async function extractDom(ctx: ExtractorContext): Promise<DomExtractionResult> {
  const { cdp } = ctx;

  // Request full DOM tree with shadow DOM piercing
  const response = await cdp.send<DomGetDocumentResponse>('DOM.getDocument', {
    depth: -1, // Full depth
    pierce: true, // Pierce through iframes and shadow DOM
  });

  const nodes = new Map<number, RawDomNode>();
  const frameIds = new Set<string>();
  const shadowRoots: number[] = [];

  // Traverse the tree starting from root
  traverseNode(response.root, undefined, nodes, frameIds, shadowRoots);

  return {
    nodes,
    rootId: response.root.backendNodeId,
    frameIds: Array.from(frameIds),
    shadowRoots,
  };
}
