/**
 * Modal Detector
 *
 * Detect modal layers in the snapshot.
 * Patterns: role="dialog" + aria-modal, <dialog open>, portal containers.
 */

import type { ReadableNode } from '../../snapshot/snapshot.types.js';
import type { LayerCandidate } from '../types.js';
import { computeEid } from '../element-identity.js';

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
export function detectModal(node: ReadableNode): LayerCandidate | null {
  const attrs = node.attributes as Record<string, unknown> | undefined;
  const role = node.attributes?.role;

  // Pattern 1: role="dialog" or role="alertdialog" + aria-modal="true"
  if ((role === 'dialog' || role === 'alertdialog') && attrs?.['aria-modal'] === 'true') {
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
  if (role === 'dialog' && (node.layout.zIndex ?? 0) > 1000) {
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
export function isPortalContainer(
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
      'el-dialog', // Element UI
      'v-dialog', // Vuetify
    ];

    const lowerClassName = className.toLowerCase();
    if (portalPatterns.some((p) => lowerClassName.includes(p.toLowerCase()))) {
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
