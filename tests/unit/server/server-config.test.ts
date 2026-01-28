/**
 * ServerConfig Tests
 *
 * TDD tests for ServerConfig implementation.
 * Centralized server configuration combining CLI args and environment variables.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createLinkedMocks, type MockBrowser } from '../../mocks/puppeteer.mock.js';

// Mock Puppeteer module
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
    connect: vi.fn(),
  },
}));

import puppeteer from 'puppeteer-core';

describe('ServerConfig', () => {
  let mockBrowser: MockBrowser;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    const mocks = createLinkedMocks({ url: 'about:blank' });
    mockBrowser = mocks.browser;

    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);
    (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
  });

  it('should initialize with default config', async () => {
    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);
    const config = getServerConfig();

    expect(config.headless).toBe(false);
    expect(config.autoConnect).toBe(false);
  });

  it('should respect CLI arguments', async () => {
    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    initServerConfig(['--headless=true', '--autoConnect']);
    const config = getServerConfig();

    expect(config.headless).toBe(true);
    expect(config.autoConnect).toBe(true);
  });

  it('should provide ensureBrowserForTools that initializes browser', async () => {
    const { initServerConfig, ensureBrowserForTools, getSessionManager } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);

    // Browser should not be running yet
    expect(getSessionManager().isRunning()).toBe(false);

    // Call ensureBrowserForTools
    await ensureBrowserForTools();

    // Now browser should be running
    expect(getSessionManager().isRunning()).toBe(true);
    expect(puppeteer.launch).toHaveBeenCalled();
  });

  it('should use AUTO_CONNECT env var when set', async () => {
    process.env.AUTO_CONNECT = 'true';

    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);
    const config = getServerConfig();

    expect(config.autoConnect).toBe(true);

    delete process.env.AUTO_CONNECT;
  });

  it('should throw if getServerConfig called before initServerConfig', async () => {
    const { getServerConfig } = await import('../../../src/server/server-config.js');

    expect(() => getServerConfig()).toThrow('Server config not initialized');
  });

  it('should reuse existing browser on subsequent ensureBrowserForTools calls', async () => {
    const { initServerConfig, ensureBrowserForTools, getSessionManager } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);

    // First call launches browser
    await ensureBrowserForTools();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);

    // Second call should not launch again
    await ensureBrowserForTools();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);

    expect(getSessionManager().isRunning()).toBe(true);
  });

  it('should not override explicit CLI autoConnect with env var', async () => {
    // CLI provides browserUrl, so AUTO_CONNECT should not affect autoConnect
    process.env.AUTO_CONNECT = 'true';

    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    // When browserUrl is set, AUTO_CONNECT env should not enable autoConnect
    initServerConfig(['--browserUrl', 'http://localhost:9222']);
    const config = getServerConfig();

    // Since browserUrl is set, autoConnect should NOT be enabled from env
    expect(config.autoConnect).toBe(false);
    expect(config.browserUrl).toBe('http://localhost:9222');

    delete process.env.AUTO_CONNECT;
  });

  it('should allow resetServerState for testing', async () => {
    const { initServerConfig, getServerConfig, resetServerState } =
      await import('../../../src/server/server-config.js');

    initServerConfig(['--headless=false']);
    expect(getServerConfig().headless).toBe(false);

    resetServerState();

    expect(() => getServerConfig()).toThrow('Server config not initialized');
  });

  it('should report isSessionManagerInitialized correctly', async () => {
    const { initServerConfig, getSessionManager, isSessionManagerInitialized, resetServerState } =
      await import('../../../src/server/server-config.js');

    // Initially not initialized
    expect(isSessionManagerInitialized()).toBe(false);

    // After getSessionManager(), it should be initialized
    initServerConfig([]);
    getSessionManager();
    expect(isSessionManagerInitialized()).toBe(true);

    // After reset, it should be false again
    resetServerState();
    expect(isSessionManagerInitialized()).toBe(false);
  });
});
