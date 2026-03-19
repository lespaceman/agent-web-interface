/**
 * Toast Detector
 *
 * Detect toast/alert overlay layers in the snapshot.
 * Toast layers are non-blocking and never become the active layer.
 */

import type { ReadableNode } from '../../snapshot/snapshot.types.js';
import type { LayerCandidate } from '../types.js';
import { computeEid } from '../element-identity.js';
import { isLiveRegionKind } from '../actionables-filter.js';

// Roles that indicate toast-like overlays (non-modal alert/status patterns)
export const TOAST_ROLES = new Set(['alert', 'status']);

/**
 * Detect if node is a toast/alert overlay layer.
 *
 * Patterns:
 * - role="alert" or role="status" with high z-index (non-modal)
 * - Live region kinds: alert, status, log, timer, progressbar with high z-index
 *
 * Toast layers are non-blocking — they appear in the layer stack but never
 * become the active layer.
 *
 * @param node - Node to check
 * @returns Layer candidate or null
 */
export function detectToast(node: ReadableNode): LayerCandidate | null {
  const role = node.attributes?.role;
  const zIndex = node.layout.zIndex ?? 0;
  const attrs = node.attributes as Record<string, unknown> | undefined;

  // Must have z-index > 100 to be considered a toast overlay
  if (zIndex <= 100) {
    return null;
  }

  // Must NOT be aria-modal (those are modals/alertdialogs, not toasts)
  if (attrs?.['aria-modal'] === 'true') {
    return null;
  }

  const hasToastRole = role !== undefined && TOAST_ROLES.has(role);

  if (hasToastRole || isLiveRegionKind(node.kind)) {
    return {
      type: 'toast',
      rootEid: computeEid(node, 'toast'),
      zIndex,
      isModal: false,
      confidence: 0.7,
    };
  }

  return null;
}
