/**
 * Viewport Tools
 *
 * MCP tool handlers for viewport-level actions: drag, wheel, screenshot.
 */

import {
  getElementTopLeft,
  dragBetweenCoordinates,
  dispatchWheelEvent,
} from '../snapshot/index.js';
import { DragInputSchema, WheelInputSchema, TakeScreenshotInputSchema } from './tool-schemas.js';
import { captureScreenshot, getElementBoundingBox } from '../screenshot/index.js';
import { executeAction } from './execute-action.js';
import {
  getSessionManager,
  getSnapshotStore,
  resolveExistingPage,
  ensureCdpSession,
  requireSnapshot,
  resolveElementByEid,
} from './tool-context.js';
import { prepareActionContext } from './action-context.js';

// Convenience alias for module-internal use
const snapshotStore = getSnapshotStore();

/**
 * Drag from one point to another.
 *
 * If eid is provided, coordinates are relative to the element's top-left corner.
 * Otherwise, coordinates are absolute viewport coordinates.
 *
 * @param rawInput - Drag options (will be validated)
 * @returns Drag result with updated snapshot
 */
export async function drag(rawInput: unknown): Promise<import('./tool-schemas.js').DragOutput> {
  const input = DragInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  let sourceX = input.source_x;
  let sourceY = input.source_y;
  let targetX = input.target_x;
  let targetY = input.target_y;

  if (input.eid) {
    const snap = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid, snap);

    const { x, y } = await getElementTopLeft(handleRef.current.cdp, node.backend_node_id);
    sourceX = x + input.source_x;
    sourceY = y + input.source_y;
    targetX = x + input.target_x;
    targetY = y + input.target_y;
  }

  const result = await executeAction(
    handleRef.current,
    async () => {
      await dragBetweenCoordinates(
        handleRef.current.cdp,
        sourceX,
        sourceY,
        targetX,
        targetY,
        10,
        input.modifiers
      );
    },
    captureSnapshot
  );

  snapshotStore.store(pageId, result.snapshot);
  return result.state_response;
}

/**
 * Dispatch a mouse wheel event.
 *
 * If eid is provided, x/y coordinates are relative to the element's top-left corner.
 * Otherwise, x/y are absolute viewport coordinates.
 *
 * @param rawInput - Wheel options (will be validated)
 * @returns Wheel result with updated snapshot
 */
export async function wheel(rawInput: unknown): Promise<import('./tool-schemas.js').WheelOutput> {
  const input = WheelInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  let x = input.x;
  let y = input.y;

  if (input.eid) {
    const snap = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid, snap);

    const topLeft = await getElementTopLeft(handleRef.current.cdp, node.backend_node_id);
    x = topLeft.x + input.x;
    y = topLeft.y + input.y;
  }

  const result = await executeAction(
    handleRef.current,
    async () => {
      await dispatchWheelEvent(
        handleRef.current.cdp,
        x,
        y,
        input.deltaX,
        input.deltaY,
        input.modifiers
      );
    },
    captureSnapshot
  );

  snapshotStore.store(pageId, result.snapshot);
  return result.state_response;
}

/**
 * Take a screenshot of the page or a specific element.
 *
 * Observation tool - does not mutate page state.
 * Returns inline image (<2MB) or temp file path (>=2MB).
 *
 * @param rawInput - Screenshot options (will be validated)
 * @returns ImageResult or FileResult
 */
export async function takeScreenshot(
  rawInput: unknown
): Promise<import('./tool-schemas.js').TakeScreenshotOutput> {
  const input = TakeScreenshotInputSchema.parse(rawInput);

  if (input.eid && input.fullPage) {
    throw new Error(
      "Cannot use both 'eid' and 'fullPage'. Use eid for element screenshots OR fullPage for full-page capture."
    );
  }

  const session = getSessionManager();
  let handle = resolveExistingPage(session, input.page_id);
  const pageId = handle.page_id;

  // Ensure CDP session is healthy (auto-repair if needed)
  const ensureResult = await ensureCdpSession(session, handle);
  handle = ensureResult.handle;

  let clip: import('devtools-protocol').Protocol.Page.Viewport | undefined;
  if (input.eid) {
    const snapshot = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid, snapshot);
    clip = await getElementBoundingBox(handle.cdp, node.backend_node_id);
  }

  return captureScreenshot(handle.cdp, {
    format: input.format ?? 'png',
    quality: input.quality,
    clip,
    captureBeyondViewport: input.fullPage ?? false,
  });
}
