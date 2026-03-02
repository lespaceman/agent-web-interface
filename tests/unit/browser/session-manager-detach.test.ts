/**
 * SessionManager.detach() Tests
 *
 * Tests for the detach() method that disconnects from a browser
 * without closing it, allowing the browser to survive MCP server exit.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SessionManager } from '../../../src/browser/session-manager.js';
import {
  createLinkedMocks,
  type MockBrowser,
  type MockBrowserContext,
  type MockPage,
  type MockCDPSession,
} from '../../mocks/puppeteer.mock.js';

// Mock Puppeteer module
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
    connect: vi.fn(),
  },
}));

// Import AFTER mocking
import puppeteer from 'puppeteer-core';

describe('SessionManager.detach', () => {
  let sessionManager: SessionManager;
  let mockBrowser: MockBrowser;
  let mockContext: MockBrowserContext;
  let mockPage: MockPage;
  let mockCdpSession: MockCDPSession;

  beforeEach(() => {
    vi.clearAllMocks();

    const mocks = createLinkedMocks({ url: 'https://example.com', title: 'Example' });
    mockBrowser = mocks.browser;
    mockContext = mocks.context;
    mockPage = mocks.page;
    mockCdpSession = mocks.cdpSession;

    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);
    (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
    mockBrowser.browserContexts.mockReturnValue([mockContext]);
    mockContext.pages.mockResolvedValue([mockPage]);

    sessionManager = new SessionManager();
  });

  describe('with launched browser', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should call browser.disconnect()', async () => {
      await sessionManager.detach();

      expect(mockBrowser.disconnect).toHaveBeenCalled();
    });

    it('should NOT call browser.close()', async () => {
      await sessionManager.detach();

      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it('should clean up CDP sessions', async () => {
      await sessionManager.createPage();

      await sessionManager.detach();

      expect(mockCdpSession.detach).toHaveBeenCalled();
    });

    it('should return isRunning() as false after detach', async () => {
      expect(sessionManager.isRunning()).toBe(true);

      await sessionManager.detach();

      expect(sessionManager.isRunning()).toBe(false);
    });

    it('should transition connectionState to idle', async () => {
      await sessionManager.detach();

      expect(sessionManager.connectionState).toBe('idle');
    });

    it('should clear the page registry', async () => {
      await sessionManager.createPage();
      expect(sessionManager.listPages()).toHaveLength(1);

      await sessionManager.detach();

      expect(sessionManager.listPages()).toHaveLength(0);
    });

    it('should save the WebSocket endpoint URL', async () => {
      mockBrowser.wsEndpoint.mockReturnValue('ws://127.0.0.1:9222/devtools/browser/abc');

      await sessionManager.detach();

      expect(sessionManager.lastWsEndpoint).toBe('ws://127.0.0.1:9222/devtools/browser/abc');
    });

    it('should remove browser disconnect listener before disconnecting', async () => {
      await sessionManager.detach();

      expect(mockBrowser.off).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });
  });

  describe('with connected (external) browser', () => {
    beforeEach(async () => {
      await sessionManager.connect({
        browserWSEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      });
    });

    it('should call browser.disconnect()', async () => {
      await sessionManager.detach();

      expect(mockBrowser.disconnect).toHaveBeenCalled();
    });

    it('should NOT call browser.close()', async () => {
      await sessionManager.detach();

      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it('should clean up CDP sessions for adopted pages', async () => {
      await sessionManager.adoptPage(0);

      await sessionManager.detach();

      expect(mockCdpSession.detach).toHaveBeenCalled();
    });
  });

  describe('no-op scenarios', () => {
    it('should be a no-op if browser is not connected', async () => {
      // No launch or connect called
      await expect(sessionManager.detach()).resolves.not.toThrow();
    });

    it('should be a no-op if already detached', async () => {
      await sessionManager.launch();
      await sessionManager.detach();

      // Second detach should not throw
      await expect(sessionManager.detach()).resolves.not.toThrow();
      // disconnect should only be called once
      expect(mockBrowser.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await sessionManager.launch();
    });

    it('should handle CDP session close errors gracefully', async () => {
      await sessionManager.createPage();
      mockCdpSession.detach.mockRejectedValue(new Error('Session already closed'));

      await expect(sessionManager.detach()).resolves.not.toThrow();
      expect(mockBrowser.disconnect).toHaveBeenCalled();
    });

    it('should handle wsEndpoint throwing gracefully', async () => {
      // Simulate wsEndpoint throwing (e.g., pipe transport)
      mockBrowser.wsEndpoint.mockImplementation(() => {
        throw new Error('No WebSocket endpoint available');
      });

      await expect(sessionManager.detach()).resolves.not.toThrow();
      expect(sessionManager.lastWsEndpoint).toBeUndefined();
    });
  });
});
