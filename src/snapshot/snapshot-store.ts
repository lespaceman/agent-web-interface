/**
 * Snapshot Store
 *
 * In-memory storage for page snapshots.
 * Keeps most recent snapshot per page for element resolution.
 */

import type { BaseSnapshot, ReadableNode } from './snapshot.types.js';

/**
 * Simple in-memory store for BaseSnapshot objects.
 * Tracks one snapshot per page (latest overwrites previous).
 */
export class SnapshotStore {
  /** Map of snapshot_id → BaseSnapshot */
  private readonly snapshots = new Map<string, BaseSnapshot>();

  /** Map of page_id → snapshot_id (for lookup by page) */
  private readonly pageToSnapshot = new Map<string, string>();

  /**
   * Store a snapshot for a page.
   * Overwrites any previous snapshot for the same page.
   *
   * @param pageId - Page identifier
   * @param snapshot - Snapshot to store
   */
  store(pageId: string, snapshot: BaseSnapshot): void {
    // Remove previous snapshot for this page if exists
    const previousSnapshotId = this.pageToSnapshot.get(pageId);
    if (previousSnapshotId) {
      this.snapshots.delete(previousSnapshotId);
    }

    // Store new snapshot
    this.snapshots.set(snapshot.snapshot_id, snapshot);
    this.pageToSnapshot.set(pageId, snapshot.snapshot_id);
  }

  /**
   * Get a snapshot by its ID.
   *
   * @param snapshotId - Snapshot identifier
   * @returns Snapshot or undefined if not found
   */
  get(snapshotId: string): BaseSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Get the most recent snapshot for a page.
   *
   * @param pageId - Page identifier
   * @returns Snapshot or undefined if no snapshot for page
   */
  getByPageId(pageId: string): BaseSnapshot | undefined {
    const snapshotId = this.pageToSnapshot.get(pageId);
    return snapshotId ? this.snapshots.get(snapshotId) : undefined;
  }

  /**
   * Find a node within a snapshot.
   *
   * @param snapshotId - Snapshot identifier
   * @param nodeId - Node identifier
   * @returns Node or undefined if not found
   */
  findNode(snapshotId: string, nodeId: string): ReadableNode | undefined {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot?.nodes.find((n) => n.node_id === nodeId);
  }

  /**
   * Remove snapshot for a specific page.
   *
   * @param pageId - Page identifier
   * @returns true if snapshot was removed, false if not found
   */
  removeByPageId(pageId: string): boolean {
    const snapshotId = this.pageToSnapshot.get(pageId);
    if (!snapshotId) {
      return false;
    }

    this.snapshots.delete(snapshotId);
    this.pageToSnapshot.delete(pageId);
    return true;
  }

  /**
   * Clear all stored snapshots.
   */
  clear(): void {
    this.snapshots.clear();
    this.pageToSnapshot.clear();
  }

  /**
   * Get count of stored snapshots.
   */
  get size(): number {
    return this.snapshots.size;
  }
}
