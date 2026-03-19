/**
 * Popover Detector
 *
 * Detect popover layers in the snapshot.
 * Patterns: role="menu", "listbox", "tooltip" + z-index > 100.
 */

import type { ReadableNode } from '../../snapshot/snapshot.types.js';
import type { LayerCandidate } from '../types.js';
import { computeEid } from '../element-identity.js';

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
export function detectPopover(node: ReadableNode): LayerCandidate | null {
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
    if (popoverPatterns.some((p) => lowerClassName.includes(p.toLowerCase()))) {
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
