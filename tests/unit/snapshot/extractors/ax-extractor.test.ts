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
