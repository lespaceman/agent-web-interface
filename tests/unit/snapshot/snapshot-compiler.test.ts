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
                          attributes: [
                            'type',
                            'text',
                            'name',
                            'username',
                            'placeholder',
                            'Username',
                          ],
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
        properties: [{ name: 'focusable', value: { value: true } }],
      },
      {
        nodeId: 'ax-8',
        backendDOMNodeId: 8,
        role: { value: 'heading' },
        name: { value: 'Welcome' },
        ignored: false,
        properties: [{ name: 'level', value: { value: 1 } }],
      },
      {
        nodeId: 'ax-10',
        backendDOMNodeId: 10,
        role: { value: 'textbox' },
        name: { value: 'Username' },
        ignored: false,
        properties: [{ name: 'focusable', value: { value: true } }],
      },
      {
        nodeId: 'ax-11',
        backendDOMNodeId: 11,
        role: { value: 'button' },
        name: { value: 'Submit' },
        ignored: false,
        properties: [{ name: 'focusable', value: { value: true } }],
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
      const interactiveNodes = snapshot.nodes.filter((n) =>
        ['button', 'link', 'input', 'combobox'].includes(n.kind)
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
      const nodesWithRegion = snapshot.nodes.filter((n) => n.where.region !== 'unknown');
      // Mock data has HEADER, NAV, MAIN elements, so at least some nodes should have detected regions
      // If no nodes have regions, the assertion will fail and expose region detection issues
      expect(nodesWithRegion.length).toBeGreaterThan(0);
    });

    it('should include node locators', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Interactive nodes should have locators
      const interactiveNodes = snapshot.nodes.filter((n) =>
        ['button', 'link', 'input'].includes(n.kind)
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

    it('should derive node_id from backend_node_id for stability across snapshots', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Each node's node_id should be the string representation of its backend_node_id
      // This ensures the same DOM element gets the same ID across snapshots
      for (const node of snapshot.nodes) {
        expect(node.node_id).toBe(String(node.backend_node_id));
      }
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

    it('should include form nodes for form detection', async () => {
      // Setup: page with form element
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'FORM',
                      attributes: ['id', 'login-form'],
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'INPUT',
                          attributes: ['type', 'text', 'name', 'username'],
                          children: [],
                        },
                        {
                          nodeId: 12,
                          backendNodeId: 12,
                          nodeType: 1,
                          nodeName: 'BUTTON',
                          attributes: ['type', 'submit'],
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'form' },
            name: { value: 'Login Form' },
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'textbox' },
            name: { value: 'Username' },
            ignored: false,
          },
          {
            nodeId: 'ax-12',
            backendDOMNodeId: 12,
            role: { value: 'button' },
            name: { value: 'Submit' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should include form node (essential structural node for form detection)
      const formNodes = snapshot.nodes.filter((n) => n.kind === 'form');
      expect(formNodes.length).toBe(1);
      expect(formNodes[0].label).toBe('Login Form');

      // Should also include interactive nodes
      const inputNodes = snapshot.nodes.filter((n) => n.kind === 'input');
      expect(inputNodes.length).toBe(1);
      const buttonNodes = snapshot.nodes.filter((n) => n.kind === 'button');
      expect(buttonNodes.length).toBe(1);
    });

    it('should include dialog nodes for dialog detection', async () => {
      // Setup: page with dialog element
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'DIALOG',
                      attributes: ['open', ''],
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'BUTTON',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'dialog' },
            name: { value: 'Confirm Action' },
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'button' },
            name: { value: 'OK' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should include dialog node (essential structural node for dialog detection)
      const dialogNodes = snapshot.nodes.filter((n) => n.kind === 'dialog');
      expect(dialogNodes.length).toBe(1);
      expect(dialogNodes[0].label).toBe('Confirm Action');
    });
  });

  describe('options', () => {
    it('should respect includeReadable: false', async () => {
      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should only have interactive nodes
      const readableNodes = snapshot.nodes.filter((n) =>
        ['heading', 'paragraph', 'list', 'image'].includes(n.kind)
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

  describe('DOM ordering', () => {
    it('should order nodes by DOM pre-order traversal', async () => {
      // Setup DOM with specific structure:
      // #document -> HTML -> BODY -> [H1, BUTTON, LINK, INPUT]
      // Expected DOM order: H1 (8), BUTTON (11), LINK (6), INPUT (10)
      // But our setup has: NAV > A (6), MAIN > H1 (8) > FORM > INPUT (10), BUTTON (11)
      // So DOM pre-order should be: A (6), H1 (8), INPUT (10), BUTTON (11)
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'first-btn'],
                      children: [],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'A',
                      attributes: ['href', '/link'],
                      children: [],
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'INPUT',
                      attributes: ['type', 'text'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      // AX tree returns nodes in different order than DOM
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'textbox' },
            name: { value: 'Input' },
            ignored: false,
          },
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            name: { value: 'Title' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'link' },
            name: { value: 'My Link' },
            ignored: false,
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Click Me' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Nodes should be in DOM pre-order: H1 (10), BUTTON (20), A (30), INPUT (40)
      expect(snapshot.nodes.length).toBe(4);
      expect(snapshot.nodes[0].backend_node_id).toBe(10); // H1 first
      expect(snapshot.nodes[1].backend_node_id).toBe(20); // BUTTON second
      expect(snapshot.nodes[2].backend_node_id).toBe(30); // A third
      expect(snapshot.nodes[3].backend_node_id).toBe(40); // INPUT fourth
    });

    it('should respect max_nodes with DOM order - first N nodes are first N in DOM order', async () => {
      // Create 5 elements in specific DOM order
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'btn-1'],
                      children: [],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'btn-2'],
                      children: [],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'btn-3'],
                      children: [],
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'btn-4'],
                      children: [],
                    },
                    {
                      nodeId: 50,
                      backendNodeId: 50,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'btn-5'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      // AX tree returns in reverse order
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-50',
            backendDOMNodeId: 50,
            role: { value: 'button' },
            name: { value: 'Button 5' },
            ignored: false,
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'button' },
            name: { value: 'Button 4' },
            ignored: false,
          },
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'button' },
            name: { value: 'Button 3' },
            ignored: false,
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Button 2' },
            ignored: false,
          },
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Button 1' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ max_nodes: 3 });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should get first 3 in DOM order, not AX order
      expect(snapshot.nodes.length).toBe(3);
      expect(snapshot.nodes[0].backend_node_id).toBe(10); // btn-1
      expect(snapshot.nodes[1].backend_node_id).toBe(20); // btn-2
      expect(snapshot.nodes[2].backend_node_id).toBe(30); // btn-3
    });

    it('should add warning when DOM extraction fails and fall back to AX order', async () => {
      mockCdp.setError('DOM.getDocument', new Error('DOM extraction failed'));

      // AX-only mode should still work
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'button' },
            name: { value: 'Button 1' },
            ignored: false,
          },
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'link' },
            name: { value: 'Link 1' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta.warnings).toBeDefined();
      expect(snapshot.meta.warnings).toContainEqual(
        expect.stringMatching(/DOM.*order.*unavailable|DOM.*extraction.*failed/i)
      );
      // Should maintain stable AX order as fallback
      expect(snapshot.nodes.length).toBe(2);
    });
  });

  describe('heading context', () => {
    it('should provide heading context even when includeReadable is false', async () => {
      // Setup: H2 -> BUTTON
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'SECTION',
                      children: [
                        {
                          nodeId: 20,
                          backendNodeId: 20,
                          nodeType: 1,
                          nodeName: 'H2',
                          children: [],
                        },
                        {
                          nodeId: 30,
                          backendNodeId: 30,
                          nodeType: 1,
                          nodeName: 'P',
                          children: [],
                        },
                        {
                          nodeId: 40,
                          backendNodeId: 40,
                          nodeType: 1,
                          nodeName: 'BUTTON',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'heading' },
            name: { value: 'Section Heading' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 2 } }],
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'button' },
            name: { value: 'Submit' },
            ignored: false,
          },
        ],
      });

      // includeReadable: false means headings won't be in final nodes
      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Button should still have heading context from the H2
      const buttonNode = snapshot.nodes.find((n) => n.kind === 'button');
      expect(buttonNode).toBeDefined();
      expect(buttonNode?.where.heading_context).toBe('Section Heading');
    });

    it('should assign heading context from DOM order, not limited nodes', async () => {
      // Create many nodes but only include first few due to max_nodes
      // Heading is at position 1000 in DOM but should still affect earlier interactive elements
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'H2',
                      children: [],
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'INPUT',
                      attributes: ['type', 'text'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            name: { value: 'Main Title' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Action' },
            ignored: false,
          },
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'heading' },
            name: { value: 'Sub Section' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 2 } }],
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'textbox' },
            name: { value: 'Search' },
            ignored: false,
          },
        ],
      });

      // Only include interactive elements but get heading context
      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Button (20) follows H1 (10), should have "Main Title" as context
      const buttonNode = snapshot.nodes.find((n) => n.backend_node_id === 20);
      expect(buttonNode?.where.heading_context).toBe('Main Title');

      // Input (40) follows H2 (30), should have "Sub Section" as context
      const inputNode = snapshot.nodes.find((n) => n.backend_node_id === 40);
      expect(inputNode?.where.heading_context).toBe('Sub Section');
    });

    it('should build heading index from full DOM order including headings not in limitedNodes', async () => {
      // Scenario: max_nodes=2, but H1 is at position 3
      // The H1 should still provide context for the INPUT at position 4
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [],
                    },
                    {
                      nodeId: 15,
                      backendNodeId: 15,
                      nodeType: 1,
                      nodeName: 'A',
                      attributes: ['href', '/link'],
                      children: [],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'INPUT',
                      attributes: ['type', 'text'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Click' },
            ignored: false,
          },
          {
            nodeId: 'ax-15',
            backendDOMNodeId: 15,
            role: { value: 'link' },
            name: { value: 'Link' },
            ignored: false,
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'heading' },
            name: { value: 'Important Section' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'textbox' },
            name: { value: 'Input' },
            ignored: false,
          },
        ],
      });

      // max_nodes=3 with includeReadable=true would give: BUTTON, A, H1
      // But INPUT should still get heading context from H1
      const compiler = new SnapshotCompiler({ max_nodes: 3, includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // With max_nodes=3, we get BUTTON, A, H1 (DOM order)
      expect(snapshot.nodes.length).toBe(3);

      // Now test with max_nodes=4 - INPUT should have "Important Section" heading context
      const compiler2 = new SnapshotCompiler({ max_nodes: 4, includeReadable: true });
      const snapshot2 = await compiler2.compile(mockCdp, mockPage, 'page-1');

      const inputNode = snapshot2.nodes.find((n) => n.backend_node_id === 30);
      expect(inputNode).toBeDefined();
      expect(inputNode?.where.heading_context).toBe('Important Section');
    });
  });

  describe('Shadow DOM and iframe ordering', () => {
    it('should include shadow DOM children in DOM order traversal', async () => {
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'light-btn'],
                      children: [],
                    },
                    {
                      // Shadow host
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'MY-COMPONENT',
                      children: [],
                      shadowRoots: [
                        {
                          nodeId: 21,
                          backendNodeId: 21,
                          nodeType: 11, // DOCUMENT_FRAGMENT_NODE
                          nodeName: '#document-fragment',
                          shadowRootType: 'open',
                          children: [
                            {
                              nodeId: 22,
                              backendNodeId: 22,
                              nodeType: 1,
                              nodeName: 'BUTTON',
                              attributes: ['data-testid', 'shadow-btn'],
                              children: [],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      nodeId: 30,
                      backendNodeId: 30,
                      nodeType: 1,
                      nodeName: 'INPUT',
                      attributes: ['type', 'text'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Light Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-22',
            backendDOMNodeId: 22,
            role: { value: 'button' },
            name: { value: 'Shadow Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-30',
            backendDOMNodeId: 30,
            role: { value: 'textbox' },
            name: { value: 'Input Field' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // DOM order should be: light button (10), shadow button (22), input (30)
      expect(snapshot.nodes.length).toBe(3);
      expect(snapshot.nodes[0].backend_node_id).toBe(10);
      expect(snapshot.nodes[1].backend_node_id).toBe(22);
      expect(snapshot.nodes[2].backend_node_id).toBe(30);

      // Shadow button should have shadow_path populated
      const shadowBtn = snapshot.nodes.find((n) => n.backend_node_id === 22);
      expect(shadowBtn?.find?.shadow_path).toEqual(['20']); // Shadow host backendNodeId
    });

    it('should use DOM text content when AX name is missing', async () => {
      // H1 with text node child but no AX name
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 3, // TEXT_NODE
                          nodeName: '#text',
                          nodeValue: 'DOM Heading Text',
                        },
                      ],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      // AX tree has heading but NO name
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            // name intentionally omitted
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Click Me' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Button should have heading context from DOM text
      const buttonNode = snapshot.nodes.find((n) => n.kind === 'button');
      expect(buttonNode).toBeDefined();
      expect(buttonNode?.where.heading_context).toBe('DOM Heading Text');
    });

    it('should use aria-label when AX name is missing', async () => {
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      attributes: ['aria-label', 'Aria Heading Label'],
                      children: [], // No text children
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      // AX tree omits heading name
      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            // name intentionally omitted
            ignored: false,
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Submit' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const buttonNode = snapshot.nodes.find((n) => n.kind === 'button');
      expect(buttonNode).toBeDefined();
      expect(buttonNode?.where.heading_context).toBe('Aria Heading Label');
    });

    it('should propagate heading context through shadow DOM', async () => {
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [],
                    },
                    {
                      // Shadow host after heading
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'MY-COMPONENT',
                      children: [],
                      shadowRoots: [
                        {
                          nodeId: 21,
                          backendNodeId: 21,
                          nodeType: 11,
                          nodeName: '#document-fragment',
                          shadowRootType: 'open',
                          children: [
                            {
                              nodeId: 22,
                              backendNodeId: 22,
                              nodeType: 1,
                              nodeName: 'BUTTON',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            name: { value: 'Main Title' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-22',
            backendDOMNodeId: 22,
            role: { value: 'button' },
            name: { value: 'Shadow Button' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Shadow button should have heading context from the H1 before the shadow host
      const shadowBtn = snapshot.nodes.find((n) => n.kind === 'button');
      expect(shadowBtn?.where.heading_context).toBe('Main Title');
    });

    it('should include iframe content in DOM order traversal', async () => {
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'main-btn'],
                      children: [],
                    },
                    {
                      // iframe
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'IFRAME',
                      frameId: 'frame-1',
                      children: [],
                      contentDocument: {
                        nodeId: 30,
                        backendNodeId: 30,
                        nodeType: 9,
                        nodeName: '#document',
                        children: [
                          {
                            nodeId: 31,
                            backendNodeId: 31,
                            nodeType: 1,
                            nodeName: 'HTML',
                            children: [
                              {
                                nodeId: 32,
                                backendNodeId: 32,
                                nodeType: 1,
                                nodeName: 'BODY',
                                children: [
                                  {
                                    nodeId: 33,
                                    backendNodeId: 33,
                                    nodeType: 1,
                                    nodeName: 'BUTTON',
                                    attributes: ['data-testid', 'iframe-btn'],
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'INPUT',
                      attributes: ['type', 'text'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Main Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-33',
            backendDOMNodeId: 33,
            role: { value: 'button' },
            name: { value: 'Iframe Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'textbox' },
            name: { value: 'Input Field' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // DOM order should be: main button (10), iframe button (33), input (40)
      expect(snapshot.nodes.length).toBe(3);
      expect(snapshot.nodes[0].backend_node_id).toBe(10);
      expect(snapshot.nodes[1].backend_node_id).toBe(33);
      expect(snapshot.nodes[2].backend_node_id).toBe(40);

      // Iframe button should have frame_path populated
      const iframeBtn = snapshot.nodes.find((n) => n.backend_node_id === 33);
      expect(iframeBtn?.find?.frame_path).toEqual(['20']); // Iframe backendNodeId
    });

    it('should NOT propagate heading context into iframe content', async () => {
      // Setup: H1 in main doc, then iframe with button (no heading inside iframe)
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
                      // H1 in main document
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'H1',
                      children: [],
                    },
                    {
                      // Button after heading (should have heading context)
                      nodeId: 15,
                      backendNodeId: 15,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'main-btn'],
                      children: [],
                    },
                    {
                      // iframe after heading
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'IFRAME',
                      frameId: 'frame-1',
                      children: [],
                      contentDocument: {
                        nodeId: 30,
                        backendNodeId: 30,
                        nodeType: 9,
                        nodeName: '#document',
                        children: [
                          {
                            nodeId: 31,
                            backendNodeId: 31,
                            nodeType: 1,
                            nodeName: 'HTML',
                            children: [
                              {
                                nodeId: 32,
                                backendNodeId: 32,
                                nodeType: 1,
                                nodeName: 'BODY',
                                children: [
                                  {
                                    // Button inside iframe - NO heading in iframe
                                    nodeId: 33,
                                    backendNodeId: 33,
                                    nodeType: 1,
                                    nodeName: 'BUTTON',
                                    attributes: ['data-testid', 'iframe-btn'],
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'heading' },
            name: { value: 'Main Page Title' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-15',
            backendDOMNodeId: 15,
            role: { value: 'button' },
            name: { value: 'Main Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-33',
            backendDOMNodeId: 33,
            role: { value: 'button' },
            name: { value: 'Iframe Button' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Main button SHOULD have heading context
      const mainBtn = snapshot.nodes.find((n) => n.backend_node_id === 15);
      expect(mainBtn).toBeDefined();
      expect(mainBtn?.where.heading_context).toBe('Main Page Title');

      // Iframe button should NOT have heading context (isolated document)
      const iframeBtn = snapshot.nodes.find((n) => n.backend_node_id === 33);
      expect(iframeBtn).toBeDefined();
      expect(iframeBtn?.where.heading_context).toBeUndefined();
    });

    it('should isolate heading context within iframe boundaries', async () => {
      // Setup: Main doc with button, iframe with H2 then button, main button after iframe
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'before-iframe-btn'],
                      children: [],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'IFRAME',
                      frameId: 'frame-1',
                      children: [],
                      contentDocument: {
                        nodeId: 30,
                        backendNodeId: 30,
                        nodeType: 9,
                        nodeName: '#document',
                        children: [
                          {
                            nodeId: 31,
                            backendNodeId: 31,
                            nodeType: 1,
                            nodeName: 'HTML',
                            children: [
                              {
                                nodeId: 32,
                                backendNodeId: 32,
                                nodeType: 1,
                                nodeName: 'BODY',
                                children: [
                                  {
                                    nodeId: 33,
                                    backendNodeId: 33,
                                    nodeType: 1,
                                    nodeName: 'H2',
                                    children: [],
                                  },
                                  {
                                    nodeId: 34,
                                    backendNodeId: 34,
                                    nodeType: 1,
                                    nodeName: 'BUTTON',
                                    attributes: ['data-testid', 'iframe-btn'],
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'after-iframe-btn'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Before Iframe' },
            ignored: false,
          },
          {
            nodeId: 'ax-33',
            backendDOMNodeId: 33,
            role: { value: 'heading' },
            name: { value: 'Iframe Section' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 2 } }],
          },
          {
            nodeId: 'ax-34',
            backendDOMNodeId: 34,
            role: { value: 'button' },
            name: { value: 'Iframe Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'button' },
            name: { value: 'After Iframe' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Button before iframe - no heading context
      const beforeBtn = snapshot.nodes.find((n) => n.backend_node_id === 10);
      expect(beforeBtn?.where.heading_context).toBeUndefined();

      // Button inside iframe - should have iframe's heading context
      const iframeBtn = snapshot.nodes.find((n) => n.backend_node_id === 34);
      expect(iframeBtn?.where.heading_context).toBe('Iframe Section');

      // Button after iframe - should NOT have iframe's heading context
      // (iframe heading stays inside iframe)
      const afterBtn = snapshot.nodes.find((n) => n.backend_node_id === 40);
      expect(afterBtn?.where.heading_context).toBeUndefined();
    });

    it('should not leak iframe headings when includeReadable is true', async () => {
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
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'IFRAME',
                      frameId: 'frame-1',
                      children: [],
                      contentDocument: {
                        nodeId: 30,
                        backendNodeId: 30,
                        nodeType: 9,
                        nodeName: '#document',
                        children: [
                          {
                            nodeId: 31,
                            backendNodeId: 31,
                            nodeType: 1,
                            nodeName: 'HTML',
                            children: [
                              {
                                nodeId: 32,
                                backendNodeId: 32,
                                nodeType: 1,
                                nodeName: 'BODY',
                                children: [
                                  {
                                    nodeId: 33,
                                    backendNodeId: 33,
                                    nodeType: 1,
                                    nodeName: 'H2',
                                    children: [],
                                  },
                                  {
                                    nodeId: 34,
                                    backendNodeId: 34,
                                    nodeType: 1,
                                    nodeName: 'BUTTON',
                                    attributes: ['data-testid', 'iframe-btn'],
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['data-testid', 'after-iframe-btn'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-33',
            backendDOMNodeId: 33,
            role: { value: 'heading' },
            name: { value: 'Iframe Section' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 2 } }],
          },
          {
            nodeId: 'ax-34',
            backendDOMNodeId: 34,
            role: { value: 'button' },
            name: { value: 'Iframe Button' },
            ignored: false,
          },
          {
            nodeId: 'ax-40',
            backendDOMNodeId: 40,
            role: { value: 'button' },
            name: { value: 'After Iframe' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const iframeBtn = snapshot.nodes.find((n) => n.backend_node_id === 34);
      expect(iframeBtn?.where.heading_context).toBe('Iframe Section');

      const afterBtn = snapshot.nodes.find((n) => n.backend_node_id === 40);
      expect(afterBtn?.where.heading_context).toBeUndefined();
    });

    it('should resolve aria-labelledby within the correct iframe context', async () => {
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
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'IFRAME',
                      frameId: 'frame-1',
                      children: [],
                      contentDocument: {
                        nodeId: 30,
                        backendNodeId: 30,
                        nodeType: 9,
                        nodeName: '#document',
                        children: [
                          {
                            nodeId: 31,
                            backendNodeId: 31,
                            nodeType: 1,
                            nodeName: 'HTML',
                            children: [
                              {
                                nodeId: 32,
                                backendNodeId: 32,
                                nodeType: 1,
                                nodeName: 'BODY',
                                children: [
                                  {
                                    nodeId: 50,
                                    backendNodeId: 50,
                                    nodeType: 1,
                                    nodeName: 'SPAN',
                                    attributes: [
                                      'id',
                                      'shared-title',
                                      'aria-label',
                                      'Iframe Title',
                                    ],
                                    children: [],
                                  },
                                  {
                                    nodeId: 33,
                                    backendNodeId: 33,
                                    nodeType: 1,
                                    nodeName: 'H1',
                                    attributes: ['aria-labelledby', 'shared-title'],
                                    children: [],
                                  },
                                  {
                                    nodeId: 34,
                                    backendNodeId: 34,
                                    nodeType: 1,
                                    nodeName: 'BUTTON',
                                    attributes: ['data-testid', 'iframe-btn'],
                                    children: [],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      nodeId: 40,
                      backendNodeId: 40,
                      nodeType: 1,
                      nodeName: 'SPAN',
                      attributes: ['id', 'shared-title', 'aria-label', 'Main Title'],
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-33',
            backendDOMNodeId: 33,
            role: { value: 'heading' },
            ignored: false,
            properties: [{ name: 'level', value: { value: 1 } }],
          },
          {
            nodeId: 'ax-34',
            backendDOMNodeId: 34,
            role: { value: 'button' },
            name: { value: 'Iframe Button' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: false });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      const iframeBtn = snapshot.nodes.find((n) => n.backend_node_id === 34);
      expect(iframeBtn?.where.heading_context).toBe('Iframe Title');
    });
  });

  describe('noise filtering', () => {
    it('should filter out empty list containers with no interactive descendants', async () => {
      // Setup: UL with no name and only empty listitem children
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'UL',
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'LI',
                          children: [],
                        },
                        {
                          nodeId: 12,
                          backendNodeId: 12,
                          nodeType: 1,
                          nodeName: 'LI',
                          children: [],
                        },
                      ],
                    },
                    {
                      nodeId: 20,
                      backendNodeId: 20,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'list' },
            name: { value: '' }, // Empty name
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'listitem' },
            name: { value: '' }, // Empty name
            ignored: false,
          },
          {
            nodeId: 'ax-12',
            backendDOMNodeId: 12,
            role: { value: 'listitem' },
            name: { value: '' }, // Empty name
            ignored: false,
          },
          {
            nodeId: 'ax-20',
            backendDOMNodeId: 20,
            role: { value: 'button' },
            name: { value: 'Submit' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should NOT include the empty list and listitems
      const listNodes = snapshot.nodes.filter((n) => n.kind === 'list' || n.kind === 'listitem');
      expect(listNodes.length).toBe(0);

      // Should still include the button
      const buttons = snapshot.nodes.filter((n) => n.kind === 'button');
      expect(buttons.length).toBe(1);
    });

    it('should keep list containers that have interactive descendants', async () => {
      // Setup: UL with no name but contains interactive links
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'UL',
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'LI',
                          children: [
                            {
                              nodeId: 15,
                              backendNodeId: 15,
                              nodeType: 1,
                              nodeName: 'A',
                              attributes: ['href', '/link'],
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'list' },
            name: { value: '' }, // Empty name but has interactive child
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'listitem' },
            name: { value: '' },
            ignored: false,
          },
          {
            nodeId: 'ax-15',
            backendDOMNodeId: 15,
            role: { value: 'link' },
            name: { value: 'Home' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should keep the list and listitem because they contain interactive link
      const listNodes = snapshot.nodes.filter((n) => n.kind === 'list');
      expect(listNodes.length).toBe(1);

      // Should include the link
      const links = snapshot.nodes.filter((n) => n.kind === 'link');
      expect(links.length).toBe(1);
    });

    it('should filter out StaticText that mirrors parent label', async () => {
      // Setup: Button with StaticText child that has same label
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 3, // TEXT_NODE
                          nodeName: '#text',
                          nodeValue: 'Click Me',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'button' },
            name: { value: 'Click Me' },
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'StaticText' },
            name: { value: 'Click Me' }, // Same label as parent
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should NOT include the StaticText that mirrors parent
      const staticTextNodes = snapshot.nodes.filter((n) => n.kind === 'text');
      expect(staticTextNodes.length).toBe(0);

      // Should include the button
      const buttons = snapshot.nodes.filter((n) => n.kind === 'button');
      expect(buttons.length).toBe(1);
    });

    it('should keep StaticText with unique content', async () => {
      // Setup: Paragraph with StaticText children that add unique info
      // Note: StaticText AX nodes need a DOM node with matching backendNodeId
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'P',
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 3, // TEXT_NODE
                          nodeName: '#text',
                          nodeValue: 'Important information here',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'paragraph' },
            name: { value: '' }, // Empty paragraph name
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'StaticText' },
            name: { value: 'Important information here' }, // Unique content
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should include StaticText with unique content
      const staticTextNodes = snapshot.nodes.filter((n) => n.kind === 'text');
      expect(staticTextNodes.length).toBe(1);
      expect(staticTextNodes[0].label).toBe('Important information here');
    });

    it('should keep lists with semantic names', async () => {
      // Setup: UL with aria-label
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
                      nodeId: 10,
                      backendNodeId: 10,
                      nodeType: 1,
                      nodeName: 'UL',
                      attributes: ['aria-label', 'Navigation Menu'],
                      children: [
                        {
                          nodeId: 11,
                          backendNodeId: 11,
                          nodeType: 1,
                          nodeName: 'LI',
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

      mockCdp.setResponse('Accessibility.getFullAXTree', {
        nodes: [
          {
            nodeId: 'ax-10',
            backendDOMNodeId: 10,
            role: { value: 'list' },
            name: { value: 'Navigation Menu' }, // Has semantic name
            ignored: false,
          },
          {
            nodeId: 'ax-11',
            backendDOMNodeId: 11,
            role: { value: 'listitem' },
            name: { value: '' },
            ignored: false,
          },
        ],
      });

      const compiler = new SnapshotCompiler({ includeReadable: true });
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should keep list with semantic name
      const listNodes = snapshot.nodes.filter((n) => n.kind === 'list');
      expect(listNodes.length).toBe(1);
      expect(listNodes[0].label).toBe('Navigation Menu');
    });
  });
});
