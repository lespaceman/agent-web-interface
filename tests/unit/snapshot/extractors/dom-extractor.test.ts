/**
 * DOM Extractor Tests
 *
 * Tests for CDP DOM tree extraction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractDom } from '../../../../src/snapshot/extractors/dom-extractor.js';
import { createExtractorContext } from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient, MockCdpClient } from '../../../mocks/cdp-client.mock.js';

describe('DOM Extractor', () => {
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  describe('extractDom', () => {
    it('should extract basic document structure', async () => {
      // Setup mock response for DOM.getDocument
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9, // DOCUMENT_NODE
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1, // ELEMENT_NODE
              nodeName: 'HTML',
              attributes: ['lang', 'en'],
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'BODY',
                  attributes: [],
                  children: [],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.rootId).toBe(1);
      expect(result.nodes.size).toBeGreaterThan(0);
      expect(result.nodes.has(2)).toBe(true); // HTML element
      expect(result.nodes.get(2)?.nodeName).toBe('HTML');
      expect(result.nodes.get(2)?.attributes?.lang).toBe('en');
    });

    it('should extract nested elements with attributes', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'HTML',
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'BODY',
                  children: [
                    {
                      nodeId: 4,
                      backendNodeId: 4,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['id', 'submit-btn', 'class', 'btn primary', 'aria-label', 'Submit'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.nodes.has(4)).toBe(true);
      const button = result.nodes.get(4);
      expect(button?.nodeName).toBe('BUTTON');
      expect(button?.attributes?.id).toBe('submit-btn');
      expect(button?.attributes?.class).toBe('btn primary');
      expect(button?.attributes?.['aria-label']).toBe('Submit');
    });

    it('should track parent-child relationships', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'HTML',
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'DIV',
                  children: [
                    {
                      nodeId: 4,
                      backendNodeId: 4,
                      nodeType: 1,
                      nodeName: 'SPAN',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      // DIV (3) is parent of SPAN (4)
      expect(result.nodes.get(4)?.parentId).toBe(3);
      // DIV (3) should have SPAN (4) as child
      expect(result.nodes.get(3)?.childNodeIds).toContain(4);
    });

    it('should detect shadow DOM roots', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'HTML',
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'MY-COMPONENT',
                  shadowRoots: [
                    {
                      nodeId: 4,
                      backendNodeId: 4,
                      nodeType: 11, // DOCUMENT_FRAGMENT_NODE
                      nodeName: '#shadow-root',
                      shadowRootType: 'open',
                      children: [],
                    },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.shadowRoots).toContain(3);
      expect(result.nodes.get(3)?.shadowRootType).toBe('open');
    });

    it('should detect iframes', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'HTML',
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'IFRAME',
                  attributes: ['src', 'https://example.com/embed'],
                  frameId: 'frame-123',
                  contentDocument: {
                    nodeId: 4,
                    backendNodeId: 4,
                    nodeType: 9,
                    nodeName: '#document',
                    children: [],
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.frameIds).toContain('frame-123');
      expect(result.nodes.get(3)?.frameId).toBe('frame-123');
    });

    it('should handle empty document', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.rootId).toBe(1);
      expect(result.nodes.size).toBe(1);
      expect(result.frameIds).toHaveLength(0);
      expect(result.shadowRoots).toHaveLength(0);
    });

    it('should parse attributes from array format', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'INPUT',
              // CDP returns attributes as flat array: [name1, value1, name2, value2, ...]
              attributes: ['type', 'text', 'name', 'username', 'placeholder', 'Enter username'],
              children: [],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      const input = result.nodes.get(2);
      expect(input?.attributes?.type).toBe('text');
      expect(input?.attributes?.name).toBe('username');
      expect(input?.attributes?.placeholder).toBe('Enter username');
    });

    it('should handle text nodes', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'P',
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 3, // TEXT_NODE
                  nodeName: '#text',
                  nodeValue: 'Hello, world!',
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      const textNode = result.nodes.get(3);
      expect(textNode?.nodeName).toBe('#text');
      expect(textNode?.nodeValue).toBe('Hello, world!');
      expect(textNode?.nodeType).toBe(3);
    });

    it('should handle deeply nested structures', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [
            {
              nodeId: 2,
              backendNodeId: 2,
              nodeType: 1,
              nodeName: 'DIV',
              attributes: ['id', 'level-1'],
              children: [
                {
                  nodeId: 3,
                  backendNodeId: 3,
                  nodeType: 1,
                  nodeName: 'DIV',
                  attributes: ['id', 'level-2'],
                  children: [
                    {
                      nodeId: 4,
                      backendNodeId: 4,
                      nodeType: 1,
                      nodeName: 'DIV',
                      attributes: ['id', 'level-3'],
                      children: [
                        {
                          nodeId: 5,
                          backendNodeId: 5,
                          nodeType: 1,
                          nodeName: 'SPAN',
                          attributes: ['id', 'level-4'],
                          children: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractDom(ctx);

      expect(result.nodes.size).toBe(5);
      expect(result.nodes.get(5)?.parentId).toBe(4);
      expect(result.nodes.get(4)?.parentId).toBe(3);
      expect(result.nodes.get(3)?.parentId).toBe(2);
    });

    it('should call DOM.getDocument with correct depth', async () => {
      mockCdp.setResponse('DOM.getDocument', {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: '#document',
          children: [],
        },
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      await extractDom(ctx);

      expect(mockCdp.sendSpy).toHaveBeenCalledWith('DOM.getDocument', { depth: -1, pierce: true });
    });
  });
});
