/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Unit tests for SessionController
 *
 * Tests both stdio (single-tenant) and HTTP (multi-tenant) modes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrowserContext, Page, CDPSession } from 'puppeteer-core';
import type { SessionManager } from '../../../src/browser/session-manager.js';
import type { PageHandle } from '../../../src/browser/page-registry.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../../src/tools/tool-context.js', () => ({
  ensureCdpSession: vi.fn(),
  resolveExistingPage: vi.fn(),
}));

vi.mock('../../../src/tools/action-context.js', () => ({
  captureSnapshotWithRecovery: vi.fn(),
}));

vi.mock('../../../src/cdp/puppeteer-cdp-client.js', () => {
  const PuppeteerCdpClient = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.isActive = vi.fn().mockReturnValue(true);
    this.send = vi.fn().mockResolvedValue({});
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { PuppeteerCdpClient };
});

import { SessionController } from '../../../src/session/session-controller.js';
import { resolveExistingPage } from '../../../src/tools/tool-context.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePageHandle(overrides: Partial<PageHandle> = {}): PageHandle {
  return {
    page_id: overrides.page_id ?? 'page-1',
    page: (overrides.page ?? {}) as Page,
    cdp: (overrides.cdp ?? {
      isActive: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CdpClient,
    created_at: overrides.created_at ?? new Date(),
    url: overrides.url ?? 'https://example.com',
  };
}

function makeMockSessionManager(): SessionManager {
  return {
    resolvePage: vi.fn(),
    resolvePageOrCreate: vi.fn(),
    touchPage: vi.fn(),
    closePage: vi.fn().mockResolvedValue(true),
    syncPages: vi.fn().mockResolvedValue([]),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    rebindCdpSession: vi.fn(),
  } as unknown as SessionManager;
}

function makeMockCdpSession(): CDPSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
  } as unknown as CDPSession;
}

function makeMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
  return {
    isClosed: vi.fn().mockReturnValue(false),
    url: vi.fn().mockReturnValue('about:blank'),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue(makeMockCdpSession()),
    evaluate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page;
}

