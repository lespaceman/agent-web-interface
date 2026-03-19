/**
 * Node Filtering
 *
 * Filters noise nodes and slices to budget while preserving overlay content.
 *
 * @module snapshot/node-filter
 */

import type { ReadableNode } from './snapshot.types.js';
import type { RawNodeData, RawDomNode, RawAxNode } from './extractors/index.js';
import { isInteractiveKind } from '../state/actionables-filter.js';

/**
 * Filter out noise nodes to reduce snapshot size.
 *
 * Filters:
 * 1. Empty list/listitem containers with no semantic name AND no interactive descendants
 * 2. StaticText/text nodes that mirror their parent's label exactly
 */
export function filterNoiseNodes(
  nodes: ReadableNode[],
  domTree: Map<number, RawDomNode>,
  axTree: Map<number, RawAxNode>
): ReadableNode[] {
  // Build set of interactive node backend IDs for descendant checking
  const interactiveBackendIds = new Set(
    nodes.filter((n) => isInteractiveKind(n.kind)).map((n) => n.backend_node_id)
  );

  // Build parent-child relationship from DOM tree
  const childToParent = new Map<number, number>();
  for (const [nodeId, domNode] of domTree) {
    if (domNode.parentId !== undefined) {
      childToParent.set(nodeId, domNode.parentId);
    }
  }

  // Check if a node has any interactive descendants in the DOM tree
  const hasInteractiveDescendant = (nodeId: number): boolean => {
    const domNode = domTree.get(nodeId);
    if (!domNode) return false;

    // Check direct children
    if (domNode.childNodeIds) {
      for (const childId of domNode.childNodeIds) {
        if (interactiveBackendIds.has(childId)) {
          return true;
        }
        if (hasInteractiveDescendant(childId)) {
          return true;
        }
      }
    }
    return false;
  };

  // Get label of parent node in the node list
  const getParentLabel = (nodeId: number): string | undefined => {
    const parentId = childToParent.get(nodeId);
    if (parentId === undefined) return undefined;

    // Look up parent in our node list
    const parentNode = nodes.find((n) => n.backend_node_id === parentId);
    if (parentNode) {
      return parentNode.label;
    }

    // Parent might be further up - check AX tree for parent's name
    const parentAx = axTree.get(parentId);
    return parentAx?.name;
  };

  // Container kinds that can be noisy when empty
  const containerKinds = new Set(['list', 'listitem']);

  // Text kinds that can duplicate parent labels
  const textKinds = new Set(['text']);

  return nodes.filter((node) => {
    // Rule 1: Filter empty container nodes without interactive descendants
    if (containerKinds.has(node.kind)) {
      const hasSemanticName = node.label && node.label.trim().length > 0;
      if (!hasSemanticName) {
        const hasInteractive = hasInteractiveDescendant(node.backend_node_id);
        if (!hasInteractive) {
          return false; // Filter out empty container without interactive content
        }
      }
    }

    // Rule 2: Filter text nodes that mirror parent's label
    if (textKinds.has(node.kind)) {
      const parentLabel = getParentLabel(node.backend_node_id);
      if (parentLabel && node.label) {
        // Normalize and compare
        const normalizedParent = parentLabel.trim().toLowerCase();
        const normalizedNode = node.label.trim().toLowerCase();
        if (normalizedNode === normalizedParent) {
          return false; // Filter out duplicate text
        }
      }
    }

    return true; // Keep the node
  });
}

/**
 * Slice nodes to max_nodes budget while preserving high z-index overlay content.
 *
 * Portal-rendered content (dropdowns, popovers, modals) appears at the end of
 * DOM order. On heavy pages, a naive slice truncates it.
 *
 * Strategy:
 * 1. Partition nodes into overlay (z-index > threshold) and main
 * 2. Take all overlay nodes (up to 30% of budget)
 * 3. Fill remaining budget with main nodes (DOM order)
 * 4. Re-sort by original DOM order
 */
export function sliceWithOverlayPriority(nodes: RawNodeData[], maxNodes: number): RawNodeData[] {
  if (nodes.length <= maxNodes) {
    return nodes;
  }

  const OVERLAY_Z_THRESHOLD = 100;
  const MAX_OVERLAY_RATIO = 0.3;

  const overlayNodes: RawNodeData[] = [];
  const mainNodes: RawNodeData[] = [];

  for (const node of nodes) {
    const zIndex = node.layout?.zIndex;
    if (zIndex !== undefined && zIndex > OVERLAY_Z_THRESHOLD) {
      overlayNodes.push(node);
    } else {
      mainNodes.push(node);
    }
  }

  // No overlay content → simple slice
  if (overlayNodes.length === 0) {
    return nodes.slice(0, maxNodes);
  }

  // Reserve budget for overlay (capped at 30% of total)
  const maxOverlay = Math.min(overlayNodes.length, Math.floor(maxNodes * MAX_OVERLAY_RATIO));
  const overlaySlice = overlayNodes.slice(0, maxOverlay);

  // Fill remaining budget with main content
  const mainBudget = maxNodes - overlaySlice.length;
  const mainSlice = mainNodes.slice(0, mainBudget);

  // Merge and re-sort by original DOM order
  const merged = [...mainSlice, ...overlaySlice];
  const indexMap = new Map(nodes.map((n, i) => [n.backendNodeId, i]));
  merged.sort((a, b) => {
    const ia = indexMap.get(a.backendNodeId) ?? Infinity;
    const ib = indexMap.get(b.backendNodeId) ?? Infinity;
    return ia - ib;
  });

  return merged;
}
