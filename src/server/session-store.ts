/**
 * Session Store
 *
 * Tracks active sessions per MCP client (tenant isolation).
 * Supports optional TTL-based auto-cleanup of expired sessions.
 */

import { randomUUID } from 'crypto';

/** Default TTL in milliseconds (30 minutes) */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Options for session store configuration
 */
export interface SessionStoreOptions {
  /** Session TTL in milliseconds (default: 30 minutes, 0 = no expiry) */
  ttlMs?: number;

  /** Maximum sessions allowed (default: unlimited) */
  maxSessions?: number;

  /** Enable automatic cleanup of expired sessions (default: false) */
  autoCleanup?: boolean;
}

/**
 * Represents a tenant session
 */
export interface TenantSession {
  /** Unique session identifier */
  session_id: string;

  /** Tenant/client identifier */
  tenant_id: string;

  /** Page IDs associated with this session */
  page_ids: Set<string>;

  /** When the session was created */
  created_at: Date;

  /** When the session was last accessed */
  last_accessed_at: Date;

  /** When the session expires (null = never) */
  expires_at: Date | null;
}

/**
 * In-memory session store for tenant isolation
 */
export class SessionStore {
  private readonly sessions = new Map<string, TenantSession>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSessions = options.maxSessions ?? Infinity;

    if (options.autoCleanup && this.ttlMs > 0) {
      this.startAutoCleanup();
    }
  }

  /**
   * Create a new session for a tenant
   *
   * @param tenant_id - The tenant/client identifier
   * @returns The new session_id
   * @throws Error if max sessions limit reached
   */
  createSession(tenant_id: string): string {
    // Check max sessions limit
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum sessions limit reached: ${this.maxSessions}`);
    }

    const session_id = `session-${randomUUID()}`;
    const now = new Date();

    const session: TenantSession = {
      session_id,
      tenant_id,
      page_ids: new Set(),
      created_at: now,
      last_accessed_at: now,
      expires_at: this.ttlMs > 0 ? new Date(now.getTime() + this.ttlMs) : null,
    };

    this.sessions.set(session_id, session);

    return session_id;
  }

  /**
   * Get a session by its ID.
   * Automatically refreshes TTL and checks for expiration.
   *
   * @param session_id - The session identifier
   * @returns TenantSession if found and not expired, undefined otherwise
   */
  getSession(session_id: string): TenantSession | undefined {
    const session = this.sessions.get(session_id);
    if (!session) return undefined;

    // Check if expired
    if (this.isExpired(session)) {
      this.sessions.delete(session_id);
      return undefined;
    }

    // Touch session to refresh TTL
    this.touchSession(session);
    return session;
  }

  /**
   * Add a page to a session
   *
   * @param session_id - The session identifier
   * @param page_id - The page identifier to add
   */
  addPage(session_id: string, page_id: string): void {
    const session = this.sessions.get(session_id);
    if (session) {
      session.page_ids.add(page_id);
    }
  }

  /**
   * Remove a page from a session
   *
   * @param session_id - The session identifier
   * @param page_id - The page identifier to remove
   */
  removePage(session_id: string, page_id: string): void {
    const session = this.sessions.get(session_id);
    if (session) {
      session.page_ids.delete(page_id);
    }
  }

  /**
   * Get all pages for a session
   *
   * @param session_id - The session identifier
   * @returns Array of page_ids (empty if session not found)
   */
  getPages(session_id: string): string[] {
    const session = this.sessions.get(session_id);
    if (!session) {
      return [];
    }
    return Array.from(session.page_ids);
  }

  /**
   * Destroy a session completely
   *
   * @param session_id - The session identifier
   */
  destroySession(session_id: string): void {
    this.sessions.delete(session_id);
  }

  /**
   * List all active sessions
   *
   * @returns Array of all TenantSession objects
   */
  listSessions(): TenantSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a specific tenant
   *
   * @param tenant_id - The tenant identifier
   * @returns Array of sessions for this tenant
   */
  getSessionsByTenant(tenant_id: string): TenantSession[] {
    return this.listSessions().filter((s) => s.tenant_id === tenant_id);
  }

  /**
   * Get the total number of sessions
   *
   * @returns Session count
   */
  sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session exists
   *
   * @param session_id - The session identifier
   * @returns true if session exists
   */
  hasSession(session_id: string): boolean {
    return this.sessions.has(session_id);
  }

  /**
   * Clear all sessions (for testing or shutdown)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Stop automatic cleanup timer
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Start automatic cleanup of expired sessions
   */
  startAutoCleanup(): void {
    this.stopAutoCleanup();
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref();
  }

  /**
   * Manually clean up all expired sessions
   *
   * @returns Number of sessions removed
   */
  cleanupExpired(): number {
    let removed = 0;
    const now = new Date();

    for (const [session_id, session] of this.sessions) {
      if (session.expires_at && session.expires_at <= now) {
        this.sessions.delete(session_id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Check if a session is expired
   */
  private isExpired(session: TenantSession): boolean {
    if (!session.expires_at) return false;
    return session.expires_at <= new Date();
  }

  /**
   * Touch a session to refresh its TTL
   */
  private touchSession(session: TenantSession): void {
    const now = new Date();
    session.last_accessed_at = now;
    if (this.ttlMs > 0) {
      session.expires_at = new Date(now.getTime() + this.ttlMs);
    }
  }

  /**
   * Get the configured TTL in milliseconds
   */
  getTtlMs(): number {
    return this.ttlMs;
  }

  /**
   * Get the configured max sessions limit
   */
  getMaxSessions(): number {
    return this.maxSessions;
  }
}
