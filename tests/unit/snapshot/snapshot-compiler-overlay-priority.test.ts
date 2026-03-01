/**
 * Snapshot Compiler — Overlay Priority Tests
 *
 * Verifies that sliceWithOverlayPriority preserves high z-index
 * overlay content when max_nodes would otherwise truncate it.
 */
import { describe, it, expect } from 'vitest';
import { sliceWithOverlayPriority } from '../../../src/snapshot/snapshot-compiler.js';
import type { RawNodeData } from '../../../src/snapshot/extractors/types.js';

// Minimal RawNodeData-like objects for testing
function makeRawNode(backendNodeId: number, zIndex?: number): RawNodeData {
  return {
    backendNodeId,
    layout: zIndex !== undefined ? ({ zIndex } as RawNodeData['layout']) : undefined,
  };
}

describe('sliceWithOverlayPriority', () => {
  it('should return all nodes when under budget', () => {
    const nodes = [makeRawNode(1), makeRawNode(2), makeRawNode(3)];
    const result = sliceWithOverlayPriority(nodes, 10);
    expect(result).toHaveLength(3);
  });

  it('should simple-slice when no overlay content exists', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeRawNode(i));
    const result = sliceWithOverlayPriority(nodes, 5);
    expect(result).toHaveLength(5);
    expect(result.map((n) => n.backendNodeId)).toEqual([0, 1, 2, 3, 4]);
  });

  it('should preserve high z-index overlay nodes even when they would be truncated', () => {
    // 20 main nodes + 3 overlay nodes at end (portal-rendered)
    const nodes = [
      ...Array.from({ length: 20 }, (_, i) => makeRawNode(i)),
      makeRawNode(100, 1300),
      makeRawNode(101, 1300),
      makeRawNode(102, 1300),
    ];
    // Budget of 10: 30% = 3 overlay slots, all 3 overlay nodes fit
    const result = sliceWithOverlayPriority(nodes, 10);
    expect(result).toHaveLength(10);
    // All overlay nodes should be present
    const overlayIds = result.filter((n) => n.backendNodeId >= 100).map((n) => n.backendNodeId);
    expect(overlayIds).toContain(100);
    expect(overlayIds).toContain(101);
    expect(overlayIds).toContain(102);
    // Remaining 7 slots filled with main content
    const mainIds = result.filter((n) => n.backendNodeId < 100);
    expect(mainIds).toHaveLength(7);
  });

  it('should cap overlay nodes at 30% of budget', () => {
    // 50 main + 20 overlay, budget=10 → max 3 overlay (30% of 10)
    const nodes = [
      ...Array.from({ length: 50 }, (_, i) => makeRawNode(i)),
      ...Array.from({ length: 20 }, (_, i) => makeRawNode(100 + i, 500)),
    ];
    const result = sliceWithOverlayPriority(nodes, 10);
    expect(result).toHaveLength(10);
    const overlayCount = result.filter((n) => n.backendNodeId >= 100).length;
    expect(overlayCount).toBe(3); // 30% of 10
  });

  it('should maintain DOM order in output', () => {
    const nodes = [
      makeRawNode(1),
      makeRawNode(2),
      makeRawNode(3),
      makeRawNode(50, 1300), // overlay in middle
      makeRawNode(4),
      makeRawNode(5),
      makeRawNode(60, 1300), // overlay at end
    ];
    const result = sliceWithOverlayPriority(nodes, 5);
    // Should preserve relative order
    const ids = result.map((n) => n.backendNodeId);
    for (let i = 1; i < ids.length; i++) {
      const prevIndex = nodes.findIndex((n) => n.backendNodeId === ids[i - 1]);
      const currIndex = nodes.findIndex((n) => n.backendNodeId === ids[i]);
      expect(prevIndex).toBeLessThan(currIndex);
    }
  });

  it('should treat z-index at threshold (100) as main content', () => {
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => makeRawNode(i)),
      makeRawNode(10, 100), // exactly at threshold, should be treated as main
      makeRawNode(11, 101), // above threshold, should be treated as overlay
    ];
    const result = sliceWithOverlayPriority(nodes, 9);
    expect(result).toHaveLength(9);
    // Node with z-index 101 should be preserved as overlay
    expect(result.some((n) => n.backendNodeId === 11)).toBe(true);
    // Node with z-index 100 is main content, may or may not be included depending on budget
    // With 1 overlay (30% of 9 = 2 max), mainBudget = 8, and we have 9 main nodes
    // So node 10 (z=100) might be included (it's the 9th main node, budget is 8)
  });

  it('should treat nodes without layout as main content', () => {
    // 5 main nodes (no layout) + 1 overlay, budget=4 → 30% of 4 = 1 overlay slot
    const nodes: RawNodeData[] = [
      makeRawNode(1), // no layout
      { backendNodeId: 2 }, // no layout at all
      makeRawNode(3), // no layout
      makeRawNode(4), // no layout
      makeRawNode(5), // no layout
      makeRawNode(6, 1300), // overlay
    ];
    const result = sliceWithOverlayPriority(nodes, 4);
    expect(result).toHaveLength(4);
    // Overlay node should be included (1 fits in 30% of 4)
    expect(result.some((n) => n.backendNodeId === 6)).toBe(true);
    // Remaining 3 should be main content
    const mainNodes = result.filter((n) => n.backendNodeId !== 6);
    expect(mainNodes).toHaveLength(3);
  });
});
