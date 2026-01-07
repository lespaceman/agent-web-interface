/**
 * Layout Extractor
 *
 * Gets bounding boxes and CSS layout info for nodes.
 *
 * @module snapshot/extractors/layout-extractor
 *
 * CDP Domains:
 * - DOM.getBoxModel: Get bounding box for a node
 * - CSS.getComputedStyleForNode: Get computed CSS properties
 */

import type { BBox, ScreenZone, Viewport } from '../snapshot.types.js';
import type {
  ExtractorContext,
  LayoutExtractionResult,
  NodeLayoutInfo,
  RawDomNode,
} from './types.js';

/**
 * CDP box model response
 */
interface CdpBoxModel {
  content: number[]; // 8 values: x1,y1, x2,y2, x3,y3, x4,y4
  padding?: number[];
  border?: number[];
  margin?: number[];
  width: number;
  height: number;
}

/**
 * CDP DOM.getBoxModel response
 */
interface BoxModelResponse {
  model: CdpBoxModel;
}

/**
 * CDP computed style property
 */
interface CdpComputedStyleProperty {
  name: string;
  value: string;
}

/**
 * CDP CSS.getComputedStyleForNode response
 */
interface ComputedStyleResponse {
  computedStyle: CdpComputedStyleProperty[];
}

/**
 * Compute bounding box from CDP box model content array.
 * CDP returns 8 values representing the 4 corners of the quad.
 *
 * @param content - Array of 8 values: [x1,y1, x2,y2, x3,y3, x4,y4]
 * @param width - Width from box model
 * @param height - Height from box model
 * @returns BBox object
 */
function boxModelToBBox(content: number[], width: number, height: number): BBox {
  // For a simple rectangle, x1,y1 is the top-left corner
  const x = content[0];
  const y = content[1];
  return { x, y, w: width, h: height };
}

/**
 * Compute screen zone based on element position relative to viewport.
 *
 * @param bbox - Element bounding box
 * @param viewport - Viewport dimensions
 * @returns ScreenZone classification
 */
export function computeScreenZone(bbox: BBox, viewport: Viewport): ScreenZone {
  // Check if below fold first
  if (bbox.y >= viewport.height) {
    return 'below-fold';
  }

  // Calculate center point of element
  const centerX = bbox.x + bbox.w / 2;
  const centerY = bbox.y + bbox.h / 2;

  // Divide viewport into 3x3 grid
  const xThird = viewport.width / 3;
  const yThird = viewport.height / 3;

  // Determine horizontal zone
  let horizontal: 'left' | 'center' | 'right';
  if (centerX < xThird) {
    horizontal = 'left';
  } else if (centerX < xThird * 2) {
    horizontal = 'center';
  } else {
    horizontal = 'right';
  }

  // Determine vertical zone
  let vertical: 'top' | 'middle' | 'bottom';
  if (centerY < yThird) {
    vertical = 'top';
  } else if (centerY < yThird * 2) {
    vertical = 'middle';
  } else {
    vertical = 'bottom';
  }

  return `${vertical}-${horizontal}` as ScreenZone;
}

/**
 * Compute visibility from display, visibility CSS properties and bbox.
 *
 * @param bbox - Element bounding box
 * @param display - CSS display value
 * @param visibility - CSS visibility value
 * @returns true if element is visible
 */
export function computeVisibility(
  bbox: BBox,
  display?: string,
  visibility?: string
): boolean {
  // Check CSS display
  if (display === 'none') {
    return false;
  }

  // Check CSS visibility
  if (visibility === 'hidden' || visibility === 'collapse') {
    return false;
  }

  // Check size (zero-size elements are not visible)
  if (bbox.w === 0 || bbox.h === 0) {
    return false;
  }

  return true;
}

/**
 * Extract layout information for a single node.
 *
 * @param ctx - Extractor context
 * @param backendNodeId - Backend node ID (used for DOM.getBoxModel)
 * @param nodeId - Ephemeral node ID (used for CSS.getComputedStyleForNode)
 * @returns NodeLayoutInfo
 */
async function extractNodeLayout(
  ctx: ExtractorContext,
  backendNodeId: number,
  nodeId: number | undefined
): Promise<NodeLayoutInfo> {
  const { cdp, viewport } = ctx;

  let bbox: BBox = { x: 0, y: 0, w: 0, h: 0 };
  let display: string | undefined;
  let visibility: string | undefined;
  let boxModelError = false;

  // Get box model (uses backendNodeId)
  try {
    const boxResponse = await cdp.send<BoxModelResponse>('DOM.getBoxModel', {
      backendNodeId,
    });
    bbox = boxModelToBBox(
      boxResponse.model.content,
      boxResponse.model.width,
      boxResponse.model.height
    );
  } catch {
    // Element may not be rendered (display:none, not in DOM, etc.)
    boxModelError = true;
  }

  // Get computed styles (requires ephemeral nodeId, not backendNodeId)
  if (nodeId !== undefined) {
    try {
      const styleResponse = await cdp.send<ComputedStyleResponse>('CSS.getComputedStyleForNode', {
        nodeId,
      });

      for (const prop of styleResponse.computedStyle) {
        if (prop.name === 'display') {
          display = prop.value;
        } else if (prop.name === 'visibility') {
          visibility = prop.value;
        }
      }
    } catch {
      // Styles may not be available
    }
  }

  const isVisible = boxModelError ? false : computeVisibility(bbox, display, visibility);
  const screenZone = isVisible ? computeScreenZone(bbox, viewport) : undefined;

  return {
    bbox,
    display,
    visibility,
    isVisible,
    screenZone,
  };
}

/**
 * Node ID lookup interface for extractLayout.
 * Maps backendNodeId to object containing nodeId.
 */
type NodeIdLookup = Map<number, { nodeId: number; backendNodeId?: number }>;

/**
 * Extract layout information for multiple nodes.
 *
 * @param ctx - Extractor context with CDP client and options
 * @param backendNodeIds - Array of backend node IDs to extract layout for
 * @param domNodes - Optional map of backendNodeId to DOM node (for nodeId lookup)
 * @returns LayoutExtractionResult with layouts map
 */
export async function extractLayout(
  ctx: ExtractorContext,
  backendNodeIds: number[],
  domNodes?: NodeIdLookup | Map<number, RawDomNode>
): Promise<LayoutExtractionResult> {
  const layouts = new Map<number, NodeLayoutInfo>();

  if (backendNodeIds.length === 0) {
    return { layouts };
  }

  // Extract layout for each node
  // Note: Could be optimized with batching/parallelization for large node counts
  for (const backendNodeId of backendNodeIds) {
    // Look up ephemeral nodeId from DOM nodes map
    const domNode = domNodes?.get(backendNodeId);
    const nodeId = domNode?.nodeId;

    const layout = await extractNodeLayout(ctx, backendNodeId, nodeId);
    layouts.set(backendNodeId, layout);
  }

  return { layouts };
}
