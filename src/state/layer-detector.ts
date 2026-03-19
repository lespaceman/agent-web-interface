/**
 * Layer Detector
 *
 * Detect UI layers (modal > popover > drawer > main) to scope actionables correctly.
 * Only return actionables from the active (topmost) layer.
 */

import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { LayerDetectionResult, LayerCandidate, LayerInfo, ActiveLayerType } from './types.js';
import { computeEid } from './element-identity.js';
import { detectModal } from './layer-detectors/modal-detector.js';
import { detectDrawer } from './layer-detectors/drawer-detector.js';
import { detectPopover } from './layer-detectors/popover-detector.js';
import { detectToast } from './layer-detectors/toast-detector.js';

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
      continue;
    }

    // Toast detection (lowest priority overlay)
    const toastMatch = detectToast(node);
    if (toastMatch) {
      candidates.push(toastMatch);
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

  // Determine active layer (topmost non-toast layer)
  // Toast layers are non-blocking and should never become the active layer.
  // Main is always at index 0, so the filtered stack is never empty.
  const nonToastStack = stack.filter((l) => l.type !== 'toast');
  const active = nonToastStack[nonToastStack.length - 1].type as ActiveLayerType;

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
