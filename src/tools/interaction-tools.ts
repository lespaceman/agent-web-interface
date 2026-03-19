/**
 * Interaction Tools
 *
 * MCP tool handlers for element interaction: click, type, press, select, hover.
 */

import {
  clickByBackendNodeId,
  clickAtCoordinates,
  clickAtElementOffset,
  typeByBackendNodeId,
  pressKey,
  selectOption,
  hoverByBackendNodeId,
} from '../snapshot/index.js';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import {
  ClickInputSchema,
  TypeInputSchema,
  PressInputSchema,
  SelectInputSchema,
  HoverInputSchema,
} from './tool-schemas.js';
import {
  executeAction,
  executeActionWithRetry,
  executeActionWithOutcome,
} from './execute-action.js';
import { getSnapshotStore, requireSnapshot, resolveElementByEid } from './tool-context.js';
import { prepareActionContext } from './action-context.js';

// Convenience alias for module-internal use
const snapshotStore = getSnapshotStore();

/**
 * Click an element or at viewport coordinates.
 *
 * Three modes:
 * 1. eid only -> click element center (existing behavior)
 * 2. eid + x/y -> click at offset relative to element top-left
 * 3. x/y only -> click at absolute viewport coordinates
 *
 * @param rawInput - Click options (will be validated)
 * @returns Click result with navigation-aware outcome
 */
export async function click(rawInput: unknown): Promise<import('./tool-schemas.js').ClickOutput> {
  const input = ClickInputSchema.parse(rawInput);
  const hasEid = input.eid !== undefined;
  const hasCoords = input.x !== undefined && input.y !== undefined;

  if (!hasEid && !hasCoords) {
    throw new Error('Either eid or both x and y coordinates must be provided.');
  }

  if ((input.x !== undefined) !== (input.y !== undefined)) {
    throw new Error('Both x and y coordinates must be provided together.');
  }

  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  let result: { snapshot: BaseSnapshot; state_response: string };

  if (hasEid) {
    // Mode 1 & 2: element-based click (center or offset)
    const snap = requireSnapshot(pageId);
    const node = resolveElementByEid(pageId, input.eid!, snap);

    result = await executeActionWithOutcome(
      handleRef.current,
      node,
      async (backendNodeId) => {
        if (hasCoords) {
          await clickAtElementOffset(
            handleRef.current.cdp,
            backendNodeId,
            input.x!,
            input.y!,
            input.modifiers
          );
        } else {
          await clickByBackendNodeId(handleRef.current.cdp, backendNodeId, input.modifiers);
        }
      },
      snapshotStore,
      captureSnapshot
    );
  } else {
    // Mode 3: x/y only -> absolute viewport click
    result = await executeAction(
      handleRef.current,
      async () => {
        await clickAtCoordinates(handleRef.current.cdp, input.x!, input.y!, input.modifiers);
      },
      captureSnapshot
    );
  }

  snapshotStore.store(pageId, result.snapshot);
  return result.state_response;
}

/**
 * Type text into an element.
 *
 * @param rawInput - Type options (will be validated)
 * @returns Type result with delta
 */
export async function type(rawInput: unknown): Promise<import('./tool-schemas.js').TypeOutput> {
  const input = TypeInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await typeByBackendNodeId(handleRef.current.cdp, backendNodeId, input.text, {
        clear: input.clear,
      });
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Press a keyboard key (no agent_version).
 *
 * @param rawInput - Press options (will be validated)
 * @returns Press result with delta
 */
export async function press(rawInput: unknown): Promise<import('./tool-schemas.js').PressOutput> {
  const input = PressInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  // Execute action with new simplified wrapper
  const result = await executeAction(
    handleRef.current,
    async () => {
      await pressKey(handleRef.current.cdp, input.key, input.modifiers);
    },
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Select a dropdown option.
 *
 * @param rawInput - Select options (will be validated)
 * @returns Select result with delta
 */
export async function select(rawInput: unknown): Promise<import('./tool-schemas.js').SelectOutput> {
  const input = SelectInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await selectOption(handleRef.current.cdp, backendNodeId, input.value);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}

/**
 * Hover over an element.
 *
 * @param rawInput - Hover options (will be validated)
 * @returns Hover result with delta
 */
export async function hover(rawInput: unknown): Promise<import('./tool-schemas.js').HoverOutput> {
  const input = HoverInputSchema.parse(rawInput);
  const { handleRef, pageId, captureSnapshot } = await prepareActionContext(input.page_id);

  const snap = requireSnapshot(pageId);
  const node = resolveElementByEid(pageId, input.eid, snap);

  // Execute action with automatic retry on stale elements
  const result = await executeActionWithRetry(
    handleRef.current,
    node,
    async (backendNodeId) => {
      await hoverByBackendNodeId(handleRef.current.cdp, backendNodeId);
    },
    snapshotStore,
    captureSnapshot
  );

  // Store snapshot for future queries
  snapshotStore.store(pageId, result.snapshot);

  // Return XML state response directly
  return result.state_response;
}
