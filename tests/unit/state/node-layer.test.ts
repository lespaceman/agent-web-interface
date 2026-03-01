/**
 * Node Layer Assignment Tests
 */
import { describe, it, expect } from 'vitest';
import { getNodeLayer, INCLUSIVE_OVERLAY_LAYERS } from '../../../src/state/node-layer.js';
import type { ReadableNode } from '../../../src/snapshot/snapshot.types.js';

function makeNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: '1',
    backend_node_id: 100,
    frame_id: 'main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Test',
    where: { region: 'main' },
    layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
    state: { visible: true, enabled: true },
    find: { primary: '#test', alternates: [] },
    ...overrides,
  } as ReadableNode;
}

describe('INCLUSIVE_OVERLAY_LAYERS', () => {
  it('should contain popover and drawer', () => {
    expect(INCLUSIVE_OVERLAY_LAYERS.has('popover')).toBe(true);
    expect(INCLUSIVE_OVERLAY_LAYERS.has('drawer')).toBe(true);
  });

  it('should not contain modal or main', () => {
    expect(INCLUSIVE_OVERLAY_LAYERS.has('modal')).toBe(false);
    expect(INCLUSIVE_OVERLAY_LAYERS.has('main')).toBe(false);
  });
});

describe('getNodeLayer', () => {
  it('should return "main" for nodes in main region', () => {
    const node = makeNode({ where: { region: 'main' } });
    expect(getNodeLayer(node)).toBe('main');
  });

  it('should return "modal" for nodes in dialog region', () => {
    const node = makeNode({ where: { region: 'dialog' } });
    expect(getNodeLayer(node)).toBe('modal');
  });

  it('should return "main" for nodes with unknown region (default)', () => {
    const node = makeNode({ where: { region: 'unknown' } });
    expect(getNodeLayer(node)).toBe('main');
  });

  describe('with activeLayer context', () => {
    it('should return "popover" for high z-index nodes when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 1300 },
      });
      expect(getNodeLayer(node, 'popover')).toBe('popover');
    });

    it('should return "drawer" for high z-index nodes when activeLayer is drawer', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 500 },
      });
      expect(getNodeLayer(node, 'drawer')).toBe('drawer');
    });

    it('should return "main" for nodes with undefined z-index when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: undefined },
      });
      expect(getNodeLayer(node, 'popover')).toBe('main');
    });

    it('should return "main" for z-index 0 when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 0 },
      });
      expect(getNodeLayer(node, 'popover')).toBe('main');
    });

    it('should return "main" for z-index at threshold (1) when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 1 },
      });
      expect(getNodeLayer(node, 'popover')).toBe('main');
    });

    it('should return "popover" for z-index just above threshold (2) when activeLayer is popover', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 2 },
      });
      expect(getNodeLayer(node, 'popover')).toBe('popover');
    });

    it('should return "modal" for dialog region regardless of activeLayer', () => {
      const node = makeNode({ where: { region: 'dialog' } });
      expect(getNodeLayer(node, 'popover')).toBe('modal');
    });

    it('should return "main" for nodes when activeLayer is main (no change)', () => {
      const node = makeNode({
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 200, h: 300 }, zIndex: 1300 },
      });
      expect(getNodeLayer(node, 'main')).toBe('main');
    });
  });
});
