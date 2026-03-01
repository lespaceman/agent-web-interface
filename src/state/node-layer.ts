/**
 * Node Layer Assignment
 *
 * Determines which UI layer a node belongs to.
 * Used by actionables filter, state manager, and locator generator.
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';

/**
 * Z-index threshold for assigning nodes to overlay layers.
 * Nodes with z-index above this are considered part of the active overlay.
 * Deliberately low — the layer detector already validated the overlay exists;
 * we just need to distinguish overlay content from background content.
 */
const OVERLAY_Z_INDEX_THRESHOLD = 1;

/**
 * Layer types where content coexists with main (unlike modal which blocks).
 * Used for z-index-based node assignment and to skip layer filtering.
 */
export const INCLUSIVE_OVERLAY_LAYERS = new Set(['popover', 'drawer']);

/**
 * Determine which layer a node belongs to.
 *
 * @param node - ReadableNode to classify
 * @param activeLayer - Currently active layer from layer detector (optional).
 *   When provided, enables z-index-based assignment for popover/drawer layers.
 * @returns Layer name: 'main', 'modal', 'popover', or 'drawer'
 */
export function getNodeLayer(node: ReadableNode, activeLayer?: string): string {
  const region = node.where.region ?? 'unknown';

  // Dialog region always maps to modal layer
  if (region === 'dialog') {
    return 'modal';
  }

  // When active layer is popover/drawer, use z-index to determine membership
  if (activeLayer && INCLUSIVE_OVERLAY_LAYERS.has(activeLayer)) {
    const zIndex = node.layout.zIndex;
    if (zIndex !== undefined && zIndex > OVERLAY_Z_INDEX_THRESHOLD) {
      return activeLayer;
    }
  }

  return 'main';
}
