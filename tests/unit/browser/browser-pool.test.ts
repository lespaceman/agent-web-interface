/* eslint-disable @typescript-eslint/unbound-method */
/**
 * BrowserPool Tests
 *
 * Unit tests for BrowserPool — isolated BrowserContext management
 * on top of a SessionManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserPool } from '../../../src/browser/browser-pool.js';
import type { BrowserContext } from 'puppeteer-core';
import type { SessionManager } from '../../../src/browser/session-manager.js';

// Suppress logger output during tests
vi.mock('../../../src/shared/services/logging.service.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockContext(): BrowserContext {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;
}

function createMockSessionManager(overrides: Partial<{ isRunning: boolean }> = {}): SessionManager {
  const mockContext = createMockContext();
  return {
    isRunning: vi.fn().mockReturnValue(overrides.isRunning ?? true),
    createIsolatedContext: vi.fn().mockResolvedValue(mockContext),
  } as unknown as SessionManager;
}

describe('BrowserPool', () => {
  let pool: BrowserPool;
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new BrowserPool();
    mockSessionManager = createMockSessionManager();
  });

  describe('constructor', () => {
    it('sets default maxContexts to 10', async () => {
      pool.initialize(mockSessionManager);

      // Acquire 10 contexts — should all succeed
      for (let i = 0; i < 10; i++) {
        await pool.acquire(`session-${i}`);
      }

      // The 11th should fail, proving the default limit is 10
      await expect(pool.acquire('session-10')).rejects.toThrow('Maximum contexts (10) reached');
    });

    it('respects custom maxContexts option', async () => {
      const customPool = new BrowserPool({ maxContexts: 2 });
      customPool.initialize(mockSessionManager);

      await customPool.acquire('s1');
      await customPool.acquire('s2');

      await expect(customPool.acquire('s3')).rejects.toThrow('Maximum contexts (2) reached');
    });
  });

  describe('initialize()', () => {
    it('transitions to ready state', () => {
      expect(pool.state).toBe('idle');
      pool.initialize(mockSessionManager);
      expect(pool.state).toBe('ready');
    });

    it('throws if browser is not running', () => {
      const notRunning = createMockSessionManager({ isRunning: false });

      expect(() => pool.initialize(notRunning)).toThrow('SessionManager browser is not running');
      expect(pool.state).toBe('failed');
    });

    it('throws if already shut down', async () => {
      pool.initialize(mockSessionManager);
      await pool.shutdown();

      expect(() => pool.initialize(mockSessionManager)).toThrow(
        'BrowserPool has been shut down and cannot be reinitialized'
      );
    });
  });

  describe('acquire()', () => {
    beforeEach(() => {
      pool.initialize(mockSessionManager);
    });

    it('creates an isolated context', async () => {
      const lease = await pool.acquire('session-1');

      expect(mockSessionManager.createIsolatedContext).toHaveBeenCalledOnce();
      expect(lease.context).toBeDefined();
      expect(typeof lease.release).toBe('function');
    });

    it('throws if session already has a context', async () => {
      await pool.acquire('session-1');

      await expect(pool.acquire('session-1')).rejects.toThrow(
        'Context already acquired for session: session-1'
      );
    });

    it('throws if maxContexts reached', async () => {
      const smallPool = new BrowserPool({ maxContexts: 1 });
      smallPool.initialize(mockSessionManager);

      await smallPool.acquire('s1');

      await expect(smallPool.acquire('s2')).rejects.toThrow('Maximum contexts (1) reached');
    });

    it('throws if not ready', async () => {
      const uninitializedPool = new BrowserPool();

      await expect(uninitializedPool.acquire('s1')).rejects.toThrow(
        'BrowserPool not ready (state: idle)'
      );
    });
  });

  describe('release()', () => {
    beforeEach(() => {
      pool.initialize(mockSessionManager);
    });

    it('closes context and removes from tracking', async () => {
      const lease = await pool.acquire('session-1');
      const context = lease.context;

      expect(pool.has('session-1')).toBe(true);
      expect(pool.activeCount).toBe(1);

      await pool.release('session-1');

      expect(context.close).toHaveBeenCalledOnce();
      expect(pool.has('session-1')).toBe(false);
      expect(pool.activeCount).toBe(0);
    });

    it('is idempotent — no-op for unknown session', async () => {
      // Should not throw
      await pool.release('nonexistent-session');
      expect(pool.activeCount).toBe(0);
    });

    it('can be called via the lease release function', async () => {
      const lease = await pool.acquire('session-1');

      await lease.release();

      expect(pool.has('session-1')).toBe(false);
      expect(lease.context.close).toHaveBeenCalledOnce();
    });

    it('handles context.close() errors gracefully', async () => {
      const failingContext = {
        close: vi.fn().mockRejectedValue(new Error('already closed')),
      } as unknown as BrowserContext;

      const sm = {
        isRunning: vi.fn().mockReturnValue(true),
        createIsolatedContext: vi.fn().mockResolvedValue(failingContext),
      } as unknown as SessionManager;

      const errorPool = new BrowserPool();
      errorPool.initialize(sm);
      await errorPool.acquire('s1');

      // Should not throw even though context.close() rejects
      await errorPool.release('s1');
      expect(errorPool.has('s1')).toBe(false);
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      pool.initialize(mockSessionManager);
    });

    it('returns true for acquired session', async () => {
      await pool.acquire('session-1');
      expect(pool.has('session-1')).toBe(true);
    });

    it('returns false for unknown session', () => {
      expect(pool.has('unknown')).toBe(false);
    });

    it('returns false after release', async () => {
      await pool.acquire('session-1');
      await pool.release('session-1');
      expect(pool.has('session-1')).toBe(false);
    });
  });

  describe('activeCount', () => {
    beforeEach(() => {
      pool.initialize(mockSessionManager);
    });

    it('starts at zero', () => {
      expect(pool.activeCount).toBe(0);
    });

    it('increments on acquire', async () => {
      await pool.acquire('s1');
      expect(pool.activeCount).toBe(1);

      await pool.acquire('s2');
      expect(pool.activeCount).toBe(2);
    });

    it('decrements on release', async () => {
      await pool.acquire('s1');
      await pool.acquire('s2');
      await pool.release('s1');
      expect(pool.activeCount).toBe(1);
    });
  });

  describe('shutdown()', () => {
    beforeEach(() => {
      pool.initialize(mockSessionManager);
    });

    it('closes all contexts and transitions to shutdown state', async () => {
      // Use a session manager that returns distinct contexts per call
      const context1 = createMockContext();
      const context2 = createMockContext();
      const sm = {
        isRunning: vi.fn().mockReturnValue(true),
        createIsolatedContext: vi
          .fn()
          .mockResolvedValueOnce(context1)
          .mockResolvedValueOnce(context2),
      } as unknown as SessionManager;

      const shutdownPool = new BrowserPool();
      shutdownPool.initialize(sm);

      await shutdownPool.acquire('s1');
      await shutdownPool.acquire('s2');

      await shutdownPool.shutdown();

      expect(context1.close).toHaveBeenCalledOnce();
      expect(context2.close).toHaveBeenCalledOnce();
      expect(shutdownPool.activeCount).toBe(0);
      expect(shutdownPool.state).toBe('shutdown');
    });

    it('is idempotent', async () => {
      await pool.acquire('s1');

      await pool.shutdown();
      await pool.shutdown(); // second call should be a no-op

      expect(pool.state).toBe('shutdown');
    });

    it('prevents further acquire after shutdown', async () => {
      await pool.shutdown();

      await expect(pool.acquire('s1')).rejects.toThrow('BrowserPool not ready (state: shutdown)');
    });
  });
});
