/**
 * AX Extractor Tests
 *
 * Tests for CDP Accessibility tree extraction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractAx, classifyAxRole } from '../../../../src/snapshot/extractors/ax-extractor.js';
import { createExtractorContext } from '../../../../src/snapshot/extractors/types.js';
import { createMockCdpClient, MockCdpClient } from '../../../mocks/cdp-client.mock.js';

describe('AX Extractor', () => {
  let mockCdp: MockCdpClient;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
  });

  describe('extractAx', () => {
    it('should extract interactive elements', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: 10,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            ignored: false,
          },
          {
            nodeId: '2',
            backendDOMNodeId: 20,
            role: { type: 'role', value: 'link' },
            name: { type: 'computedString', value: 'About us' },
            ignored: false,
          },
          {
            nodeId: '3',
            backendDOMNodeId: 30,
            role: { type: 'role', value: 'textbox' },
            name: { type: 'computedString', value: 'Username' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      expect(result.nodes.size).toBe(3);
      expect(result.interactiveIds.has(10)).toBe(true);
      expect(result.interactiveIds.has(20)).toBe(true);
      expect(result.interactiveIds.has(30)).toBe(true);
    });

    it('should extract readable content elements', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: 10,
            role: { type: 'role', value: 'heading' },
            name: { type: 'computedString', value: 'Welcome' },
            properties: [{ name: 'level', value: { type: 'integer', value: 1 } }],
            ignored: false,
          },
          {
            nodeId: '2',
            backendDOMNodeId: 20,
            role: { type: 'role', value: 'paragraph' },
            name: { type: 'computedString', value: 'Hello world' },
            ignored: false,
          },
          {
            nodeId: '3',
            backendDOMNodeId: 30,
            role: { type: 'role', value: 'image' },
            name: { type: 'computedString', value: 'Logo' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      expect(result.nodes.size).toBe(3);
      expect(result.readableIds.has(10)).toBe(true);
      expect(result.readableIds.has(20)).toBe(true);
      expect(result.readableIds.has(30)).toBe(true);
    });

    it('should filter out ignored nodes', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: 10,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            ignored: true, // Ignored
          },
          {
            nodeId: '2',
            backendDOMNodeId: 20,
            role: { type: 'role', value: 'link' },
            name: { type: 'computedString', value: 'About' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      expect(result.nodes.size).toBe(1);
      expect(result.nodes.has(10)).toBe(false);
      expect(result.nodes.has(20)).toBe(true);
    });

    it('should correlate AX nodes with DOM via backendDOMNodeId', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-1',
            backendDOMNodeId: 100,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Click me' },
            ignored: false,
            childIds: ['ax-2'],
          },
          {
            nodeId: 'ax-2',
            backendDOMNodeId: 200,
            role: { type: 'role', value: 'StaticText' },
            name: { type: 'computedString', value: 'Click me' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      const buttonNode = result.nodes.get(100);
      expect(buttonNode).toBeDefined();
      expect(buttonNode?.role).toBe('button');
      expect(buttonNode?.name).toBe('Click me');
      expect(buttonNode?.childIds).toEqual(['ax-2']);
    });

    it('should extract AX properties', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: 10,
            role: { type: 'role', value: 'checkbox' },
            name: { type: 'computedString', value: 'Accept terms' },
            properties: [
              { name: 'checked', value: { type: 'tristate', value: 'true' } },
              { name: 'focusable', value: { type: 'booleanOrUndefined', value: true } },
            ],
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      const checkbox = result.nodes.get(10);
      expect(checkbox?.properties).toBeDefined();
      expect(checkbox?.properties?.length).toBe(2);
      expect(checkbox?.properties?.[0].name).toBe('checked');
    });

    it('should skip nodes without backendDOMNodeId', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            // No backendDOMNodeId
            role: { type: 'role', value: 'WebArea' },
            name: { type: 'computedString', value: 'Page' },
            ignored: false,
          },
          {
            nodeId: '2',
            backendDOMNodeId: 20,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      // Only the node with backendDOMNodeId should be included
      expect(result.nodes.size).toBe(1);
      expect(result.nodes.has(20)).toBe(true);
    });

    it('should classify interactive vs readable nodes correctly', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          { nodeId: '1', backendDOMNodeId: 1, role: { value: 'button' }, ignored: false },
          { nodeId: '2', backendDOMNodeId: 2, role: { value: 'link' }, ignored: false },
          { nodeId: '3', backendDOMNodeId: 3, role: { value: 'textbox' }, ignored: false },
          { nodeId: '4', backendDOMNodeId: 4, role: { value: 'heading' }, ignored: false },
          { nodeId: '5', backendDOMNodeId: 5, role: { value: 'paragraph' }, ignored: false },
          { nodeId: '6', backendDOMNodeId: 6, role: { value: 'navigation' }, ignored: false },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      // Interactive: button, link, textbox
      expect(result.interactiveIds.has(1)).toBe(true);
      expect(result.interactiveIds.has(2)).toBe(true);
      expect(result.interactiveIds.has(3)).toBe(true);

      // Readable: heading, paragraph
      expect(result.readableIds.has(4)).toBe(true);
      expect(result.readableIds.has(5)).toBe(true);

      // Structural (not in interactive or readable)
      expect(result.interactiveIds.has(6)).toBe(false);
      expect(result.readableIds.has(6)).toBe(false);
    });

    it('should handle empty AX tree', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });
      const result = await extractAx(ctx);

      expect(result.nodes.size).toBe(0);
      expect(result.interactiveIds.size).toBe(0);
      expect(result.readableIds.size).toBe(0);
    });
  });

  describe('multi-frame extraction', () => {
    it('should extract AX nodes from multiple frames when frameIds provided', async () => {
      // Setup: main frame has a button, iframe has a checkbox (like cookie consent)
      mockCdp.setResponse('Accessibility.getFullAXTree', (params?: Record<string, unknown>) => {
        const frameId = params?.frameId as string | undefined;

        if (frameId === 'iframe-cookie-consent') {
          // Cookie consent iframe content
          return {
            nodes: [
              {
                nodeId: 'iframe-1',
                backendDOMNodeId: 1001,
                role: { type: 'role', value: 'checkbox' },
                name: { type: 'computedString', value: 'Accept all cookies' },
                ignored: false,
              },
              {
                nodeId: 'iframe-2',
                backendDOMNodeId: 1002,
                role: { type: 'role', value: 'button' },
                name: { type: 'computedString', value: 'Save preferences' },
                ignored: false,
              },
            ],
          };
        }

        // Main frame content
        return {
          nodes: [
            {
              nodeId: 'main-1',
              backendDOMNodeId: 10,
              role: { type: 'role', value: 'button' },
              name: { type: 'computedString', value: 'Submit' },
              ignored: false,
            },
            {
              nodeId: 'main-2',
              backendDOMNodeId: 20,
              role: { type: 'role', value: 'dialog' },
              name: { type: 'computedString', value: 'Cookie Consent' },
              ignored: false,
            },
          ],
        };
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });

      // Extract with frame IDs (main frame + cookie consent iframe)
      const result = await extractAx(ctx, ['iframe-cookie-consent']);

      // Should have nodes from both frames
      expect(result.nodes.size).toBe(4);

      // Main frame nodes
      expect(result.nodes.has(10)).toBe(true);
      expect(result.nodes.get(10)?.role).toBe('button');
      expect(result.nodes.get(10)?.name).toBe('Submit');

      expect(result.nodes.has(20)).toBe(true);
      expect(result.nodes.get(20)?.role).toBe('dialog');

      // Iframe nodes (cookie consent)
      expect(result.nodes.has(1001)).toBe(true);
      expect(result.nodes.get(1001)?.role).toBe('checkbox');
      expect(result.nodes.get(1001)?.name).toBe('Accept all cookies');

      expect(result.nodes.has(1002)).toBe(true);
      expect(result.nodes.get(1002)?.role).toBe('button');
      expect(result.nodes.get(1002)?.name).toBe('Save preferences');

      // Interactive IDs should include iframe elements
      expect(result.interactiveIds.has(10)).toBe(true); // Main frame button
      expect(result.interactiveIds.has(1001)).toBe(true); // Iframe checkbox
      expect(result.interactiveIds.has(1002)).toBe(true); // Iframe button
    });

    it('should handle frame extraction failures gracefully', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', (params?: Record<string, unknown>) => {
        const frameId = params?.frameId as string | undefined;

        if (frameId === 'broken-frame') {
          throw new Error('Frame not found');
        }

        return {
          nodes: [
            {
              nodeId: 'main-1',
              backendDOMNodeId: 10,
              role: { type: 'role', value: 'button' },
              name: { type: 'computedString', value: 'Submit' },
              ignored: false,
            },
          ],
        };
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });

      // Should not throw, should return main frame nodes
      const result = await extractAx(ctx, ['broken-frame']);

      expect(result.nodes.size).toBe(1);
      expect(result.nodes.has(10)).toBe(true);
    });

    it('should work without frameIds (backwards compatible)', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: 10,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            ignored: false,
          },
        ],
      });

      const ctx = createExtractorContext(mockCdp, { width: 1280, height: 720 });

      // No frameIds - should work as before
      const result = await extractAx(ctx);

      expect(result.nodes.size).toBe(1);
      expect(result.nodes.has(10)).toBe(true);
    });
  });

  describe('classifyAxRole', () => {
    it('should classify interactive roles', () => {
      expect(classifyAxRole('button')).toBe('interactive');
      expect(classifyAxRole('link')).toBe('interactive');
      expect(classifyAxRole('textbox')).toBe('interactive');
      expect(classifyAxRole('checkbox')).toBe('interactive');
      expect(classifyAxRole('radio')).toBe('interactive');
      expect(classifyAxRole('combobox')).toBe('interactive');
      expect(classifyAxRole('slider')).toBe('interactive');
      expect(classifyAxRole('tab')).toBe('interactive');
      expect(classifyAxRole('menuitem')).toBe('interactive');
    });

    it('should classify readable roles', () => {
      expect(classifyAxRole('heading')).toBe('readable');
      expect(classifyAxRole('paragraph')).toBe('readable');
      expect(classifyAxRole('image')).toBe('readable');
      expect(classifyAxRole('list')).toBe('readable');
      expect(classifyAxRole('listitem')).toBe('readable');
      expect(classifyAxRole('table')).toBe('readable');
    });

    it('should classify structural roles', () => {
      expect(classifyAxRole('banner')).toBe('structural');
      expect(classifyAxRole('navigation')).toBe('structural');
      expect(classifyAxRole('main')).toBe('structural');
      expect(classifyAxRole('contentinfo')).toBe('structural');
      expect(classifyAxRole('form')).toBe('structural');
      expect(classifyAxRole('dialog')).toBe('structural');
    });

    it('should return unknown for unrecognized roles', () => {
      expect(classifyAxRole('generic')).toBe('unknown');
      expect(classifyAxRole('none')).toBe('unknown');
      expect(classifyAxRole('presentation')).toBe('unknown');
    });

    it('should handle case insensitively', () => {
      expect(classifyAxRole('BUTTON')).toBe('interactive');
      expect(classifyAxRole('Button')).toBe('interactive');
      expect(classifyAxRole('HEADING')).toBe('readable');
    });
  });
});
