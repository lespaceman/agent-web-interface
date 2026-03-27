/**
 * Session Router
 *
 * Maps MCP connections to SessionController instances.
 *
 * - stdio mode: resolve(undefined) returns a single implicit SessionController
 * - HTTP mode: resolve(sessionId) looks up by MCP session ID
 *
 * Each SessionController owns its own browser lifecycle, configured
 * independently via BrowserSessionConfig.
 *
 * @module gateway/session-router
 */

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
  private readonly idleTimeoutMs: number;
  private readonly maxSessions: number;
  private _onSessionDestroyed?: (sessionId: string) => void | Promise<void>;
  private idleCheckTimer?: ReturnType<typeof setInterval>;

  constructor(options?: SessionRouterOptions) {
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
  // eslint-disable-next-line @typescript-eslint/require-await -- Kept async for API contract with HttpGateway
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
    };

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
    if (toEvict.length === 0) return;

    // Evict in parallel — each destroySession operates on a distinct session
    const results = await Promise.allSettled(
      toEvict.map((id) => {
        logger.info('Evicting idle session', { sessionId: id });
        return this.destroySession(id);
      })
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(
          'Failed to evict session',
          result.reason instanceof Error ? result.reason : undefined,
          { sessionId: toEvict[i] }
        );
      }
    }
  }
}
