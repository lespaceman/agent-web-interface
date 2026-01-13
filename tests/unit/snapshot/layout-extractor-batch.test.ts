import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractLayout } from '../../../src/snapshot/extractors/layout-extractor.js';
import type {
  ExtractorContext,
  RawDomNode,
  LayoutExtractionResult,
} from '../../../src/snapshot/extractors/types.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

// Define a type for CDP params to avoid 'any'
interface CdpParams {
  expression?: string;
  backendNodeId?: number;
}

// Define mock type using interface
type CdpSendFn = (method: string, params?: unknown) => Promise<unknown>;
interface MockCdp {
  send: ReturnType<typeof vi.fn<CdpSendFn>>;
}

describe('extractLayout (Batch Strategy)', () => {
  let mockCdp: MockCdp;
  let ctx: ExtractorContext;
  let domNodes: Map<number, RawDomNode>;

  beforeEach(() => {
    mockCdp = {
      send: vi.fn<CdpSendFn>(),
    };
    ctx = {
      cdp: mockCdp as unknown as CdpClient,
      viewport: { width: 1000, height: 1000 },
      options: {},
    };

    // Build a mock DOM tree
    // 1: #document
    //   2: HTML
    //     3: BODY
    //       4: DIV (child 1)
    //         5: SPAN
    //       6: DIV-HOST (child 2)
    //         7: #shadow-root (Type 11)
    //           8: BUTTON
    domNodes = new Map<number, RawDomNode>();

    const nodes: RawDomNode[] = [
      { nodeId: 1, backendNodeId: 1, nodeName: '#document', nodeType: 9, childNodeIds: [2] },
      {
        nodeId: 2,
        backendNodeId: 2,
        nodeName: 'HTML',
        nodeType: 1,
        parentId: 1,
        childNodeIds: [3],
      },
      {
        nodeId: 3,
        backendNodeId: 3,
        nodeName: 'BODY',
        nodeType: 1,
        parentId: 2,
        childNodeIds: [4, 6],
      },
      { nodeId: 4, backendNodeId: 4, nodeName: 'DIV', nodeType: 1, parentId: 3, childNodeIds: [5] },
      { nodeId: 5, backendNodeId: 5, nodeName: 'SPAN', nodeType: 1, parentId: 4, childNodeIds: [] },
      {
        nodeId: 6,
        backendNodeId: 6,
        nodeName: 'DIV-HOST',
        nodeType: 1,
        parentId: 3,
        childNodeIds: [],
        shadowRootType: 'open',
      },
      {
        nodeId: 7,
        backendNodeId: 7,
        nodeName: '#shadow-root',
        nodeType: 11,
        parentId: 6,
        childNodeIds: [8],
      },
      {
        nodeId: 8,
        backendNodeId: 8,
        nodeName: 'BUTTON',
        nodeType: 1,
        parentId: 7,
        childNodeIds: [],
      },
    ];

    nodes.forEach((n: RawDomNode) => domNodes.set(n.backendNodeId, n));
  });

  it('should use batch extraction for standard nodes', async () => {
    // Setup mock response for Runtime.evaluate
    mockCdp.send.mockImplementation((method: string, params?: unknown) => {
      const p = params as CdpParams;
      if (method === 'Runtime.evaluate') {
        const expr = p.expression ?? '';

        // Verify path for Node 5 (SPAN)
        expect(expr).toContain(
          'html:nth-child(1) > body:nth-child(1) > div:nth-child(1) > span:nth-child(1)'
        );

        return Promise.resolve({
          result: {
            value: [{ x: 10, y: 10, w: 100, h: 20, display: 'block', visibility: 'visible' }],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected method: ${method}`));
    });

    const result: LayoutExtractionResult = await extractLayout(ctx, [5], domNodes);

    expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.anything());
    expect(mockCdp.send).not.toHaveBeenCalledWith('DOM.getBoxModel', expect.anything());

    // Safety check derived values
    const layout = result.layouts.get(5);
    expect(layout).toBeDefined();
    if (layout) {
      expect(layout).toEqual({
        bbox: { x: 10, y: 10, w: 100, h: 20 },
        display: 'block',
        visibility: 'visible',
        isVisible: true,
        screenZone: 'top-left', // Calculated from bbox/viewport
      });
    }
  });

  it('should generate correct paths for Shadow DOM elements', async () => {
    mockCdp.send.mockImplementation((method: string, params?: unknown) => {
      const p = params as CdpParams;
      if (method === 'Runtime.evaluate') {
        const expr = p.expression ?? '';

        const expectedHostSelector =
          'html:nth-child(1) > body:nth-child(1) > div-host:nth-child(2)';
        const expectedShadowSelector = 'button:nth-child(1)';

        expect(expr).toContain(expectedHostSelector);
        expect(expr).toContain(expectedShadowSelector);

        return Promise.resolve({
          result: {
            value: [{ x: 50, y: 50, w: 20, h: 20, display: 'inline-block', visibility: 'visible' }],
          },
        });
      }
      return Promise.resolve({});
    });

    await extractLayout(ctx, [8], domNodes);
    expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.anything());
  });

  it('should fall back to individual calls if batch returns null', async () => {
    mockCdp.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({
          result: {
            value: [null], // Failed to resolve in batch
          },
        });
      }
      if (method === 'DOM.getBoxModel') {
        return Promise.resolve({
          model: {
            content: [0, 0, 10, 0, 10, 10, 0, 10],
            width: 10,
            height: 10,
          },
        });
      }
      return Promise.resolve({});
    });

    const result: LayoutExtractionResult = await extractLayout(ctx, [5], domNodes);

    expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.anything());
    expect(mockCdp.send).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 5 });

    const layout = result.layouts.get(5);
    expect(layout).toBeDefined();
    expect(layout?.bbox.w).toBe(10);
  });

  it('should fall back if Runtime.evaluate fails entirely', async () => {
    mockCdp.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') {
        return Promise.reject(new Error('Script failed'));
      }
      if (method === 'DOM.getBoxModel') {
        return Promise.resolve({
          model: {
            content: [0, 0, 10, 0, 10, 10, 0, 10],
            width: 10,
            height: 10,
          },
        });
      }
      return Promise.resolve({});
    });

    const result: LayoutExtractionResult = await extractLayout(ctx, [5], domNodes);

    expect(mockCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.anything());
    expect(mockCdp.send).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 5 });

    expect(result.layouts.get(5)).toBeDefined();
  });
});
