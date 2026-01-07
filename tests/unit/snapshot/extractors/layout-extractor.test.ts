/**
 * Layout Extractor Tests
 *
 * Tests for CDP layout and bounding box extraction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractLayout,
  computeScreenZone,
  computeVisibility,
} from '../../../../src/snapshot/extractors/layout-extractor.js';
import { createExtractorContext } from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient, MockCdpClient } from '../../../mocks/cdp-client.mock.js';

describe('Layout Extractor', () => {
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  describe('extractLayout', () => {
    it('should extract bounding boxes for nodes', async () => {
      // Mock DOM.getBoxModel response
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [10, 20, 110, 20, 110, 70, 10, 70], // x1,y1, x2,y2, x3,y3, x4,y4
          padding: [10, 20, 110, 20, 110, 70, 10, 70],
          border: [10, 20, 110, 20, 110, 70, 10, 70],
          margin: [10, 20, 110, 20, 110, 70, 10, 70],
          width: 100,
          height: 50,
        },
      });

      // Mock CSS.getComputedStyleForNode response
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'visible' },
        ],
      });

      // Create DOM nodes map with nodeId for CSS.getComputedStyleForNode
      const domNodes = new Map<number, { nodeId: number; backendNodeId: number }>();
      domNodes.set(100, { nodeId: 100, backendNodeId: 100 });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100], domNodes);

      expect(result.layouts.size).toBe(1);
      const layout = result.layouts.get(100);
      expect(layout).toBeDefined();
      expect(layout?.bbox).toEqual({ x: 10, y: 20, w: 100, h: 50 });
      expect(layout?.display).toBe('block');
      expect(layout?.visibility).toBe('visible');
      expect(layout?.isVisible).toBe(true);
    });

    it('should handle nodes with no box model (hidden elements)', async () => {
      // Mock DOM.getBoxModel to throw (element not rendered)
      mockCdp.setError('DOM.getBoxModel', new Error('Could not compute box model'));

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100]);

      // Node should still be in the result but marked as not visible
      expect(result.layouts.size).toBe(1);
      const layout = result.layouts.get(100);
      expect(layout?.isVisible).toBe(false);
      expect(layout?.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    });

    it('should compute screen zone correctly', async () => {
      // Element in top-left
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [50, 50, 150, 50, 150, 100, 50, 100],
          width: 100,
          height: 50,
        },
      });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'visible' },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100]);

      const layout = result.layouts.get(100);
      expect(layout?.screenZone).toBe('top-left');
    });

    it('should mark display:none elements as not visible', async () => {
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [0, 0, 100, 0, 100, 50, 0, 50],
          width: 100,
          height: 50,
        },
      });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'none' },
          { name: 'visibility', value: 'visible' },
        ],
      });

      // Create DOM nodes map with nodeId for CSS.getComputedStyleForNode
      const domNodes = new Map<number, { nodeId: number; backendNodeId: number }>();
      domNodes.set(100, { nodeId: 100, backendNodeId: 100 });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100], domNodes);

      const layout = result.layouts.get(100);
      expect(layout?.isVisible).toBe(false);
    });

    it('should mark visibility:hidden elements as not visible', async () => {
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [0, 0, 100, 0, 100, 50, 0, 50],
          width: 100,
          height: 50,
        },
      });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'hidden' },
        ],
      });

      // Create DOM nodes map with nodeId for CSS.getComputedStyleForNode
      const domNodes = new Map<number, { nodeId: number; backendNodeId: number }>();
      domNodes.set(100, { nodeId: 100, backendNodeId: 100 });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100], domNodes);

      const layout = result.layouts.get(100);
      expect(layout?.isVisible).toBe(false);
    });

    it('should mark zero-size elements as not visible', async () => {
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [10, 20, 10, 20, 10, 20, 10, 20], // Zero size
          width: 0,
          height: 0,
        },
      });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'visible' },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100]);

      const layout = result.layouts.get(100);
      expect(layout?.isVisible).toBe(false);
    });

    it('should extract multiple nodes in batch', async () => {
      // We need to track call order
      let callIndex = 0;
      const boxModels = [
        { content: [0, 0, 100, 0, 100, 50, 0, 50], width: 100, height: 50 },
        { content: [200, 100, 350, 100, 350, 200, 200, 200], width: 150, height: 100 },
        { content: [500, 500, 600, 500, 600, 550, 500, 550], width: 100, height: 50 },
      ];

      // Override sendSpy to return different responses based on call order
      mockCdp.sendSpy.mockImplementation((method: string) => {
        if (method === 'DOM.getBoxModel') {
          const model = boxModels[callIndex % boxModels.length];
          callIndex++;
          return Promise.resolve({ model });
        }
        if (method === 'CSS.getComputedStyleForNode') {
          return Promise.resolve({
            computedStyle: [
              { name: 'display', value: 'block' },
              { name: 'visibility', value: 'visible' },
            ],
          });
        }
        return Promise.resolve({});
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, [100, 200, 300]);

      expect(result.layouts.size).toBe(3);
      expect(result.layouts.has(100)).toBe(true);
      expect(result.layouts.has(200)).toBe(true);
      expect(result.layouts.has(300)).toBe(true);
    });

    it('should handle empty node list', async () => {
      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractLayout(ctx, []);

      expect(result.layouts.size).toBe(0);
    });

    it('should use correct nodeId for CSS.getComputedStyleForNode', async () => {
      // Mock responses
      mockCdp.setResponse('DOM.getBoxModel', {
        model: {
          content: [10, 20, 110, 20, 110, 70, 10, 70],
          width: 100,
          height: 50,
        },
      });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: 'visibility', value: 'visible' },
        ],
      });

      // Create DOM nodes map with different nodeId and backendNodeId
      const domNodes = new Map<number, { nodeId: number; backendNodeId: number }>();
      domNodes.set(100, { nodeId: 42, backendNodeId: 100 }); // nodeId=42, backendNodeId=100

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      await extractLayout(ctx, [100], domNodes);

      // Verify CSS.getComputedStyleForNode was called with the correct nodeId (42), not backendNodeId (100)
      const cssCall = (mockCdp.sendSpy.mock.calls as [string, unknown][]).find(
        (call): call is [string, unknown] => call[0] === 'CSS.getComputedStyleForNode'
      );
      expect(cssCall).toBeDefined();
      expect(cssCall?.[1]).toEqual({ nodeId: 42 });
    });
  });

  describe('computeScreenZone', () => {
    const viewport = { width: 1200, height: 900 };

    it('should identify top-left zone', () => {
      const bbox = { x: 100, y: 100, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('top-left');
    });

    it('should identify top-center zone', () => {
      const bbox = { x: 500, y: 100, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('top-center');
    });

    it('should identify top-right zone', () => {
      const bbox = { x: 1000, y: 100, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('top-right');
    });

    it('should identify middle-left zone', () => {
      const bbox = { x: 100, y: 400, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('middle-left');
    });

    it('should identify middle-center zone', () => {
      const bbox = { x: 500, y: 400, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('middle-center');
    });

    it('should identify middle-right zone', () => {
      const bbox = { x: 1000, y: 400, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('middle-right');
    });

    it('should identify bottom-left zone', () => {
      const bbox = { x: 100, y: 700, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('bottom-left');
    });

    it('should identify bottom-center zone', () => {
      const bbox = { x: 500, y: 700, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('bottom-center');
    });

    it('should identify bottom-right zone', () => {
      const bbox = { x: 1000, y: 700, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('bottom-right');
    });

    it('should identify elements below fold', () => {
      const bbox = { x: 100, y: 1000, w: 100, h: 50 };
      expect(computeScreenZone(bbox, viewport)).toBe('below-fold');
    });
  });

  describe('computeVisibility', () => {
    it('should return true for visible elements', () => {
      const bbox = { x: 10, y: 20, w: 100, h: 50 };
      expect(computeVisibility(bbox, 'block', 'visible')).toBe(true);
    });

    it('should return false for display:none', () => {
      const bbox = { x: 10, y: 20, w: 100, h: 50 };
      expect(computeVisibility(bbox, 'none', 'visible')).toBe(false);
    });

    it('should return false for visibility:hidden', () => {
      const bbox = { x: 10, y: 20, w: 100, h: 50 };
      expect(computeVisibility(bbox, 'block', 'hidden')).toBe(false);
    });

    it('should return false for visibility:collapse', () => {
      const bbox = { x: 10, y: 20, w: 100, h: 50 };
      expect(computeVisibility(bbox, 'block', 'collapse')).toBe(false);
    });

    it('should return false for zero-width elements', () => {
      const bbox = { x: 10, y: 20, w: 0, h: 50 };
      expect(computeVisibility(bbox, 'block', 'visible')).toBe(false);
    });

    it('should return false for zero-height elements', () => {
      const bbox = { x: 10, y: 20, w: 100, h: 0 };
      expect(computeVisibility(bbox, 'block', 'visible')).toBe(false);
    });
  });
});
