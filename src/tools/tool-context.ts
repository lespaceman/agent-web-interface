/**
 * Tool Context
 *
 * Shared plumbing for all tool modules (browser-tools, canvas-tools, form-tools).
 * Centralizes session management, snapshot storage, page resolution, and element lookup.
 */

import type { SessionManager } from '../browser/session-manager.js';
import type { PageHandle } from '../browser/page-registry.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import { createHealthyRuntime, createRecoveredCdpRuntime } from '../state/health.types.js';
import { SnapshotStore } from '../snapshot/index.js';
import { getStateManager } from './state-manager-registry.js';
import { ElementNotFoundError, StaleElementError, SnapshotRequiredError } from './errors.js';

// ---------------------------------------------------------------------------
// Session Manager Singleton
// ---------------------------------------------------------------------------

let sessionManager: SessionManager | null = null;

/**
 * Initialize shared tool context with a session manager.
 * Must be called once before using any tool handlers.
 */
export function initializeToolContext(manager: SessionManager): void {
  sessionManager = manager;
}

/**
 * Get the session manager, throwing if not initialized.
 */
export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error('Tools not initialized. Call initializeToolContext() first.');
  }
  return sessionManager;
}

// ---------------------------------------------------------------------------
// Snapshot Store Singleton
// ---------------------------------------------------------------------------

const snapshotStore = new SnapshotStore();

/**
 * Get the shared snapshot store instance.
 */
export function getSnapshotStore(): SnapshotStore {
  return snapshotStore;
}

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

export interface CdpSessionResult {
  handle: PageHandle;
  recovered: boolean;
  runtime_health: RuntimeHealth;
}

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

// ---------------------------------------------------------------------------
// Snapshot Resolution
// ---------------------------------------------------------------------------

/**
 * Require snapshot for a page, throwing a consistent error if missing.
 */
export function requireSnapshot(pageId: string): BaseSnapshot {
  const snap = snapshotStore.getByPageId(pageId);
  if (!snap) {
    throw new SnapshotRequiredError(pageId);
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Element Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve element by eid for action tools.
 * Looks up element in registry and finds corresponding node in snapshot.
 * Includes proactive staleness detection before CDP interaction.
 *
 * @throws {ElementNotFoundError} If eid not found in registry
 * @throws {StaleElementError} If eid reference is stale or element not in current snapshot
 */
export function resolveElementByEid(
  pageId: string,
  eid: string,
  snapshot: BaseSnapshot
): ReadableNode {
  const stateManager = getStateManager(pageId);
  const registry = stateManager.getElementRegistry();
  const elementRef = registry.getByEid(eid);

  if (!elementRef) {
    throw new ElementNotFoundError(eid);
  }

  if (registry.isStale(eid)) {
    throw new StaleElementError(eid);
  }

  const node = snapshot.nodes.find((n) => n.backend_node_id === elementRef.ref.backend_node_id);
  if (!node) {
    throw new StaleElementError(eid);
  }

  return node;
}
