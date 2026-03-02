/**
 * Canvas Snapshot Support Tests
 *
 * Tests that canvas elements appear in compiled snapshots.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotCompiler } from '../../../src/snapshot/snapshot-compiler.js';
import { createMockCdpClient, MockCdpClient } from '../../mocks/cdp-client.mock.js';
import type { Page } from 'puppeteer-core';
import { createMockPage } from '../../mocks/puppeteer.mock.js';
import { isInteractiveNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Setup CDP mocks with a canvas element in the DOM.
 * The AX tree does NOT include the canvas (simulating Chrome's behavior
 * where canvas is classified as generic/ignored).
 */
function setupCanvasCdpMocks(mockCdp: MockCdpClient): void {
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
                  nodeName: 'MAIN',
                  children: [
                    {
                      nodeId: 5,
                      backendNodeId: 5,
                      nodeType: 1,
                      nodeName: 'BUTTON',
                      attributes: ['type', 'submit'],
                      children: [],
                    },
                    {
                      nodeId: 6,
                      backendNodeId: 6,
                      nodeType: 1,
                      nodeName: 'CANVAS',
                      attributes: ['width', '800', 'height', '600', 'aria-label', 'Drawing area'],
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

  // AX tree does NOT include canvas node — simulates Chrome ignoring it
  mockCdp.setResponse('Accessibility.getFullAXTree', {
    nodes: [
      {
        nodeId: 'ax-1',
        backendDOMNodeId: 1,
        role: { value: 'WebArea' },
        name: { value: 'Canvas Test' },
        ignored: false,
        childIds: ['ax-5'],
      },
      {
        nodeId: 'ax-5',
        backendDOMNodeId: 5,
        role: { value: 'button' },
        name: { value: 'Submit' },
        ignored: false,
        properties: [{ name: 'focusable', value: { value: true } }],
      },
      // Canvas element is NOT in the AX tree (classified as generic/ignored by Chrome)
    ],
  });

  mockCdp.setResponse('DOM.getBoxModel', {
    model: {
      content: [100, 100, 900, 100, 900, 700, 100, 700],
      width: 800,
      height: 600,
    },
  });

  mockCdp.setResponse('CSS.getComputedStyleForNode', {
    computedStyle: [
      { name: 'display', value: 'block' },
      { name: 'visibility', value: 'visible' },
    ],
  });
}

describe('Canvas Snapshot Support', () => {
  let mockCdp: MockCdpClient;
  let mockPage: Page;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
    mockPage = createMockPage({
      url: 'https://example.com/draw',
      title: 'Canvas Test',
    }) as unknown as Page;
    setupCanvasCdpMocks(mockCdp);
  });

  it('should include canvas node in compiled snapshot', async () => {
    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const canvasNodes = snapshot.nodes.filter((n) => n.kind === 'canvas');
    expect(canvasNodes.length).toBe(1);
  });

  it('should resolve canvas label from aria-label', async () => {
    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const canvasNode = snapshot.nodes.find((n) => n.kind === 'canvas');
    expect(canvasNode).toBeDefined();
    expect(canvasNode!.label).toBe('Drawing area');
  });

  it('should classify canvas as interactive via isInteractiveNode', async () => {
    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const canvasNode = snapshot.nodes.find((n) => n.kind === 'canvas');
    expect(canvasNode).toBeDefined();
    expect(isInteractiveNode(canvasNode!)).toBe(true);
  });

  it('should count canvas in interactive_count', async () => {
    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    // Should count both the button and the canvas
    expect(snapshot.meta.interactive_count).toBeGreaterThanOrEqual(2);
  });

  it('should include canvas in DOM-only fallback when AX tree is empty', async () => {
    // Override AX tree to return empty (simulates AX extraction failure)
    mockCdp.setResponse('Accessibility.getFullAXTree', { nodes: [] });

    const compiler = new SnapshotCompiler();
    const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

    const canvasNodes = snapshot.nodes.filter((n) => n.kind === 'canvas');
    expect(canvasNodes.length).toBe(1);
  });
});
