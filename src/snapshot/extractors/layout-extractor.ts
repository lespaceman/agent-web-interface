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
 * Compute visibility from CSS properties and bbox.
 *
 * @param bbox - Element bounding box
 * @param display - CSS display value
 * @param visibility - CSS visibility value
 * @param opacity - CSS opacity value
 * @param pointerEvents - CSS pointer-events value
 * @param clipPath - CSS clip-path value
 * @returns true if element is visible
 */
export function computeVisibility(
  bbox: BBox,
  display?: string,
  visibility?: string,
  opacity?: string,
  pointerEvents?: string,
  clipPath?: string
): boolean {
  // Check CSS display
  if (display === 'none') {
    return false;
  }

  // Check CSS visibility
  if (visibility === 'hidden' || visibility === 'collapse') {
    return false;
  }

  // Check opacity (fully transparent elements are not visible)
  if (opacity === '0') {
    return false;
  }

  // Check pointer-events (non-interactive elements treated as not visible for interaction)
  if (pointerEvents === 'none') {
    return false;
  }

  // Check clip-path (fully clipped elements are not visible)
  if (clipPath === 'inset(100%)') {
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
  let zIndex: number | undefined;
  let opacity: string | undefined;
  let pointerEvents: string | undefined;
  let clipPath: string | undefined;
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
        } else if (prop.name === 'z-index') {
          // Parse z-index; 'auto' results in NaN which we ignore
          const parsed = parseInt(prop.value, 10);
          if (!isNaN(parsed)) {
            zIndex = parsed;
          }
        } else if (prop.name === 'opacity') {
          opacity = prop.value;
        } else if (prop.name === 'pointer-events') {
          pointerEvents = prop.value;
        } else if (prop.name === 'clip-path') {
          clipPath = prop.value;
        }
      }
    } catch {
      // Styles may not be available
    }
  }

  const isVisible = boxModelError
    ? false
    : computeVisibility(bbox, display, visibility, opacity, pointerEvents, clipPath);
  const screenZone = isVisible ? computeScreenZone(bbox, viewport) : undefined;

  return {
    bbox,
    display,
    visibility,
    isVisible,
    screenZone,
    zIndex,
    opacity,
    pointerEvents,
    clipPath,
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
 * Uses a batch strategy via Runtime.evaluate to minimize roundtrips.
 * Falls back to individual CDP calls for nodes that cannot be resolved via batch (e.g. inside closed shadow roots).
 *
 * @param ctx - Extractor context with CDP client and options
 * @param backendNodeIds - Array of backend node IDs to extract layout for
 * @param domNodes - Map of backendNodeId to DOM node
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

  // Identify nodes that need fallback
  const processedIds = new Set<number>();
  const fallbackIds: number[] = [];

  // Try batch extraction if we have the DOM tree
  if (domNodes instanceof Map) {
    try {
      const batchResults = await extractLayoutBatch(
        ctx,
        backendNodeIds,
        domNodes as Map<number, RawDomNode>
      );

      for (const { backendNodeId, layout } of batchResults) {
        if (layout?.bbox) {
          // Compute derived fields that weren't in the batch script
          const isVisible = computeVisibility(layout.bbox, layout.display, layout.visibility);
          const screenZone = isVisible ? computeScreenZone(layout.bbox, ctx.viewport) : undefined;

          layouts.set(backendNodeId, {
            ...layout,
            bbox: layout.bbox, // Explicitly set bbox to satisfy TS
            isVisible,
            screenZone,
          });
          processedIds.add(backendNodeId);
        }
      }
    } catch {
      // If batch fails entirely, we will fallback for all because processedIds is empty
      // console.warn('Batch layout extraction failed:', err);
    }
  }

  // Identify fallback candidates (either batch failed or wasn't tried)
  for (const id of backendNodeIds) {
    if (!processedIds.has(id)) {
      fallbackIds.push(id);
    }
  }

  // Process fallbacks
  for (const backendNodeId of fallbackIds) {
    // Look up ephemeral nodeId from DOM nodes map
    // We handle both possible Map types (NodeIdLookup or Map<number, RawDomNode>)
    // RawDomNode has .nodeId, NodeIdLookup values have .nodeId
    const nodeData = domNodes?.get(backendNodeId);
    // Use type assertion or check properties since types overlap on .nodeId
    const nodeId = (nodeData as { nodeId: number })?.nodeId;

    const layout = await extractNodeLayout(ctx, backendNodeId, nodeId);
    layouts.set(backendNodeId, layout);
  }

  return { layouts };
}

/**
 * Result from batch layout extraction script
 */
