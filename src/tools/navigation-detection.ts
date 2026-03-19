/**
 * Navigation Detection
 *
 * Captures and compares navigation state (URL, loaderId) for click outcome classification.
 *
 * @module tools/navigation-detection
 */

import type { PageHandle } from '../browser/page-registry.js';

/**
 * Navigation state for detecting URL/loaderId changes.
 */
export interface NavigationState {
  url: string;
  loaderId?: string;
}

/**
 * Capture current navigation state (URL and loaderId).
 *
 * @param handle - Page handle with CDP client
 * @returns Navigation state with URL and optional loaderId
 */
export async function captureNavigationState(handle: PageHandle): Promise<NavigationState> {
  const url = handle.page.url();
  let loaderId: string | undefined;

  try {
    const frameTree = await handle.cdp.send('Page.getFrameTree', undefined);
    loaderId = frameTree.frameTree.frame.loaderId;
  } catch {
    // Ignore - we can still detect navigation via URL
  }

  return { url, loaderId };
}

/**
 * Check if navigation occurred between two states.
 *
 * @param before - State before action
 * @param after - State after action
 * @returns True if navigation detected
 */
export function checkNavigationOccurred(before: NavigationState, after: NavigationState): boolean {
  // URL changed = navigation
  if (before.url !== after.url) {
    return true;
  }

  // LoaderId changed (and both defined) = navigation
  if (
    before.loaderId !== undefined &&
    after.loaderId !== undefined &&
    before.loaderId !== after.loaderId
  ) {
    return true;
  }

  return false;
}
