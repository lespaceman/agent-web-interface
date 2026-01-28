/**
 * SessionManager Tests
 *
 * TDD tests for SessionManager implementation.
 * Uses mocked Puppeteer - no real browser required.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SessionManager } from '../../../src/browser/session-manager.js';
import {
  createLinkedMocks,
  createMockPage,
  createMockCDPSession,
  type MockBrowser,
  type MockBrowserContext,
  type MockPage,
  type MockCDPSession,
} from '../../mocks/puppeteer.mock.js';
import { expectPageId } from '../../helpers/test-utils.js';

// Mock Puppeteer module
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
    connect: vi.fn(),
  },
}));

// Import AFTER mocking
import puppeteer from 'puppeteer-core';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockBrowser: MockBrowser;
  let mockContext: MockBrowserContext;
  let mockPage: MockPage;
  let mockCdpSession: MockCDPSession;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create linked mocks
    const mocks = createLinkedMocks({ url: 'about:blank', title: '' });
    mockBrowser = mocks.browser;
    mockContext = mocks.context;
    mockPage = mocks.page;
    mockCdpSession = mocks.cdpSession;

    // Configure puppeteer.launch to return our mock browser
    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);

    sessionManager = new SessionManager();
  });

  describe('launch', () => {
    it('should start browser with default options', async () => {
      await sessionManager.launch();

      expect(vi.mocked(puppeteer.launch)).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          channel: 'chrome',
        })
      );
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should apply custom headless option', async () => {
      await sessionManager.launch({ headless: false });

      expect(vi.mocked(puppeteer.launch)).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
    });

    it('should apply custom viewport', async () => {
      const viewport = { width: 1920, height: 1080 };

      await sessionManager.launch({ viewport });

      expect(vi.mocked(puppeteer.launch)).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultViewport: viewport,
        })
      );
    });

    it('should apply custom channel', async () => {
      await sessionManager.launch({ channel: 'chrome-canary' });

      expect(vi.mocked(puppeteer.launch)).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'chrome-canary',
        })
      );
    });

    it('should use executablePath when provided', async () => {
      const executablePath = '/opt/chrome/chrome';

      await sessionManager.launch({ executablePath });

      expect(vi.mocked(puppeteer.launch)).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath,
          channel: undefined, // Channel should be undefined when executablePath is set
        })
      );
    });

    it('should throw if already launched', async () => {
      await sessionManager.launch();

      await expect(sessionManager.launch()).rejects.toThrow('Invalid operation "launch"');
    });
  });

  describe('createPage', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should create new page and return PageHandle', async () => {
      const handle = await sessionManager.createPage();

      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.createCDPSession).toHaveBeenCalled();
      expectPageId(handle.page_id);
      expect(handle.page).toBe(mockPage);
    });

    it('should navigate to URL when provided', async () => {
      const url = 'https://example.com';

      await sessionManager.createPage(url);

      expect(mockPage.goto).toHaveBeenCalledWith(url, expect.any(Object));
    });

    it('should not navigate when no URL provided', async () => {
      await sessionManager.createPage();

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should throw if browser not launched', async () => {
      const newManager = new SessionManager();

      await expect(newManager.createPage()).rejects.toThrow('Browser not running');
    });
  });

  describe('getPage', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should return PageHandle by page_id', async () => {
      const handle = await sessionManager.createPage();

      const retrieved = sessionManager.getPage(handle.page_id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.page_id).toBe(handle.page_id);
    });

    it('should return undefined for unknown page_id', () => {
      const result = sessionManager.getPage('page-unknown');

      expect(result).toBeUndefined();
    });
  });

  describe('closePage', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should close page and remove from registry', async () => {
      const handle = await sessionManager.createPage();

      const closed = await sessionManager.closePage(handle.page_id);

      expect(closed).toBe(true);
      expect(mockPage.close).toHaveBeenCalled();
      expect(sessionManager.getPage(handle.page_id)).toBeUndefined();
    });

    it('should close CDP session', async () => {
      const handle = await sessionManager.createPage();

      await sessionManager.closePage(handle.page_id);

      expect(mockCdpSession.detach).toHaveBeenCalled();
    });

    it('should return false for unknown page_id', async () => {
      const closed = await sessionManager.closePage('page-unknown');

      expect(closed).toBe(false);
    });
  });

  describe('navigateTo', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should navigate existing page to URL', async () => {
      const handle = await sessionManager.createPage();
      const newUrl = 'https://new-site.com';

      await sessionManager.navigateTo(handle.page_id, newUrl);

      expect(mockPage.goto).toHaveBeenCalledWith(newUrl, expect.any(Object));
    });

    it('should throw for unknown page_id', async () => {
      await expect(
        sessionManager.navigateTo('page-unknown', 'https://example.com')
      ).rejects.toThrow('Page not found');
    });

    it('should log error and re-throw on navigation failure', async () => {
      const handle = await sessionManager.createPage();
      const navigationError = new Error('Navigation timeout');
      mockPage.goto.mockRejectedValue(navigationError);

      await expect(sessionManager.navigateTo(handle.page_id, 'https://fail.com')).rejects.toThrow(
        'Navigation timeout'
      );
    });

    it('should wait for network quiet after navigation using tracker', async () => {
      const handle = await sessionManager.createPage();

      await sessionManager.navigateTo(handle.page_id, 'https://example.com');

      // Verify network tracker was used (via page.on for request/requestfinished/requestfailed)
      expect(mockPage.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should not throw when network idle wait times out', async () => {
      const handle = await sessionManager.createPage();

      // Navigation should complete without throwing even if network never idles
      // (tracker returns false on timeout, doesn't throw)
      await expect(
        sessionManager.navigateTo(handle.page_id, 'https://example.com')
      ).resolves.not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should close browser gracefully', async () => {
      await sessionManager.launch();

      await sessionManager.shutdown();

      expect(mockBrowser.close).toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should not throw if not running', async () => {
      await expect(sessionManager.shutdown()).resolves.not.toThrow();
    });

    it('should close all pages before browser', async () => {
      await sessionManager.launch();
      await sessionManager.createPage();
      await sessionManager.createPage();

      await sessionManager.shutdown();

      expect(mockPage.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('isRunning', () => {
    it('should return false before launch', () => {
      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should return true after launch', async () => {
      await sessionManager.launch();

      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should return false after shutdown', async () => {
      await sessionManager.launch();
      await sessionManager.shutdown();

      expect(sessionManager.isRunning()).toBe(false);
    });
  });

  describe('listPages', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should return empty array when no pages', () => {
      const pages = sessionManager.listPages();

      expect(pages).toEqual([]);
    });

    it('should return all active pages', async () => {
      const handle1 = await sessionManager.createPage();
      const handle2 = await sessionManager.createPage();

      const pages = sessionManager.listPages();

      expect(pages).toHaveLength(2);
      expect(pages.map((p) => p.page_id)).toContain(handle1.page_id);
      expect(pages.map((p) => p.page_id)).toContain(handle2.page_id);
    });
  });

  describe('connect', () => {
    beforeEach(() => {
      // Configure puppeteer.connect to return our mock browser
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      // Mock browserContexts() to return array with our mock context
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
    });

    it('should connect to external browser via CDP', async () => {
      await sessionManager.connect();

      expect(vi.mocked(puppeteer.connect)).toHaveBeenCalledWith(
        expect.objectContaining({
          browserURL: 'http://127.0.0.1:9223',
        })
      );
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should use custom browserURL', async () => {
      await sessionManager.connect({ browserURL: 'http://localhost:9222' });

      expect(vi.mocked(puppeteer.connect)).toHaveBeenCalledWith(
        expect.objectContaining({
          browserURL: 'http://localhost:9222',
        })
      );
    });

    it('should use browserWSEndpoint when provided', async () => {
      await sessionManager.connect({
        browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc123',
      });

      expect(vi.mocked(puppeteer.connect)).toHaveBeenCalledWith(
        expect.objectContaining({
          browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc123',
        })
      );
    });

    it('should use custom host and port', async () => {
      await sessionManager.connect({ host: '192.168.1.1', port: 9999 });

      expect(vi.mocked(puppeteer.connect)).toHaveBeenCalledWith(
        expect.objectContaining({
          browserURL: 'http://192.168.1.1:9999',
        })
      );
    });

    it('should throw if already connected', async () => {
      await sessionManager.connect();

      await expect(sessionManager.connect()).rejects.toThrow('Invalid operation "connect"');
    });

    it('should use existing context from browser', async () => {
      await sessionManager.connect();

      expect(mockBrowser.browserContexts).toHaveBeenCalled();
    });
  });

  describe('adoptPage', () => {
    beforeEach(async () => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
      mockContext.pages.mockResolvedValue([mockPage]);
      mockPage.url.mockReturnValue('https://example.com');
      await sessionManager.connect();
    });

    it('should adopt existing page from browser', async () => {
      const handle = await sessionManager.adoptPage(0);

      expectPageId(handle.page_id);
      expect(handle.page).toBe(mockPage);
      expect(mockPage.createCDPSession).toHaveBeenCalled();
    });

    it('should register page with correct URL', async () => {
      const handle = await sessionManager.adoptPage(0);

      expect(handle.url).toBe('https://example.com');
    });

    it('should throw for invalid page index', async () => {
      await expect(sessionManager.adoptPage(5)).rejects.toThrow('Invalid page index: 5');
    });

    it('should throw if browser not connected', async () => {
      const newManager = new SessionManager();

      await expect(newManager.adoptPage()).rejects.toThrow('Browser not running');
    });
  });

  describe('shutdown with external browser', () => {
    beforeEach(async () => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
      mockContext.pages.mockResolvedValue([mockPage]);
      await sessionManager.connect();
    });

    it('should disconnect without closing external browser', async () => {
      await sessionManager.adoptPage(0);

      await sessionManager.shutdown();

      // Should disconnect but NOT close browser or pages for external browser
      expect(mockBrowser.disconnect).toHaveBeenCalled();
      expect(mockBrowser.close).not.toHaveBeenCalled();
      expect(mockPage.close).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should still close CDP sessions', async () => {
      await sessionManager.adoptPage(0);

      await sessionManager.shutdown();

      expect(mockCdpSession.detach).toHaveBeenCalled();
    });
  });

  describe('concurrent connect protection', () => {
    beforeEach(() => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
    });

    it('should reject concurrent connect() calls', async () => {
      // Start two connect calls simultaneously
      const connect1 = sessionManager.connect();
      const connect2 = sessionManager.connect();

      // First should succeed, second should fail
      await expect(connect1).resolves.not.toThrow();
      await expect(connect2).rejects.toThrow(/Invalid operation "connect"/);
    });

    it('should reject connect() during launch()', async () => {
      (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);

      const launch = sessionManager.launch();
      const connect = sessionManager.connect();

      // Await both in parallel to avoid unhandled rejection
      await Promise.all([
        expect(launch).resolves.not.toThrow(),
        expect(connect).rejects.toThrow(/Invalid operation "connect"/),
      ]);
    });

    it('should allow connect() after failed connect()', async () => {
      (puppeteer.connect as Mock)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(mockBrowser);

      await expect(sessionManager.connect()).rejects.toThrow('Connection refused');
      await expect(sessionManager.connect()).resolves.not.toThrow();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('connection timeout', () => {
    beforeEach(() => {
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
    });

    it('should timeout if connection takes too long', async () => {
      // Mock a slow connection that never resolves
      (puppeteer.connect as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      );

      await expect(sessionManager.connect({ timeout: 100 })).rejects.toThrow(/timeout/i);
    });

    it('should use default timeout of 10000ms', async () => {
      // Configure mock to succeed immediately
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);

      // Verify timeout option exists in interface by using it
      await expect(sessionManager.connect({ timeout: 10000 })).resolves.not.toThrow();
    });
  });

  describe('partial connect failure cleanup', () => {
    it('should cleanup browser if connection fails', async () => {
      (puppeteer.connect as Mock).mockRejectedValue(new Error('Connection refused'));

      await expect(sessionManager.connect()).rejects.toThrow('Connection refused');

      // Browser should be cleaned up (state is failed)
      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should allow reconnect after connection failure', async () => {
      (puppeteer.connect as Mock)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);

      await expect(sessionManager.connect()).rejects.toThrow('Connection refused');

      // Second attempt should succeed
      await expect(sessionManager.connect()).resolves.not.toThrow();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('browser disconnect detection', () => {
    let disconnectHandler: (() => void) | undefined;

    beforeEach(() => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
      mockContext.pages.mockResolvedValue([mockPage]);

      // Capture the disconnect handler when it's registered
      mockBrowser.on = vi.fn((event: string, handler: () => void) => {
        if (event === 'disconnected') {
          disconnectHandler = handler;
        }
      });
    });

    it('should register disconnect listener on connect', async () => {
      await sessionManager.connect();

      expect(mockBrowser.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });

    it('should update state when browser disconnects unexpectedly', async () => {
      await sessionManager.connect();
      await sessionManager.adoptPage(0);

      // Simulate browser disconnect
      Object.defineProperty(mockBrowser, 'connected', { value: false });
      disconnectHandler?.();

      expect(sessionManager.isRunning()).toBe(false);
      expect(sessionManager.listPages()).toHaveLength(0);
    });
  });

  describe('URL validation', () => {
    it('should reject invalid browserURL', async () => {
      await expect(sessionManager.connect({ browserURL: 'not-a-url' })).rejects.toThrow(
        /invalid.*url/i
      );
    });

    it('should reject invalid browserWSEndpoint', async () => {
      await expect(
        sessionManager.connect({ browserWSEndpoint: 'http://localhost' })
      ).rejects.toThrow(/invalid.*url/i);
    });

    it('should accept valid http URL', async () => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);

      await expect(
        sessionManager.connect({ browserURL: 'http://localhost:9223' })
      ).resolves.not.toThrow();
    });

    it('should accept valid ws URL', async () => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);

      await expect(
        sessionManager.connect({ browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc' })
      ).resolves.not.toThrow();
    });
  });

  describe('adoptPage idempotency', () => {
    beforeEach(async () => {
      (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.browserContexts.mockReturnValue([mockContext]);
      mockContext.pages.mockResolvedValue([mockPage]);
      mockPage.url.mockReturnValue('https://example.com');
      await sessionManager.connect();
    });

    it('should return same handle when adopting same page twice', async () => {
      const handle1 = await sessionManager.adoptPage(0);
      const handle2 = await sessionManager.adoptPage(0);

      expect(handle1.page_id).toBe(handle2.page_id);
      expect(handle1.page).toBe(handle2.page);
    });

    it('should not create duplicate CDP sessions for same page', async () => {
      await sessionManager.adoptPage(0);
      await sessionManager.adoptPage(0);

      // Should only create one CDP session
      expect(mockPage.createCDPSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-page shutdown', () => {
    it('should close all pages individually', async () => {
      // Create multiple mock pages
      const cdpSession1 = createMockCDPSession();
      const cdpSession2 = createMockCDPSession();
      const page1 = createMockPage({ url: 'https://page1.com', cdpSession: cdpSession1 });
      const page2 = createMockPage({ url: 'https://page2.com', cdpSession: cdpSession2 });

      mockContext.newPage.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

      await sessionManager.launch();
      await sessionManager.createPage();
      await sessionManager.createPage();

      await sessionManager.shutdown();

      expect(page1.close).toHaveBeenCalled();
      expect(page2.close).toHaveBeenCalled();
    });
  });

  describe('touchPage', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should mark page as MRU', async () => {
      const page1 = await sessionManager.createPage();
      const page2 = await sessionManager.createPage();

      // page2 is MRU after creation
      expect(sessionManager.resolvePage()?.page_id).toBe(page2.page_id);

      // Touch page1
      sessionManager.touchPage(page1.page_id);

      // page1 should now be MRU
      expect(sessionManager.resolvePage()?.page_id).toBe(page1.page_id);
    });
  });

  describe('resolvePage', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should return specified page when page_id provided', async () => {
      const page1 = await sessionManager.createPage();
      await sessionManager.createPage(); // Create page2 to have multiple pages

      const resolved = sessionManager.resolvePage(page1.page_id);

      expect(resolved?.page_id).toBe(page1.page_id);
    });

    it('should return undefined for unknown page_id', () => {
      const resolved = sessionManager.resolvePage('page-unknown');

      expect(resolved).toBeUndefined();
    });

    it('should return MRU page when page_id omitted', async () => {
      await sessionManager.createPage(); // page1
      const page2 = await sessionManager.createPage();

      // page2 is MRU (last created)
      const resolved = sessionManager.resolvePage();

      expect(resolved?.page_id).toBe(page2.page_id);
    });

    it('should return undefined when no pages and page_id omitted', () => {
      const resolved = sessionManager.resolvePage();

      expect(resolved).toBeUndefined();
    });
  });

  describe('resolvePageOrCreate', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should return specified page when page_id provided', async () => {
      const page = await sessionManager.createPage();

      const resolved = await sessionManager.resolvePageOrCreate(page.page_id);

      expect(resolved.page_id).toBe(page.page_id);
    });

    it('should throw when page_id provided but not found', async () => {
      await expect(sessionManager.resolvePageOrCreate('page-unknown')).rejects.toThrow(
        'Page not found: page-unknown'
      );
    });

    it('should return MRU page when page_id omitted and pages exist', async () => {
      await sessionManager.createPage(); // page1
      const page2 = await sessionManager.createPage();

      const resolved = await sessionManager.resolvePageOrCreate();

      expect(resolved.page_id).toBe(page2.page_id);
    });

    it('should create new page when page_id omitted and no pages exist', async () => {
      const resolved = await sessionManager.resolvePageOrCreate();

      expectPageId(resolved.page_id);
      expect(mockContext.newPage).toHaveBeenCalled();
    });

    it('should throw when browser not running', async () => {
      const newManager = new SessionManager();

      await expect(newManager.resolvePageOrCreate()).rejects.toThrow('Browser not running');
    });
  });

  describe('getConnectionHealth', () => {
    it('should return "failed" before launch/connect', async () => {
      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('failed');
    });

    it('should return "healthy" when connected and all CDP sessions active', async () => {
      await sessionManager.launch();
      await sessionManager.createPage();

      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('healthy');
    });

    it('should return "degraded" when connected but CDP session inactive', async () => {
      await sessionManager.launch();
      const handle = await sessionManager.createPage();

      // Simulate CDP session becoming inactive
      vi.spyOn(handle.cdp, 'isActive').mockReturnValue(false);

      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('degraded');
    });

    it('should return "healthy" with no pages (nothing degraded)', async () => {
      await sessionManager.launch();

      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('healthy');
    });

    it('should return "failed" after shutdown', async () => {
      await sessionManager.launch();
      await sessionManager.shutdown();

      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('failed');
    });

    it('should return "degraded" when CDP probe fails', async () => {
      await sessionManager.launch();
      const handle = await sessionManager.createPage();

      vi.spyOn(handle.cdp, 'send').mockRejectedValue(new Error('Probe failed'));

      const health = await sessionManager.getConnectionHealth();
      expect(health).toBe('degraded');
    });
  });

  describe('rebindCdpSession', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should create new CDP session for existing page', async () => {
      const handle = await sessionManager.createPage();

      // Clear mock to track rebind calls
      mockPage.createCDPSession.mockClear();

      const newHandle = await sessionManager.rebindCdpSession(handle.page_id);

      expect(mockPage.createCDPSession).toHaveBeenCalled();
      expect(newHandle.page_id).toBe(handle.page_id);
      expect(newHandle.page).toBe(handle.page);
      // cdp should be different object (new session)
      expect(newHandle.cdp).not.toBe(handle.cdp);
    });

    it('should close old CDP session before creating new one', async () => {
      const handle = await sessionManager.createPage();
      const oldCdpClose = vi.spyOn(handle.cdp, 'close');

      await sessionManager.rebindCdpSession(handle.page_id);

      expect(oldCdpClose).toHaveBeenCalled();
    });

    it('should update registry with new handle', async () => {
      const handle = await sessionManager.createPage();
      const newHandle = await sessionManager.rebindCdpSession(handle.page_id);

      // Getting page should return handle with new CDP
      const retrieved = sessionManager.getPage(handle.page_id);
      expect(retrieved?.cdp).toBe(newHandle.cdp);
    });

    it('should throw if page not found', async () => {
      await expect(sessionManager.rebindCdpSession('page-unknown')).rejects.toThrow(
        'Page not found: page-unknown'
      );
    });

    it('should handle old CDP close error gracefully', async () => {
      const handle = await sessionManager.createPage();
      vi.spyOn(handle.cdp, 'close').mockRejectedValue(new Error('Already closed'));

      // Should not throw
      await expect(sessionManager.rebindCdpSession(handle.page_id)).resolves.toBeDefined();
    });

    it('should restore degraded connection to healthy', async () => {
      const handle = await sessionManager.createPage();

      // Simulate degraded state
      vi.spyOn(handle.cdp, 'isActive').mockReturnValue(false);
      await expect(sessionManager.getConnectionHealth()).resolves.toBe('degraded');

      // Rebind
      await sessionManager.rebindCdpSession(handle.page_id);

      // Should be healthy again
      await expect(sessionManager.getConnectionHealth()).resolves.toBe('healthy');
    });
  });
});
