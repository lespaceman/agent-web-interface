/**
 * Element Resolver
 *
 * Resolves node_id from snapshot to actionable element.
 * Provides CDP-based clicking using backendNodeId for guaranteed uniqueness.
 */

import type { CdpClient } from '../cdp/cdp-client.interface.js';

// ============================================================================
// Modifier Bitmask Constants
// ============================================================================

/**
 * CDP Input modifier bitmask values.
 * These are ORed together for combined modifiers.
 */
export const MODIFIER_ALT = 1;
export const MODIFIER_CTRL = 2;
export const MODIFIER_META = 4;
export const MODIFIER_SHIFT = 8;

/**
 * Convert modifier names to CDP modifier bitmask.
 */
function computeModifiers(modifiers?: string[]): number {
  if (!modifiers) return 0;
  let bits = 0;
  for (const mod of modifiers) {
    switch (mod.toLowerCase()) {
      case 'alt':
        bits |= MODIFIER_ALT;
        break;
      case 'control':
      case 'ctrl':
        bits |= MODIFIER_CTRL;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        bits |= MODIFIER_META;
        break;
      case 'shift':
        bits |= MODIFIER_SHIFT;
        break;
    }
  }
  return bits;
}

// ============================================================================
// Key Code Mapping
// ============================================================================

/**
 * Maps key names to their DOM key codes.
 * Used for Input.dispatchKeyEvent CDP commands.
 */
const KEY_DEFINITIONS: Record<
  string,
  { code: string; keyCode: number; key: string; text?: string }
> = {
  Enter: { code: 'Enter', keyCode: 13, key: 'Enter', text: '\r' },
  Tab: { code: 'Tab', keyCode: 9, key: 'Tab' },
  Escape: { code: 'Escape', keyCode: 27, key: 'Escape' },
  Backspace: { code: 'Backspace', keyCode: 8, key: 'Backspace' },
  Delete: { code: 'Delete', keyCode: 46, key: 'Delete' },
  Space: { code: 'Space', keyCode: 32, key: ' ', text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38, key: 'ArrowUp' },
  ArrowDown: { code: 'ArrowDown', keyCode: 40, key: 'ArrowDown' },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37, key: 'ArrowLeft' },
  ArrowRight: { code: 'ArrowRight', keyCode: 39, key: 'ArrowRight' },
  Home: { code: 'Home', keyCode: 36, key: 'Home' },
  End: { code: 'End', keyCode: 35, key: 'End' },
  PageUp: { code: 'PageUp', keyCode: 33, key: 'PageUp' },
  PageDown: { code: 'PageDown', keyCode: 34, key: 'PageDown' },
};

// ============================================================================
// Element Box Model Helpers
// ============================================================================

/**
 * Scroll element into view and get its content quad from CDP.
 * Shared primitive used by click, drag, and other coordinate-based operations.
 *
 * @returns Content quad as 8-element array [x1,y1, x2,y2, x3,y3, x4,y4]
 */
async function scrollAndGetContentQuad(cdp: CdpClient, backendNodeId: number): Promise<number[]> {
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to scroll element into view (backendNodeId: ${backendNodeId}). ` +
        `The element may have been removed from the DOM. Original error: ${message}`
    );
  }

  let model;
  try {
    const result = await cdp.send('DOM.getBoxModel', { backendNodeId });
    model = result.model;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to get element bounding box (backendNodeId: ${backendNodeId}). ` +
        `The element may be hidden or have no layout. Original error: ${message}`
    );
  }

  if (!model?.content || model.content.length < 8) {
    throw new Error(
      `Element has no clickable area (backendNodeId: ${backendNodeId}). ` +
        `The element may be zero-sized or not rendered.`
    );
  }

  return model.content;
}

/**
 * Get the top-left viewport coordinates of an element.
 * Scrolls element into view first.
 */
export async function getElementTopLeft(
  cdp: CdpClient,
  backendNodeId: number
): Promise<{ x: number; y: number }> {
  const content = await scrollAndGetContentQuad(cdp, backendNodeId);
  return { x: content[0], y: content[1] };
}

/**
 * Compute center point from a content quad, with validation.
 */
