/**
 * Navigation Tools
 *
 * MCP tool handlers for browser navigation and session management.
 */

import { observationAccumulator } from '../observation/index.js';
import {
  ClosePageInputSchema,
  CloseSessionInputSchema,
  NavigateInputSchema,
  GoBackInputSchema,
  GoForwardInputSchema,
  ReloadInputSchema,
} from './tool-schemas.js';
import { cleanupTempFiles } from '../lib/temp-file.js';
import {
  getStateManager,
  removeStateManager,
  clearAllStateManagers,
} from './state-manager-registry.js';
import { stabilizeAfterNavigation } from './action-stabilization.js';
import {
  buildClosePageResponse,
  buildCloseSessionResponse,
  buildListPagesResponse,
} from './response-builder.js';
import { getDependencyTracker } from '../form/index.js';
import { getSessionManager, getSnapshotStore } from './tool-context.js';
import { captureSnapshotWithRecovery } from './action-context.js';

// Convenience alias for module-internal use
const snapshotStore = getSnapshotStore();

/**
 * Navigation action types.
 */
type NavigationAction = 'back' | 'forward' | 'reload';

/**
 * Execute a navigation action with snapshot capture.
 * Consolidates goBack, goForward, and reload handlers.
 *
 * Waits for both DOM stabilization and network idle after navigation
 * to ensure the page is fully loaded before capturing snapshot.
 *
 * @param pageId - Optional page ID
 * @param action - Navigation action to execute
 * @returns State response after navigation
 */
async function executeNavigationAction(
  pageId: string | undefined,
  action: NavigationAction
): Promise<string> {
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(pageId);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  getDependencyTracker().clearPage(page_id);

  // Execute navigation
  switch (action) {
    case 'back':
      await handle.page.goBack();
      break;
    case 'forward':
      await handle.page.goForward();
      break;
    case 'reload':
      await handle.page.reload();
      break;
  }

  // Wait for page to stabilize (DOM + network idle)
  await stabilizeAfterNavigation(handle.page);

  // Re-inject observation accumulator (new document context after navigation)
  await observationAccumulator.inject(handle.page);

  // Auto-capture snapshot after navigation
  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(page_id, snapshot);

  // Return XML state response (trimmed for navigation snapshots)
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
}

/**
 * List all open browser pages with their metadata.
 *
 * Syncs with browser context to ensure all tabs are registered,
 * including tabs opened externally or after reconnection.
 *
 * @returns XML result with page list
 */
export async function listPages(): Promise<import('./tool-schemas.js').ListPagesOutput> {
  const session = getSessionManager();
  // Sync to pick up any unregistered browser tabs
  const pages = await session.syncPages();
  const pageInfos = await Promise.all(
    pages.map(async (h) => {
      const liveUrl = h.page.url?.() ?? h.url ?? '';
      let liveTitle = h.title ?? '';

      if (typeof h.page.title === 'function') {
        try {
          liveTitle = await h.page.title();
        } catch {
          // Ignore pages that cannot expose title in the current state.
        }
      }

      h.url = liveUrl;
      h.title = liveTitle;

      return {
        page_id: h.page_id,
        url: liveUrl,
        title: liveTitle,
      };
    })
  );
  return buildListPagesResponse(pageInfos);
}

/**
 * Close a specific page.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function closePage(
  rawInput: unknown
): Promise<import('./tool-schemas.js').ClosePageOutput> {
  const input = ClosePageInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.closePage(input.page_id);
  snapshotStore.removeByPageId(input.page_id);
  removeStateManager(input.page_id); // Clean up state manager
  getDependencyTracker().clearPage(input.page_id); // Clean up dependencies

  return buildClosePageResponse(input.page_id);
}

/**
 * Close the entire browser session.
 *
 * @param rawInput - Close options (will be validated)
 * @returns Close result
 */
export async function closeSession(
  rawInput: unknown
): Promise<import('./tool-schemas.js').CloseSessionOutput> {
  CloseSessionInputSchema.parse(rawInput);
  const session = getSessionManager();

  await session.shutdown();
  snapshotStore.clear();
  clearAllStateManagers(); // Clean up all state managers
  getDependencyTracker().clearAll(); // Clean up all dependencies
  await cleanupTempFiles(); // Clean up screenshot temp files

  return buildCloseSessionResponse();
}

/**
 * Navigate to a URL.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function navigate(
  rawInput: unknown
): Promise<import('./tool-schemas.js').NavigateOutput> {
  const input = NavigateInputSchema.parse(rawInput);
  const session = getSessionManager();

  let handle = await session.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  session.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  getDependencyTracker().clearPage(page_id);

  await session.navigateTo(page_id, input.url);

  // Auto-capture snapshot after navigation
  const captureResult = await captureSnapshotWithRecovery(session, handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  snapshotStore.store(page_id, snapshot);

  // Return XML state response directly (trimmed for navigation snapshots)
  const stateManager = getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
}

/**
 * Go back in browser history.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function goBack(rawInput: unknown): Promise<import('./tool-schemas.js').GoBackOutput> {
  const input = GoBackInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'back');
}

/**
 * Go forward in browser history.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function goForward(
  rawInput: unknown
): Promise<import('./tool-schemas.js').GoForwardOutput> {
  const input = GoForwardInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'forward');
}

/**
 * Reload the current page.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function reload(rawInput: unknown): Promise<import('./tool-schemas.js').ReloadOutput> {
  const input = ReloadInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, 'reload');
}
