/**
 * Snapshot Version Manager
 *
 * Manages snapshot versioning with monotonic version numbers and history.
 * Enables delta computation from agent's last known state.
 */

import type { Page } from 'playwright';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { VersionedSnapshot, ValidationResult } from './types.js';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import { compileSnapshot } from '../snapshot/snapshot-compiler.js';
import { hashSnapshot, createVersionedSnapshot } from './utils.js';

/** Default maximum history size */
const DEFAULT_MAX_HISTORY_SIZE = 3;

/**
 * SnapshotVersionManager class
 *
 * Tracks versioned snapshots with history for delta computation.
 */
export class SnapshotVersionManager {
  private currentVersion = 0;
  private current: VersionedSnapshot | null = null;

  /** Keep last N versions for delta computation against old agent state */
  private history: VersionedSnapshot[] = [];
  private readonly maxHistorySize: number;

  /** Page ID for snapshot compilation */
  private readonly pageId: string;

  constructor(pageId: string, maxHistorySize = DEFAULT_MAX_HISTORY_SIZE) {
    this.pageId = pageId;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Get current version number.
   */
  get version(): number {
    return this.currentVersion;
  }

  /**
   * Get current versioned snapshot.
   */
  get currentSnapshot(): VersionedSnapshot | null {
    return this.current;
  }

  /**
   * Capture new snapshot only if state changed.
   * Avoids double version increments.
   *
   * @param page - Playwright Page instance
   * @param cdp - CDP client for the page
   * @returns The versioned snapshot and whether it's new
   */
  async captureIfChanged(
    page: Page,
    cdp: CdpClient
  ): Promise<{ versioned: VersionedSnapshot; isNew: boolean }> {
    const snapshot = await compileSnapshot(cdp, page, this.pageId);
    const hash = hashSnapshot(snapshot);

    // No change - return existing
    if (this.current?.hash === hash) {
      return { versioned: this.current, isNew: false };
    }

    // State changed - create new version
    const versioned = this.createNewVersion(snapshot, hash);
    return { versioned, isNew: true };
  }

  /**
   * Force capture (ignores hash check).
   * Use after actions that definitely changed state.
   *
   * @param page - Playwright Page instance
   * @param cdp - CDP client for the page
   * @returns The new versioned snapshot
   */
  async forceCapture(page: Page, cdp: CdpClient): Promise<VersionedSnapshot> {
    const snapshot = await compileSnapshot(cdp, page, this.pageId);
    const hash = hashSnapshot(snapshot);
    return this.createNewVersion(snapshot, hash);
  }

  /**
   * Create a versioned snapshot from an existing BaseSnapshot.
   * Use when snapshot is already compiled.
   *
   * @param snapshot - Existing BaseSnapshot
   * @returns The new versioned snapshot
   */
  createVersionFromSnapshot(snapshot: BaseSnapshot): VersionedSnapshot {
    const hash = hashSnapshot(snapshot);
    return this.createNewVersion(snapshot, hash);
  }

  /**
   * Create a new version and archive current.
   */
  private createNewVersion(snapshot: BaseSnapshot, hash: string): VersionedSnapshot {
    this.currentVersion++;
    const versioned = createVersionedSnapshot(this.currentVersion, snapshot);
    versioned.hash = hash; // Override with computed hash

    // Archive current to history before replacing
    if (this.current) {
      this.history.push(this.current);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }

    this.current = versioned;
    return versioned;
  }

  /**
   * Get snapshot for a specific version.
   * Returns current if version matches, searches history otherwise.
   *
   * @param version - Version number to look up
   * @returns The versioned snapshot or null if not found
   */
  getVersion(version: number): VersionedSnapshot | null {
    if (this.current?.version === version) {
      return this.current;
    }
    return this.history.find((h) => h.version === version) ?? null;
  }

  /**
   * Validate agent's assumed version against current state.
   * Returns appropriate response strategy.
   *
   * @param page - Playwright Page instance
   * @param cdp - CDP client for the page
   * @param agentVersion - Agent's last known version (optional)
   * @returns Validation result with strategy
   */
  async validateAgentState(
    page: Page,
    cdp: CdpClient,
    agentVersion?: number
  ): Promise<ValidationResult> {
    const { versioned } = await this.captureIfChanged(page, cdp);

    // No agent version provided - assume they want current
    if (agentVersion === undefined) {
      return {
        status: 'current',
        currentVersion: versioned,
      };
    }

    // Agent has current version
    if (agentVersion === versioned.version) {
      return {
        status: 'current',
        currentVersion: versioned,
      };
    }

    // Agent has old version - try to compute delta from their version
    const agentSnapshot = this.getVersion(agentVersion);

    if (agentSnapshot) {
      // Can compute delta from agent's known state
      return {
        status: 'stale_with_history',
        currentVersion: versioned,
        agentVersion: agentSnapshot,
        canComputeDelta: true,
      };
    }

    // Agent version too old (not in history) - must send full
    return {
      status: 'stale_no_history',
      currentVersion: versioned,
      agentVersionNumber: agentVersion,
      canComputeDelta: false,
    };
  }

  /**
   * Reset all state (call on full page navigation).
   * Note: Does NOT reset currentVersion - keeps it monotonic.
   */
  reset(): void {
    this.current = null;
    this.history = [];
    // Don't reset currentVersion - keep it monotonic across navigations
  }

  /**
   * Check if we have any snapshot.
   */
  get hasSnapshot(): boolean {
    return this.current !== null;
  }

  /**
   * Get history size.
   */
  get historySize(): number {
    return this.history.length;
  }
}
