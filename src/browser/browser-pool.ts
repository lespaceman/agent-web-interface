/**
 * Browser Pool
 *
 * Manages Chrome browser contexts for multi-tenancy.
 * Uses SessionManager for the underlying browser lifecycle and creates
 * isolated BrowserContexts for per-session cookie/storage separation.
 *
 * Each session gets its own BrowserContext via SessionManager.createIsolatedContext(),
 * providing separate cookies/storage/cache per tenant.
 */

import type { BrowserContext } from 'puppeteer-core';
import type { SessionManager } from './session-manager.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/**
 * Context lease returned when acquiring a BrowserContext.
 */
export interface ContextLease {
  /** The browser context for this session */
  context: BrowserContext;
  /** Release the context back to the pool */
  release: () => Promise<void>;
}

/**
 * BrowserPool state machine.
 */
export type BrowserPoolState = 'idle' | 'ready' | 'failed' | 'shutdown';

/**
 * BrowserPool configuration.
 */
export interface BrowserPoolOptions {
  /** Maximum concurrent contexts (default: 10) */
  maxContexts?: number;
}

/**
 * Manages per-session BrowserContext allocation on top of a SessionManager.
 *
 * The pool does not own the browser lifecycle — SessionManager handles
 * launch/connect/shutdown. The pool's responsibility is allocating and
 * tracking isolated BrowserContexts within that browser.
 */
export class BrowserPool {
  private _state: BrowserPoolState = 'idle';
  private readonly maxContexts: number;
  private readonly activeContexts = new Map<string, BrowserContext>();
  private sessionManager: SessionManager | null = null;

  constructor(options?: BrowserPoolOptions) {
    this.maxContexts = options?.maxContexts ?? 10;
  }

  get state(): BrowserPoolState {
    return this._state;
  }

  /**
   * Initialize the pool with a SessionManager.
   * The SessionManager must already have a browser launched or connected.
   *
   * @param sessionManager - The session manager that owns the browser
   * @throws Error if the session manager's browser is not running
   */
  initialize(sessionManager: SessionManager): void {
    if (this._state === 'shutdown') {
      throw new Error('BrowserPool has been shut down and cannot be reinitialized');
    }

    if (!sessionManager.isRunning()) {
      this._state = 'failed';
      throw new Error('SessionManager browser is not running');
    }

    this.sessionManager = sessionManager;
    this._state = 'ready';
    logger.info('BrowserPool initialized', {
      maxContexts: this.maxContexts,
    });
  }

  /**
   * Acquire an isolated BrowserContext for a session.
   *
   * Creates an isolated BrowserContext via SessionManager.createIsolatedContext().
   * Each context has its own cookie jar and storage partition.
   *
   * @param sessionId - Unique identifier for the session
   * @returns A ContextLease with the context and a release function
   * @throws Error if pool is not ready, session already has a context, or capacity reached
   */
  async acquire(sessionId: string): Promise<ContextLease> {
    if (this._state !== 'ready') {
      throw new Error(`BrowserPool not ready (state: ${this._state})`);
    }
    if (!this.sessionManager) {
      throw new Error('BrowserPool not initialized');
    }
    if (this.activeContexts.has(sessionId)) {
      throw new Error(`Context already acquired for session: ${sessionId}`);
    }
    if (this.activeContexts.size >= this.maxContexts) {
      throw new Error(`Maximum contexts (${this.maxContexts}) reached`);
    }

    // Create an isolated BrowserContext with its own cookies/storage
    const context = await this.sessionManager.createIsolatedContext();

    this.activeContexts.set(sessionId, context);
    logger.info('Context acquired', { sessionId, activeCount: this.activeContexts.size });

    const lease: ContextLease = {
      context,
      release: async () => {
        await this.release(sessionId);
      },
    };

    return lease;
  }

  /**
   * Release a session's BrowserContext.
   *
   * Closes the isolated BrowserContext (destroys all pages and cookies within it).
   *
   * @param sessionId - The session to release
   */
  async release(sessionId: string): Promise<void> {
    const context = this.activeContexts.get(sessionId);
    if (!context) return;

    this.activeContexts.delete(sessionId);

    try {
      await context.close();
    } catch (err) {
      // Context may already be closed (e.g., browser disconnected)
      logger.debug('Error closing context during release', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('Context released', { sessionId, activeCount: this.activeContexts.size });
  }

  /**
   * Check if a session has an active context.
   *
   * @param sessionId - The session identifier
   * @returns true if the session has an acquired context
   */
  has(sessionId: string): boolean {
    return this.activeContexts.has(sessionId);
  }

  /**
   * Get the number of active contexts.
   */
  get activeCount(): number {
    return this.activeContexts.size;
  }

  /**
   * Shutdown the pool and release all contexts.
   *
   * Closes all isolated BrowserContexts. Does NOT shut down the
   * underlying browser — that remains SessionManager's responsibility.
   */
  async shutdown(): Promise<void> {
    if (this._state === 'shutdown') return;

    const sessionIds = Array.from(this.activeContexts.keys());
    for (const sessionId of sessionIds) {
      await this.release(sessionId);
    }

    this.sessionManager = null;
    this._state = 'shutdown';
    logger.info('BrowserPool shut down');
  }
}
