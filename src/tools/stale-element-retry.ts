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
 * Find the best matching node in a fresh snapshot using label+kind plus
 * location-based disambiguation scoring.
 *
 * Candidates must match on label and kind. Among those, we score by how many
 * `where` properties (region, heading_context, group_id) also match. Ties are
 * broken by choosing the node whose backend_node_id is closest to the original,
 * as a proxy for DOM proximity.
 */
function findBestMatch(
  original: ReadableNode,
  freshNodes: ReadableNode[]
): ReadableNode | undefined {
  const candidates = freshNodes.filter(
    (n) => n.label === original.label && n.kind === original.kind
  );

  if (candidates.length <= 1) return candidates[0];

  // Score each candidate by matching where-properties
  const scored = candidates.map((candidate) => {
    let score = 0;
    if (candidate.where.region === original.where.region) score++;
    if (
      original.where.heading_context != null &&
      candidate.where.heading_context === original.where.heading_context
    )
      score++;
    if (original.where.group_id != null && candidate.where.group_id === original.where.group_id)
      score++;
    return { candidate, score };
  });

  // Sort: highest score first, then closest backend_node_id as tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const distA = Math.abs(a.candidate.backend_node_id - original.backend_node_id);
    const distB = Math.abs(b.candidate.backend_node_id - original.backend_node_id);
    return distA - distB;
  });

  return scored[0].candidate;
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

    // Find element by label+kind, then disambiguate using location context
    const freshNode = findBestMatch(node, freshSnapshot.nodes);

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
