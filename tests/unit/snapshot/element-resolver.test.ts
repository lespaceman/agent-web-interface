/**
 * Element Resolver Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clickByBackendNodeId,
  clickAtCoordinates,
  clickAtElementOffset,
  dragBetweenCoordinates,
  dispatchWheelEvent,
  typeByBackendNodeId,
  pressKey,
  selectOption,
  hoverByBackendNodeId,
  scrollIntoView,
  scrollPage,
  clearFocusedText,
  MODIFIER_CTRL,
} from '../../../src/snapshot/element-resolver.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

describe('ElementResolver', () => {
  describe('clickByBackendNodeId()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should click element using CDP', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 200, 200, 200, 250, 100, 250],
          },
        }) // getBoxModel
        .mockResolvedValueOnce(undefined) // mousePressed
        .mockResolvedValueOnce(undefined); // mouseReleased

      await clickByBackendNodeId(mockCdp as unknown as CdpClient, 12345);

      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith('DOM.getBoxModel', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          x: 150, // center of 100-200
          y: 225, // center of 200-250
          button: 'left',
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
        })
      );
    });

    it('should throw descriptive error when element is removed from DOM', async () => {
      mockCdp.send.mockRejectedValueOnce(new Error('Node with given id does not exist'));

      await expect(clickByBackendNodeId(mockCdp as unknown as CdpClient, 99999)).rejects.toThrow(
        /Failed to scroll element into view.*backendNodeId: 99999.*removed from the DOM/
      );
    });

    it('should throw descriptive error when element has no bounding box', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockRejectedValueOnce(new Error('Could not compute box model'));

      await expect(clickByBackendNodeId(mockCdp as unknown as CdpClient, 12345)).rejects.toThrow(
        /Failed to get element bounding box.*backendNodeId: 12345.*hidden or have no layout/
      );
    });

    it('should throw error when content box is empty', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [], // Empty content box
          },
        });

      await expect(clickByBackendNodeId(mockCdp as unknown as CdpClient, 12345)).rejects.toThrow(
        /Element has no clickable area.*backendNodeId: 12345.*zero-sized/
      );
    });

    it('should throw error when content box is undefined', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {}, // No content property
        });

      await expect(clickByBackendNodeId(mockCdp as unknown as CdpClient, 12345)).rejects.toThrow(
        /Element has no clickable area/
      );
    });

    it('should throw error for invalid coordinates', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [-100, -50, 0, -50, 0, 0, -100, 0], // Negative coordinates
          },
        });

      await expect(clickByBackendNodeId(mockCdp as unknown as CdpClient, 12345)).rejects.toThrow(
        /Invalid coordinates.*off-screen/
      );
    });
  });

  describe('typeByBackendNodeId()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should click element and insert text', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded (from clickByBackendNodeId)
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 200, 200, 200, 250, 100, 250],
          },
        }) // getBoxModel
        .mockResolvedValueOnce(undefined) // mousePressed
        .mockResolvedValueOnce(undefined) // mouseReleased
        .mockResolvedValueOnce(undefined); // insertText

      await typeByBackendNodeId(mockCdp as unknown as CdpClient, 12345, 'Hello World');

      expect(mockCdp.send).toHaveBeenCalledWith('Input.insertText', { text: 'Hello World' });
    });

    it('should clear existing text when clear option is true', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 200, 200, 200, 250, 100, 250],
          },
        }) // getBoxModel
        .mockResolvedValueOnce(undefined) // mousePressed
        .mockResolvedValueOnce(undefined) // mouseReleased
        .mockResolvedValueOnce(undefined) // keyDown (Ctrl+A)
        .mockResolvedValueOnce(undefined) // keyUp (Ctrl+A)
        .mockResolvedValueOnce(undefined) // keyDown (Delete)
        .mockResolvedValueOnce(undefined) // keyUp (Delete)
        .mockResolvedValueOnce(undefined); // insertText

      await typeByBackendNodeId(mockCdp as unknown as CdpClient, 12345, 'New Text', {
        clear: true,
      });

      // Check Ctrl+A was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'a',
          modifiers: MODIFIER_CTRL,
        })
      );

      // Check Delete was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'Delete',
        })
      );

      // Check text was inserted
      expect(mockCdp.send).toHaveBeenCalledWith('Input.insertText', { text: 'New Text' });
    });
  });

  describe('pressKey()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
      mockCdp.send.mockResolvedValue(undefined);
    });

    it('should dispatch keyDown and keyUp events for Enter', async () => {
      await pressKey(mockCdp as unknown as CdpClient, 'Enter');

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyUp',
          key: 'Enter',
        })
      );
    });

    it('should dispatch keyDown and keyUp events for Tab', async () => {
      await pressKey(mockCdp as unknown as CdpClient, 'Tab');

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
        })
      );
    });

    it('should handle modifier keys', async () => {
      await pressKey(mockCdp as unknown as CdpClient, 'Enter', ['Control', 'Shift']);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'Enter',
          modifiers: 10, // Control (2) + Shift (8)
        })
      );
    });

    it('should throw error for unknown key', async () => {
      await expect(pressKey(mockCdp as unknown as CdpClient, 'UnknownKey')).rejects.toThrow(
        /Unknown key.*UnknownKey.*Supported keys/
      );
    });
  });

  describe('selectOption()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should select option and return selected text', async () => {
      mockCdp.send
        .mockResolvedValueOnce({
          object: { objectId: 'obj-123' },
        }) // DOM.resolveNode
        .mockResolvedValueOnce({
          result: { value: 'Medium Size' },
        }); // Runtime.callFunctionOn

      const result = await selectOption(mockCdp as unknown as CdpClient, 12345, 'medium');

      expect(mockCdp.send).toHaveBeenCalledWith('DOM.resolveNode', { backendNodeId: 12345 });
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Runtime.callFunctionOn',
        expect.objectContaining({
          objectId: 'obj-123',
          arguments: [{ value: 'medium' }],
        })
      );
      expect(result).toBe('Medium Size');
    });

    it('should throw error when element cannot be resolved', async () => {
      mockCdp.send.mockResolvedValueOnce({
        object: {}, // No objectId
      });

      await expect(selectOption(mockCdp as unknown as CdpClient, 12345, 'value')).rejects.toThrow(
        /Failed to resolve element/
      );
    });

    it('should throw error when option not found', async () => {
      mockCdp.send
        .mockResolvedValueOnce({
          object: { objectId: 'obj-123' },
        })
        .mockResolvedValueOnce({
          exceptionDetails: {
            exception: { description: 'Option not found: "invalid"' },
          },
        });

      await expect(selectOption(mockCdp as unknown as CdpClient, 12345, 'invalid')).rejects.toThrow(
        /Failed to select option.*Option not found/
      );
    });
  });

  describe('hoverByBackendNodeId()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should scroll into view and move mouse to element center', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 200, 200, 200, 250, 100, 250],
          },
        }) // getBoxModel
        .mockResolvedValueOnce(undefined); // mouseMoved

      await hoverByBackendNodeId(mockCdp as unknown as CdpClient, 12345);

      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseMoved',
          x: 150, // center of 100-200
          y: 225, // center of 200-250
        })
      );
    });
  });

  describe('scrollIntoView()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should call DOM.scrollIntoViewIfNeeded', async () => {
      mockCdp.send.mockResolvedValueOnce(undefined);

      await scrollIntoView(mockCdp as unknown as CdpClient, 12345);

      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });
    });

    it('should throw descriptive error on failure', async () => {
      mockCdp.send.mockRejectedValueOnce(new Error('Node not found'));

      await expect(scrollIntoView(mockCdp as unknown as CdpClient, 12345)).rejects.toThrow(
        /Failed to scroll element into view.*backendNodeId: 12345/
      );
    });
  });

  describe('scrollPage()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
      mockCdp.send.mockResolvedValue(undefined);
    });

    it('should scroll down with default amount', async () => {
      await scrollPage(mockCdp as unknown as CdpClient, 'down');

      expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'window.scrollBy(0, 500)',
      });
    });

    it('should scroll up with default amount', async () => {
      await scrollPage(mockCdp as unknown as CdpClient, 'up');

      expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'window.scrollBy(0, -500)',
      });
    });

    it('should scroll with custom amount', async () => {
      await scrollPage(mockCdp as unknown as CdpClient, 'down', 1000);

      expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'window.scrollBy(0, 1000)',
      });
    });
  });

  describe('clearFocusedText()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
      mockCdp.send.mockResolvedValue(undefined);
    });

    it('should dispatch Ctrl+A then Delete to clear text', async () => {
      await clearFocusedText(mockCdp as unknown as CdpClient);

      // Check Ctrl+A keyDown was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'a',
          code: 'KeyA',
          modifiers: MODIFIER_CTRL,
        })
      );

      // Check Ctrl+A keyUp was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyUp',
          key: 'a',
          code: 'KeyA',
          modifiers: MODIFIER_CTRL,
        })
      );

      // Check Delete keyDown was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyDown',
          key: 'Delete',
          code: 'Delete',
        })
      );

      // Check Delete keyUp was called
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({
          type: 'keyUp',
          key: 'Delete',
          code: 'Delete',
        })
      );

      // Should have exactly 4 CDP calls
      expect(mockCdp.send).toHaveBeenCalledTimes(4);
    });
  });

  describe('clickAtCoordinates()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should dispatch mousePressed and mouseReleased at given coordinates', async () => {
      await clickAtCoordinates(mockCdp as unknown as CdpClient, 100, 200);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          x: 100,
          y: 200,
          button: 'left',
          clickCount: 1,
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          x: 100,
          y: 200,
          button: 'left',
          clickCount: 1,
        })
      );
      expect(mockCdp.send).toHaveBeenCalledTimes(2);
    });

    it('should reject negative X coordinate', async () => {
      await expect(clickAtCoordinates(mockCdp as unknown as CdpClient, -1, 200)).rejects.toThrow(
        'Invalid click coordinates'
      );
    });

    it('should reject negative Y coordinate', async () => {
      await expect(clickAtCoordinates(mockCdp as unknown as CdpClient, 100, -5)).rejects.toThrow(
        'Invalid click coordinates'
      );
    });

    it('should reject NaN coordinates', async () => {
      await expect(clickAtCoordinates(mockCdp as unknown as CdpClient, NaN, 200)).rejects.toThrow(
        'Invalid click coordinates'
      );
    });
  });

  describe('clickAtElementOffset()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn(),
      };
    });

    it('should compute absolute coords from box model + offset', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({
          model: {
            content: [100, 200, 300, 200, 300, 400, 100, 400],
          },
        }) // getBoxModel
        .mockResolvedValueOnce(undefined) // mousePressed
        .mockResolvedValueOnce(undefined); // mouseReleased

      await clickAtElementOffset(mockCdp as unknown as CdpClient, 12345, 10, 20);

      expect(mockCdp.send).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', {
        backendNodeId: 12345,
      });

      // Absolute coords: element top-left (100, 200) + offset (10, 20) = (110, 220)
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          x: 110,
          y: 220,
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          x: 110,
          y: 220,
        })
      );
    });

    it('should throw if element has no box model', async () => {
      mockCdp.send
        .mockResolvedValueOnce(undefined) // scrollIntoViewIfNeeded
        .mockResolvedValueOnce({ model: { content: [] } }); // getBoxModel with empty content

      await expect(
        clickAtElementOffset(mockCdp as unknown as CdpClient, 12345, 10, 20)
      ).rejects.toThrow('no clickable area');
    });
  });

  describe('dragBetweenCoordinates()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should dispatch mousePressed, N mouseMoved, and mouseReleased', async () => {
      const steps = 5;
      await dragBetweenCoordinates(mockCdp as unknown as CdpClient, 100, 200, 200, 400, steps);

      const calls = mockCdp.send.mock.calls;

      // First call: mousePressed at source
      expect(calls[0]).toEqual([
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          x: 100,
          y: 200,
          button: 'left',
        }),
      ]);

      // Middle calls: mouseMoved (steps count)
      for (let i = 1; i <= steps; i++) {
        expect(calls[i]).toEqual([
          'Input.dispatchMouseEvent',
          expect.objectContaining({
            type: 'mouseMoved',
            button: 'left',
          }),
        ]);
      }

      // Last call: mouseReleased at target
      expect(calls[steps + 1]).toEqual([
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          x: 200,
          y: 400,
          button: 'left',
        }),
      ]);

      // Total: 1 pressed + steps moved + 1 released
      expect(mockCdp.send).toHaveBeenCalledTimes(1 + steps + 1);
    });

    it('should correctly interpolate intermediate points', async () => {
      await dragBetweenCoordinates(mockCdp as unknown as CdpClient, 0, 0, 100, 200, 2);

      const calls = mockCdp.send.mock.calls;

      // Step 1/2: midpoint (50, 100)
      expect(calls[1][1]).toEqual(
        expect.objectContaining({
          type: 'mouseMoved',
          x: 50,
          y: 100,
        })
      );

      // Step 2/2: endpoint (100, 200)
      expect(calls[2][1]).toEqual(
        expect.objectContaining({
          type: 'mouseMoved',
          x: 100,
          y: 200,
        })
      );
    });

    it('should reject negative coordinates', async () => {
      await expect(
        dragBetweenCoordinates(mockCdp as unknown as CdpClient, -1, 0, 100, 100)
      ).rejects.toThrow('Invalid drag coordinate');
    });

    it('should reject NaN coordinates', async () => {
      await expect(
        dragBetweenCoordinates(mockCdp as unknown as CdpClient, 0, 0, NaN, 100)
      ).rejects.toThrow('Invalid drag coordinate');
    });

    it('should pass modifier bitmask to all drag events', async () => {
      await dragBetweenCoordinates(mockCdp as unknown as CdpClient, 100, 200, 200, 400, 2, [
        'Shift',
      ]);

      const calls = mockCdp.send.mock.calls;
      // All calls (pressed, moved, released) should have modifiers: 8 (Shift)
      for (const call of calls) {
        expect(call[1]).toHaveProperty('modifiers', 8);
      }
    });

    it('should default to zero modifiers when none provided', async () => {
      await dragBetweenCoordinates(mockCdp as unknown as CdpClient, 100, 200, 200, 400, 1);

      const calls = mockCdp.send.mock.calls;
      for (const call of calls) {
        expect(call[1]).toHaveProperty('modifiers', 0);
      }
    });
  });

  describe('clickAtCoordinates() with modifiers', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = {
        send: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should pass modifier bitmask to mouse events', async () => {
      await clickAtCoordinates(mockCdp as unknown as CdpClient, 100, 200, ['Control', 'Shift']);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          x: 100,
          y: 200,
          modifiers: 10, // Control (2) + Shift (8)
        })
      );
      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseReleased',
          modifiers: 10,
        })
      );
    });

    it('should default to zero modifiers when none provided', async () => {
      await clickAtCoordinates(mockCdp as unknown as CdpClient, 100, 200);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mousePressed',
          modifiers: 0,
        })
      );
    });
  });

  describe('dispatchWheelEvent()', () => {
    let mockCdp: { send: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockCdp = { send: vi.fn().mockResolvedValue(undefined) };
    });

    it('should dispatch mouseWheel event with deltaX and deltaY', async () => {
      await dispatchWheelEvent(mockCdp as unknown as CdpClient, 400, 300, 0, -120);

      expect(mockCdp.send).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 400,
        y: 300,
        deltaX: 0,
        deltaY: -120,
        modifiers: 0,
      });
      expect(mockCdp.send).toHaveBeenCalledTimes(1);
    });

    it('should pass modifier bitmask for ctrl+scroll zoom', async () => {
      await dispatchWheelEvent(mockCdp as unknown as CdpClient, 400, 300, 0, -120, ['Control']);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseWheel',
          modifiers: 2, // Control
          deltaY: -120,
        })
      );
    });

    it('should support horizontal scrolling', async () => {
      await dispatchWheelEvent(mockCdp as unknown as CdpClient, 200, 150, 50, 0);

      expect(mockCdp.send).toHaveBeenCalledWith(
        'Input.dispatchMouseEvent',
        expect.objectContaining({
          type: 'mouseWheel',
          deltaX: 50,
          deltaY: 0,
        })
      );
    });

    it('should reject negative coordinates', async () => {
      await expect(
        dispatchWheelEvent(mockCdp as unknown as CdpClient, -1, 300, 0, -120)
      ).rejects.toThrow('Invalid wheel coordinates');
    });

    it('should reject NaN coordinates', async () => {
      await expect(
        dispatchWheelEvent(mockCdp as unknown as CdpClient, NaN, 300, 0, -120)
      ).rejects.toThrow('Invalid wheel coordinates');
    });
  });
});
