/**
 * Snapshot Store
 *
 * In-memory storage for page snapshots with optional TTL-based cleanup.
 * Keeps most recent snapshot per page for element resolution.
 *
 * @module snapshot/snapshot-store
 */

import type { BaseSnapshot, ReadableNode } from './snapshot.types.js';

/**
 * Snapshot store entry with metadata
 */
export interface SnapshotEntry {
  /** The stored snapshot */
  snapshot: BaseSnapshot;
  /** Timestamp when snapshot was stored */
  storedAt: number;
  /** Associated page ID */
  pageId: string;
}

/**
 * Snapshot store configuration options
 */
export interface SnapshotStoreOptions {
  /** TTL in milliseconds for automatic expiration. Undefined = no expiration */
  ttlMs?: number;
  /** Interval in milliseconds for automatic cleanup. Defaults to TTL value if TTL is set */
  cleanupIntervalMs?: number;
}

/**
 * Store statistics
 */
export interface SnapshotStoreStats {
  /** Number of stored snapshots */
  snapshotCount: number;
  /** Total number of nodes across all snapshots */
  totalNodes: number;
  /** Oldest snapshot timestamp */
  oldestSnapshot?: number;
  /** Newest snapshot timestamp */
  newestSnapshot?: number;
}

/**
 * Simple in-memory store for BaseSnapshot objects.
 * Tracks one snapshot per page (latest overwrites previous).
 * Supports optional TTL-based expiration with automatic cleanup.
 */
export class SnapshotStore {
  /** Map of snapshot_id → SnapshotEntry */
  private readonly entries = new Map<string, SnapshotEntry>();

  /** Map of page_id → snapshot_id (for lookup by page) */
  private readonly pageToSnapshot = new Map<string, string>();

  /** TTL in milliseconds (undefined = no expiration) */
  private readonly ttlMs?: number;

  /** Cleanup interval timer */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options?: SnapshotStoreOptions) {
    this.ttlMs = options?.ttlMs;

    // Start automatic cleanup if TTL is configured
    if (this.ttlMs !== undefined) {
      const intervalMs = options?.cleanupIntervalMs ?? this.ttlMs;
      this.startCleanupTimer(intervalMs);
    }
  }

  /**
   * Start automatic cleanup timer.
   * @param intervalMs - Cleanup interval in milliseconds
   */
  private startCleanupTimer(intervalMs: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, intervalMs);
    // Ensure timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop automatic cleanup timer.
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

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
      this.entries.delete(previousSnapshotId);
    }

    // Store new snapshot with metadata
    const entry: SnapshotEntry = {
      snapshot,
      storedAt: Date.now(),
      pageId,
    };

    this.entries.set(snapshot.snapshot_id, entry);
    this.pageToSnapshot.set(pageId, snapshot.snapshot_id);
  }

  /**
   * Get a snapshot by its ID.
   *
   * @param snapshotId - Snapshot identifier
   * @returns Snapshot or undefined if not found
   */
  get(snapshotId: string): BaseSnapshot | undefined {
    const entry = this.entries.get(snapshotId);
    return entry?.snapshot;
  }

  /**
   * Get full entry (with metadata) by snapshot ID.
   *
   * @param snapshotId - Snapshot identifier
   * @returns SnapshotEntry or undefined if not found
   */
  getEntry(snapshotId: string): SnapshotEntry | undefined {
    return this.entries.get(snapshotId);
  }

  /**
   * Get the most recent snapshot for a page.
   *
   * @param pageId - Page identifier
   * @returns Snapshot or undefined if no snapshot for page
   */
  getByPageId(pageId: string): BaseSnapshot | undefined {
    const snapshotId = this.pageToSnapshot.get(pageId);
    return snapshotId ? this.get(snapshotId) : undefined;
  }

  /**
   * Find a node within a snapshot.
   *
   * @param snapshotId - Snapshot identifier
   * @param nodeId - Node identifier
   * @returns Node or undefined if not found
   */
  findNode(snapshotId: string, nodeId: string): ReadableNode | undefined {
    const snapshot = this.get(snapshotId);
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

    this.entries.delete(snapshotId);
    this.pageToSnapshot.delete(pageId);
    return true;
  }

  /**
   * Clear all stored snapshots.
   */
  clear(): void {
    this.entries.clear();
    this.pageToSnapshot.clear();
  }

  /**
   * Destroy the store, clearing all data and stopping cleanup timer.
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.clear();
  }

  /**
   * Cleanup expired snapshots based on TTL.
   * Does nothing if TTL is not configured.
   *
   * @returns Number of expired snapshots removed
   */
  cleanupExpired(): number {
    if (this.ttlMs === undefined) {
      return 0;
    }

    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [snapshotId, entry] of this.entries) {
      if (now - entry.storedAt > this.ttlMs) {
        expiredIds.push(snapshotId);
      }
    }

    for (const snapshotId of expiredIds) {
      const entry = this.entries.get(snapshotId);
      if (entry) {
        this.pageToSnapshot.delete(entry.pageId);
        this.entries.delete(snapshotId);
      }
    }

    return expiredIds.length;
  }

  /**
   * Get store statistics.
   *
   * @returns SnapshotStoreStats
   */
  getStats(): SnapshotStoreStats {
    let totalNodes = 0;
    let oldestSnapshot: number | undefined;
    let newestSnapshot: number | undefined;

    for (const entry of this.entries.values()) {
      totalNodes += entry.snapshot.nodes.length;

      if (oldestSnapshot === undefined || entry.storedAt < oldestSnapshot) {
        oldestSnapshot = entry.storedAt;
      }
      if (newestSnapshot === undefined || entry.storedAt > newestSnapshot) {
        newestSnapshot = entry.storedAt;
      }
    }

    return {
      snapshotCount: this.entries.size,
      totalNodes,
      oldestSnapshot,
      newestSnapshot,
    };
  }

  /**
   * Get count of stored snapshots.
   */
  get size(): number {
    return this.entries.size;
  }
}