function centerFromContentQuad(
  content: number[],
  backendNodeId: number
): { x: number; y: number } {
  const [x1, y1, x2, , , y3] = content;
  const x = x1 + (x2 - x1) / 2;
  const y = y1 + (y3 - y1) / 2;

  if (x < 0 || y < 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(
      `Invalid coordinates (x: ${x}, y: ${y}) for backendNodeId: ${backendNodeId}. ` +
        `The element may be positioned off-screen.`
    );
  }

  return { x, y };
}

/**
 * Get the center coordinates of an element by its backendNodeId.
 * Scrolls the element into view first.
 */
async function getElementCenter(
  cdp: CdpClient,
  backendNodeId: number
): Promise<{ x: number; y: number }> {
  const content = await scrollAndGetContentQuad(cdp, backendNodeId);
  return centerFromContentQuad(content, backendNodeId);
}

// ============================================================================
// Click Operations
// ============================================================================

/**
 * Minimum element dimension (px) below which we search for a larger clickable ancestor.
 * Hidden radio/checkbox inputs are commonly 1x1 or 0x0 with a visible label wrapper.
 */
const MIN_CLICKABLE_SIZE = 5;

/**
 * Find a clickable ancestor when the target element is too small to reliably click.
 * Walks up the DOM looking for a parent/label with a reasonable bounding box.
 *
 * @returns backendNodeId of a better click target, or the original if none found
 */
