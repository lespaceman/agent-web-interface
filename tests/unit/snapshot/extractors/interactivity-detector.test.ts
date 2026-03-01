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
});
