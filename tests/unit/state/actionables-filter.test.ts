/**
 * Actionables Filter Tests
 *
 * Tests for selectActionables including implicitly interactive elements.
 */

import { describe, it, expect } from 'vitest';
import { selectActionables, isInteractiveKind } from '../../../src/state/actionables-filter.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Create a test snapshot with configurable nodes.
 */
function createTestSnapshot(nodes: Partial<ReadableNode>[]): BaseSnapshot {
  const fullNodes = nodes.map((partial, idx) => ({
    node_id: partial.node_id ?? `node-${idx}`,
    backend_node_id: partial.backend_node_id ?? 100 + idx,
    frame_id: 'main-frame',
    loader_id: 'loader-1',
    kind: partial.kind ?? 'button',
    label: partial.label ?? `Element ${idx}`,
    where: partial.where ?? { region: 'main' },
    layout: partial.layout ?? {
      bbox: { x: 0, y: idx * 50, w: 100, h: 40 },
      display: 'block',
      screen_zone: 'top-center' as const,
    },
    state: partial.state ?? { visible: true, enabled: true },
    find: partial.find ?? { primary: `#el-${idx}`, alternates: [] },
    implicitly_interactive: partial.implicitly_interactive,
  })) as ReadableNode[];

  return {
    snapshot_id: `snap-${Date.now()}`,
    url: 'https://example.com/',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes: fullNodes,
    meta: {
      node_count: fullNodes.length,
      interactive_count: fullNodes.length,
    },
  };
}

describe('isInteractiveKind', () => {
  it('should return true for standard interactive kinds', () => {
    expect(isInteractiveKind('button')).toBe(true);
    expect(isInteractiveKind('link')).toBe(true);
    expect(isInteractiveKind('input')).toBe(true);
    expect(isInteractiveKind('checkbox')).toBe(true);
  });

  it('should return false for non-interactive kinds', () => {
    expect(isInteractiveKind('generic')).toBe(false);
    expect(isInteractiveKind('heading')).toBe(false);
    expect(isInteractiveKind('paragraph')).toBe(false);
  });
});

describe('selectActionables', () => {
  describe('implicitly interactive elements', () => {
    it('should include implicitly interactive nodes in actionables selection', () => {
      const snapshot = createTestSnapshot([
        {
          kind: 'button',
          label: 'Submit',
          state: { visible: true, enabled: true },
        },
        {
          kind: 'generic',
          label: 'Clickable row',
          state: { visible: true, enabled: true },
          implicitly_interactive: true,
        },
      ]);

      const result = selectActionables(snapshot, 'main', 100);

      expect(result.length).toBe(2);
      expect(result.some((n) => n.label === 'Clickable row')).toBe(true);
    });

    it('should NOT include non-interactive nodes without implicitly_interactive flag', () => {
      const snapshot = createTestSnapshot([
        {
          kind: 'button',
          label: 'Submit',
          state: { visible: true, enabled: true },
        },
        {
          kind: 'generic',
          label: 'Plain div',
          state: { visible: true, enabled: true },
          // no implicitly_interactive
        },
      ]);

      const result = selectActionables(snapshot, 'main', 100);

      expect(result.length).toBe(1);
      expect(result[0].label).toBe('Submit');
    });

    it('should filter implicitly interactive nodes by visibility', () => {
      const snapshot = createTestSnapshot([
        {
          kind: 'generic',
          label: 'Hidden clickable',
          state: { visible: false, enabled: true },
          implicitly_interactive: true,
        },
      ]);

      const result = selectActionables(snapshot, 'main', 100);

      expect(result.length).toBe(0);
    });
  });
});
