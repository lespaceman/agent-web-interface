/**
 * Tool Context Types
 *
 * Defines the ToolContext interface that all tool handlers receive as a parameter.
 * This decouples tool handlers from global singletons, enabling multi-tenancy
 * where each session has its own isolated context.
 *
 * @module tools/tool-context.types
 */

import type { SessionManager } from '../browser/session-manager.js';
import type { PageHandle } from '../browser/page-registry.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { SnapshotStore } from '../snapshot/snapshot-store.js';
import type { StateManager } from '../state/state-manager.js';
import type { DependencyTracker } from '../form/dependency-tracker.js';
import type { ObservationAccumulator } from '../observation/observation-accumulator.js';
import type { RuntimeHealth } from '../state/health.types.js';

/**
 * Result of ensuring a CDP session is healthy.
 */
export interface CdpSessionResult {
  handle: PageHandle;
  recovered: boolean;
  runtime_health: RuntimeHealth;
}

/**
 * Result of capturing a snapshot with recovery.
 */
export interface SnapshotCaptureResult {
  snapshot: BaseSnapshot;
  handle: PageHandle;
  runtime_health: RuntimeHealth;
}

/**
 * Context interface for tool handler execution.
 *
 * Provides all per-session state that tool handlers need.
 * Replaces module-level singletons with an injectable context object.
 *
 * In single-tenant (stdio) mode, a DefaultToolContext wraps the existing singletons.
 * In multi-tenant (HTTP) mode, a SessionController implements this interface directly.
 */
export interface ToolContext {
  /** Unique session identifier */
  readonly sessionId: string;

  // ---------------------------------------------------------------------------
  // Page lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Resolve page_id to a PageHandle, returning undefined if not found.
   */
  resolvePage(pageId?: string): PageHandle | undefined;

  /**
   * Resolve page_id to a PageHandle, creating a new page if needed.
   */
  resolvePageOrCreate(pageId?: string): Promise<PageHandle>;

  /**
   * Resolve page_id to a PageHandle, throwing if not found.
   * Also touches the page to mark it as MRU.
   */
  resolveExistingPage(pageId?: string): PageHandle;

  // ---------------------------------------------------------------------------
  // State access
  // ---------------------------------------------------------------------------

  /** Get the session manager for browser lifecycle operations. */
  getSessionManager(): SessionManager;

  /** Get the snapshot store for this session. */
  getSnapshotStore(): SnapshotStore;

  /** Get or create a state manager for a specific page. */
  getStateManager(pageId: string): StateManager;

  /** Remove the state manager for a page (on page close). */
  removeStateManager(pageId: string): void;

  /** Clear all state managers (on session close). */
  clearAllStateManagers(): void;

  /** Get the dependency tracker for this session. */
  getDependencyTracker(): DependencyTracker;

  /** Get the observation accumulator for this session. */
  getObservationAccumulator(): ObservationAccumulator;

  // ---------------------------------------------------------------------------
  // CDP health
  // ---------------------------------------------------------------------------

  /**
   * Ensure CDP session is healthy, attempting repair if needed.
   * Call this before any CDP operation to auto-repair dead sessions.
   */
  ensureCdpSession(handle: PageHandle): Promise<CdpSessionResult>;

  // ---------------------------------------------------------------------------
  // Snapshot capture
  // ---------------------------------------------------------------------------

  /**
   * Capture a snapshot with stabilization and CDP recovery when empty.
   */
  captureSnapshotWithRecovery(handle: PageHandle, pageId: string): Promise<SnapshotCaptureResult>;

  // ---------------------------------------------------------------------------
  // Element resolution
  // ---------------------------------------------------------------------------

  /**
   * Require a snapshot for a page, throwing if none exists.
   */
  requireSnapshot(pageId: string): BaseSnapshot;

  /**
   * Resolve an element by eid from the snapshot.
   * Includes proactive staleness detection.
   *
   * @throws {ElementNotFoundError} If eid not found in registry
   * @throws {StaleElementError} If eid reference is stale
   */
  resolveElementByEid(pageId: string, eid: string, snapshot: BaseSnapshot): ReadableNode;
}
