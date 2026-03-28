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

// Hoisted mock functions (vi.mock factories run before variable declarations)
const { mockAccess, mockUnlink, mockMkdir, mockReadFile } = vi.hoisted(() => ({
  mockAccess: vi.fn<(path: string, mode?: number) => Promise<void>>(),
  mockUnlink: vi.fn<(path: string) => Promise<void>>(),
  mockMkdir: vi.fn<(path: string, options?: object) => Promise<string | undefined>>(),
  mockReadFile: vi.fn<(path: string, encoding?: string) => Promise<string>>(),
}));

// Mock node:fs for DevToolsActivePort detection and profile directory creation
vi.mock('node:fs', () => ({
  default: {
    promises: {
      access: mockAccess,
      unlink: mockUnlink,
      mkdir: mockMkdir,
      readFile: mockReadFile,
    },
    constants: { F_OK: 0 },
  },
  promises: {
    access: mockAccess,
    unlink: mockUnlink,
    mkdir: mockMkdir,
    readFile: mockReadFile,
  },
  constants: { F_OK: 0 },
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

    // Default: DevToolsActivePort does not exist (readFile fails with ENOENT)
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);

    sessionManager = new SessionManager();
  });

  // Dynamic import so vi.mock hoisting takes effect before module load
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

    it('should connect instead of launch when AWI_CDP_URL env var is set', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      process.env.AWI_CDP_URL = 'http://localhost:9222';
      try {
        await ensureBrowserReady(sessionManager, {});

        expect(puppeteer.launch).not.toHaveBeenCalled();
        expect(puppeteer.connect).toHaveBeenCalled();
      } finally {
        delete process.env.AWI_CDP_URL;
      }
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
  });

  describe('when connection is in progress', () => {
    it('should await in-flight connection instead of launching again', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Use a deferred promise to control launch timing
      let resolveLaunch!: (value: typeof mockBrowser) => void;
      (puppeteer.launch as Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLaunch = resolve;
          })
      );

      // First call starts the launch (use isolated to skip reconnect + fs.promises.mkdir)
      const call1 = ensureBrowserReady(sessionManager, { isolated: true });

      // Yield to let _doLaunch progress to puppeteer.launch()
      await new Promise((r) => {
        setTimeout(r, 0);
      });

      // Second call should detect 'connecting' state and await the promise
      const call2 = ensureBrowserReady(sessionManager, { isolated: true });

      // Complete the launch
      resolveLaunch(mockBrowser);
      await call1;
      await call2;

      // Only one launch should have been called
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('reconnection to existing browser', () => {
    it('should reconnect when existing browser has DevToolsActivePort', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // readDevToolsActivePort succeeds (Chrome is running with a debug port)
      mockReadFile.mockResolvedValue('9222\n/devtools/browser/abc-123\n');

      await ensureBrowserReady(sessionManager, {});

      expect(puppeteer.connect).toHaveBeenCalled();
      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should fall back to launch when reconnect fails (no running browser)', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Default: readFile rejects (no DevToolsActivePort), so tryReconnect fails
      // before reaching puppeteer.connect. Launch should proceed.
      await ensureBrowserReady(sessionManager, {});

      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should fall back to connect on profile lock error during launch', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Flow: tryReconnect #1 fails (no DevToolsActivePort) → launch fails
      // (profile lock) → tryReconnect #2 succeeds (other process wrote port file)
      mockReadFile
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        .mockResolvedValueOnce('9222\n/devtools/browser/abc-123\n');

      (puppeteer.launch as Mock).mockRejectedValueOnce(
        new Error(
          'The browser is already running for /some/path/chrome-profile. Use a different `userDataDir` or stop the running browser first.'
        )
      );

      await ensureBrowserReady(sessionManager, {});

      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.connect).toHaveBeenCalledTimes(1); // only the successful fallback
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should skip reconnection logic for isolated mode', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Even if DevToolsActivePort exists, isolated mode should not try reconnecting
      mockReadFile.mockResolvedValue('9222\n/devtools/browser/abc-123\n');

      await ensureBrowserReady(sessionManager, { isolated: true });

      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.connect).not.toHaveBeenCalled();
    });

    it('should throw original error when both launch and fallback connect fail', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Both tryReconnect calls fail, launch fails with profile lock
      (puppeteer.connect as Mock).mockRejectedValue(new Error('DevToolsActivePort file not found'));
      (puppeteer.launch as Mock).mockRejectedValueOnce(
        new Error(
          'The browser is already running for /some/path. Use a different `userDataDir` or stop the running browser first.'
        )
      );

      await expect(ensureBrowserReady(sessionManager, {})).rejects.toThrow('already running');
    });
  });
});
