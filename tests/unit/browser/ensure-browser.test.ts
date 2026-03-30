/**
 * ensureBrowserReady Tests
 *
 * Tests for lazy browser initialization with BrowserSessionConfig.
 * Uses mocked Puppeteer - no real browser required.
 *
 * Modes:
 *   - cdpUrl set → connect to explicit endpoint, no fallback
 *   - browserMode set → try that mode only, fail on error
 *   - browserMode undefined (auto) → fallback chain: user → persistent → isolated
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { SessionManager } from '../../../src/browser/session-manager.js';
import type { BrowserSessionConfig } from '../../../src/browser/browser-session-config.js';
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

    // Default: DevToolsActivePort does not exist
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
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
    it('should return immediately without launching or connecting', async () => {
      // First launch browser
      await sessionManager.launch();
      expect(sessionManager.isRunning()).toBe(true);

      const ensureBrowserReady = await getEnsureBrowserReady();

      // Reset mock call counts
      (puppeteer.launch as Mock).mockClear();
      (puppeteer.connect as Mock).mockClear();

      const config: BrowserSessionConfig = { headless: false };
      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(puppeteer.connect).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });
  });

  describe('explicit CDP URL', () => {
    it('should connect via endpointUrl and not launch', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      const config: BrowserSessionConfig = {
        headless: false,
        cdpUrl: 'http://localhost:9222',
      };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.connect).toHaveBeenCalled();
      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should throw when connect to CDP URL fails (no fallback)', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      (puppeteer.connect as Mock).mockRejectedValueOnce(new Error('Connection refused'));

      const config: BrowserSessionConfig = {
        headless: false,
        cdpUrl: 'http://localhost:9222',
      };

      await expect(ensureBrowserReady(sessionManager, config)).rejects.toThrow(
        'Failed to connect to CDP endpoint'
      );
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });
  });

  describe('explicit browserMode: user', () => {
    it('should call connect({ autoConnect: true })', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // autoConnect needs DevToolsActivePort to exist
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('9222\n/devtools/browser/abc-123\n');

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'user',
      };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.connect).toHaveBeenCalled();
      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should NOT fall back on failure', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      (puppeteer.connect as Mock).mockRejectedValue(new Error('No Chrome found'));

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'user',
      };

      await expect(ensureBrowserReady(sessionManager, config)).rejects.toThrow();
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });
  });

  describe('explicit browserMode: persistent', () => {
    it('should call launch({ isolated: false })', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'persistent',
      };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
      expect(puppeteer.connect).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should NOT fall back on failure', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      (puppeteer.launch as Mock).mockRejectedValue(new Error('Launch failed'));

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'persistent',
      };

      await expect(ensureBrowserReady(sessionManager, config)).rejects.toThrow();
      expect(puppeteer.connect).not.toHaveBeenCalled();
    });
  });

  describe('explicit browserMode: isolated', () => {
    it('should call launch({ isolated: true })', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'isolated',
      };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
      // Isolated means no userDataDir (temp profile)
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          userDataDir: undefined,
        })
      );
      expect(puppeteer.connect).not.toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should NOT fall back on failure', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      (puppeteer.launch as Mock).mockRejectedValue(new Error('Launch failed'));

      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'isolated',
      };

      await expect(ensureBrowserReady(sessionManager, config)).rejects.toThrow();
      expect(puppeteer.connect).not.toHaveBeenCalled();
    });
  });

  describe('auto mode (browserMode undefined)', () => {
    it('should try user first (connect), succeed immediately', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // autoConnect needs DevToolsActivePort to exist
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('9222\n/devtools/browser/abc-123\n');

      const config: BrowserSessionConfig = { headless: false };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.connect).toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should fall back: user fails → persistent works', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // user mode connect fails
      (puppeteer.connect as Mock).mockRejectedValueOnce(new Error('No Chrome found'));
      // persistent mode launch succeeds (default mock)

      const config: BrowserSessionConfig = { headless: false };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.launch).toHaveBeenCalled();
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should fall back: user fails → persistent fails → isolated works', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // user mode connect fails
      (puppeteer.connect as Mock).mockRejectedValueOnce(new Error('No Chrome found'));
      // persistent mode launch fails first time
      (puppeteer.launch as Mock)
        .mockRejectedValueOnce(new Error('Profile locked'))
        // isolated mode launch succeeds second time
        .mockResolvedValueOnce(mockBrowser);

      const config: BrowserSessionConfig = { headless: false };

      await ensureBrowserReady(sessionManager, config);

      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
      expect(sessionManager.isRunning()).toBe(true);
    });

    it('should throw when all modes in fallback chain fail', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // user mode connect fails
      (puppeteer.connect as Mock).mockRejectedValue(new Error('No Chrome found'));
      // persistent and isolated launch both fail
      (puppeteer.launch as Mock).mockRejectedValue(new Error('Launch failed'));

      const config: BrowserSessionConfig = { headless: false };

      await expect(ensureBrowserReady(sessionManager, config)).rejects.toThrow(
        'All browser modes exhausted'
      );
    });
  });

  describe('in-flight deduplication', () => {
    it('should await same promise for concurrent calls', async () => {
      const ensureBrowserReady = await getEnsureBrowserReady();

      // Use a deferred promise to control launch timing
      let resolveLaunch!: (value: typeof mockBrowser) => void;
      (puppeteer.launch as Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLaunch = resolve;
          })
      );

      // Use isolated to skip connect attempts (simplest path)
      const config: BrowserSessionConfig = {
        headless: false,
        browserMode: 'isolated',
      };

      // First call starts the launch
      const call1 = ensureBrowserReady(sessionManager, config);

      // Yield to let internal async progress to puppeteer.launch()
      await new Promise((r) => {
        setTimeout(r, 0);
      });

      // Second call should detect 'connecting' state and await the same promise
      const call2 = ensureBrowserReady(sessionManager, config);

      // Complete the launch
      resolveLaunch(mockBrowser);
      await call1;
      await call2;

      // Only one launch should have been called
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(sessionManager.isRunning()).toBe(true);
    });
  });
});
