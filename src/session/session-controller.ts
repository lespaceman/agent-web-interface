/**
 * Session Controller
 *
 * Per-tenant state container that implements ToolContext.
 * Each agent/session gets its own SessionController instance
 * with isolated pages, snapshots, state managers, and registries.
 *
 * In single-tenant (stdio) mode, one SessionController wraps
 * the existing SessionManager.
 *
 * In multi-tenant (HTTP) mode, each MCP connection gets its own
 * SessionController with an isolated BrowserContext.
 *
 * @module session/session-controller
 */

import type { BrowserContext } from 'puppeteer-core';
import type { PageHandle } from '../browser/page-registry.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { SessionManager } from '../browser/session-manager.js';
import { SnapshotStore } from '../snapshot/snapshot-store.js';
import { StateManager } from '../state/state-manager.js';
import { DependencyTracker } from '../form/dependency-tracker.js';
import { ObservationAccumulator } from '../observation/observation-accumulator.js';
import {
  ensureCdpSession as ensureCdpSessionImpl,
  resolveExistingPage as resolveExistingPageImpl,
} from '../tools/tool-context.js';
import { captureSnapshotWithRecovery as captureSnapshotWithRecoveryImpl } from '../tools/action-context.js';
import { ElementNotFoundError, StaleElementError, SnapshotRequiredError } from '../tools/errors.js';
import type {
  ToolContext,
  CdpSessionResult,
  SnapshotCaptureResult,
} from '../tools/tool-context.types.js';

/**
 * Session state machine.
 */
export type SessionState = 'initializing' | 'active' | 'closing' | 'closed';

/**
 * SessionController configuration.
 */
export interface SessionControllerOptions {
  /** Unique session identifier */
  sessionId: string;
  /** SessionManager instance for browser operations */
  sessionManager: SessionManager;
  /** Optional isolated BrowserContext for multi-tenant mode */
  browserContext?: BrowserContext;
}

/**
 * Per-tenant session controller implementing ToolContext.
 *
 * Owns all per-session state:
 * - SnapshotStore (per-session snapshot cache)
 * - StateManagers (one per page)
 * - DependencyTracker (per-session form dependencies)
 * - ObservationAccumulator (per-session DOM mutation tracking)
 */
export class SessionController implements ToolContext {
  readonly sessionId: string;

  private readonly _sessionManager: SessionManager;
  private readonly _browserContext?: BrowserContext;
  private readonly _snapshotStore: SnapshotStore;
  private readonly _stateManagers = new Map<string, StateManager>();
  private readonly _dependencyTracker: DependencyTracker;
  private readonly _observationAccumulator: ObservationAccumulator;

  private _state: SessionState = 'initializing';
  private _lastActivity: number = Date.now();

  constructor(options: SessionControllerOptions) {
    this.sessionId = options.sessionId;
    this._sessionManager = options.sessionManager;
    this._browserContext = options.browserContext;
    this._snapshotStore = new SnapshotStore();
    this._dependencyTracker = new DependencyTracker();
    this._observationAccumulator = new ObservationAccumulator();
    this._state = 'active';
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  /** Get the current session state. */
  get state(): SessionState {
    return this._state;
  }

  /** Touch the session to update last activity timestamp. */
  touch(): void {
    this._lastActivity = Date.now();
  }

  /** Get the time of last activity. */
  get lastActivity(): number {
    return this._lastActivity;
  }

  /**
   * Close the session and clean up all resources.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Kept async for API contract; BrowserPool owns context close
  async close(): Promise<void> {
    if (this._state === 'closing' || this._state === 'closed') return;
    this._state = 'closing';

    this._snapshotStore.destroy();
    this._stateManagers.clear();
    this._dependencyTracker.clearAll();

    // Note: We do NOT close _browserContext here. The BrowserPool owns
    // the context lifecycle and closes it in BrowserPool.release().

    this._state = 'closed';
  }

  // ---------------------------------------------------------------------------
  // Page lifecycle (ToolContext implementation)
  // ---------------------------------------------------------------------------

  resolvePage(pageId?: string): PageHandle | undefined {
    this.touch();
    return this._sessionManager.resolvePage(pageId);
  }

  async resolvePageOrCreate(pageId?: string): Promise<PageHandle> {
    this.touch();
    return this._sessionManager.resolvePageOrCreate(pageId);
  }

  resolveExistingPage(pageId?: string): PageHandle {
    this.touch();
    return resolveExistingPageImpl(this._sessionManager, pageId);
  }

  // ---------------------------------------------------------------------------
  // State access (ToolContext implementation)
  // ---------------------------------------------------------------------------

  getSessionManager(): SessionManager {
    return this._sessionManager;
  }

  getSnapshotStore(): SnapshotStore {
    return this._snapshotStore;
  }

  getStateManager(pageId: string): StateManager {
    if (!this._stateManagers.has(pageId)) {
      this._stateManagers.set(pageId, new StateManager({ pageId }));
    }
    return this._stateManagers.get(pageId)!;
  }

  removeStateManager(pageId: string): void {
    this._stateManagers.delete(pageId);
  }

  clearAllStateManagers(): void {
    this._stateManagers.clear();
  }

  getDependencyTracker(): DependencyTracker {
    return this._dependencyTracker;
  }

  getObservationAccumulator(): ObservationAccumulator {
    return this._observationAccumulator;
  }

  // ---------------------------------------------------------------------------
  // CDP health (ToolContext implementation)
  // ---------------------------------------------------------------------------

  async ensureCdpSession(handle: PageHandle): Promise<CdpSessionResult> {
    return ensureCdpSessionImpl(this._sessionManager, handle);
  }

  // ---------------------------------------------------------------------------
  // Snapshot capture (ToolContext implementation)
  // ---------------------------------------------------------------------------

  async captureSnapshotWithRecovery(
    handle: PageHandle,
    pageId: string
  ): Promise<SnapshotCaptureResult> {
    return captureSnapshotWithRecoveryImpl(this, handle, pageId);
  }

  // ---------------------------------------------------------------------------
  // Element resolution (ToolContext implementation)
  // ---------------------------------------------------------------------------

  requireSnapshot(pageId: string): BaseSnapshot {
    const snap = this._snapshotStore.getByPageId(pageId);
    if (!snap) {
      throw new SnapshotRequiredError(pageId);
    }
    return snap;
  }

  resolveElementByEid(pageId: string, eid: string, snapshot: BaseSnapshot): ReadableNode {
    const stateManager = this.getStateManager(pageId);
    const registry = stateManager.getElementRegistry();
    const elementRef = registry.getByEid(eid);

    if (!elementRef) {
      throw new ElementNotFoundError(eid);
    }

    if (registry.isStale(eid)) {
      throw new StaleElementError(eid);
    }

    const node = snapshot.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
    if (!node) {
      throw new StaleElementError(eid);
    }

    return node;
  }
}
