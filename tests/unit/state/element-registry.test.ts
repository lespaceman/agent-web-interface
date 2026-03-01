/**
 * Element Registry Tests
 *
 * Tests for ElementRegistry tracking of interactive and implicitly interactive elements.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ElementRegistry } from '../../../src/state/element-registry.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Create a test snapshot with configurable nodes.
 */
function createTestSnapshot(options: {
  snapshotId?: string;
  nodes: Partial<ReadableNode>[];
}): BaseSnapshot {
  const nodes = options.nodes.map((partial, idx) => ({
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
    snapshot_id: options.snapshotId ?? `snap-${Date.now()}`,
    url: 'https://example.com/',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => n.state?.visible).length,
    },
  };
}

describe('ElementRegistry', () => {
  let registry: ElementRegistry;

  beforeEach(() => {
    registry = new ElementRegistry();
  });

  describe('implicitly interactive element tracking', () => {
    it('should register nodes with implicitly_interactive: true even if kind is generic', () => {
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-implicit-1',
        nodes: [
          {
            node_id: 'div-clickable',
            backend_node_id: 200,
            kind: 'generic',
            label: 'Clickable div',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
            implicitly_interactive: true,
          },
        ],
      });

      const result = registry.updateFromSnapshot(snapshot, 'main');

      expect(result.added.length).toBe(1);
      expect(registry.size()).toBe(1);

      // Verify the element can be looked up
      const eid = registry.getEidByBackendNodeId(200);
      expect(eid).toBeDefined();
    });

    it('should NOT register non-interactive nodes without implicitly_interactive flag', () => {
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-notrack-1',
        nodes: [
          {
            node_id: 'plain-div',
            backend_node_id: 300,
            kind: 'generic',
            label: 'Plain div',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
            // implicitly_interactive is undefined/not set
          },
        ],
      });

      const result = registry.updateFromSnapshot(snapshot, 'main');

      expect(result.added.length).toBe(0);
      expect(registry.size()).toBe(0);
    });

    it('should register both interactive and implicitly interactive nodes', () => {
      const snapshot = createTestSnapshot({
        snapshotId: 'snap-both-1',
        nodes: [
          {
            node_id: 'btn-1',
            backend_node_id: 100,
            kind: 'button',
            label: 'Submit',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'div-clickable',
            backend_node_id: 200,
            kind: 'generic',
            label: 'Clickable row',
            where: { region: 'main' },
            state: { visible: true, enabled: true },
            implicitly_interactive: true,
          },
        ],
      });

      const result = registry.updateFromSnapshot(snapshot, 'main');

      expect(result.added.length).toBe(2);
      expect(registry.size()).toBe(2);
    });
  });
});
