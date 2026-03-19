/**
 * Action Stabilization
 *
 * Stabilizes the page after actions using tiered waiting (DOM + network).
 *
 * @module tools/action-stabilization
 */

import type { Page } from 'puppeteer-core';
import { stabilizeDom, type StabilizationResult } from '../delta/dom-stabilizer.js';
import type { PageHandle } from '../browser/page-registry.js';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import { createHealthyRuntime } from '../state/health.types.js';
import { compileSnapshot } from '../snapshot/index.js';
import {
  waitForNetworkQuiet,
  ACTION_NETWORK_IDLE_TIMEOUT_MS,
  NAVIGATION_NETWORK_IDLE_TIMEOUT_MS,
} from '../browser/page-stabilization.js';

/**
 * Stabilize page after an action using tiered waiting strategy.
 *
 * This addresses the core issue: actions may trigger API calls that complete
 * after DOM mutations settle. The tiered approach:
 *
 * 1. Wait for DOM to stabilize (MutationObserver) - catches SPA rendering
 * 2. Wait for network to quiet down (networkidle) - catches pending API calls
 * 3. If DOM stabilization fails (navigation), fall back to network idle wait
 *
 * Timeouts are generous but never throw - we proceed even if network stays busy
 * (common with analytics, long-polling, websockets).
 *
 * @param page - Puppeteer Page instance
 * @param networkTimeoutMs - Optional custom timeout for network idle (default: 3000ms)
 * @returns Stabilization result with status
 */
export async function stabilizeAfterAction(
  page: Page,
  networkTimeoutMs: number = ACTION_NETWORK_IDLE_TIMEOUT_MS
): Promise<StabilizationResult> {
  // Step 1: Try MutationObserver-based DOM stabilization first
  const result = await stabilizeDom(page);

  // Step 2: Handle based on DOM stabilization result
  if (result.status === 'stable' || result.status === 'timeout') {
    // DOM settled (or timed out) - now wait for network to quiet down
    // This catches API calls that haven't rendered to DOM yet
    const networkIdle = await waitForNetworkQuiet(page, networkTimeoutMs);

    if (!networkIdle && result.status === 'stable') {
      // DOM was stable but network didn't idle - add a note
      return {
        ...result,
        warning: result.warning ?? 'Network did not reach idle state within timeout',
      };
    }

    return result;
  }

  // status === 'error' means page.evaluate() failed, likely due to navigation
  // Fall back to waiting for network idle on the new page
  try {
    // Wait for network to settle on the new page
    await waitForNetworkQuiet(page, networkTimeoutMs);

    return {
      status: 'stable',
      waitTimeMs: result.waitTimeMs,
      warning: 'Navigation detected; waited for networkidle',
    };
  } catch (waitError) {
    // If network wait also fails, the page might be in an unusual state
    // Return the original error but with additional context
    const message = waitError instanceof Error ? waitError.message : String(waitError);
    return {
      status: 'error',
      waitTimeMs: result.waitTimeMs,
      warning: `${result.warning}. Fallback network wait also failed: ${message}`,
    };
  }
}

/**
 * Stabilize page after explicit navigation (goto, back, forward, reload).
 *
 * Uses a longer network timeout since navigations typically trigger more
 * requests than in-page actions.
 *
 * @param page - Puppeteer Page instance
 * @returns Stabilization result with status
 */
export async function stabilizeAfterNavigation(page: Page): Promise<StabilizationResult> {
  return stabilizeAfterAction(page, NAVIGATION_NETWORK_IDLE_TIMEOUT_MS);
}

/**
 * Capture snapshot without recovery (fallback path).
 */
export async function captureSnapshotFallback(
  handle: PageHandle
): Promise<{ snapshot: BaseSnapshot; runtime_health: RuntimeHealth }> {
  const snapshot = await compileSnapshot(handle.cdp, handle.page, handle.page_id);
  return { snapshot, runtime_health: createHealthyRuntime() };
}
