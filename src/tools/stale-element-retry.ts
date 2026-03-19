/**
 * Stale Element Retry
 *
 * Handles stale element detection and retry logic for element-based actions.
 *
 * @module tools/stale-element-retry
 */

import type { ReadableNode, BaseSnapshot } from '../snapshot/snapshot.types.js';
import type { PageHandle } from '../browser/page-registry.js';
import type { ClickOutcome } from '../state/element-ref.types.js';
import type { CaptureSnapshotFn } from './execute-action.js';

/**
 * Check if an error is a stale element error.
 */
export function isStaleElementError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes('no node found for given backend id') ||
    message.includes('protocol error (dom.scrollintoviewifneeded)') ||
    message.includes('node is detached from document') ||
    message.includes('node has been deleted')
  );
}

/**
 * Result of handling a stale element retry.
 */
export interface StaleElementRetryResult {
  success: boolean;
  error?: string;
  outcome: ClickOutcome;
}

/**
 * Handle stale element retry logic.
 *
 * @param handle - Page handle
 * @param node - Original target node
 * @param action - Action to retry
 * @param capture - Snapshot capture function
 * @param snapshotStore - Optional snapshot store to update
 * @returns Retry result with success/error/outcome
 */
export async function handleStaleElementRetry(
  handle: PageHandle,
  node: ReadableNode,
  action: (backendNodeId: number) => Promise<void>,
  capture: CaptureSnapshotFn,
  snapshotStore?: { store: (pageId: string, snapshot: BaseSnapshot) => void }
): Promise<StaleElementRetryResult> {
  try {
    // Capture fresh snapshot
    const freshSnapshot = (await capture()).snapshot;

    // Update snapshot store if provided
    if (snapshotStore) {
      snapshotStore.store(handle.page_id, freshSnapshot);
    }

    // Find element by label in fresh snapshot
    const freshNode = freshSnapshot.nodes.find(
      (n) => n.label === node.label && n.kind === node.kind
    );

    if (!freshNode) {
      return {
        success: false,
        error: `Element no longer found after refresh: ${node.label}`,
        outcome: {
          status: 'element_not_found',
          eid: '', // Will be filled by caller if available
          last_known_label: node.label,
        },
      };
    }

    // Retry action with fresh backend_node_id
    await action(freshNode.backend_node_id);

    return {
      success: true,
      outcome: { status: 'stale_element', reason: 'dom_mutation', retried: true },
    };
  } catch (retryErr) {
    return {
      success: false,
      error:
        retryErr instanceof Error
          ? `Retry failed: ${retryErr.message}`
          : `Retry failed: ${String(retryErr)}`,
      outcome: { status: 'stale_element', reason: 'dom_mutation', retried: true },
    };
  }
}
