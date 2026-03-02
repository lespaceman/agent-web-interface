/**
 * Tests for per-session BrowserContext isolation.
 *
 * Verifies that SessionManager.createIsolatedContext() creates isolated
 * browser contexts, and that SessionStore.destroySession() closes them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLinkedMocks,
  createMockBrowserContext,
  type LinkedMocks,
} from '../../mocks/puppeteer.mock.js';
import { SessionStore } from '../../../src/server/session-store.js';

// Hoist mock variables so they're available inside vi.mock factories
const { mockPuppeteer } = vi.hoisted(() => {
  return {
    mockPuppeteer: { launch: vi.fn(), connect: vi.fn() },
  };
});

vi.mock('puppeteer-core', () => ({
  default: mockPuppeteer,
  TargetType: { SERVICE_WORKER: 'service_worker', BACKGROUND_PAGE: 'background_page' },
}));

vi.mock('../../../src/shared/services/logging.service.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/observation/index.js', () => ({
  observationAccumulator: { inject: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/browser/page-network-tracker.js', () => ({
  getOrCreateTracker: vi.fn().mockReturnValue({ attach: vi.fn(), markNavigation: vi.fn() }),
  removeTracker: vi.fn(),
}));

// Import after mocks
const { SessionManager } = await import('../../../src/browser/session-manager.js');

describe('Per-session BrowserContext isolation', () => {
  let mocks: LinkedMocks;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createLinkedMocks();
    mockPuppeteer.launch.mockResolvedValue(mocks.browser);
  });

  describe('SessionManager.createIsolatedContext', () => {
    it('should call browser.createBrowserContext()', async () => {
      const session = new SessionManager();
      await session.launch({ headless: true, isolated: true });

      const isolatedContext = createMockBrowserContext();
      mocks.browser.createBrowserContext.mockResolvedValue(isolatedContext);

      const result = await session.createIsolatedContext();

      expect(mocks.browser.createBrowserContext).toHaveBeenCalledOnce();
      expect(result).toBe(isolatedContext);
    });

    it('should throw when browser is not connected', async () => {
      const session = new SessionManager();
      // Never launched, so browser is null

      await expect(session.createIsolatedContext()).rejects.toThrow('Browser not connected');
    });

    it('should throw when browser.connected is false', async () => {
      const session = new SessionManager();
      await session.launch({ headless: true, isolated: true });

      // Simulate browser disconnection
      mocks.browser.connected = false;

      await expect(session.createIsolatedContext()).rejects.toThrow('Browser not connected');
    });

    it('should create multiple independent contexts', async () => {
      const session = new SessionManager();
      await session.launch({ headless: true, isolated: true });

      const ctx1 = createMockBrowserContext();
      const ctx2 = createMockBrowserContext();
      mocks.browser.createBrowserContext.mockResolvedValueOnce(ctx1).mockResolvedValueOnce(ctx2);

      const result1 = await session.createIsolatedContext();
      const result2 = await session.createIsolatedContext();

      expect(result1).toBe(ctx1);
      expect(result2).toBe(ctx2);
      expect(result1).not.toBe(result2);
      expect(mocks.browser.createBrowserContext).toHaveBeenCalledTimes(2);
    });
  });

  describe('SessionStore.destroySession with browser_context', () => {
    it('should close browser_context when destroying session', async () => {
      const store = new SessionStore({ ttlMs: 0 });
      const sessionId = store.createSession('tenant-1');

      // Attach a mock browser context to the session
      const mockBrowserCtx = createMockBrowserContext();
      const session = store.getSession(sessionId)!;
      session.browser_context =
        mockBrowserCtx as unknown as import('puppeteer-core').BrowserContext;

      await store.destroySession(sessionId);

      expect(mockBrowserCtx.close).toHaveBeenCalledOnce();
      expect(store.hasSession(sessionId)).toBe(false);
    });

    it('should still destroy session if browser_context.close() throws', async () => {
      const store = new SessionStore({ ttlMs: 0 });
      const sessionId = store.createSession('tenant-1');

      const mockBrowserCtx = createMockBrowserContext();
      mockBrowserCtx.close.mockRejectedValue(new Error('Context already closed'));
      const session = store.getSession(sessionId)!;
      session.browser_context =
        mockBrowserCtx as unknown as import('puppeteer-core').BrowserContext;

      await store.destroySession(sessionId);

      expect(mockBrowserCtx.close).toHaveBeenCalledOnce();
      expect(store.hasSession(sessionId)).toBe(false);
    });

    it('should not call close when session has no browser_context', async () => {
      const store = new SessionStore({ ttlMs: 0 });
      const sessionId = store.createSession('tenant-1');

      // No browser_context attached
      await store.destroySession(sessionId);

      expect(store.hasSession(sessionId)).toBe(false);
    });

    it('should handle destroying unknown session gracefully', async () => {
      const store = new SessionStore({ ttlMs: 0 });

      // Should not throw
      await store.destroySession('nonexistent-session');
    });
  });
});
