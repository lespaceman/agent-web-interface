// tests/integration/lazy-init.test.ts
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createLinkedMocks, type MockBrowser } from '../mocks/puppeteer.mock.js';

// Mock Puppeteer module
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(),
    connect: vi.fn(),
  },
}));

import puppeteer from 'puppeteer-core';

describe('Lazy Browser Initialization Integration', () => {
  let mockBrowser: MockBrowser;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    const mocks = createLinkedMocks({ url: 'https://example.com', title: 'Example' });
    mockBrowser = mocks.browser;

    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);
    (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
  });

  it('should auto-launch browser on first tool call', async () => {
    const { initServerConfig, getSessionManager, ensureBrowserForTools } =
      await import('../../src/server/server-config.js');

    initServerConfig([]);
    const session = getSessionManager();

    // Browser not running initially
    expect(session.isRunning()).toBe(false);

    // Simulate what any tool does
    await ensureBrowserForTools();

    // Browser should now be running
    expect(session.isRunning()).toBe(true);
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  it('should auto-connect when --browserUrl provided', async () => {
    const { initServerConfig, getSessionManager, ensureBrowserForTools } =
      await import('../../src/server/server-config.js');

    initServerConfig(['--browserUrl', 'http://localhost:9222']);
    const session = getSessionManager();

    await ensureBrowserForTools();

    expect(session.isRunning()).toBe(true);
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(puppeteer.connect).toHaveBeenCalled();
  });

  // Skip: autoConnect requires Chrome running with remote debugging enabled,
  // which creates DevToolsActivePort file. Can't reliably mock fs in CI due to
  // dynamic imports after vi.resetModules(). This is tested manually.
  it.skip('should auto-connect when --autoConnect provided', async () => {
    const { initServerConfig, getSessionManager, ensureBrowserForTools } =
      await import('../../src/server/server-config.js');

    initServerConfig(['--autoConnect']);
    const session = getSessionManager();

    await ensureBrowserForTools();

    expect(session.isRunning()).toBe(true);
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(puppeteer.connect).toHaveBeenCalled();
  });

  it('should not re-launch on subsequent tool calls', async () => {
    const { initServerConfig, ensureBrowserForTools } =
      await import('../../src/server/server-config.js');

    initServerConfig([]);

    // First call launches
    await ensureBrowserForTools();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);

    // Subsequent calls should not launch again
    await ensureBrowserForTools();
    await ensureBrowserForTools();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  it('should respect headless=false from CLI', async () => {
    const { initServerConfig, ensureBrowserForTools } =
      await import('../../src/server/server-config.js');

    initServerConfig(['--headless=false']);

    await ensureBrowserForTools();

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      })
    );
  });
});
