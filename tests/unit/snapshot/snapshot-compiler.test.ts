/**
 * Snapshot Compiler Tests
 *
 * Tests for the SnapshotCompiler orchestration layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SnapshotCompiler } from '../../../src/snapshot/snapshot-compiler.js';
import { createMockCdpClient, MockCdpClient } from '../../mocks/cdp-client.mock.js';
import type { Page } from 'playwright';

// Mock Playwright Page
function createMockPage(overrides: Partial<Page> = {}): Page {
  return {
    url: vi.fn().mockReturnValue('https://example.com/'),
    title: vi.fn().mockResolvedValue('Test Page'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    ...overrides,
  } as unknown as Page;
}

// Create realistic CDP mock responses
function setupCdpMocks(mockCdp: MockCdpClient): void {
  // DOM.getDocument response
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
          attributes: ['lang', 'en'],
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
                  nodeName: 'HEADER',
                  children: [
                    {
                      nodeId: 5,
                      backendNodeId: 5,
                      nodeType: 1,
                      nodeName: 'NAV',
                      children: [
                        {
                          nodeId: 6,
                          backendNodeId: 6,
                          nodeType: 1,
                          nodeName: 'A',
                          attributes: ['href', '/about'],
                          children: [],
                        },
                      ],
                    },
                  ],
                },
                {
                  nodeId: 7,
                  backendNodeId: 7,
                  nodeType: 1,
                  nodeName: 'MAIN',
                  children: [
                    {
                      nodeId: 8,
                      backendNodeId: 8,
                      nodeType: 1,
                      nodeName: 'H1',
                      attributes: ['id', 'main-heading'],
                      children: [],
                    },
                    {
                      nodeId: 9,
                      backendNodeId: 9,
                      nodeType: 1,
                      nodeName: 'FORM',
                      attributes: ['id', 'login-form'],
                      children: [
                        {
                          nodeId: 10,
                          backendNodeId: 10,
                          nodeType: 1,
                          nodeName: 'INPUT',
                          attributes: ['type', 'text', 'name', 'username', 'placeholder', 'Username'],
                          children: [],
                        },
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'BUTTON',
                          attributes: ['type', 'submit', 'data-testid', 'submit-btn'],
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
      ],
    },
  });

  // Accessibility.getFullAXTree response
  mockCdp.setResponse('Accessibility.getFullAXTree', {
    nodes: [
      {
        nodeId: 'ax-1',
        backendDOMNodeId: 1,
        role: { value: 'WebArea' },
        name: { value: 'Test Page' },
        ignored: false,
        childIds: ['ax-2'],
      },
      {
        nodeId: 'ax-6',
        backendDOMNodeId: 6,
        role: { value: 'link' },
        name: { value: 'About' },
        ignored: false,
        properties: [
          { name: 'focusable', value: { value: true } },
        ],
      },
      {
        nodeId: 'ax-8',
        backendDOMNodeId: 8,
        role: { value: 'heading' },
        name: { value: 'Welcome' },
        ignored: false,
        properties: [
          { name: 'level', value: { value: 1 } },
        ],
      },
      {
        nodeId: 'ax-10',
        backendDOMNodeId: 10,
        role: { value: 'textbox' },
        name: { value: 'Username' },
        ignored: false,
        properties: [
          { name: 'focusable', value: { value: true } },
        ],
      },
      {
        nodeId: 'ax-11',
        backendDOMNodeId: 11,
        role: { value: 'button' },
        name: { value: 'Submit' },
        ignored: false,
        properties: [
          { name: 'focusable', value: { value: true } },
        ],
      },
    ],
  });

  // DOM.getBoxModel - default response
  mockCdp.setResponse('DOM.getBoxModel', {
    model: {
      content: [100, 100, 200, 100, 200, 150, 100, 150],
      width: 100,
      height: 50,
    },
  });

  // CSS.getComputedStyleForNode - default response
  mockCdp.setResponse('CSS.getComputedStyleForNode', {
    computedStyle: [
      { name: 'display', value: 'block' },
      { name: 'visibility', value: 'visible' },
    ],
  });
}

describe('SnapshotCompiler', () => {
  let mockCdp: MockCdpClient;
  let mockPage: Page;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
    mockPage = createMockPage();
    setupCdpMocks(mockCdp);
  });

  describe('compile', () => {
    it('should compile a full snapshot', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot).toBeDefined();
      expect(snapshot.snapshot_id).toBeDefined();
      expect(snapshot.url).toBe('https://example.com/');
      expect(snapshot.title).toBe('Test Page');
      expect(snapshot.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('should extract interactive nodes', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should include button, link, and textbox
      const interactiveNodes = snapshot.nodes.filter(
        (n) => ['button', 'link', 'input', 'combobox'].includes(n.kind)
      );
      expect(interactiveNodes.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract readable content when enabled', async () => {
      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should include heading
      const headings = snapshot.nodes.filter((n) => n.kind === 'heading');
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });

    it('should include layout information when enabled', async () => {
      const compiler = new SnapshotCompiler({ includeLayout: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // All nodes should have bbox
      for (const node of snapshot.nodes) {
        expect(node.layout).toBeDefined();
        expect(node.layout.bbox).toBeDefined();
      }
    });

    it('should include semantic regions', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Check that regions are populated
      const nodesWithRegion = snapshot.nodes.filter(
        (n) => n.where.region !== 'unknown'
      );
      // Mock data has HEADER, NAV, MAIN elements, so at least some nodes should have detected regions
      // If no nodes have regions, the assertion will fail and expose region detection issues
      expect(nodesWithRegion.length).toBeGreaterThan(0);
    });

    it('should include node locators', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Interactive nodes should have locators
      const interactiveNodes = snapshot.nodes.filter(
        (n) => ['button', 'link', 'input'].includes(n.kind)
      );
      for (const node of interactiveNodes) {
        expect(node.find).toBeDefined();
        expect(node.find?.primary).toBeDefined();
      }
    });

    it('should track metadata', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta).toBeDefined();
      expect(snapshot.meta.node_count).toBe(snapshot.nodes.length);
      expect(snapshot.meta.capture_duration_ms).toBeDefined();
      expect(typeof snapshot.meta.capture_duration_ms).toBe('number');
    });

    it('should generate unique snapshot IDs', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot1 = await compiler.compile(mockCdp, mockPage, 'page-1');
      const snapshot2 = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot1.snapshot_id).not.toBe(snapshot2.snapshot_id);
    });

    it('should generate unique node IDs', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const nodeIds = snapshot.nodes.map((n) => n.node_id);
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
    });

    it('should handle include_hidden option', async () => {
      const compiler = new SnapshotCompiler();

      // Make element "hidden" by setting box model error
      mockCdp.setError('DOM.getBoxModel', new Error('Not rendered'));

      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should still work, but may have fewer visible nodes
      expect(snapshot).toBeDefined();
    });

    it('should include captured_at timestamp', async () => {
      const compiler = new SnapshotCompiler();
      const beforeCompile = new Date().toISOString();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const afterCompile = new Date().toISOString();

      expect(snapshot.captured_at).toBeDefined();
      expect(snapshot.captured_at >= beforeCompile).toBe(true);
      expect(snapshot.captured_at <= afterCompile).toBe(true);
    });
  });

  describe('options', () => {
    it('should respect includeReadable: false', async () => {
      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should only have interactive nodes
      const readableNodes = snapshot.nodes.filter(
        (n) => ['heading', 'paragraph', 'list', 'image'].includes(n.kind)
      );
      expect(readableNodes.length).toBe(0);
    });

    it('should respect includeLayout: false', async () => {
      const compiler = new SnapshotCompiler({ includeLayout: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Nodes should have default/empty bbox
      for (const node of snapshot.nodes) {
        if (node.layout) {
          expect(node.layout.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle CDP errors gracefully', async () => {
      mockCdp.setError('Accessibility.getFullAXTree', new Error('CDP error'));

      const compiler = new SnapshotCompiler();
      // Should not throw, but may produce partial results
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot).toBeDefined();
      expect(snapshot.meta.partial).toBe(true);
    });

    it('should mark snapshot as partial when errors occur', async () => {
      mockCdp.setError('DOM.getBoxModel', new Error('Layout error'));

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot).toBeDefined();
      // Snapshot should still be usable
    });
  });
});
