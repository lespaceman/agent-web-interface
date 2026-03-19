/**
 * Frame and Shadow DOM Context Utilities
 *
 * Provides context-scoped ID maps, adjacency maps for shadow roots and
 * iframe content documents, and DOM order indexing.
 *
 * @module snapshot/frame-context
 */

import type { DomExtractionResult, RawDomNode } from './extractors/index.js';

/**
 * Adjacency maps for efficient shadow root and content document lookup.
 */
export interface AdjacencyMaps {
  /** Maps shadow host backendNodeId -> array of shadow root backendNodeIds */
  shadowRootsByHost: Map<number, number[]>;
  /** Maps iframe backendNodeId -> array of content document backendNodeIds */
  contentDocsByFrame: Map<number, number[]>;
}

export type IdMapsByContext = Map<string, Map<string, RawDomNode>>;

const ROOT_CONTEXT = 'root';
const LIGHT_DOM_CONTEXT = 'light';

/**
 * Build a context key based on iframe and shadow ancestry.
 */
export function buildContextKey(node: RawDomNode): string {
  const frameKey = node.framePath?.length ? node.framePath.join('/') : ROOT_CONTEXT;
  const shadowKey = node.shadowPath?.length ? node.shadowPath.join('/') : LIGHT_DOM_CONTEXT;
  return `${frameKey}|${shadowKey}`;
}

/**
 * Build context-scoped ID maps to avoid cross-frame/shadow collisions.
 */
export function buildIdMapsByContext(domResult: DomExtractionResult): IdMapsByContext {
  const idMaps = new Map<string, Map<string, RawDomNode>>();

  for (const node of domResult.nodes.values()) {
    const id = node.attributes?.id;
    if (!id) continue;

    const contextKey = buildContextKey(node);
    let map = idMaps.get(contextKey);
    if (!map) {
      map = new Map<string, RawDomNode>();
      idMaps.set(contextKey, map);
    }
    map.set(id, node);
  }

  return idMaps;
}

/**
 * Get the ID map scoped to a node's frame/shadow context.
 */
export function getIdMapForNode(
  node: RawDomNode | undefined,
  idMapsByContext: IdMapsByContext
): Map<string, RawDomNode> | undefined {
  if (!node) return undefined;
  return idMapsByContext.get(buildContextKey(node));
}

/**
 * Build adjacency maps for shadow roots and iframe content documents.
 * Single O(n) pass through all nodes.
 *
 * @param domResult - DOM extraction result
 * @returns Adjacency maps for shadow roots and content documents
 */
export function buildAdjacencyMaps(domResult: DomExtractionResult): AdjacencyMaps {
  const shadowRootsByHost = new Map<number, number[]>();
  const contentDocsByFrame = new Map<number, number[]>();

  for (const [nodeId, node] of domResult.nodes) {
    if (node.parentId === undefined) continue;

    if (node.nodeName === '#document-fragment') {
      // This is a shadow root - add to shadow host's children
      const existing = shadowRootsByHost.get(node.parentId) ?? [];
      existing.push(nodeId);
      shadowRootsByHost.set(node.parentId, existing);
    } else if (node.nodeName === '#document') {
      // This is a content document - add to iframe's children
      const existing = contentDocsByFrame.get(node.parentId) ?? [];
      existing.push(nodeId);
      contentDocsByFrame.set(node.parentId, existing);
    }
  }

  return { shadowRootsByHost, contentDocsByFrame };
}

/**
 * Build DOM pre-order index by traversing the DOM tree.
 * Also traverses into shadow roots and iframe content documents.
 *
 * @param domResult - DOM extraction result with nodes and rootId
 * @param adjacencyMaps - Precomputed maps for shadow roots and content documents
 * @returns Map of backendNodeId -> DOM order index
 */
export function buildDomOrderIndex(
  domResult: DomExtractionResult,
  adjacencyMaps: AdjacencyMaps
): Map<number, number> {
  const orderIndex = new Map<number, number>();
  const shadowHostSet = new Set(domResult.shadowRoots);
  let index = 0;

  function traverse(nodeId: number): void {
    const node = domResult.nodes.get(nodeId);
    if (!node) return;

    orderIndex.set(nodeId, index++);

    // 1. Process light DOM children first (pre-order DFS)
    if (node.childNodeIds) {
      for (const childId of node.childNodeIds) {
        traverse(childId);
      }
    }

    // 2. If this node hosts a shadow root, traverse shadow content (O(1) lookup)
    if (shadowHostSet.has(nodeId)) {
      const shadowRoots = adjacencyMaps.shadowRootsByHost.get(nodeId) ?? [];
      for (const shadowRootId of shadowRoots) {
        traverse(shadowRootId);
      }
    }

    // 3. If this node is an iframe, traverse content document (O(1) lookup)
    if (node.frameId || node.nodeName.toUpperCase() === 'IFRAME') {
      const contentDocs = adjacencyMaps.contentDocsByFrame.get(nodeId) ?? [];
      for (const contentDocId of contentDocs) {
        traverse(contentDocId);
      }
    }
  }

  traverse(domResult.rootId);
  return orderIndex;
}

/**
 * Frame info for loader ID lookup.
 */
export interface FrameLoaderInfo {
  frameId: string;
  loaderId: string;
  isMainFrame: boolean;
}

/**
 * Recursively collect frame loaderIds from frame tree.
 */
export function collectFrameLoaderIds(
  frameTree: {
    frame: { id: string; loaderId: string; parentId?: string };
    childFrames?: unknown[];
  },
  frameLoaderIds: Map<string, FrameLoaderInfo>,
  _isMainFrame = true
): void {
  const frame = frameTree.frame;
  frameLoaderIds.set(frame.id, {
    frameId: frame.id,
    loaderId: frame.loaderId,
    isMainFrame: !frame.parentId,
  });

  if (frameTree.childFrames) {
    for (const child of frameTree.childFrames as (typeof frameTree)[]) {
      collectFrameLoaderIds(child, frameLoaderIds, false);
    }
  }
}
