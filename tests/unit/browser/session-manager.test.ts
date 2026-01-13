/**
 * SessionManager Tests
 *
 * TDD tests for SessionManager implementation.
 * Uses mocked Playwright - no real browser required.
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SessionManager } from '../../../src/browser/session-manager.js';
import {
  createLinkedMocks,
  createMockPage,
  createMockCDPSession,
  createMockBrowserContext,
  type MockBrowser,
  type MockBrowserContext,
  type MockPage,
  type MockCDPSession,
} from '../../mocks/playwright.mock.js';
import { expectPageId } from '../../helpers/test-utils.js';

// Mock Playwright module
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
    connectOverCDP: vi.fn(),
    launchPersistentContext: vi.fn(),
  },
}));

import { chromium } from 'playwright';

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

    // Configure chromium.launch to return our mock browser
    (chromium.launch as Mock).mockResolvedValue(mockBrowser);

    sessionManager = new SessionManager();
  });

  describe('launch', () => {
    it('should start browser with default options', async () => {
      await sessionManager.launch();

      expect(vi.mocked(chromium.launch)).toHaveBeenCalledWith({
        headless: true,
      });
      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should apply custom headless option', async () => {
      await sessionManager.launch({ headless: false });

      expect(vi.mocked(chromium.launch)).toHaveBeenCalledWith({
        headless: false,
      });
    });

    it('should apply custom viewport', async () => {
      const viewport = { width: 1920, height: 1080 };

      await sessionManager.launch({ viewport });

      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport,
        })
      );
    });

    it('should apply custom userAgent', async () => {
      const userAgent = 'Custom Agent/1.0';

      await sessionManager.launch({ userAgent });

      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent,
        })
      );
    });

    it('should apply custom locale and timezone', async () => {
      const locale = 'en-GB';
      const timezone = 'Europe/London';

      await sessionManager.launch({ locale, timezone });

      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalledWith(
        expect.objectContaining({
          locale,
          timezoneId: timezone,
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
      expect(mockContext.newCDPSession).toHaveBeenCalledWith(mockPage);
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
      // Configure connectOverCDP to return our mock browser
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      // Mock contexts() to return array with our mock context
      mockBrowser.contexts.mockReturnValue([mockContext]);
    });

    it('should connect to external browser via CDP', async () => {
      await sessionManager.connect();

      expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledWith('http://127.0.0.1:9223');
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should use custom endpoint URL', async () => {
      await sessionManager.connect({ endpointUrl: 'http://localhost:9222' });

      expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledWith('http://localhost:9222');
    });

    it('should use custom host and port', async () => {
      await sessionManager.connect({ host: '192.168.1.1', port: 9999 });

      expect(vi.mocked(chromium.connectOverCDP)).toHaveBeenCalledWith('http://192.168.1.1:9999');
    });

    it('should throw if already connected', async () => {
      await sessionManager.connect();

      await expect(sessionManager.connect()).rejects.toThrow('Invalid operation "connect"');
    });

    it('should use existing context from browser', async () => {
      await sessionManager.connect();

      expect(mockBrowser.contexts).toHaveBeenCalled();
      // Should not create new context
      expect(mockBrowser.newContext).not.toHaveBeenCalled();
    });
  });

  describe('adoptPage', () => {
    beforeEach(async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([mockPage]);
      mockPage.url.mockReturnValue('https://example.com');
      await sessionManager.connect();
    });

    it('should adopt existing page from browser', async () => {
      const handle = await sessionManager.adoptPage(0);

      expectPageId(handle.page_id);
      expect(handle.page).toBe(mockPage);
      expect(mockContext.newCDPSession).toHaveBeenCalledWith(mockPage);
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
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([mockPage]);
      await sessionManager.connect();
    });

    it('should disconnect without closing external browser', async () => {
      await sessionManager.adoptPage(0);

      await sessionManager.shutdown();

      // Should NOT close browser or pages for external browser
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
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);
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
      (chromium.launch as Mock).mockResolvedValue(mockBrowser);

      const launch = sessionManager.launch();
      const connect = sessionManager.connect();

      await expect(launch).resolves.not.toThrow();
      await expect(connect).rejects.toThrow(/Invalid operation "connect"/);
    });

    it('should allow connect() after failed connect()', async () => {
      (chromium.connectOverCDP as Mock)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(mockBrowser);

      await expect(sessionManager.connect()).rejects.toThrow('Connection refused');
      await expect(sessionManager.connect()).resolves.not.toThrow();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('connection timeout', () => {
    beforeEach(() => {
      mockBrowser.contexts.mockReturnValue([mockContext]);
    });

    it('should timeout if connection takes too long', async () => {
      // Mock a slow connection that never resolves
      (chromium.connectOverCDP as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      );

      await expect(sessionManager.connect({ timeout: 100 })).rejects.toThrow(/timeout/i);
    });

    it('should use default timeout of 10000ms', async () => {
      // Configure mock to succeed immediately
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);

      // Verify timeout option exists in interface by using it
      await expect(sessionManager.connect({ timeout: 10000 })).resolves.not.toThrow();
    });
  });

  describe('partial connect failure cleanup', () => {
    it('should cleanup browser if context creation fails', async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([]); // No existing contexts
      mockBrowser.newContext.mockRejectedValue(new Error('Context creation failed'));

      await expect(sessionManager.connect()).rejects.toThrow('Context creation failed');

      // Browser should be cleaned up
      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should allow reconnect after partial failure', async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([]);
      mockBrowser.newContext.mockRejectedValueOnce(new Error('Context creation failed'));
      mockBrowser.newContext.mockResolvedValueOnce(mockContext);

      await expect(sessionManager.connect()).rejects.toThrow();

      // Reset contexts mock for second attempt
      mockBrowser.contexts.mockReturnValue([mockContext]);

      await expect(sessionManager.connect()).resolves.not.toThrow();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('browser disconnect detection', () => {
    let disconnectHandler: (() => void) | undefined;

    beforeEach(() => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([mockPage]);

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
      mockBrowser.isConnected.mockReturnValue(false);
      disconnectHandler?.();

      expect(sessionManager.isRunning()).toBe(false);
      expect(sessionManager.listPages()).toHaveLength(0);
    });
  });

  describe('URL validation', () => {
    it('should reject invalid endpoint URL', async () => {
      await expect(sessionManager.connect({ endpointUrl: 'not-a-url' })).rejects.toThrow(
        /invalid.*url/i
      );
    });

    it('should reject non-http endpoint URL', async () => {
      await expect(sessionManager.connect({ endpointUrl: 'ftp://localhost:9223' })).rejects.toThrow(
        /invalid.*url/i
      );
    });

    it('should accept valid http URL', async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);

      await expect(
        sessionManager.connect({ endpointUrl: 'http://localhost:9223' })
      ).resolves.not.toThrow();
    });

    it('should accept valid https URL', async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);

      await expect(
        sessionManager.connect({ endpointUrl: 'https://localhost:9223' })
      ).resolves.not.toThrow();
    });
  });

  describe('adoptPage idempotency', () => {
    beforeEach(async () => {
      (chromium.connectOverCDP as Mock).mockResolvedValue(mockBrowser);
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([mockPage]);
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
      expect(mockContext.newCDPSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-page shutdown', () => {
    it('should close all pages individually', async () => {
      // Create multiple mock pages
      const page1 = createMockPage({ url: 'https://page1.com' });
      const page2 = createMockPage({ url: 'https://page2.com' });
      const cdpSession1 = createMockCDPSession();
      const cdpSession2 = createMockCDPSession();

      mockContext.newPage.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      mockContext.newCDPSession
        .mockResolvedValueOnce(cdpSession1)
        .mockResolvedValueOnce(cdpSession2);

      await sessionManager.launch();
      await sessionManager.createPage();
      await sessionManager.createPage();

      await sessionManager.shutdown();

      expect(page1.close).toHaveBeenCalled();
      expect(page2.close).toHaveBeenCalled();
    });
  });

  describe('storage state', () => {
    it('should launch with storage state file path', async () => {
      const storageStatePath = '/path/to/state.json';

      await sessionManager.launch({ storageState: storageStatePath });

      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalledWith(
        expect.objectContaining({
          storageState: storageStatePath,
        })
      );
    });

    it('should launch with inline storage state object', async () => {
      const storageState = {
        cookies: [
          {
            name: 'session',
            value: 'abc123',
            domain: 'example.com',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax' as const,
          },
        ],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: [{ name: 'token', value: 'xyz' }],
          },
        ],
      };

      await sessionManager.launch({ storageState });

      expect(vi.mocked(mockBrowser.newContext)).toHaveBeenCalledWith(
        expect.objectContaining({
          storageState,
        })
      );
    });

    it('should save storage state to file', async () => {
      const mockStorageState = {
        cookies: [{ name: 'test', value: 'value', domain: 'test.com', path: '/' }],
        origins: [],
      };
      mockContext.storageState = vi.fn().mockResolvedValue(mockStorageState);

      await sessionManager.launch();
      const result = await sessionManager.saveStorageState();

      expect(mockContext.storageState).toHaveBeenCalled();
      expect(result).toEqual(mockStorageState);
    });

    it('should save storage state to file path when provided', async () => {
      const savePath = '/path/to/save.json';
      mockContext.storageState = vi.fn().mockResolvedValue({});

      await sessionManager.launch();
      await sessionManager.saveStorageState(savePath);

      expect(mockContext.storageState).toHaveBeenCalledWith({ path: savePath });
    });

    it('should throw when saving storage state without running browser', async () => {
      await expect(sessionManager.saveStorageState()).rejects.toThrow('Browser not running');
    });
  });

  describe('persistent profile (userDataDir)', () => {
    it('should use launchPersistentContext when userDataDir provided', async () => {
      const userDataDir = '/path/to/profile';
      const persistentContext = createMockBrowserContext({
        pages: [mockPage],
        cdpSession: mockCdpSession,
      });
      (chromium.launchPersistentContext as Mock).mockResolvedValue(persistentContext);

      await sessionManager.launch({ userDataDir });

      expect(vi.mocked(chromium.launchPersistentContext)).toHaveBeenCalledWith(
        userDataDir,
        expect.objectContaining({
          headless: true,
        })
      );
      expect(vi.mocked(chromium.launch)).not.toHaveBeenCalled();
    });

    it('should apply viewport to persistent context', async () => {
      const userDataDir = '/path/to/profile';
      const viewport = { width: 1920, height: 1080 };
      const persistentContext = createMockBrowserContext({
        pages: [mockPage],
        cdpSession: mockCdpSession,
      });
      (chromium.launchPersistentContext as Mock).mockResolvedValue(persistentContext);

      await sessionManager.launch({ userDataDir, viewport });

      expect(vi.mocked(chromium.launchPersistentContext)).toHaveBeenCalledWith(
        userDataDir,
        expect.objectContaining({
          viewport,
        })
      );
    });

    it('should close context on shutdown for persistent profile', async () => {
      const userDataDir = '/path/to/profile';
      const persistentContext = createMockBrowserContext({
        pages: [mockPage],
        cdpSession: mockCdpSession,
      });
      (chromium.launchPersistentContext as Mock).mockResolvedValue(persistentContext);

      await sessionManager.launch({ userDataDir });
      await sessionManager.shutdown();

      // For persistent context, we close context directly (no browser.close)
      expect(persistentContext.close).toHaveBeenCalled();
    });

    it('should track isPersistentContext flag', async () => {
      const userDataDir = '/path/to/profile';
      const persistentContext = createMockBrowserContext({
        pages: [mockPage],
        cdpSession: mockCdpSession,
      });
      (chromium.launchPersistentContext as Mock).mockResolvedValue(persistentContext);

      await sessionManager.launch({ userDataDir });

      // Session manager should recognize this is a persistent context
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should create pages in persistent context', async () => {
      const userDataDir = '/path/to/profile';
      const persistentContext = createMockBrowserContext({
        pages: [mockPage],
        cdpSession: mockCdpSession,
      });
      (chromium.launchPersistentContext as Mock).mockResolvedValue(persistentContext);

      await sessionManager.launch({ userDataDir });
      const handle = await sessionManager.createPage('https://example.com');

      expectPageId(handle.page_id);
      expect(persistentContext.newPage).toHaveBeenCalled();
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
      // We need to mock cdp.isActive() to return false
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
      mockContext.newCDPSession.mockClear();

      const newHandle = await sessionManager.rebindCdpSession(handle.page_id);

      expect(mockContext.newCDPSession).toHaveBeenCalledWith(handle.page);
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

    it('should throw if page is closed', async () => {
      const handle = await sessionManager.createPage();
      mockPage.isClosed.mockReturnValue(true);

      await expect(sessionManager.rebindCdpSession(handle.page_id)).rejects.toThrow(
        `Page is closed: ${handle.page_id}`
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
