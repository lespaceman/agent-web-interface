/**
 * Action Context
 *
 * Shared action context helpers used by all tool handler modules.
 * Provides snapshot capture with CDP recovery, action context preparation,
 * runtime health building, and tool initialization.
 */

import type { PageHandle } from '../browser/page-registry.js';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { RuntimeHealth } from '../state/health.types.js';
import {
  captureWithStabilization,
  determineHealthCode,
  type CaptureWithStabilizationResult,
} from '../snapshot/snapshot-health.js';
import type { CaptureSnapshotFn } from './execute-action.js';
import type { ToolContext } from './tool-context.types.js';

/**
 * Build runtime health details from a capture attempt.
 */
export function buildRuntimeHealth(
  cdpHealth: RuntimeHealth['cdp'],
  result: CaptureWithStabilizationResult
): RuntimeHealth {
  const code = determineHealthCode(result);

  return {
    cdp: cdpHealth,
    snapshot: {
      ok: code === 'HEALTHY',
      code,
      attempts: result.attempts,
      message: result.health.message,
    },
  };
}

/**
 * Capture a snapshot with stabilization and CDP recovery when empty.
 */
export async function captureSnapshotWithRecovery(
  ctx: ToolContext,
  handle: PageHandle,
  pageId: string
): Promise<{ snapshot: BaseSnapshot; handle: PageHandle; runtime_health: RuntimeHealth }> {
  const ensureResult = await ctx.ensureCdpSession(handle);
  handle = ensureResult.handle;

  let result = await captureWithStabilization(handle.cdp, handle.page, pageId);
  let runtime_health = buildRuntimeHealth(ensureResult.runtime_health.cdp, result);

  if (!result.health.valid) {
    const healthCode = determineHealthCode(result);
    console.warn(`[RECOVERY] Empty snapshot for ${pageId} (${healthCode}); rebinding CDP session`);

    handle = await ctx.getSessionManager().rebindCdpSession(pageId);
    result = await captureWithStabilization(handle.cdp, handle.page, pageId, { maxRetries: 1 });
    runtime_health = buildRuntimeHealth(
      { ok: true, recovered: true, recovery_method: 'rebind' },
      result
    );
  }

  return { snapshot: result.snapshot, handle, runtime_health };
}

/**
 * Create a capture function that keeps the handle updated after recovery.
 */
export function createActionCapture(
  ctx: ToolContext,
  handleRef: { current: PageHandle },
  pageId: string
): CaptureSnapshotFn {
  return async () => {
    const captureResult = await captureSnapshotWithRecovery(ctx, handleRef.current, pageId);
    handleRef.current = captureResult.handle;
    return {
      snapshot: captureResult.snapshot,
      runtime_health: captureResult.runtime_health,
    };
  };
}

// ============================================================================
// Action Context Helpers
// ============================================================================

/**
 * Context for action execution.
 */
export interface ActionContext {
  /** Mutable reference to page handle (updated on recovery) */
  handleRef: { current: PageHandle };
  /** Resolved page ID */
  pageId: string;
  /** Snapshot capture function */
  captureSnapshot: CaptureSnapshotFn;
  /** Tool context instance */
  ctx: ToolContext;
}

/**
 * Prepare context for action execution.
 * Resolves page, ensures CDP session health, and creates capture function.
 *
 * @param pageId - Optional page ID to resolve
 * @returns Action context with handle, capture function, and session
 */
export async function prepareActionContext(
  pageId: string | undefined,
  ctx: ToolContext
): Promise<ActionContext> {
  const handleRef = { current: ctx.resolveExistingPage(pageId) };
  const resolvedPageId = handleRef.current.page_id;

  handleRef.current = (await ctx.ensureCdpSession(handleRef.current)).handle;
  await handleRef.current.page.bringToFront();
  const captureSnapshot = createActionCapture(ctx, handleRef, resolvedPageId);

  return { handleRef, pageId: resolvedPageId, captureSnapshot, ctx };
}
