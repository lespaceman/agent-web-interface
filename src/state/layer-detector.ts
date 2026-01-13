/**
 * Layer Detector
 *
 * Detect UI layers (modal > popover > drawer > main) to scope actionables correctly.
 * Only return actionables from the active (topmost) layer.
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { LayerDetectionResult, LayerCandidate, LayerInfo } from './types.js';
import { computeEid } from './element-identity.js';

// ============================================================================
// Layer Detection
// ============================================================================

/**
 * Detect layers in the snapshot.
 * Returns stack of layers with active (topmost) layer.
 *
 * Detection priority order:
 * 1. Modal - role="dialog" + aria-modal="true", <dialog open>, high z-index + backdrop
 * 2. Drawer - role="complementary" + edge-positioned + high z-index
 * 3. Popover - role="menu", role="listbox" + z-index > 100
 * 4. Main - Always present as base layer
 *
 * @param snapshot - Compiled snapshot
 * @returns Layer detection result
 */
export function detectLayers(snapshot: BaseSnapshot): LayerDetectionResult {
  const candidates: LayerCandidate[] = [];

  // Scan nodes for layer patterns
  for (const node of snapshot.nodes) {
    // Modal detection (highest priority)
    const modalMatch = detectModal(node);
    if (modalMatch) {
      candidates.push(modalMatch);
      continue;
    }

    // Drawer detection
    const drawerMatch = detectDrawer(node);
    if (drawerMatch) {
      candidates.push(drawerMatch);
      continue;
    }

    // Popover detection
    const popoverMatch = detectPopover(node);
    if (popoverMatch) {
      candidates.push(popoverMatch);
    }
  }

  // Sort by z-index (highest first), filter low confidence
  candidates.sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  const layers = candidates.filter((c) => c.confidence > 0.6);

  // Build stack: main is always present
  const stack: LayerInfo[] = [{ type: 'main', isModal: false }];

  // Add detected layers
  for (const layer of layers) {
    stack.push({
      type: layer.type,
      rootEid: layer.rootEid,
      zIndex: layer.zIndex,
      isModal: layer.isModal,
    });
  }

  // Determine active layer (topmost)
  const active = stack[stack.length - 1].type;

  // Find focused element
  const focusEid = detectFocusedElement(snapshot);

  return {
    stack,
    active,
    focusEid,
    pointerLock: false, // TODO: detect from page
  };
}

// ============================================================================
// Modal Detection
// ============================================================================

/**
 * Detect if node is a modal layer.
 *
 * Patterns:
 * - role="dialog" or role="alertdialog" + aria-modal="true"
 * - <dialog open>
 * - High z-index (>1000) with dialog role
 * - React/Vue portal containers with modal content
 *
 * @param node - Node to check
 * @returns Layer candidate or null
 */
function detectModal(node: ReadableNode): LayerCandidate | null {
  const attrs = node.attributes as Record<string, unknown> | undefined;
  const role = node.attributes?.role;

  // Pattern 1: role="dialog" or role="alertdialog" + aria-modal="true"
  if (
    (role === 'dialog' || role === 'alertdialog') &&
    attrs?.['aria-modal'] === 'true'
  ) {
    return {
      type: 'modal',
      rootEid: computeEid(node, 'modal'),
      zIndex: node.layout.zIndex ?? 0,
      isModal: true,
      confidence: 1.0,
    };
  }

  // Pattern 2: <dialog> element with open attribute
  if (node.kind === 'dialog' && attrs?.open === true) {
    return {
      type: 'modal',
      rootEid: computeEid(node, 'modal'),
      zIndex: node.layout.zIndex ?? 0,
      isModal: true,
      confidence: 0.95,
    };
  }

  // Pattern 3: alertdialog without aria-modal (still modal by nature)
  if (role === 'alertdialog') {
    return {
      type: 'modal',
      rootEid: computeEid(node, 'modal'),
      zIndex: node.layout.zIndex ?? 0,
      isModal: true,
      confidence: 0.9,
    };
  }

  // Pattern 4: High z-index dialog (>1000)
  if (
    role === 'dialog' &&
    (node.layout.zIndex ?? 0) > 1000
  ) {
    return {
      type: 'modal',
      rootEid: computeEid(node, 'modal'),
      zIndex: node.layout.zIndex ?? 0,
      isModal: true,
      confidence: 0.8,
    };
  }

  // Pattern 5: Portal container detection (React/Vue/Angular)
  // Common portal container patterns
  if (isPortalContainer(node, attrs)) {
    return {
      type: 'modal',
      rootEid: computeEid(node, 'modal'),
      zIndex: node.layout.zIndex ?? 0,
      isModal: true,
      confidence: 0.75,
    };
  }

  return null;
}