interface BatchLayoutResult {
  x: number;
  y: number;
  w: number;
  h: number;
  display: string;
  visibility: string;
  zIndex: number | null;
}

/**
 * Helper to build a selector path for a node.
 * Returns array of selector segments (splitting at shadow/frame boundaries).
 */
function buildPath(nodeId: number, domNodes: Map<number, RawDomNode>): string[] | undefined {
  const path: string[] = [];
  let currentSegment = '';
  let currentId: number | undefined = nodeId;

  // Safety break
  let depth = 0;
  const MAX_DEPTH = 100;

  while (currentId !== undefined && depth < MAX_DEPTH) {
    const node = domNodes.get(currentId);
    if (!node) return undefined;

    // Check parent
    const parentId = node.parentId;

    // If no parent, we are at root (or detached)
    if (parentId === undefined) {
      if (node.nodeName === '#document') {
        // Root document, we are done with this segment
        if (currentSegment) {
          path.unshift(currentSegment);
        }
        break;
      }
      // Detached node?
      return undefined;
    }

    const parent = domNodes.get(parentId);
    if (!parent) return undefined;

    // Handle Node Types
    if (node.nodeType === 1) {
      // ELEMENT_NODE
      // Calculate nth-child index among ELEMENT siblings
      let index = 1;
      if (parent.childNodeIds) {
        for (const childId of parent.childNodeIds) {
          if (childId === currentId) break;
          const sibling = domNodes.get(childId);
          if (sibling?.nodeType === 1) {
            index++;
          }
        }
      }

      const segment = `${node.nodeName.toLowerCase()}:nth-child(${index})`;
      currentSegment = currentSegment ? `${segment} > ${currentSegment}` : segment;
    } else if (node.nodeType === 11) {
      // DOCUMENT_FRAGMENT_NODE (Shadow Root)
      // Boundary reached. Push current segment.
      if (currentSegment) {
        path.unshift(currentSegment);
        currentSegment = '';
      }
      // Next iteration will handle the HOST (parent of shadow root)
      // The parent of shadow root in RawDomNode tree is the host element.
    } else if (node.nodeType === 9) {
      // DOCUMENT_NODE (in Iframe)
      // Boundary reached. Push current segment.
      if (currentSegment) {
        path.unshift(currentSegment);
        currentSegment = '';
      }
      // Parent is the iframe element
    }

    currentId = parentId;
    depth++;
  }

  return path;
}

/**
 * Execute batch extraction via Runtime.evaluate
 */
async function extractLayoutBatch(
  ctx: ExtractorContext,
  backendNodeIds: number[],
  domNodes: Map<number, RawDomNode>
): Promise<{ backendNodeId: number; layout?: Partial<NodeLayoutInfo> }[]> {
  const paths: { id: number; path: string[] }[] = [];

  for (const id of backendNodeIds) {
    const path = buildPath(id, domNodes);
    if (path) {
      paths.push({ id, path });
    }
  }

  if (paths.length === 0) return [];

  // Script to resolve paths and get layout
  const expression = `
    (function(items) {
      function resolve(path) {
        let ctx = document;
        for (const segment of path) {
          if (!ctx) return null;

          if (ctx instanceof HTMLIFrameElement) {
             try {
               ctx = ctx.contentDocument;
             } catch (e) { return null; }
          } else if (ctx.shadowRoot) {
             ctx = ctx.shadowRoot;
          }

          if (!ctx) return null;

          ctx = ctx.querySelector(segment);
        }
        return ctx;
      }

      return items.map(item => {
        try {
          const node = resolve(item.path);
          if (!node || node.nodeType !== 1) return null;

          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const zIndexValue = style.zIndex;
          const zIndex = zIndexValue === 'auto' ? null : parseInt(zIndexValue, 10);

          return {
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            display: style.display,
            visibility: style.visibility,
            zIndex: isNaN(zIndex) ? null : zIndex
          };
        } catch (e) {
          return null;
        }
      });
    })(${JSON.stringify(paths)})
  `;

  try {
    const response = await ctx.cdp.send<{ result: { value: (BatchLayoutResult | null)[] } }>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: false,
      }
    );

    const results = response.result.value;

    if (!Array.isArray(results) || results.length !== paths.length) {
      return [];
    }

    return paths.map((item, index) => {
      const res = results[index];
      if (!res) return { backendNodeId: item.id };

      return {
        backendNodeId: item.id,
        layout: {
          bbox: { x: res.x, y: res.y, w: res.w, h: res.h },
          display: res.display,
          visibility: res.visibility,
          zIndex: res.zIndex ?? undefined,
        },
      };
    });
  } catch {
    // console.error('Batch eval failed', e);
    return [];
  }
}