async function findClickableAncestor(
  cdp: CdpClient,
  backendNodeId: number
): Promise<number> {
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
    if (!object.objectId) return backendNodeId;

    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        var MIN = ${MIN_CLICKABLE_SIZE};
        var el = this;
        if (el.id) {
          var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
          if (label && label.offsetWidth > MIN && label.offsetHeight > MIN) return label;
        }
        var current = el.parentElement;
        for (var i = 0; i < 5 && current; i++) {
          if (current.offsetWidth > MIN && current.offsetHeight > MIN) return current;
          current = current.parentElement;
        }
        return null;
      }`,
      returnByValue: false,
    });

    if (result.result?.objectId) {
      const desc = await cdp.send('DOM.describeNode', {
        objectId: result.result.objectId,
      });
      if (desc.node?.backendNodeId) {
        return desc.node.backendNodeId;
      }
    }
  } catch {
    // Non-critical — ancestor lookup can fail for detached nodes
  }
  return backendNodeId;
}

/**
 * Click an element at its center using CDP's backendNodeId.
 *
 * If the element is tiny (< 5x5 px), searches for a larger clickable
 * ancestor (label, parent wrapper) to click instead — common for hidden
 * radio/checkbox inputs with custom visual wrappers.
 */
export async function clickByBackendNodeId(
  cdp: CdpClient,
  backendNodeId: number,
  modifiers?: string[]
): Promise<void> {
  const content = await scrollAndGetContentQuad(cdp, backendNodeId);
  const [x1, y1, x2, , , y3] = content;
  const width = x2 - x1;
  const height = y3 - y1;

  if (width < MIN_CLICKABLE_SIZE && height < MIN_CLICKABLE_SIZE) {
    const ancestor = await findClickableAncestor(cdp, backendNodeId);
    if (ancestor !== backendNodeId) {
      const center = await getElementCenter(cdp, ancestor);
      await clickAtCoordinates(cdp, center.x, center.y, modifiers);
      return;
    }
  }

  const { x, y } = centerFromContentQuad(content, backendNodeId);
  await clickAtCoordinates(cdp, x, y, modifiers);
}

/**
 * Click at absolute viewport coordinates using CDP.
 */
export async function clickAtCoordinates(
  cdp: CdpClient,
  x: number,
  y: number,
  modifiers?: string[]
): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error(
      `Invalid click coordinates (x: ${x}, y: ${y}). Coordinates must be non-negative finite numbers.`
    );
  }

  const modifierBits = computeModifiers(modifiers);

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
    modifiers: modifierBits,
  });

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
    modifiers: modifierBits,
  });
}

/**
 * Click at an offset relative to an element's top-left corner.
 * Scrolls element into view, computes absolute coordinates, then clicks.
 */
export async function clickAtElementOffset(
  cdp: CdpClient,
  backendNodeId: number,
  offsetX: number,
  offsetY: number,
  modifiers?: string[]
): Promise<void> {
  const { x, y } = await getElementTopLeft(cdp, backendNodeId);
  await clickAtCoordinates(cdp, x + offsetX, y + offsetY, modifiers);
}

// ============================================================================
// Clear Text Helper
// ============================================================================

/**
 * Clear text in the currently focused element using Ctrl+A then Delete.
 *
 * This helper is used by typeByBackendNodeId and can be used directly
 * when typing into an already-focused element.
 *
 * @param cdp - CDP client instance
 */
export async function clearFocusedText(cdp: CdpClient): Promise<void> {
  // Select all (Ctrl+A)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers: MODIFIER_CTRL,
    windowsVirtualKeyCode: 65,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers: MODIFIER_CTRL,
    windowsVirtualKeyCode: 65,
  });

  // Delete selected text
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Delete',
    code: 'Delete',
    windowsVirtualKeyCode: 46,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Delete',
    code: 'Delete',
    windowsVirtualKeyCode: 46,
  });
}

// ============================================================================
// Type Text
// ============================================================================

/**
 * Type text into an element using CDP.
 *
 * Focuses the element first (via click), optionally clears existing text,
 * then inserts the new text.
 *
 * @param cdp - CDP client instance
 * @param backendNodeId - Element to type into
 * @param text - Text to type
 * @param options.clear - If true, clears existing text first (Ctrl+A, Delete)
 */
export async function typeByBackendNodeId(
  cdp: CdpClient,
  backendNodeId: number,
  text: string,
  options?: { clear?: boolean }
): Promise<void> {
  // 1. Focus the element by clicking it
  await clickByBackendNodeId(cdp, backendNodeId);

  // 2. Clear existing text if requested
  if (options?.clear) {
    await clearFocusedText(cdp);
  }

  // 3. Insert text
  await cdp.send('Input.insertText', { text });
}

// ============================================================================
// Press Key
// ============================================================================

/**
 * Press a keyboard key using CDP.
 *
 * Sends keyDown and keyUp events for the specified key.
 *
 * @param cdp - CDP client instance
 * @param key - Key name (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown')
 * @param modifiers - Optional modifier keys ['Control', 'Shift', 'Alt', 'Meta']
 */
export async function pressKey(cdp: CdpClient, key: string, modifiers?: string[]): Promise<void> {
  const keyDef = KEY_DEFINITIONS[key];
  if (!keyDef) {
    throw new Error(
      `Unknown key: "${key}". Supported keys: ${Object.keys(KEY_DEFINITIONS).join(', ')}`
    );
  }

  const modifierBits = computeModifiers(modifiers);

  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: keyDef.key,
    code: keyDef.code,
    windowsVirtualKeyCode: keyDef.keyCode,
    modifiers: modifierBits,
    text: keyDef.text,
  });

  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: keyDef.key,
    code: keyDef.code,
    windowsVirtualKeyCode: keyDef.keyCode,
    modifiers: modifierBits,
  });
}

// ============================================================================
// Select Option
// ============================================================================

/**
 * Select an option from a <select> element.
 *
 * Uses Runtime.callFunctionOn to set the select value and dispatch a change event.
 *
 * @param cdp - CDP client instance
 * @param backendNodeId - The <select> element's backendNodeId
 * @param value - Option value or visible text to select
 * @returns The selected option's visible text
 */
export async function selectOption(
  cdp: CdpClient,
  backendNodeId: number,
  value: string
): Promise<string> {
  // Resolve the backendNodeId to a Runtime object
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });

  if (!object.objectId) {
    throw new Error(`Failed to resolve element (backendNodeId: ${backendNodeId})`);
  }

  // Call a function on the element to select the option
  const result = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function(targetValue) {
      if (this.tagName !== 'SELECT') {
        throw new Error('Element is not a <select> element');
      }
      const options = Array.from(this.options);
      const option = options.find(o =>
        o.value === targetValue ||
        o.text === targetValue ||
        o.text.trim() === targetValue
      );
      if (!option) {
        const available = options.map(o => o.text || o.value).join(', ');
        throw new Error('Option not found: "' + targetValue + '". Available: ' + available);
      }
      this.value = option.value;
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return option.text;
    }`,
    arguments: [{ value }],
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(
      `Failed to select option: ${result.exceptionDetails.exception?.description ?? 'Unknown error'}`
    );
  }

  return result.result.value as string;
}

