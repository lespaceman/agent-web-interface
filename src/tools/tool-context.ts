/**
 * Tool Context
 *
 * Implementation helpers used by SessionController for page resolution
 * and CDP session health. These accept a SessionManager parameter rather
 * than using module-level singletons.
 */

import type { SessionManager } from '../browser/session-manager.js';
import type { PageHandle } from '../browser/page-registry.js';
import { createHealthyRuntime, createRecoveredCdpRuntime } from '../state/health.types.js';
import type { CdpSessionResult } from './tool-context.types.js';

// ---------------------------------------------------------------------------
// Page Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve page_id to a PageHandle, throwing if not found.
 * Also touches the page to mark it as MRU.
 */
export function resolveExistingPage(
  session: SessionManager,
  page_id: string | undefined
): PageHandle {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    throw new Error(
      page_id ? `Page not found: ${page_id}` : 'No page available. Navigate to a URL first.'
    );
  }
  session.touchPage(handle.page_id);
  return handle;
}

// ---------------------------------------------------------------------------
// CDP Session Health
// ---------------------------------------------------------------------------

/**
 * Ensure CDP session is healthy, attempting repair if needed.
 * Call this before any CDP operation to auto-repair dead sessions.
 */
export async function ensureCdpSession(
  session: SessionManager,
  handle: PageHandle
): Promise<CdpSessionResult> {
  if (handle.cdp.isActive()) {
    try {
      await handle.cdp.send('Page.getFrameTree', undefined);
      return { handle, recovered: false, runtime_health: createHealthyRuntime() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[RECOVERY] CDP probe failed for ${handle.page_id}: ${message}. Attempting rebind`
      );
    }
  }

  console.warn(`[RECOVERY] CDP session dead for ${handle.page_id}, attempting rebind`);
  const newHandle = await session.rebindCdpSession(handle.page_id);
  return {
    handle: newHandle,
    recovered: true,
    runtime_health: createRecoveredCdpRuntime('HEALTHY'),
  };
}
