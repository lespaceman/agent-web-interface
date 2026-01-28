/**
 * ensureBrowserReady Tests
 *
 * TDD tests for lazy browser initialization.
 * Uses mocked Puppeteer - no real browser required.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SessionManager } from '../../../src/browser/session-manager.js';
import { createLinkedMocks, type MockBrowser } from '../../mocks/puppeteer.mock.js';

// Mock Puppeteer module
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
    connect: vi.fn(),
  },
}));

import puppeteer from 'puppeteer-core';

describe('ensureBrowserReady', () => {
  let sessionManager: SessionManager;
  let mockBrowser: MockBrowser;

  beforeEach(() => {
    vi.clearAllMocks();

    const mocks = createLinkedMocks({ url: 'about:blank' });
    mockBrowser = mocks.browser;

    // Configure browserContexts for connect scenarios
    mockBrowser.browserContexts.mockReturnValue([mocks.context]);

    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);
    (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);

    sessionManager = new SessionManager();
  });

  // Import dynamically to get fresh module with mocks
  const getEnsureBrowserReady = async () => {
    const mod = await import('../../../src/browser/ensure-browser.js');
    return mod.ensureBrowserReady;
  };

  describe('when browser is already running', () => {
    it('should return immediately without launching', async () => {
      // First launch browser
      await sessionManager.launch();
      expect(sessionManager.isRunning()).toBe(true);

      const ensureBrowserReady = await getEnsureBrowserReady();

      // Reset mock call count
      (puppeteer.launch as Mock).mockClear();

      // Call ensure - should not launch again
      await ensureBrowserReady(sessionManager, {});

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('when browser is not running', () => {
    it('should launch browser with default options (headless: false)', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, {});

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should launch with headless=true when specified', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, { headless: true });

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
        })
      );
    });

    it('should connect instead of launch when browserUrl provided', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, {
        browserUrl: 'http://localhost:9222',
      });

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(puppeteer.connect).toHaveBeenCalled();
    });

    it('should connect instead of launch when wsEndpoint provided', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, {
        wsEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      });

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(puppeteer.connect).toHaveBeenCalled();
    });

    // Skip: autoConnect reads DevToolsActivePort file which requires Chrome
    // running with remote debugging. Can't mock fs in unit tests due to
    // dynamic imports. This is tested manually.
    it.skip('should connect instead of launch when autoConnect is true', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, { autoConnect: true });

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(puppeteer.connect).toHaveBeenCalled();
    });

    it('should pass isolated option to launch', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, { isolated: true });

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          userDataDir: undefined, // isolated means no persistent profile
        })
      );
    });

    it('should pass channel option to launch', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, { channel: 'chrome-canary' });

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'chrome-canary',
        })
      );
    });

    it('should pass executablePath option to launch', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      await ensureBrowserReady(sessionManager, { executablePath: '/opt/chrome/chrome' });

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/opt/chrome/chrome',
        })
      );
    });
  });
});
