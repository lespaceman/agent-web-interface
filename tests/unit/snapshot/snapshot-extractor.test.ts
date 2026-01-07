/**
 * Snapshot Extractor Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSnapshot, mapAxRoleToNodeKind } from '../../../src/snapshot/snapshot-extractor.js';
import { createMockCdpClient } from '../../mocks/cdp-client.mock.js';
import type { Page } from 'playwright';

describe('SnapshotExtractor', () => {
  describe('mapAxRoleToNodeKind()', () => {
    it('should map button role', () => {
      expect(mapAxRoleToNodeKind('button')).toBe('button');
    });

    it('should map link role', () => {
      expect(mapAxRoleToNodeKind('link')).toBe('link');
    });

    it('should map textbox to input', () => {
      expect(mapAxRoleToNodeKind('textbox')).toBe('input');
    });

    it('should map searchbox to input', () => {
      expect(mapAxRoleToNodeKind('searchbox')).toBe('input');
    });

    it('should map combobox role', () => {
      expect(mapAxRoleToNodeKind('combobox')).toBe('combobox');
    });

    it('should map checkbox role', () => {
      expect(mapAxRoleToNodeKind('checkbox')).toBe('checkbox');
    });

    it('should map radio role', () => {
      expect(mapAxRoleToNodeKind('radio')).toBe('radio');
    });

    it('should map switch role', () => {
      expect(mapAxRoleToNodeKind('switch')).toBe('switch');
    });

    it('should map slider role', () => {
      expect(mapAxRoleToNodeKind('slider')).toBe('slider');
    });

    it('should map tab role', () => {
      expect(mapAxRoleToNodeKind('tab')).toBe('tab');
    });

    it('should map menuitem roles', () => {
      expect(mapAxRoleToNodeKind('menuitem')).toBe('menuitem');
      expect(mapAxRoleToNodeKind('menuitemcheckbox')).toBe('menuitem');
      expect(mapAxRoleToNodeKind('menuitemradio')).toBe('menuitem');
    });

    it('should return undefined for non-interactive roles', () => {
      expect(mapAxRoleToNodeKind('WebArea')).toBeUndefined();
      expect(mapAxRoleToNodeKind('heading')).toBeUndefined();
      expect(mapAxRoleToNodeKind('navigation')).toBeUndefined();
      expect(mapAxRoleToNodeKind('generic')).toBeUndefined();
    });
  });

  describe('extractSnapshot()', () => {
    let mockCdp: ReturnType<typeof createMockCdpClient>;
    let mockPage: Page;

    beforeEach(() => {
      mockCdp = createMockCdpClient();

      mockPage = {
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Test Page'),
        viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
      } as unknown as Page;
    });

    it('should extract interactive elements from AX tree', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 10,
          },
          {
            nodeId: '2',
            ignored: false,
            role: { type: 'role', value: 'link' },
            name: { type: 'computedString', value: 'Home' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 20,
          },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.snapshot_id).toBeDefined();
      expect(snapshot.url).toBe('https://example.com');
      expect(snapshot.title).toBe('Test Page');
      expect(snapshot.viewport).toEqual({ width: 1280, height: 720 });
      expect(snapshot.nodes).toHaveLength(2);
      expect(snapshot.nodes[0].kind).toBe('button');
      expect(snapshot.nodes[0].label).toBe('Submit');
      expect(snapshot.nodes[1].kind).toBe('link');
      expect(snapshot.nodes[1].label).toBe('Home');
    });

    it('should filter out non-interactive nodes', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'WebArea' },
            name: { type: 'computedString', value: 'Test Page' },
            properties: [],
            childIds: ['2', '3'],
            backendDOMNodeId: 3,
          },
          {
            nodeId: '2',
            ignored: false,
            role: { type: 'role', value: 'heading' },
            name: { type: 'computedString', value: 'Welcome' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 8,
          },
          {
            nodeId: '3',
            ignored: false,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 10,
          },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes).toHaveLength(1);
      expect(snapshot.nodes[0].kind).toBe('button');
    });

    it('should skip ignored nodes', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            ignored: true, // Ignored!
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Hidden Button' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 10,
          },
          {
            nodeId: '2',
            ignored: false,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Visible Button' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 20,
          },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes).toHaveLength(1);
      expect(snapshot.nodes[0].label).toBe('Visible Button');
    });

    it('should generate role-based locators', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'button' },
            name: { type: 'computedString', value: 'Submit form' },
            properties: [],
            childIds: [],
            backendDOMNodeId: 10,
          },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes[0].find?.primary).toBe('role=button[name="Submit form"]');
    });

    it('should handle nodes without names', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: '1',
            ignored: false,
            role: { type: 'role', value: 'button' },
            // No name
            properties: [],
            childIds: [],
            backendDOMNodeId: 10,
          },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes[0].find?.primary).toBe('role=button');
      expect(snapshot.nodes[0].label).toBe('');
    });

    it('should set correct meta statistics', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          { nodeId: '1', ignored: false, role: { value: 'button' }, name: { value: 'A' }, properties: [], childIds: [], backendDOMNodeId: 10 },
          { nodeId: '2', ignored: false, role: { value: 'link' }, name: { value: 'B' }, properties: [], childIds: [], backendDOMNodeId: 20 },
          { nodeId: '3', ignored: false, role: { value: 'textbox' }, name: { value: 'C' }, properties: [], childIds: [], backendDOMNodeId: 30 },
        ],
      });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta.node_count).toBe(3);
      expect(snapshot.meta.interactive_count).toBe(3);
    });

    it('should handle empty AX tree', async () => {
      mockCdp.setResponse('Accessibility.getFullAXTree', { nodes: [] });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes).toHaveLength(0);
      expect(snapshot.meta.node_count).toBe(0);
    });

    it('should use default viewport if page has none', async () => {
      mockPage.viewportSize = vi.fn().mockReturnValue(null);

      mockCdp.setResponse('Accessibility.getFullAXTree', { nodes: [] });

      const snapshot = await extractSnapshot(mockCdp, mockPage, 'page-1');

      expect(snapshot.viewport).toEqual({ width: 1280, height: 720 });
    });
  });
});
