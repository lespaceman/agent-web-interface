/**
 * Session Controller
 *
 * Per-tenant state container that implements ToolContext.
 * Each agent/session gets its own SessionController instance
 * with isolated pages, snapshots, state managers, and registries.
 *
 * Each session owns its own SessionManager and browser lifecycle,
 * configured independently via BrowserSessionConfig.
 *
 * @module session/session-controller
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import { SessionManager } from '../browser/session-manager.js';
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
import {
  defaultBrowserConfig,
  type BrowserSessionConfig,
} from '../browser/browser-session-config.js';
import { ensureBrowserReady } from '../browser/ensure-browser.js';
import type { PageHandle } from '../browser/page-registry.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

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
  /** Optional browser configuration for this session */
  browserConfig?: BrowserSessionConfig;
}

/**
 * Per-tenant session controller implementing ToolContext.
 *
 * Owns all per-session state:
 * - SessionManager (per-session browser lifecycle)
 * - SnapshotStore (per-session snapshot cache)
 * - StateManagers (one per page)
 * - DependencyTracker (per-session form dependencies)
 * - ObservationAccumulator (per-session DOM mutation tracking)
 */
export class SessionController implements ToolContext {
  readonly sessionId: string;

  private _sessionManager: SessionManager | null = null;
  private _browserConfig: BrowserSessionConfig;
  private readonly _snapshotStore: SnapshotStore;
  private readonly _stateManagers = new Map<string, StateManager>();
  private readonly _dependencyTracker: DependencyTracker;
  private readonly _observationAccumulator: ObservationAccumulator;

  /** Deduplication promise for concurrent ensureBrowser() calls */
  private _ensureBrowserPromise: Promise<void> | null = null;

  private _state: SessionState = 'initializing';
  private _lastActivity: number = Date.now();

  constructor(options: SessionControllerOptions) {
    this.sessionId = options.sessionId;
    this._browserConfig = options.browserConfig ?? defaultBrowserConfig();
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
   * Close the session and clean up all resources, including the owned browser.
   */
  async close(): Promise<void> {
    if (this._state === 'closing' || this._state === 'closed') return;
    this._state = 'closing';

    this._snapshotStore.destroy();
    this._stateManagers.clear();
    this._dependencyTracker.clearAll();

    // Shut down the owned browser
    if (this._sessionManager) {
      try {
        await this._sessionManager.shutdown();
      } catch (err) {
        logger.error(
          'Error shutting down session browser',
          err instanceof Error ? err : undefined,
          { sessionId: this.sessionId }
        );
      }
      this._sessionManager = null;
    }

    this._state = 'closed';
  }

  // ---------------------------------------------------------------------------
  // Browser lifecycle (ToolContext implementation)
  // ---------------------------------------------------------------------------

  /**
   * Set the browser configuration for this session.
   *
   * Must be called before the browser is launched/connected (i.e., before
   * the first browser-touching tool call). Throws if browser is already running.
   */
  setBrowserConfig(config: BrowserSessionConfig): void {
    if (this._sessionManager?.isRunning() || this._ensureBrowserPromise) {
      throw new Error(
        'Cannot change browser configuration after the browser has started. ' +
          'Call close_session first, then configure_browser with new settings.'
      );
    }
    // Merge only defined values to avoid wiping previously set fields
    const prev = this._browserConfig;
    this._browserConfig = {
      mode: config.mode ?? prev.mode,
      headless: config.headless ?? prev.headless,
      isolated: config.isolated ?? prev.isolated,
      browserUrl: config.browserUrl ?? prev.browserUrl,
      wsEndpoint: config.wsEndpoint ?? prev.wsEndpoint,
      autoConnect: config.autoConnect ?? prev.autoConnect,
      userDataDir: config.userDataDir ?? prev.userDataDir,
      channel: config.channel ?? prev.channel,
      executablePath: config.executablePath ?? prev.executablePath,
    };
  }

  /**
   * Ensure the session's browser is ready.
   *
   * Lazily creates a SessionManager and launches/connects based on
   * the session's BrowserSessionConfig. Idempotent — returns immediately
   * if the browser is already running. Concurrent calls are deduplicated.
   */
  async ensureBrowser(): Promise<void> {
    // Deduplicate concurrent calls — all callers await the same promise
    if (this._ensureBrowserPromise) {
      await this._ensureBrowserPromise;
      return;
    }

    const session = this.getOrCreateSessionManager();

    // ensureBrowserReady handles the isRunning() fast-path internally
    this._ensureBrowserPromise = ensureBrowserReady(session, this._browserConfig);
    try {
      await this._ensureBrowserPromise;
    } finally {
      this._ensureBrowserPromise = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Page lifecycle (ToolContext implementation)
  // ---------------------------------------------------------------------------

  resolvePage(pageId?: string): PageHandle | undefined {
    this.touch();
    return this.getSessionManager().resolvePage(pageId);
  }

  async resolvePageOrCreate(pageId?: string): Promise<PageHandle> {
    this.touch();
    return this.getSessionManager().resolvePageOrCreate(pageId);
  }

  resolveExistingPage(pageId?: string): PageHandle {
    this.touch();
    return resolveExistingPageImpl(this.getSessionManager(), pageId);
  }

  touchPage(pageId: string): void {
    this.getSessionManager().touchPage(pageId);
  }

  async closePage(pageId: string): Promise<boolean> {
    return this.getSessionManager().closePage(pageId);
  }

  async syncPages(): Promise<PageHandle[]> {
    return this.getSessionManager().syncPages();
  }

  async navigateTo(pageId: string, url: string): Promise<void> {
    await this.getSessionManager().navigateTo(pageId, url);
  }

  // ---------------------------------------------------------------------------
  // State access (ToolContext implementation)
  // ---------------------------------------------------------------------------

  getSessionManager(): SessionManager {
    return this.getOrCreateSessionManager();
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
    return ensureCdpSessionImpl(this.getSessionManager(), handle);
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get or lazily create the session's own SessionManager.
   */
  private getOrCreateSessionManager(): SessionManager {
    this._sessionManager ??= new SessionManager();
    return this._sessionManager;
  }
}
