/**
 * Page Stabilization Utilities
 *
 * Shared utilities for waiting on network activity to settle.
 * Used by session-manager and execute-action.
 *
 * IMPORTANT: This module uses PageNetworkTracker for reliable network idle
 * detection. Unlike Puppeteer's waitForNetworkIdle(), the tracker
 * monitors actual request/response events and works for in-page actions
 * (not just navigation load states).
 */

import type { Page } from 'puppeteer-core';
import { getOrCreateTracker } from './page-network-tracker.js';

/** Default timeout for network idle waiting after actions (ms) */
export const ACTION_NETWORK_IDLE_TIMEOUT_MS = 3000;

/** Default timeout for network idle waiting after navigation (ms) */
export const NAVIGATION_NETWORK_IDLE_TIMEOUT_MS = 5000;

/** Default quiet window - time with 0 inflight requests to consider "idle" (ms) */
export const DEFAULT_QUIET_WINDOW_MS = 500;

/**
 * Wait for network to become quiet (no pending requests for 500ms).
 *
 * This catches pending API calls triggered by actions. Uses PageNetworkTracker
 * which monitors request/response events directly, providing reliable detection
 * of network activity for both navigation and in-page actions.
 *
 * Unlike Puppeteer's waitForNetworkIdle(), this works correctly
 * for fetch/XHR requests triggered by user actions after page load.
 *
 * @param page - Puppeteer Page instance
 * @param timeoutMs - Maximum time to wait for network idle
 * @param quietWindowMs - Time with 0 inflight requests to consider "idle" (default: 500ms)
 * @returns Whether network became idle (false = timed out, but that's OK - never throws)
 */
export async function waitForNetworkQuiet(
  page: Page,
  timeoutMs: number,
  quietWindowMs: number = DEFAULT_QUIET_WINDOW_MS
): Promise<boolean> {
  const tracker = getOrCreateTracker(page);

  // Ensure tracker is attached (may not be if page was created outside SessionManager)
  if (!tracker.isAttached()) {
    tracker.attach(page);
  }

  return tracker.waitForQuiet(timeoutMs, quietWindowMs);
}
