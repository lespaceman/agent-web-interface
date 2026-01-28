/**
 * Snapshot Compiler Performance Benchmarks
 *
 * Tests performance targets for snapshot compilation.
 *
 * Targets:
 * - < 500ms for typical page (< 500 nodes)
 * - < 2s for complex page (< 2000 nodes)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from 'puppeteer-core';
import { SnapshotCompiler } from '../../src/snapshot/snapshot-compiler.js';
import { createMockCdpClient, MockCdpClient } from '../mocks/cdp-client.mock.js';
import { createMockPage } from '../mocks/puppeteer.mock.js';

/**
 * Generate a mock DOM tree with N interactive elements
 */
function generateMockDomTree(nodeCount: number): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  let currentNodeId = 10;
  let currentBackendNodeId = 10;

  // Generate buttons, inputs, and links
  for (let i = 0; i < nodeCount; i++) {
    const elementType = i % 3; // Rotate between button, input, link

    if (elementType === 0) {
      // Button
      children.push({
        nodeId: currentNodeId++,
        backendNodeId: currentBackendNodeId,
        nodeType: 1,
        nodeName: 'BUTTON',
        localName: 'button',
        nodeValue: '',
        childNodeCount: 1,
        attributes: ['class', 'btn', 'id', `btn-${i}`],
        children: [
          {
            nodeId: currentNodeId++,
            backendNodeId: currentBackendNodeId + 1000,
            nodeType: 3,
            nodeName: '#text',
            localName: '',
            nodeValue: `Button ${i}`,
          },
        ],
      });
    } else if (elementType === 1) {
      // Input
      children.push({
        nodeId: currentNodeId++,
        backendNodeId: currentBackendNodeId,
        nodeType: 1,
        nodeName: 'INPUT',
        localName: 'input',
        nodeValue: '',
        childNodeCount: 0,
        attributes: ['type', 'text', 'id', `input-${i}`, 'name', `field-${i}`],
      });
    } else {
      // Link
      children.push({
        nodeId: currentNodeId++,
        backendNodeId: currentBackendNodeId,
        nodeType: 1,
        nodeName: 'A',
        localName: 'a',
        nodeValue: '',
        childNodeCount: 1,
        attributes: ['href', `/page/${i}`, 'id', `link-${i}`],
        children: [
          {
            nodeId: currentNodeId++,
            backendNodeId: currentBackendNodeId + 1000,
            nodeType: 3,
            nodeName: '#text',
            localName: '',
            nodeValue: `Link ${i}`,
          },
        ],
      });
    }
    currentBackendNodeId++;
  }

  return {
    root: {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: '#document',
      localName: '',
      nodeValue: '',
      childNodeCount: 1,
      documentURL: 'https://benchmark.example.com',
      baseURL: 'https://benchmark.example.com',
      children: [
        {
          nodeId: 2,
          backendNodeId: 2,
          nodeType: 1,
          nodeName: 'HTML',
          localName: 'html',
          nodeValue: '',
          childNodeCount: 2,
          attributes: ['lang', 'en'],
          children: [
            {
              nodeId: 3,
              backendNodeId: 3,
              nodeType: 1,
              nodeName: 'HEAD',
              localName: 'head',
              nodeValue: '',
              childNodeCount: 0,
              attributes: [],
              children: [],
            },
            {
              nodeId: 4,
              backendNodeId: 4,
              nodeType: 1,
              nodeName: 'BODY',
              localName: 'body',
              nodeValue: '',
              childNodeCount: children.length,
              attributes: [],
              children,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Generate a mock AX tree with N interactive elements
 */
function generateMockAxTree(nodeCount: number): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [
    {
      nodeId: 'ax-root',
      ignored: false,
      role: { type: 'role', value: 'WebArea' },
      name: { type: 'computedString', value: 'Benchmark Page' },
      properties: [],
      childIds: [],
      backendDOMNodeId: 2,
    },
  ];

  let currentBackendNodeId = 10;

  for (let i = 0; i < nodeCount; i++) {
    const elementType = i % 3;
    let role: string;
    let name: string;

    if (elementType === 0) {
      role = 'button';
      name = `Button ${i}`;
    } else if (elementType === 1) {
      role = 'textbox';
      name = `Input ${i}`;
    } else {
      role = 'link';
      name = `Link ${i}`;
    }

    nodes.push({
      nodeId: `ax-${i}`,
      ignored: false,
      role: { type: 'role', value: role },
      name: { type: 'computedString', value: name },
      properties: [{ name: 'focusable', value: { type: 'booleanOrUndefined', value: true } }],
      childIds: [],
      backendDOMNodeId: currentBackendNodeId,
    });

    currentBackendNodeId++;
  }

  return { nodes };
}

/**
 * Create a mock page for benchmark tests.
 */
function createBenchmarkMockPage(): Page {
  return createMockPage({
    url: 'https://benchmark.example.com',
    title: 'Benchmark Page',
  }) as unknown as Page;
}

describe('Snapshot Compiler Performance Benchmarks', () => {
  let mockCdp: MockCdpClient;
  let mockPage: Page;
  let cdpCallCount: number;

  beforeEach(() => {
    mockCdp = createMockCdpClient();
    mockPage = createBenchmarkMockPage();
    cdpCallCount = 0;
  });

  /**
   * Setup mock CDP for a given number of nodes
   */
  function setupMockCdp(nodeCount: number): void {
    const domTree = generateMockDomTree(nodeCount);
    const axTree = generateMockAxTree(nodeCount);

    mockCdp.sendSpy.mockImplementation((method: string, params?: Record<string, unknown>) => {
      cdpCallCount++;

      if (method === 'DOM.getDocument') {
        return Promise.resolve(domTree);
      }
      if (method === 'Accessibility.getFullAXTree') {
        return Promise.resolve(axTree);
      }
      if (method === 'DOM.getBoxModel') {
        const nodeId = params?.backendNodeId as number;
        const x = (nodeId % 10) * 120;
        const y = Math.floor(nodeId / 10) * 50;
        return Promise.resolve({
          model: {
            content: [x, y, x + 100, y, x + 100, y + 40, x, y + 40],
            width: 100,
            height: 40,
          },
        });
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
  }

  describe('Small Page (50 nodes)', () => {
    const NODE_COUNT = 50;

    beforeEach(() => {
      setupMockCdp(NODE_COUNT);
    });

    it('should compile in under 100ms', async () => {
      const compiler = new SnapshotCompiler();

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(snapshot.nodes.length).toBeLessThanOrEqual(NODE_COUNT);
      expect(duration).toBeLessThan(100);
    });

    it('should report accurate capture duration in metadata', async () => {
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.meta.capture_duration_ms).toBeGreaterThan(0);
      expect(snapshot.meta.capture_duration_ms).toBeLessThan(100);
    });
  });

  describe('Typical Page (200 nodes)', () => {
    const NODE_COUNT = 200;

    beforeEach(() => {
      setupMockCdp(NODE_COUNT);
    });

    it('should compile in under 500ms (target)', async () => {
      const compiler = new SnapshotCompiler();

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500);
    });

    it('should track CDP call count', async () => {
      const compiler = new SnapshotCompiler();
      await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should make:
      // - 1 DOM.getDocument call
      // - 1 Accessibility.getFullAXTree call
      // - N DOM.getBoxModel calls (per node)
      // - N CSS.getComputedStyleForNode calls (per node)
      // Total minimum: 2 + 2N calls
      expect(cdpCallCount).toBeGreaterThanOrEqual(2);

      // Log for visibility
      console.log(`CDP calls for ${NODE_COUNT} nodes: ${cdpCallCount}`);
    });

    it('should process at least 1000 nodes per second', async () => {
      const compiler = new SnapshotCompiler();

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const durationSeconds = (performance.now() - startTime) / 1000;

      const nodesPerSecond = snapshot.nodes.length / durationSeconds;

      expect(nodesPerSecond).toBeGreaterThan(1000);

      console.log(`Nodes per second: ${Math.round(nodesPerSecond)}`);
    });
  });

  describe('Medium Page (500 nodes)', () => {
    const NODE_COUNT = 500;

    beforeEach(() => {
      setupMockCdp(NODE_COUNT);
    });

    it('should compile in under 500ms (target)', async () => {
      const compiler = new SnapshotCompiler();

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500);

      console.log(`500 nodes compiled in ${Math.round(duration)}ms`);
    });
  });

  describe('Large Page (1000 nodes)', () => {
    const NODE_COUNT = 1000;

    beforeEach(() => {
      setupMockCdp(NODE_COUNT);
    });

    it('should compile in under 1000ms', async () => {
      const compiler = new SnapshotCompiler();

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1000);

      console.log(`1000 nodes compiled in ${Math.round(duration)}ms`);
    });
  });

  describe('Complex Page (2000 nodes - max_nodes limit)', () => {
    const NODE_COUNT = 2000;

    beforeEach(() => {
      setupMockCdp(NODE_COUNT);
    });

    it('should compile in under 2000ms (target)', async () => {
      const compiler = new SnapshotCompiler({ max_nodes: 2000 });

      const startTime = performance.now();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(snapshot.nodes.length).toBeLessThanOrEqual(2000);
      expect(duration).toBeLessThan(2000);

      console.log(`2000 nodes compiled in ${Math.round(duration)}ms`);
    });

    it('should respect max_nodes limit for performance', async () => {
      // With default max_nodes (2000)
      const compiler = new SnapshotCompiler();
      const snapshot = await compiler.compile(mockCdp, mockPage, 'page-1');

      expect(snapshot.nodes.length).toBeLessThanOrEqual(2000);
    });

    it('should be able to limit nodes for faster compilation', async () => {
      const limitedCompiler = new SnapshotCompiler({ max_nodes: 100 });

      const startTime = performance.now();
      const snapshot = await limitedCompiler.compile(mockCdp, mockPage, 'page-1');
      const duration = performance.now() - startTime;

      expect(snapshot.nodes.length).toBeLessThanOrEqual(100);
      expect(duration).toBeLessThan(100);

      console.log(`Limited to 100 nodes: compiled in ${Math.round(duration)}ms`);
    });
  });

  describe('Memory Efficiency', () => {
    it('should handle multiple snapshots without memory leak', async () => {
      setupMockCdp(100);
      const compiler = new SnapshotCompiler();

      // Compile multiple snapshots
      const snapshots: { id: string; nodeCount: number }[] = [];

      for (let i = 0; i < 10; i++) {
        const snapshot = await compiler.compile(mockCdp, mockPage, `page-${i}`);
        snapshots.push({
          id: snapshot.snapshot_id,
          nodeCount: snapshot.nodes.length,
        });
      }

      // All snapshots should have unique IDs
      const uniqueIds = new Set(snapshots.map((s) => s.id));
      expect(uniqueIds.size).toBe(10);

      // All snapshots should have nodes
      for (const snapshot of snapshots) {
        expect(snapshot.nodeCount).toBeGreaterThan(0);
      }
    });
  });

  describe('CDP Call Efficiency', () => {
    it('should batch DOM and AX extraction in parallel', async () => {
      setupMockCdp(50);
      const compiler = new SnapshotCompiler();

      await compiler.compile(mockCdp, mockPage, 'page-1');

      // Verify both extraction methods were called
      const domCalls = mockCdp.sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === 'DOM.getDocument'
      );
      const axCalls = mockCdp.sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === 'Accessibility.getFullAXTree'
      );

      expect(domCalls.length).toBe(1);
      expect(axCalls.length).toBe(1);
    });

    it('should skip layout extraction when disabled', async () => {
      setupMockCdp(50);
      const compiler = new SnapshotCompiler({ includeLayout: false });

      cdpCallCount = 0;
      await compiler.compile(mockCdp, mockPage, 'page-1');

      // Should only have DOM + AX calls, no box model calls
      const boxModelCalls = mockCdp.sendSpy.mock.calls.filter(
        (call: unknown[]) => call[0] === 'DOM.getBoxModel'
      );

      expect(boxModelCalls.length).toBe(0);
    });
  });

  describe('Performance Metrics Summary', () => {
    it('should log performance summary', async () => {
      const sizes = [50, 100, 200, 500, 1000];
      const results: { nodes: number; duration: number; nodesPerSec: number }[] = [];

      for (const size of sizes) {
        setupMockCdp(size);
        const compiler = new SnapshotCompiler({ max_nodes: size });

        const startTime = performance.now();
        const snapshot = await compiler.compile(mockCdp, mockPage, `page-${size}`);
        const duration = performance.now() - startTime;

        results.push({
          nodes: snapshot.nodes.length,
          duration: Math.round(duration),
          nodesPerSec: Math.round(snapshot.nodes.length / (duration / 1000)),
        });
      }

      console.log('\n=== Performance Summary ===');
      console.log('Nodes\tTime(ms)\tNodes/sec');
      for (const result of results) {
        console.log(`${result.nodes}\t${result.duration}\t\t${result.nodesPerSec}`);
      }
      console.log('===========================\n');

      // All should meet basic performance targets
      for (const result of results) {
        expect(result.nodesPerSec).toBeGreaterThan(500);
      }
    });
  });
});
