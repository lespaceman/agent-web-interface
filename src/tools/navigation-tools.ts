/**
 * Navigation Tools
 *
 * MCP tool handlers for browser navigation and session management.
 */

import {
  ClosePageInputSchema,
  NavigateInputSchema,
  GoBackInputSchema,
  GoForwardInputSchema,
  ReloadInputSchema,
} from './tool-schemas.js';
import { stabilizeAfterNavigation } from './action-stabilization.js';
import { buildClosePageResponse, buildListPagesResponse } from './response-builder.js';
import type { ToolContext } from './tool-context.types.js';

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
  ctx: ToolContext,
  action: NavigationAction
): Promise<string> {
  let handle = await ctx.resolvePageOrCreate(pageId);
  const page_id = handle.page_id;
  ctx.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  ctx.getDependencyTracker().clearPage(page_id);

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
  await ctx.getObservationAccumulator().inject(handle.page);

  // Auto-capture snapshot after navigation
  const captureResult = await ctx.captureSnapshotWithRecovery(handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  ctx.getSnapshotStore().store(page_id, snapshot);

  // Return XML state response (trimmed for navigation snapshots)
  const stateManager = ctx.getStateManager(page_id);
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
export async function listPages(
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').ListPagesOutput> {
  // Sync to pick up any unregistered browser tabs
  const pages = await ctx.syncPages();
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
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').ClosePageOutput> {
  const input = ClosePageInputSchema.parse(rawInput);

  await ctx.closePage(input.page_id);
  ctx.getSnapshotStore().removeByPageId(input.page_id);
  ctx.removeStateManager(input.page_id);
  ctx.getDependencyTracker().clearPage(input.page_id);

  return buildClosePageResponse(input.page_id);
}

/**
 * Navigate to a URL.
 *
 * @param rawInput - Navigation options (will be validated)
 * @returns Navigation result with snapshot data
 */
export async function navigate(
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').NavigateOutput> {
  const input = NavigateInputSchema.parse(rawInput);

  let handle = await ctx.resolvePageOrCreate(input.page_id);
  const page_id = handle.page_id;
  ctx.touchPage(page_id);

  // Clear dependency tracker before navigation (old dependencies no longer valid)
  ctx.getDependencyTracker().clearPage(page_id);

  await ctx.navigateTo(page_id, input.url);

  // Auto-capture snapshot after navigation
  const captureResult = await ctx.captureSnapshotWithRecovery(handle, page_id);
  handle = captureResult.handle;
  const snapshot = captureResult.snapshot;
  ctx.getSnapshotStore().store(page_id, snapshot);

  // Return XML state response directly (trimmed for navigation snapshots)
  const stateManager = ctx.getStateManager(page_id);
  return stateManager.generateResponse(snapshot, { trimRegions: true });
}

/**
 * Go back in browser history.
 */
export async function goBack(
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').GoBackOutput> {
  const input = GoBackInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, ctx, 'back');
}

/**
 * Go forward in browser history.
 */
export async function goForward(
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').GoForwardOutput> {
  const input = GoForwardInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, ctx, 'forward');
}

/**
 * Reload the current page.
 */
export async function reload(
  rawInput: unknown,
  ctx: ToolContext
): Promise<import('./tool-schemas.js').ReloadOutput> {
  const input = ReloadInputSchema.parse(rawInput);
  return executeNavigationAction(input.page_id, ctx, 'reload');
}
