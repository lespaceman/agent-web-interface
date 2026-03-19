/**
 * Drawer Detector
 *
 * Detect drawer layers in the snapshot.
 * Patterns: role="complementary" or "navigation" + edge-positioned + high z-index.
 */

import type { ReadableNode } from '../../snapshot/snapshot.types.js';
import type { LayerCandidate } from '../types.js';
import { computeEid } from '../element-identity.js';

/**
 * Detect if node is a drawer layer.
 *
 * Patterns:
 * - role="complementary" or role="navigation" + edge-positioned + high z-index
 * - Slide-in panel patterns from UI libraries
 *
 * @param node - Node to check
 * @returns Layer candidate or null
 */
export function detectDrawer(node: ReadableNode): LayerCandidate | null {
  const role = node.attributes?.role;
  const zIndex = node.layout.zIndex ?? 0;
  const attrs = node.attributes as Record<string, unknown> | undefined;

  // Must have moderate z-index for overlay drawer
  if (zIndex <= 50) {
    return null;
  }

  // Pattern 1: Complementary role with high z-index
  if (role === 'complementary' && zIndex > 100) {
    return {
      type: 'drawer',
      rootEid: computeEid(node, 'drawer'),
      zIndex,
      isModal: false,
      confidence: 0.7,
    };
  }

  // Pattern 2: Navigation role with high z-index + edge position
  if (role === 'navigation' && zIndex > 100) {
    const bbox = node.layout.bbox;
    if (bbox && isEdgePositioned(bbox)) {
      return {
        type: 'drawer',
        rootEid: computeEid(node, 'drawer'),
        zIndex,
        isModal: false,
        confidence: 0.75,
      };
    }
  }

  // Pattern 3: Common drawer class patterns
  const className = attrs?.class ?? attrs?.className;
  if (typeof className === 'string' && zIndex > 50) {
    const drawerPatterns = [
      'drawer',
      'sidebar',
      'side-nav',
      'sidenav',
      'offcanvas',
      'slide-in',
      'MuiDrawer',
      'ant-drawer',
      'el-drawer',
      'v-navigation-drawer',
    ];

    const lowerClassName = className.toLowerCase();
    if (drawerPatterns.some((p) => lowerClassName.includes(p.toLowerCase()))) {
      return {
        type: 'drawer',
        rootEid: computeEid(node, 'drawer'),
        zIndex,
        isModal: false,
        confidence: 0.7,
      };
    }
  }

  return null;
}

/**
 * Check if bounding box is edge-positioned (left or right edge).
 *
 * @param bbox - Bounding box {x, y, w, h}
 * @returns True if positioned at edge
 */
export function isEdgePositioned(bbox: { x: number; y: number; w: number; h: number }): boolean {
  // Left edge: x near 0
  if (bbox.x < 10) {
    return true;
  }

  // Right edge: x + width near typical viewport widths
  // This is a heuristic - ideally we'd have viewport width
  const rightEdge = bbox.x + bbox.w;
  if (rightEdge > 1200 && bbox.x > 800) {
    return true;
  }

  return false;
}
