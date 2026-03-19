/**
 * Hash Utilities
 *
 * Computes document IDs and UI/layer hashes for state tracking.
 *
 * @module state/hash-utils
 */

import { createHash } from 'crypto';
import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import { computeEid } from './element-identity.js';
import { isInteractiveKind } from './actionables-filter.js';

/**
 * Compute document ID from snapshot.
 *
 * Uses only URL origin + pathname for navigation detection.
 * This ensures DOM mutations (like autocomplete suggestions appearing)
 * are NOT falsely detected as navigation events.
 *
 * NOTE: Previously this included a hash of the first 10 interactive node IDs,
 * which caused false navigation detection when typing triggered autocomplete
 * or other dynamic UI updates. See: https://github.com/lespaceman/agent-web-interface/issues/XXX
 */
export function computeDocId(snapshot: BaseSnapshot): string {
  const url = new URL(snapshot.url);
  // Only use origin + pathname for navigation detection
  // Query params and fragments are ignored (same page, different state)
  return hash(`${url.origin}:${url.pathname}`);
}

export function computeUiHash(snapshot: BaseSnapshot): string {
  const interactiveNodeIds = snapshot.nodes
    .filter((n) => isInteractiveKind(n.kind) && n.state?.visible)
    .map((n) => computeEid(n))
    .join(',');

  return hash(interactiveNodeIds).substring(0, 6);
}

export function computeLayerHash(stack: string[]): string {
  return hash(stack.join(',')).substring(0, 6);
}

export function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 12);
}
