/**
 * Snapshot Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotStore } from '../../../src/snapshot/snapshot-store.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

describe('SnapshotStore', () => {
  let store: SnapshotStore;

  // Create a minimal valid snapshot for testing
  function createTestSnapshot(
    snapshotId: string,
    nodes: Partial<ReadableNode>[] = []
  ): BaseSnapshot {
    return {
      snapshot_id: snapshotId,
      url: 'https://example.com',
      title: 'Test Page',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes: nodes.map((n, i) => ({
        node_id: n.node_id ?? `node-${i}`,
        kind: n.kind ?? 'button',
        label: n.label ?? `Button ${i}`,
        where: n.where ?? { region: 'main' },
        layout: n.layout ?? { bbox: { x: 0, y: 0, width: 100, height: 30 } },
        find: n.find ?? { primary: `role=button[name="Button ${i}"]` },
      })) as ReadableNode[],
      meta: {
        node_count: nodes.length,
        interactive_count: nodes.length,
      },
    };
  }

  beforeEach(() => {
    store = new SnapshotStore();
  });

  describe('store()', () => {
    it('should store a snapshot', () => {
      const snapshot = createTestSnapshot('snap-1');
      store.store('page-1', snapshot);

      expect(store.get('snap-1')).toBe(snapshot);
    });

    it('should overwrite previous snapshot for same page', () => {
      const snapshot1 = createTestSnapshot('snap-1');
      const snapshot2 = createTestSnapshot('snap-2');

      store.store('page-1', snapshot1);
      store.store('page-1', snapshot2);

      expect(store.get('snap-1')).toBeUndefined();
      expect(store.get('snap-2')).toBe(snapshot2);
      expect(store.getByPageId('page-1')).toBe(snapshot2);
    });
  });

  describe('get()', () => {
    it('should return undefined for non-existent snapshot', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });

    it('should return stored snapshot by ID', () => {
      const snapshot = createTestSnapshot('snap-1');
      store.store('page-1', snapshot);

      expect(store.get('snap-1')).toBe(snapshot);
    });
  });

  describe('getByPageId()', () => {
    it('should return undefined for non-existent page', () => {
      expect(store.getByPageId('non-existent')).toBeUndefined();
    });

    it('should return most recent snapshot for page', () => {
      const snapshot = createTestSnapshot('snap-1');
      store.store('page-1', snapshot);

      expect(store.getByPageId('page-1')).toBe(snapshot);
    });
  });

  describe('findNode()', () => {
    it('should return undefined for non-existent snapshot', () => {
      expect(store.findNode('non-existent', 'node-1')).toBeUndefined();
    });

    it('should return undefined for non-existent node', () => {
      const snapshot = createTestSnapshot('snap-1', [{ node_id: 'node-1' }]);
      store.store('page-1', snapshot);

      expect(store.findNode('snap-1', 'non-existent')).toBeUndefined();
    });

    it('should return node by ID', () => {
      const snapshot = createTestSnapshot('snap-1', [
        { node_id: 'node-1', label: 'Submit' },
        { node_id: 'node-2', label: 'Cancel' },
      ]);
      store.store('page-1', snapshot);

      const node = store.findNode('snap-1', 'node-1');
      expect(node).toBeDefined();
      expect(node?.label).toBe('Submit');
    });
  });

  describe('clear()', () => {
    it('should remove all snapshots', () => {
      const snapshot1 = createTestSnapshot('snap-1');
      const snapshot2 = createTestSnapshot('snap-2');

      store.store('page-1', snapshot1);
      store.store('page-2', snapshot2);

      store.clear();

      expect(store.get('snap-1')).toBeUndefined();
      expect(store.get('snap-2')).toBeUndefined();
      expect(store.getByPageId('page-1')).toBeUndefined();
    });
  });

  describe('removeByPageId()', () => {
    it('should remove snapshot for specific page', () => {
      const snapshot1 = createTestSnapshot('snap-1');
      const snapshot2 = createTestSnapshot('snap-2');

      store.store('page-1', snapshot1);
      store.store('page-2', snapshot2);

      store.removeByPageId('page-1');

      expect(store.get('snap-1')).toBeUndefined();
      expect(store.getByPageId('page-1')).toBeUndefined();
      expect(store.get('snap-2')).toBe(snapshot2);
    });

    it('should return true if snapshot was removed', () => {
      const snapshot = createTestSnapshot('snap-1');
      store.store('page-1', snapshot);

      expect(store.removeByPageId('page-1')).toBe(true);
    });

    it('should return false if no snapshot for page', () => {
      expect(store.removeByPageId('non-existent')).toBe(false);
    });
  });

  describe('TTL support', () => {
    it('should store timestamp with snapshot', () => {
      const snapshot = createTestSnapshot('snap-1');
      store.store('page-1', snapshot);

      const entry = store.getEntry('snap-1');
      expect(entry).toBeDefined();
      expect(entry?.storedAt).toBeDefined();
      expect(typeof entry?.storedAt).toBe('number');
    });

    it('should cleanup expired snapshots', async () => {
      // Create store with 50ms TTL
      const shortTtlStore = new SnapshotStore({ ttlMs: 50 });

      const snapshot = createTestSnapshot('snap-1');
      shortTtlStore.store('page-1', snapshot);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Manual cleanup
      shortTtlStore.cleanupExpired();

      expect(shortTtlStore.get('snap-1')).toBeUndefined();
    });

    it('should not cleanup non-expired snapshots', () => {
      // Create store with long TTL
      const longTtlStore = new SnapshotStore({ ttlMs: 60000 });

      const snapshot = createTestSnapshot('snap-1');
      longTtlStore.store('page-1', snapshot);

      longTtlStore.cleanupExpired();

      expect(longTtlStore.get('snap-1')).toBe(snapshot);
    });

    it('should not expire snapshots when TTL is undefined', () => {
      const noTtlStore = new SnapshotStore(); // No TTL

      const snapshot = createTestSnapshot('snap-1');
      noTtlStore.store('page-1', snapshot);

      noTtlStore.cleanupExpired();

      expect(noTtlStore.get('snap-1')).toBe(snapshot);
    });
  });

  describe('statistics', () => {
    it('should track store statistics', () => {
      const snapshot1 = createTestSnapshot('snap-1', [
        { node_id: 'n1' },
        { node_id: 'n2' },
      ]);
      const snapshot2 = createTestSnapshot('snap-2', [
        { node_id: 'n3' },
      ]);

      store.store('page-1', snapshot1);
      store.store('page-2', snapshot2);

      const stats = store.getStats();

      expect(stats.snapshotCount).toBe(2);
      expect(stats.totalNodes).toBe(3);
    });

    it('should update statistics on remove', () => {
      const snapshot = createTestSnapshot('snap-1', [{ node_id: 'n1' }]);
      store.store('page-1', snapshot);
      store.removeByPageId('page-1');

      const stats = store.getStats();

      expect(stats.snapshotCount).toBe(0);
      expect(stats.totalNodes).toBe(0);
    });
  });
});
