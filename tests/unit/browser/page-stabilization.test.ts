/**
 * Page Stabilization Tests
 *
 * Tests for network idle waiting utility using PageNetworkTracker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  waitForNetworkQuiet,
  ACTION_NETWORK_IDLE_TIMEOUT_MS,
  NAVIGATION_NETWORK_IDLE_TIMEOUT_MS,
  DEFAULT_QUIET_WINDOW_MS,
} from '../../../src/browser/page-stabilization.js';
import type { Page } from 'puppeteer-core';
import { createMockPageWithEvents } from '../../mocks/puppeteer.mock.js';

describe('waitForNetworkQuiet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('with idle network', () => {
    it('should return true when network is idle after quiet window', async () => {
      const mockPage = createMockPageWithEvents();

      const promise = waitForNetworkQuiet(mockPage as unknown as Page, 3000);

      // Advance past quiet window
      await vi.advanceTimersByTimeAsync(DEFAULT_QUIET_WINDOW_MS);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should respect custom quiet window', async () => {
      const mockPage = createMockPageWithEvents();

      const promise = waitForNetworkQuiet(mockPage as unknown as Page, 3000, 100);

      // Advance past custom quiet window
      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result).toBe(true);
    });
  });

  describe('timeout behavior', () => {
    it('should return false on timeout (never throws)', async () => {
      const mockPage = createMockPageWithEvents();

      const promise = waitForNetworkQuiet(mockPage as unknown as Page, 500);

      // Emit a request that never finishes (using centralized mock's event emission)
      mockPage.emitRequest({ resourceType: 'fetch' });

      // Advance to timeout
      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe('tracker attachment', () => {
    it('should attach tracker on first call', async () => {
      const mockPage = createMockPageWithEvents();

      const promise = waitForNetworkQuiet(mockPage as unknown as Page, 3000);

      // Verify tracker was attached (on was called with event handlers)
      expect(mockPage.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));

      await vi.advanceTimersByTimeAsync(DEFAULT_QUIET_WINDOW_MS);
      await promise;
    });
  });
});

describe('constants', () => {
  it('should export ACTION_NETWORK_IDLE_TIMEOUT_MS as 3000', () => {
    expect(ACTION_NETWORK_IDLE_TIMEOUT_MS).toBe(3000);
  });

  it('should export NAVIGATION_NETWORK_IDLE_TIMEOUT_MS as 5000', () => {
    expect(NAVIGATION_NETWORK_IDLE_TIMEOUT_MS).toBe(5000);
  });

  it('should export DEFAULT_QUIET_WINDOW_MS as 500', () => {
    expect(DEFAULT_QUIET_WINDOW_MS).toBe(500);
  });
});