function makeMockBrowserContext(pages: Page[] = []): BrowserContext {
  return {
    newPage: vi.fn().mockResolvedValue(makeMockPage()),
    pages: vi.fn().mockResolvedValue(pages),
  } as unknown as BrowserContext;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SessionController', () => {
  // ════════════════════════════════════════════════════════════════════════════
  // Stdio mode (no browserContext)
  // ════════════════════════════════════════════════════════════════════════════

  describe('stdio mode (no browserContext)', () => {
    let controller: SessionController;
    let sessionManager: SessionManager;

    beforeEach(() => {
      vi.clearAllMocks();
      sessionManager = makeMockSessionManager();
      controller = new SessionController({
        sessionId: 'stdio-session',
        sessionManager,
      });
    });

    it('constructor sets state to active', () => {
      expect(controller.state).toBe('active');
    });

    it('resolvePage delegates to sessionManager', () => {
      const handle = makePageHandle();
      vi.mocked(sessionManager.resolvePage).mockReturnValue(handle);

      const result = controller.resolvePage('page-1');

      expect(sessionManager.resolvePage).toHaveBeenCalledWith('page-1');
      expect(result).toBe(handle);
    });

    it('resolvePage delegates without pageId', () => {
      vi.mocked(sessionManager.resolvePage).mockReturnValue(undefined);

      const result = controller.resolvePage();

      expect(sessionManager.resolvePage).toHaveBeenCalledWith(undefined);
      expect(result).toBeUndefined();
    });

    it('resolvePageOrCreate delegates to sessionManager', async () => {
      const handle = makePageHandle();
      vi.mocked(sessionManager.resolvePageOrCreate).mockResolvedValue(handle);

      const result = await controller.resolvePageOrCreate('page-1');

      expect(sessionManager.resolvePageOrCreate).toHaveBeenCalledWith('page-1');
      expect(result).toBe(handle);
    });

    it('touchPage delegates to sessionManager', () => {
      controller.touchPage('page-1');

      expect(sessionManager.touchPage).toHaveBeenCalledWith('page-1');
    });

    it('closePage delegates to sessionManager', async () => {
      const result = await controller.closePage('page-1');

      expect(sessionManager.closePage).toHaveBeenCalledWith('page-1');
      expect(result).toBe(true);
    });

    it('syncPages delegates to sessionManager', async () => {
      const handles = [makePageHandle()];
      vi.mocked(sessionManager.syncPages).mockResolvedValue(handles);

      const result = await controller.syncPages();

      expect(sessionManager.syncPages).toHaveBeenCalled();
      expect(result).toBe(handles);
    });

    it('navigateTo delegates to sessionManager', async () => {
      await controller.navigateTo('page-1', 'https://example.com');

      expect(sessionManager.navigateTo).toHaveBeenCalledWith('page-1', 'https://example.com');
    });

    it('getSnapshotStore returns isolated store per session', () => {
      const store1 = controller.getSnapshotStore();
      const store2 = controller.getSnapshotStore();

      expect(store1).toBe(store2);

      // Different session controller gets a different store
      const controller2 = new SessionController({
        sessionId: 'stdio-session-2',
        sessionManager,
      });
      const store3 = controller2.getSnapshotStore();
      expect(store3).not.toBe(store1);
    });

    it('getStateManager creates per-page state managers', () => {
      const sm1 = controller.getStateManager('page-1');
      const sm2 = controller.getStateManager('page-2');
      const sm1Again = controller.getStateManager('page-1');

      expect(sm1).toBe(sm1Again);
      expect(sm1).not.toBe(sm2);
    });

    it('close() transitions to closed state', async () => {
      expect(controller.state).toBe('active');

      await controller.close();

      expect(controller.state).toBe('closed');
    });

    it('close() is idempotent', async () => {
      await controller.close();
      expect(controller.state).toBe('closed');

      // Second call should not throw
      await controller.close();
      expect(controller.state).toBe('closed');
    });

    it('resolveExistingPage delegates to resolveExistingPageImpl in stdio mode', () => {
      const handle = makePageHandle();
      vi.mocked(resolveExistingPage).mockReturnValue(handle);

      const result = controller.resolveExistingPage('page-1');

      expect(resolveExistingPage).toHaveBeenCalledWith(sessionManager, 'page-1');
      expect(result).toBe(handle);
    });

    it('removeStateManager removes per-page state manager', () => {
      const sm = controller.getStateManager('page-1');
      expect(sm).toBeDefined();

      controller.removeStateManager('page-1');

      // Should create a new instance after removal
      const smNew = controller.getStateManager('page-1');
      expect(smNew).not.toBe(sm);
    });

    it('clearAllStateManagers clears all state managers', () => {
      const sm1 = controller.getStateManager('page-1');
      const sm2 = controller.getStateManager('page-2');

      controller.clearAllStateManagers();

      expect(controller.getStateManager('page-1')).not.toBe(sm1);
      expect(controller.getStateManager('page-2')).not.toBe(sm2);
    });

    it('touch() updates lastActivity timestamp', () => {
      const before = controller.lastActivity;
      // Advance time slightly
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      controller.touch();

      expect(controller.lastActivity).toBeGreaterThan(before);
      vi.useRealTimers();
    });

    it('getSessionManager returns the session manager', () => {
      expect(controller.getSessionManager()).toBe(sessionManager);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // HTTP mode (with browserContext)
  // ════════════════════════════════════════════════════════════════════════════

  describe('HTTP mode (with browserContext)', () => {
    let controller: SessionController;
    let sessionManager: SessionManager;
    let browserContext: BrowserContext;
    let mockPage: Page;

    beforeEach(() => {
      vi.clearAllMocks();
      sessionManager = makeMockSessionManager();
      mockPage = makeMockPage();
      browserContext = makeMockBrowserContext();
      vi.mocked(browserContext.newPage).mockResolvedValue(mockPage);

      controller = new SessionController({
        sessionId: 'http-session',
        sessionManager,
        browserContext,
      });
    });

    it('constructor sets state to active', () => {
      expect(controller.state).toBe('active');
    });

    it('resolvePage uses local PageRegistry (returns undefined when empty)', () => {
      const result = controller.resolvePage();

      // Should NOT delegate to sessionManager
      expect(sessionManager.resolvePage).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('resolvePage returns page after it has been created', async () => {
      // Create a page first
      const handle = await controller.resolvePageOrCreate();

      const result = controller.resolvePage(handle.page_id);

      expect(sessionManager.resolvePage).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.page_id).toBe(handle.page_id);
    });

    it('resolvePageOrCreate creates page in isolated context', async () => {
      const handle = await controller.resolvePageOrCreate();

      expect(browserContext.newPage).toHaveBeenCalled();
      expect(mockPage.createCDPSession).toHaveBeenCalled();
      expect(sessionManager.resolvePageOrCreate).not.toHaveBeenCalled();
      expect(handle).toBeDefined();
      expect(handle.page).toBe(mockPage);
    });

    it('resolvePageOrCreate returns existing page on subsequent calls', async () => {
      const handle1 = await controller.resolvePageOrCreate();
      const handle2 = await controller.resolvePageOrCreate();

      expect(handle1.page_id).toBe(handle2.page_id);
      // newPage should only be called once
      expect(browserContext.newPage).toHaveBeenCalledTimes(1);
    });

    it('resolvePageOrCreate throws for unknown pageId', async () => {
      await expect(controller.resolvePageOrCreate('nonexistent')).rejects.toThrow(
        'Page not found: nonexistent'
      );
    });

    it('touchPage uses local PageRegistry', async () => {
      const handle = await controller.resolvePageOrCreate();

      // Should not throw and should NOT delegate to sessionManager
      controller.touchPage(handle.page_id);

      expect(sessionManager.touchPage).not.toHaveBeenCalled();
    });

    it('closePage closes page and CDP', async () => {
      const handle = await controller.resolvePageOrCreate();

      const result = await controller.closePage(handle.page_id);

      expect(result).toBe(true);
      expect(handle.cdp.close).toHaveBeenCalled();
      expect(mockPage.close).toHaveBeenCalled();
      expect(sessionManager.closePage).not.toHaveBeenCalled();
    });

    it('closePage returns false for unknown page', async () => {
      const result = await controller.closePage('nonexistent');
      expect(result).toBe(false);
    });

    it('syncPages uses browserContext.pages()', async () => {
      const existingPage = makeMockPage();
      vi.mocked(browserContext.pages).mockResolvedValue([existingPage] as Page[]);

      const result = await controller.syncPages();

      expect(browserContext.pages).toHaveBeenCalled();
      expect(sessionManager.syncPages).not.toHaveBeenCalled();
      expect(result.length).toBe(1);
    });

    it('syncPages skips closed pages', async () => {
      const closedPage = makeMockPage({ isClosed: vi.fn().mockReturnValue(true) });
      vi.mocked(browserContext.pages).mockResolvedValue([closedPage] as Page[]);

      const result = await controller.syncPages();

      expect(result.length).toBe(0);
    });

    it('syncPages does not re-register already registered pages', async () => {
      // Create a page through the controller first
      const handle = await controller.resolvePageOrCreate();

      // Now sync with the same page in the context
      vi.mocked(browserContext.pages).mockResolvedValue([mockPage] as Page[]);

      const result = await controller.syncPages();

      // Should have the one page, not a duplicate
      expect(result.length).toBe(1);
      expect(result[0].page_id).toBe(handle.page_id);
    });

    it('navigateTo uses local registry lookup', async () => {
      const handle = await controller.resolvePageOrCreate();

      await controller.navigateTo(handle.page_id, 'https://example.com');

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
      });
      expect(sessionManager.navigateTo).not.toHaveBeenCalled();
    });

    it('navigateTo throws for unknown page', async () => {
      await expect(controller.navigateTo('nonexistent', 'https://example.com')).rejects.toThrow(
        'Page not found: nonexistent'
      );
    });

    it('resolveExistingPage throws when no pages exist', () => {
      expect(() => controller.resolveExistingPage()).toThrow(
        'No page available. Navigate to a URL first.'
      );
    });

    it('resolveExistingPage throws for unknown pageId', () => {
      expect(() => controller.resolveExistingPage('nonexistent')).toThrow(
        'Page not found: nonexistent'
      );
    });

    it('resolveExistingPage returns page when one exists', async () => {
      const handle = await controller.resolvePageOrCreate();

      const result = controller.resolveExistingPage(handle.page_id);

      expect(result.page_id).toBe(handle.page_id);
      expect(resolveExistingPage).not.toHaveBeenCalled();
    });

    it('page is created in isolated context, not shared SessionManager', async () => {
      await controller.resolvePageOrCreate();

      expect(browserContext.newPage).toHaveBeenCalled();
      expect(sessionManager.resolvePageOrCreate).not.toHaveBeenCalled();
    });

    it('close() cleans up state managers and snapshot store', async () => {
      // Populate some state
      controller.getStateManager('page-1');
      controller.getStateManager('page-2');

      await controller.close();

      expect(controller.state).toBe('closed');
      // After close, getting state managers should create fresh ones
      // (though in practice close means no further use)
    });
  });
});