/**
 * Check if node is a portal container (React/Vue/Angular patterns).
 *
 * @param node - Node to check
 * @param attrs - Node attributes
 * @returns True if portal container
 */
function isPortalContainer(
  node: ReadableNode,
  attrs: Record<string, unknown> | undefined
): boolean {
  const zIndex = node.layout.zIndex ?? 0;

  // Must have high z-index
  if (zIndex < 100) {
    return false;
  }

  // Check for common portal container attributes/classes
  const className = attrs?.class ?? attrs?.className;
  if (typeof className === 'string') {
    const portalPatterns = [
      'modal',
      'dialog',
      'overlay',
      'portal',
      'ReactModal',
      'MuiModal',
      'chakra-modal',
      'ant-modal',
      'el-dialog',  // Element UI
      'v-dialog',   // Vuetify
    ];

    const lowerClassName = className.toLowerCase();
    if (portalPatterns.some(p => lowerClassName.includes(p.toLowerCase()))) {
      return true;
    }
  }

  // Check for data attributes indicating portal
  const dataPortal = attrs?.['data-portal'];
  const dataOverlay = attrs?.['data-overlay'];
  const dataModal = attrs?.['data-modal'];

  if (dataPortal === true || dataOverlay === true || dataModal === true) {
    return true;
  }

  // Check for aria-hidden siblings pattern (portal often has aria-hidden on root)
  // This is detected by high z-index + covering most of viewport
  const bbox = node.layout.bbox;
  if (bbox && zIndex > 500) {
    // If element covers significant viewport area with high z-index
    if (bbox.w > 200 && bbox.h > 200) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Drawer Detection
// ============================================================================

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
function detectDrawer(node: ReadableNode): LayerCandidate | null {
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
    if (drawerPatterns.some(p => lowerClassName.includes(p.toLowerCase()))) {
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
function isEdgePositioned(bbox: { x: number; y: number; w: number; h: number }): boolean {
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

// ============================================================================
// Popover Detection
// ============================================================================

/**
 * Detect if node is a popover layer.
 *
 * Patterns:
 * - role="menu", "listbox", "tooltip", "dialog" (non-modal) + z-index > 100
 * - Dropdown/popup class patterns
 *
 * @param node - Node to check
 * @returns Layer candidate or null
 */
function detectPopover(node: ReadableNode): LayerCandidate | null {
  const role = node.attributes?.role;
  const zIndex = node.layout.zIndex ?? 0;
  const attrs = node.attributes as Record<string, unknown> | undefined;

  if (zIndex <= 100) {
    return null;
  }

  // Pattern 1: Standard popover roles
  const popoverRoles = ['menu', 'listbox', 'tooltip', 'tree'];
  if (role && popoverRoles.includes(role)) {
    return {
      type: 'popover',
      rootEid: computeEid(node, 'popover'),
      zIndex,
      isModal: false,
      confidence: 0.8,
    };
  }

  // Pattern 2: Non-modal dialog (popup)
  if (role === 'dialog' && attrs?.['aria-modal'] !== 'true') {
    return {
      type: 'popover',
      rootEid: computeEid(node, 'popover'),
      zIndex,
      isModal: false,
      confidence: 0.6,
    };
  }

  // Pattern 3: Common popover/dropdown class patterns
  const className = attrs?.class ?? attrs?.className;
  if (typeof className === 'string') {
    const popoverPatterns = [
      'dropdown',
      'popover',
      'popup',
      'tooltip',
      'menu',
      'autocomplete',
      'suggestions',
      'MuiPopover',
      'MuiMenu',
      'ant-dropdown',
      'el-dropdown',
      'el-popover',
    ];

    const lowerClassName = className.toLowerCase();
    if (popoverPatterns.some(p => lowerClassName.includes(p.toLowerCase()))) {
      return {
        type: 'popover',
        rootEid: computeEid(node, 'popover'),
        zIndex,
        isModal: false,
        confidence: 0.65,
      };
    }
  }

  return null;
}

// ============================================================================
// Focused Element Detection
// ============================================================================

/**
 * Find currently focused element in snapshot.
 *
 * @param snapshot - Compiled snapshot
 * @returns EID of focused element or undefined
 */
function detectFocusedElement(snapshot: BaseSnapshot): string | undefined {
  const focusedNode = snapshot.nodes.find((n) => n.state?.focused);
  return focusedNode ? computeEid(focusedNode) : undefined;
}
