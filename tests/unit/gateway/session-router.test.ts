/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionRouter } from '../../../src/gateway/session-router.js';
import { SessionController } from '../../../src/session/session-controller.js';

vi.mock('../../../src/session/session-controller.js', () => {
  const SessionController = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    opts: { sessionId: string }
  ) {
    this.sessionId = opts.sessionId;
    this.touch = vi.fn();
    this.close = vi.fn().mockResolvedValue(undefined);
    this.lastActivity = Date.now();
  });
  return { SessionController };
});

vi.mock('../../../src/shared/services/logging.service.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('SessionRouter', () => {
  let router: SessionRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new SessionRouter();
  });

  // -------------------------------------------------------------------------
  // resolve()
  // -------------------------------------------------------------------------

  describe('resolve(undefined) - implicit stdio session', () => {
    it('creates implicit stdio session on first call', () => {
      const ctx = router.resolve(undefined);
      expect(ctx).toBeDefined();
      expect(ctx.sessionId).toBe('stdio');
      expect(SessionController).toHaveBeenCalledWith({
        sessionId: 'stdio',
      });
    });

    it('returns same implicit session on repeated calls', () => {
      const first = router.resolve(undefined);
      const second = router.resolve(undefined);
      expect(first).toBe(second);
      // SessionController should only have been constructed once
      expect(SessionController).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolve(sessionId) - named sessions', () => {
    it('throws for unknown session', () => {
      expect(() => router.resolve('unknown-id')).toThrow('Session not found: unknown-id');
    });

    it('returns existing session and calls touch()', async () => {
      const session = await router.createSession('sess-1');
      const resolved = router.resolve('sess-1');
      expect(resolved).toBe(session);
      expect(session.touch).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // createSession()
  // -------------------------------------------------------------------------

  describe('createSession()', () => {
    it('creates a new session', async () => {
      const session = await router.createSession('new-sess');
      expect(session).toBeDefined();
      expect(session.sessionId).toBe('new-sess');
      expect(router.sessionCount).toBe(1);
    });

    it('passes only sessionId to SessionController', async () => {
      await router.createSession('check-args');
      expect(SessionController).toHaveBeenCalledWith({
        sessionId: 'check-args',
      });
    });

    it('throws if session already exists', async () => {
      await router.createSession('dup');
      await expect(router.createSession('dup')).rejects.toThrow('Session already exists: dup');
    });

    it('throws if maxSessions reached', async () => {
      const smallRouter = new SessionRouter({ maxSessions: 2 });
      await smallRouter.createSession('a');
      await smallRouter.createSession('b');
      await expect(smallRouter.createSession('c')).rejects.toThrow(
        'Maximum concurrent sessions (2) reached'
      );
    });
  });

  // -------------------------------------------------------------------------
  // destroySession()
  // -------------------------------------------------------------------------

  describe('destroySession()', () => {
    it('closes session and removes it', async () => {
      const session = await router.createSession('to-destroy');
      await router.destroySession('to-destroy');

      expect(session.close).toHaveBeenCalled();
      expect(router.sessionCount).toBe(0);
    });

    it('calls onSessionDestroyed callback', async () => {
      const onDestroyed = vi.fn();
      const cbRouter = new SessionRouter({ onSessionDestroyed: onDestroyed });

      await cbRouter.createSession('cb-sess');
      await cbRouter.destroySession('cb-sess');

      expect(onDestroyed).toHaveBeenCalledWith('cb-sess');
    });

    it('is no-op for unknown session', async () => {
      // Should not throw
      await expect(router.destroySession('nonexistent')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // sessionCount
  // -------------------------------------------------------------------------

  describe('sessionCount', () => {
    it('includes implicit session', async () => {
      expect(router.sessionCount).toBe(0);

      router.resolve(undefined); // creates implicit session
      expect(router.sessionCount).toBe(1);

      await router.createSession('extra');
      expect(router.sessionCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // shutdown()
  // -------------------------------------------------------------------------

  describe('shutdown()', () => {
    it('closes all sessions including implicit', async () => {
      const implicit = router.resolve(undefined);
      const named = await router.createSession('to-close');

      await router.shutdown();

      expect((implicit as unknown as { close: unknown }).close).toHaveBeenCalled();
      expect((named as unknown as { close: unknown }).close).toHaveBeenCalled();
      expect(router.sessionCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // setOnSessionDestroyed
  // -------------------------------------------------------------------------

  describe('setOnSessionDestroyed()', () => {
    it('sets the callback used on destroy', async () => {
      const cb = vi.fn();
      router.setOnSessionDestroyed(cb);

      await router.createSession('cb-test');
      await router.destroySession('cb-test');

      expect(cb).toHaveBeenCalledWith('cb-test');
    });
  });

  // -------------------------------------------------------------------------
  // Idle eviction
  // -------------------------------------------------------------------------

  describe('idle eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts sessions that exceed idle timeout', async () => {
      const onDestroyed = vi.fn();
      const idleRouter = new SessionRouter({
        idleTimeoutMs: 5000,
        onSessionDestroyed: onDestroyed,
      });

      const session = await idleRouter.createSession('idle-sess');

      // Make the session look old by overriding lastActivity
      Object.defineProperty(session, 'lastActivity', {
        value: Date.now() - 10_000,
        writable: true,
      });

      // Advance past the 60-second check interval
      vi.advanceTimersByTime(60_000);

      // Allow async eviction to settle
      await vi.runAllTimersAsync();

      expect(session.close).toHaveBeenCalled();
      expect(onDestroyed).toHaveBeenCalledWith('idle-sess');
    });

    it('does not evict sessions that are still active', async () => {
      const idleRouter = new SessionRouter({
        idleTimeoutMs: 120_000,
      });

      const session = await idleRouter.createSession('active-sess');

      // Keep lastActivity fresh (within the 120s timeout)
      Object.defineProperty(session, 'lastActivity', {
        get: () => Date.now(),
        configurable: true,
      });

      // Advance past the 60-second check interval to trigger eviction check
      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.close).not.toHaveBeenCalled();
    });
  });
});
