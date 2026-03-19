/**
 * Heading Index Builder
 *
 * Builds a heading context index mapping each backendNodeId to its
 * heading context based on DOM order traversal.
 *
 * @module snapshot/heading-index
 */

import type { DomExtractionResult, AxExtractionResult } from './extractors/index.js';
import { resolveLabel } from './extractors/index.js';
import { getTextContent } from '../lib/text-utils.js';
import type { AdjacencyMaps, IdMapsByContext } from './frame-context.js';
import { getIdMapForNode } from './frame-context.js';

/**
 * Build heading index mapping each backendNodeId to its heading context.
 * Uses DOM order to determine the most recent preceding heading.
 * Also traverses into shadow roots and iframe content documents.
 *
 * Heading context is isolated at iframe boundaries:
 * - Heading from parent document does NOT propagate into iframe
 * - Heading from iframe does NOT propagate back to parent document
 * - Shadow DOM shares heading context with its host document
 *
 * @param domResult - DOM extraction result
 * @param axResult - AX extraction result for heading names
 * @param idMapsByContext - Context-scoped ID maps for aria-labelledby resolution
 * @param adjacencyMaps - Precomputed maps for shadow roots and content documents
 * @returns Map of backendNodeId -> heading context string
 */
export function buildHeadingIndex(
  domResult: DomExtractionResult,
  axResult: AxExtractionResult | undefined,
  idMapsByContext: IdMapsByContext,
  adjacencyMaps: AdjacencyMaps
): Map<number, string> {
  const headingIndex = new Map<number, string>();
  const shadowHostSet = new Set(domResult.shadowRoots);

  // Helper to check if a node is a heading and resolve its name
  function isHeading(backendNodeId: number): { isHeading: boolean; name?: string } {
    const domNode = domResult.nodes.get(backendNodeId);
    const axNode = axResult?.nodes.get(backendNodeId);

    // Check AX role first
    const scopedIdMap = domNode ? getIdMapForNode(domNode, idMapsByContext) : undefined;

    if (axNode?.role === 'heading') {
      // Priority: AX name -> resolveLabel -> DOM text content
      let name = axNode.name;
      if (!name && domNode) {
        const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
        if (labelResult.source !== 'none') {
          name = labelResult.label;
        }
      }
      name ??= getTextContent(backendNodeId, domResult.nodes);
      return { isHeading: true, name };
    }

    // Check DOM tag (H1-H6)
    if (domNode?.nodeName?.match(/^H[1-6]$/i)) {
      // Priority: AX name -> resolveLabel -> DOM text content
      let name = axNode?.name;
      if (!name) {
        const labelResult = resolveLabel(domNode, axNode, scopedIdMap);
        if (labelResult.source !== 'none') {
          name = labelResult.label;
        }
      }
      name ??= getTextContent(backendNodeId, domResult.nodes);
      return { isHeading: true, name };
    }

    return { isHeading: false };
  }

  // Traverse DOM in pre-order, passing and returning heading context
  function traverse(nodeId: number, currentHeading: string | undefined): string | undefined {
    const node = domResult.nodes.get(nodeId);
    if (!node) return currentHeading;

    // Check if this node is a heading
    const headingInfo = isHeading(nodeId);
    if (headingInfo.isHeading && headingInfo.name) {
      currentHeading = headingInfo.name;
    }

    // Record the current heading context for this node
    if (currentHeading) {
      headingIndex.set(nodeId, currentHeading);
    }

    // 1. Process light DOM children first (pre-order DFS)
    // Heading context propagates and updates through light DOM
    if (node.childNodeIds) {
      for (const childId of node.childNodeIds) {
        currentHeading = traverse(childId, currentHeading) ?? currentHeading;
      }
    }

    // 2. If this node hosts a shadow root, traverse shadow content (O(1) lookup)
    // Shadow DOM shares heading context with host document (same logical document)
    if (shadowHostSet.has(nodeId)) {
      const shadowRoots = adjacencyMaps.shadowRootsByHost.get(nodeId) ?? [];
      for (const shadowRootId of shadowRoots) {
        currentHeading = traverse(shadowRootId, currentHeading) ?? currentHeading;
      }
    }

    // 3. If this node is an iframe, traverse content document (O(1) lookup)
    // IMPORTANT: Heading context resets at iframe boundary (separate document)
    // - Pass undefined to reset context inside iframe
    // - Discard returned heading (iframe headings don't affect parent)
    if (node.frameId || node.nodeName.toUpperCase() === 'IFRAME') {
      const contentDocs = adjacencyMaps.contentDocsByFrame.get(nodeId) ?? [];
      for (const contentDocId of contentDocs) {
        traverse(contentDocId, undefined);
      }
    }

    return currentHeading;
  }

  traverse(domResult.rootId, undefined);
  return headingIndex;
}
