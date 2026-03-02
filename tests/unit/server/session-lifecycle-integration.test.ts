import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { SessionStore } from '../../../src/server/session-store.js';
import type { SessionStartEvent } from '../../../src/server/mcp-server.js';

/**
 * Integration test: verifies that wiring SessionStore to BrowserAutomationServer
 * lifecycle events (session:start / session:end) works correctly.
 *
 * Uses a real SessionStore and a lightweight EventEmitter stand-in for the server
 * to test the exact wiring pattern used in src/index.ts.
 */
describe('SessionStore ↔ MCP lifecycle wiring', () => {
  let sessionStore: SessionStore;
  let serverEmitter: EventEmitter;

  /**
   * Wire the emitter to the store using the same pattern as src/index.ts
   */
  function wireLifecycle(emitter: EventEmitter, store: SessionStore): void {
    emitter.on('session:start', ({ clientInfo }: SessionStartEvent) => {
      store.createSession(clientInfo?.name ?? 'unknown', clientInfo);
    });

    emitter.on('session:end', () => {
      const session = store.getDefaultSession();
      if (session) void store.destroySession(session.session_id);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStore = new SessionStore({ ttlMs: 0 }); // no expiry for tests
    serverEmitter = new EventEmitter();
    wireLifecycle(serverEmitter, sessionStore);
  });

  it('should create a session when session:start fires', () => {
    expect(sessionStore.sessionCount()).toBe(0);

    serverEmitter.emit('session:start', {
      clientInfo: { name: 'claude-code', version: '1.0' },
    });

    expect(sessionStore.sessionCount()).toBe(1);
    const sessions = sessionStore.listSessions();
    expect(sessions[0].tenant_id).toBe('claude-code');
    expect(sessions[0].client_info).toEqual({
      name: 'claude-code',
      version: '1.0',
    });
  });

  it('should use "unknown" as tenant_id when clientInfo is undefined', () => {
    serverEmitter.emit('session:start', { clientInfo: undefined });

    expect(sessionStore.sessionCount()).toBe(1);
    const sessions = sessionStore.listSessions();
    expect(sessions[0].tenant_id).toBe('unknown');
  });

  it('should destroy the session when session:end fires', () => {
    // Start a session first
    serverEmitter.emit('session:start', {
      clientInfo: { name: 'test-client', version: '2.0' },
    });
    expect(sessionStore.sessionCount()).toBe(1);

    // End the session
    serverEmitter.emit('session:end');

    expect(sessionStore.sessionCount()).toBe(0);
  });

  it('should be a no-op when session:end fires with no active session', () => {
    expect(sessionStore.sessionCount()).toBe(0);

    // Should not throw
    serverEmitter.emit('session:end');

    expect(sessionStore.sessionCount()).toBe(0);
  });

  it('should return the active session via getDefaultSession after start', () => {
    serverEmitter.emit('session:start', {
      clientInfo: { name: 'my-agent', version: '3.0' },
    });

    const session = sessionStore.getDefaultSession();
    expect(session).toBeDefined();
    expect(session!.tenant_id).toBe('my-agent');
    expect(session!.client_info).toEqual({
      name: 'my-agent',
      version: '3.0',
    });
  });

  it('should return undefined from getDefaultSession after session:end', () => {
    serverEmitter.emit('session:start', {
      clientInfo: { name: 'agent', version: '1.0' },
    });
    serverEmitter.emit('session:end');

    const session = sessionStore.getDefaultSession();
    expect(session).toBeUndefined();
  });
});
