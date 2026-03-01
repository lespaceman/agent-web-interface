import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractivity } from '../../../../src/snapshot/extractors/interactivity-detector.js';
import { createExtractorContext } from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient, MockCdpClient } from '../../../mocks/cdp-client.mock.js';
import type { RawDomNode } from '../../../../src/snapshot/extractors/types.js';

describe('Interactivity Detector', () => {
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  function makeDomNode(backendNodeId: number, attrs?: Record<string, string>): RawDomNode {
    return {
      nodeId: backendNodeId,
      backendNodeId,
      nodeName: 'DIV',
      nodeType: 1,
      attributes: attrs,
    };
  }

  describe('tabindex detection', () => {
    it('should detect tabindex=0 as interactive', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10, { tabindex: '0' }));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_tabindex).toBe(true);
    });

    it('should NOT detect tabindex=-1 as interactive', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10, { tabindex: '-1' }));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(false);
    });
  });

  describe('cursor:pointer detection', () => {
    it('should detect cursor:pointer as interactive', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'pointer' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_cursor_pointer).toBe(true);
    });
  });

  describe('event listener detection', () => {
    it('should detect click listener on self', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', {
        listeners: [
          {
            type: 'click',
            useCapture: false,
            passive: false,
            once: false,
            scriptId: '1',
            lineNumber: 1,
            columnNumber: 1,
          },
        ],
      });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_click_listener).toBe(true);
      expect(result.get(10)!.listener_source).toBe('self');
    });

    it('should detect delegated click listener on ancestor', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10));
      domNodes.get(10)!.parentId = 5;
      domNodes.set(5, makeDomNode(5));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', (params) => {
        const bid = (params!).backendNodeId as number;
        return { object: { objectId: `obj-${bid}` } };
      });
      mockCdp.setResponse('DOMDebugger.getEventListeners', (params) => {
        const objId = (params!).objectId as string;
        if (objId === 'obj-5') {
          return {
            listeners: [
              {
                type: 'click',
                useCapture: false,
                passive: false,
                once: false,
                scriptId: '1',
                lineNumber: 1,
                columnNumber: 1,
              },
            ],
          };
        }
        return { listeners: [] };
      });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_click_listener).toBe(true);
      expect(result.get(10)!.listener_source).toBe('ancestor');
    });

    it('should detect mousedown and pointerdown as click events', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', {
        listeners: [
          {
            type: 'pointerdown',
            useCapture: false,
            passive: false,
            once: false,
            scriptId: '1',
            lineNumber: 1,
            columnNumber: 1,
          },
        ],
      });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_click_listener).toBe(true);
    });

    it('should return empty map when no signals found', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10));

      mockCdp.setResponse('DOM.pushNodesByBackendIdsToFrontend', { nodeIds: [100] });
      mockCdp.setResponse('CSS.getComputedStyleForNode', {
        computedStyle: [{ name: 'cursor', value: 'default' }],
      });
      mockCdp.setResponse('DOM.resolveNode', { object: { objectId: 'obj-10' } });
      mockCdp.setResponse('DOMDebugger.getEventListeners', { listeners: [] });
      mockCdp.setResponse('Runtime.releaseObject', {});

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.size).toBe(0);
    });
  });

  describe('error resilience', () => {
    it('should handle CDP errors gracefully and still return tabindex results', async () => {
      const domNodes = new Map<number, RawDomNode>();
      domNodes.set(10, makeDomNode(10, { tabindex: '0' }));

      mockCdp.setError('DOM.pushNodesByBackendIdsToFrontend', new Error('Target closed'));

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [10], domNodes);

      expect(result.has(10)).toBe(true);
      expect(result.get(10)!.has_tabindex).toBe(true);
    });

    it('should return empty map for empty candidateIds', async () => {
      const domNodes = new Map<number, RawDomNode>();

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await detectInteractivity(ctx, [], domNodes);

      expect(result.size).toBe(0);
    });
  });
});
