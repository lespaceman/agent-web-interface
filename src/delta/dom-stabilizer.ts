/**
 * DOM Stabilizer
 *
 * Waits for DOM to stabilize after an action with guaranteed termination.
 * Uses MutationObserver to detect when mutations settle.
 */

import type { Page } from 'puppeteer-core';

/**
 * Options for DOM stabilization.
 */
export interface StabilizationOptions {
  /** Time window of no mutations to consider DOM stable (ms). Default: 100ms */
  quietWindowMs?: number;
  /** Maximum time to wait before timing out (ms). Default: 2000ms */
  maxTimeoutMs?: number;
}

/**
 * Result of DOM stabilization.
 */
export interface StabilizationResult {
  /** Status of stabilization */
  status: 'stable' | 'timeout' | 'error';
  /** Time waited for stabilization (ms) */
  waitTimeMs: number;
  /** Number of mutations observed during stabilization */
  mutationCount?: number;
  /** Warning message if timeout or error */
  warning?: string;
}

/** Type alias for compatibility */
export type DomStability = StabilizationResult;

// Browser globals used inside page.evaluate() - TypeScript doesn't know these
// run in browser context, so we declare them here. These are NOT available
// in Node.js - only in the browser context within page.evaluate().
/* eslint-disable @typescript-eslint/no-empty-object-type */
interface BrowserElement {}
interface BrowserMutationObserverInit {
  childList?: boolean;
  subtree?: boolean;
  attributes?: boolean;
  characterData?: boolean;
}
/* eslint-enable @typescript-eslint/no-empty-object-type */
declare const document: {
  body: BrowserElement | null;
};
declare const window: {
  setTimeout: (callback: () => void, ms: number) => number;
};
declare const MutationObserver: new (callback: () => void) => {
  observe(target: BrowserElement, options: BrowserMutationObserverInit): void;
  disconnect(): void;
};
declare const performance: {
  now(): number;
};
declare function clearTimeout(id: number | null): void;

/** Default quiet window in milliseconds */
const DEFAULT_QUIET_WINDOW_MS = 100;

/** Default hard timeout in milliseconds */
const DEFAULT_MAX_TIMEOUT_MS = 2000;

/**
 * Wait for DOM to stabilize with guaranteed termination.
 *
 * Uses MutationObserver in the browser to detect when mutations stop.
 * Returns when either:
 * - No mutations observed for quietWindowMs (stable)
 * - maxTimeoutMs elapsed (timeout)
 * - An error occurred (error)
 *
 * @param page - Puppeteer Page instance
 * @param options - Stabilization options
 * @returns StabilizationResult with status and timing info
 */
export async function stabilizeDom(
  page: Page,
  options: StabilizationOptions = {}
): Promise<StabilizationResult> {
  const quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  const startTime = Date.now();

  try {
    const result = await page.evaluate(
      ({ quietWindowMs, maxTimeoutMs }) => {
        return new Promise<{
          stable: boolean;
          elapsed: number;
          mutationCount: number;
        }>((resolve) => {
          // Guard: document.body may not exist during navigation
          if (!document.body) {
            resolve({ stable: false, elapsed: 0, mutationCount: 0 });
            return;
          }

          let quietTimer: number | null = null;
          let mutationCount = 0;
          const start = performance.now();

          // Hard timeout - always resolves
          const hardTimeout = window.setTimeout(() => {
            cleanup();
            resolve({
              stable: false,
              elapsed: performance.now() - start,
              mutationCount,
            });
          }, maxTimeoutMs);

          const observer = new MutationObserver(() => {
            mutationCount++;

            // Reset quiet timer on each mutation
            if (quietTimer !== null) {
              clearTimeout(quietTimer);
            }

            quietTimer = window.setTimeout(() => {
              cleanup();
              resolve({
                stable: true,
                elapsed: performance.now() - start,
                mutationCount,
              });
            }, quietWindowMs);
          });

          function cleanup() {
            if (quietTimer !== null) clearTimeout(quietTimer);
            clearTimeout(hardTimeout);
            observer.disconnect();
          }

          // Start observing
          try {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          } catch {
            // Observer failed (rare edge case)
            cleanup();
            resolve({ stable: false, elapsed: 0, mutationCount: 0 });
            return;
          }

          // Initial quiet timer (page may already be stable)
          quietTimer = window.setTimeout(() => {
            cleanup();
            resolve({
              stable: true,
              elapsed: performance.now() - start,
              mutationCount,
            });
          }, quietWindowMs);
        });
      },
      { quietWindowMs, maxTimeoutMs }
    );

    const waitTimeMs = Date.now() - startTime;

    if (result.stable) {
      return {
        status: 'stable',
        waitTimeMs,
        mutationCount: result.mutationCount,
      };
    }

    return {
      status: 'timeout',
      waitTimeMs,
      mutationCount: result.mutationCount,
      warning: `DOM still mutating after ${maxTimeoutMs}ms (${result.mutationCount} mutations observed). Snapshot may be incomplete.`,
    };
  } catch (error) {
    // page.evaluate failed - likely navigation occurred
    const waitTimeMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    return {
      status: 'error',
      waitTimeMs,
      warning: `Stabilization interrupted: ${message}. Page may have navigated.`,
    };
  }
}
