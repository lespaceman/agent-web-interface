/**
 * Session Router
 *
 * Maps MCP connections to SessionController instances.
 *
 * - stdio mode: resolve(undefined) returns a single implicit SessionController
 * - HTTP mode: resolve(sessionId) looks up by MCP session ID
 *
 * @module gateway/session-router
 */

import type { SessionManager } from '../browser/session-manager.js';
import type { BrowserPool } from '../browser/browser-pool.js';
import { SessionController, type SessionControllerOptions } from '../session/session-controller.js';
import type { ToolContext } from '../tools/tool-context.types.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/**
 * Session Router configuration.
 */
export interface SessionRouterOptions {
  /** Session idle timeout in ms (default: 30 minutes) */
  idleTimeoutMs?: number;
  /** Maximum concurrent sessions (default: 10) */
  maxSessions?: number;
  /** Optional browser pool for per-session context isolation */
  browserPool?: BrowserPool;
  /** Callback to ensure browser and pool are ready before session creation */
  ensureBrowser?: () => Promise<void>;
  /**
   * Called after a session is destroyed (e.g., by idle eviction).
   * Allows the gateway layer to clean up associated resources
   * (transports, MCP servers) that the router does not own.
   */
  onSessionDestroyed?: (sessionId: string) => void | Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 10;

/**
 * Maps MCP connections to SessionController instances.
 */
export class SessionRouter {
  private readonly sessions = new Map<string, SessionController>();
  private implicitSession: SessionController | null = null;
  private readonly sessionManager: SessionManager;
  private readonly browserPool?: BrowserPool;
  private readonly ensureBrowser?: () => Promise<void>;
  private readonly idleTimeoutMs: number;
  private readonly maxSessions: number;
  private _onSessionDestroyed?: (sessionId: string) => void | Promise<void>;
  private idleCheckTimer?: ReturnType<typeof setInterval>;

  constructor(sessionManager: SessionManager, options?: SessionRouterOptions) {
    this.sessionManager = sessionManager;
    this.browserPool = options?.browserPool;
    this.ensureBrowser = options?.ensureBrowser;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this._onSessionDestroyed = options?.onSessionDestroyed;
  }

  /**
   * Resolve an MCP session ID to a ToolContext (SessionController).
   *
   * - If mcpSessionId is undefined (stdio mode), returns the implicit session
   * - If mcpSessionId is provided (HTTP mode), looks up by ID
   */
  resolve(mcpSessionId?: string): ToolContext {
    if (mcpSessionId === undefined) {
      return this.getOrCreateImplicitSession();
    }

    const session = this.sessions.get(mcpSessionId);
    if (!session) {
      throw new Error(`Session not found: ${mcpSessionId}`);
    }

    session.touch();
    return session;
  }

  /**
   * Create a new session for an MCP connection.
   *
   * @param mcpSessionId - MCP session ID from transport
   * @returns The created SessionController
   */
  async createSession(mcpSessionId: string): Promise<SessionController> {
    if (this.sessions.has(mcpSessionId)) {
      throw new Error(`Session already exists: ${mcpSessionId}`);
    }

    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.maxSessions}) reached. Close an existing session first.`
      );
    }

    const options: SessionControllerOptions = {
      sessionId: mcpSessionId,
      sessionManager: this.sessionManager,
    };

    // If a browser pool is available, ensure the browser is running
    // (lazy init) then acquire an isolated context for this session
    if (this.browserPool) {
      if (this.ensureBrowser) {
        await this.ensureBrowser();
      }
      const lease = await this.browserPool.acquire(mcpSessionId);
      options.browserContext = lease.context;
    }

    const controller = new SessionController(options);
    this.sessions.set(mcpSessionId, controller);

    logger.info('Session created', { sessionId: mcpSessionId });
    this.startIdleCheck();

    return controller;
  }

  /**
   * Destroy a session and clean up resources.
   */
  async destroySession(mcpSessionId: string): Promise<void> {
    const session = this.sessions.get(mcpSessionId);
    if (!session) return;

    await session.close();
    this.sessions.delete(mcpSessionId);

    // Release the browser context back to the pool if available
    if (this.browserPool) {
      await this.browserPool.release(mcpSessionId);
    }

    logger.info('Session destroyed', { sessionId: mcpSessionId });

    // Notify the gateway layer so it can clean up transports / MCP servers
    if (this._onSessionDestroyed) {
      try {
        await this._onSessionDestroyed(mcpSessionId);
      } catch (err) {
        logger.error('onSessionDestroyed callback failed', err instanceof Error ? err : undefined, {
          sessionId: mcpSessionId,
        });
      }
    }

    if (this.sessions.size === 0) {
      this.stopIdleCheck();
    }
  }

  /**
   * Get or create the implicit session for stdio mode.
   */
  private getOrCreateImplicitSession(): SessionController {
    this.implicitSession ??= new SessionController({
      sessionId: 'stdio',
      sessionManager: this.sessionManager,
    });
    this.implicitSession.touch();
    return this.implicitSession;
  }

  /**
   * Get the number of active sessions.
   */
  get sessionCount(): number {
    return this.sessions.size + (this.implicitSession ? 1 : 0);
  }

  /**
   * Register a callback invoked after a session is destroyed.
   * Used by the gateway layer to clean up resources (transports,
   * MCP servers) that the router does not own.
   *
   * Can be set via constructor options or this method (for cases
   * where the gateway is created after the router).
   */
  setOnSessionDestroyed(cb: (sessionId: string) => void | Promise<void>): void {
    this._onSessionDestroyed = cb;
  }

  /**
   * Shut down all sessions and clean up.
   */
  async shutdown(): Promise<void> {
    this.stopIdleCheck();

    const closePromises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      closePromises.push(session.close());
    }
    if (this.implicitSession) {
      closePromises.push(this.implicitSession.close());
      this.implicitSession = null;
    }

    await Promise.all(closePromises);
    this.sessions.clear();
  }

  // ---------------------------------------------------------------------------
  // Idle session cleanup
  // ---------------------------------------------------------------------------

  private startIdleCheck(): void {
    if (this.idleCheckTimer) return;
    this.idleCheckTimer = setInterval(() => {
      void this.evictIdleSessions();
    }, 60_000); // Check every minute
    this.idleCheckTimer.unref();
  }

  private stopIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = undefined;
    }
  }

  private async evictIdleSessions(): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.idleTimeoutMs) {
        toEvict.push(id);
      }
    }
    for (const id of toEvict) {
      try {
        logger.info('Evicting idle session', { sessionId: id });
        await this.destroySession(id);
      } catch (err) {
        logger.error('Failed to evict session', err instanceof Error ? err : undefined, {
          sessionId: id,
        });
      }
    }
  }
}
