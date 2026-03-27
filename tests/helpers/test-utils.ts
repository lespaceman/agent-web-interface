/**
 * Test Utilities
 *
 * Common test helpers and assertions for the test suite.
 */

import { expect } from 'vitest';

/**
 * Create a delay for async tests
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Assert that a string matches a page_id format (page-{uuid})
 */
export function expectPageId(value: string): void {
  expect(value).toMatch(/^page-[0-9a-f-]+$/i);
}

/**
 * Assert that a string matches a session_id format (session-{uuid})
 */
export function expectSessionId(value: string): void {
  expect(value).toMatch(/^session-[0-9a-f-]+$/i);
}

/**
 * Assert that a Date is recent (within the last N seconds)
 */
export function expectRecentDate(date: Date, withinSeconds = 5): void {
  const now = Date.now();
  const dateMs = date.getTime();
  const diff = now - dateMs;

  expect(diff).toBeGreaterThanOrEqual(0);
  expect(diff).toBeLessThan(withinSeconds * 1000);
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await delay(interval);
  }

  throw new Error(`waitFor timeout after ${timeout}ms`);
}
