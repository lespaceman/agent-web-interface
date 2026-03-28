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

vi.mock('../../src/shared/services/logging.service.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import puppeteer from 'puppeteer-core';
import { SessionController } from '../../src/session/session-controller.js';

describe('Lazy Browser Initialization (SessionController)', () => {
  let mockBrowser: MockBrowser;

  beforeEach(() => {
    vi.clearAllMocks();

    const mocks = createLinkedMocks({ url: 'https://example.com', title: 'Example' });
    mockBrowser = mocks.browser;

    (puppeteer.launch as Mock).mockResolvedValue(mockBrowser);
    (puppeteer.connect as Mock).mockResolvedValue(mockBrowser);
  });

  it('launches a browser on ensureBrowser()', async () => {
    const controller = new SessionController({ sessionId: 'test-launch' });

    await controller.ensureBrowser();

    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    expect(controller.getSessionManager().isRunning()).toBe(true);
  });

  it('connects when AWI_CDP_URL env var is set', async () => {
    process.env.AWI_CDP_URL = 'http://localhost:9222';
    try {
      const controller = new SessionController({
        sessionId: 'test-connect',
      });

      await controller.ensureBrowser();

      expect(puppeteer.launch).not.toHaveBeenCalled();
      expect(puppeteer.connect).toHaveBeenCalled();
      expect(controller.getSessionManager().isRunning()).toBe(true);
    } finally {
      delete process.env.AWI_CDP_URL;
    }
  });

  it('is idempotent — does not re-launch on subsequent calls', async () => {
    const controller = new SessionController({ sessionId: 'test-idempotent' });

    await controller.ensureBrowser();
    await controller.ensureBrowser();
    await controller.ensureBrowser();

    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  it('respects setBrowserConfig({ headless: true })', async () => {
    const controller = new SessionController({ sessionId: 'test-headless' });
    controller.setBrowserConfig({ headless: true });

    await controller.ensureBrowser();

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
      })
    );
  });
});
