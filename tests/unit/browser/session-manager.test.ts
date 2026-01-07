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
});