// ============================================================================
// Hover
// ============================================================================

/**
 * Hover over an element using CDP.
 *
 * Scrolls the element into view and moves the mouse to its center.
 *
 * @param cdp - CDP client instance
 * @param backendNodeId - Element to hover over
 */
export async function hoverByBackendNodeId(cdp: CdpClient, backendNodeId: number): Promise<void> {
  const { x, y } = await getElementCenter(cdp, backendNodeId);

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
}

// ============================================================================
// Scroll
// ============================================================================

/**
 * Scroll an element into view using CDP.
 *
 * @param cdp - CDP client instance
 * @param backendNodeId - Element to scroll into view
 */
export async function scrollIntoView(cdp: CdpClient, backendNodeId: number): Promise<void> {
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to scroll element into view (backendNodeId: ${backendNodeId}). ` +
        `Original error: ${message}`
    );
  }
}

/**
 * Scroll the page by a specified amount.
 *
 * @param cdp - CDP client instance
 * @param direction - 'up' or 'down'
 * @param amount - Pixels to scroll (default: 500)
 */
export async function scrollPage(
  cdp: CdpClient,
  direction: 'up' | 'down',
  amount = 500
): Promise<void> {
  const scrollY = direction === 'down' ? amount : -amount;

  await cdp.send('Runtime.evaluate', {
    expression: `window.scrollBy(0, ${scrollY})`,
  });
}

// ============================================================================
// Drag Between Coordinates
// ============================================================================

/**
 * Drag from one point to another using CDP mouse events.
 *
 * Dispatches mousePressed at source, interpolates mouseMoved events
 * from source to target, then mouseReleased at target.
 *
 * @param cdp - CDP client instance
 * @param sourceX - Start X coordinate
 * @param sourceY - Start Y coordinate
 * @param targetX - End X coordinate
 * @param targetY - End Y coordinate
 * @param steps - Number of intermediate mouseMoved events (default: 10)
 * @param modifiers - Optional modifier keys (e.g., ['Shift', 'Control'])
 */
export async function dragBetweenCoordinates(
  cdp: CdpClient,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  steps = 10,
  modifiers?: string[]
): Promise<void> {
  // Validate all coordinates
  for (const [name, val] of [
    ['sourceX', sourceX],
    ['sourceY', sourceY],
    ['targetX', targetX],
    ['targetY', targetY],
  ] as const) {
    if (!Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid drag coordinate ${name}: ${val}. Coordinates must be non-negative finite numbers.`
      );
    }
  }

  const modifierBits = computeModifiers(modifiers);

  // Mouse down at source
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: sourceX,
    y: sourceY,
    button: 'left',
    clickCount: 1,
    modifiers: modifierBits,
  });

  // Interpolate mouse moves from source to target
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    const x = sourceX + (targetX - sourceX) * ratio;
    const y = sourceY + (targetY - sourceY) * ratio;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
      modifiers: modifierBits,
    });
  }

  // Mouse up at target
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: targetX,
    y: targetY,
    button: 'left',
    clickCount: 1,
    modifiers: modifierBits,
  });
}

// ============================================================================
// Wheel Event
// ============================================================================

/**
 * Dispatch a mouse wheel event at the given coordinates using CDP.
 *
 * @param cdp - CDP client instance
 * @param x - X coordinate where the wheel event occurs
 * @param y - Y coordinate where the wheel event occurs
 * @param deltaX - Horizontal scroll delta (positive = right)
 * @param deltaY - Vertical scroll delta (positive = down)
 * @param modifiers - Optional modifier keys (e.g., ['Control'] for zoom)
 */
export async function dispatchWheelEvent(
  cdp: CdpClient,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  modifiers?: string[]
): Promise<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error(
      `Invalid wheel coordinates (x: ${x}, y: ${y}). Coordinates must be non-negative finite numbers.`
    );
  }

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
    modifiers: computeModifiers(modifiers),
  });
}
