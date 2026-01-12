/**
 * Delta FactPack Utilities
 *
 * Hash functions, composite key builders, and other helpers
 * for delta computation and element reference management.
 */

import { createHash } from 'crypto';
import type { ScopedElementRef, CompositeNodeKey, VersionedSnapshot } from './types.js';
import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';

// ============================================================================
// Composite Key Functions
// ============================================================================

/**
 * Build composite key from a ScopedElementRef.
 * Format: "frameId:loaderId:backendNodeId"
 */
export function makeCompositeKey(ref: ScopedElementRef): CompositeNodeKey {
  return `${ref.frame_id}:${ref.loader_id}:${ref.backend_node_id}`;
}

/**
 * Create composite key from a ReadableNode.
 * Uses the node's own loader_id (not mainFrame's) to handle iframes correctly.
 */
export function makeCompositeKeyFromNode(node: ReadableNode): CompositeNodeKey {
  return `${node.frame_id}:${node.loader_id}:${node.backend_node_id}`;
}

/**
 * Build a ScopedElementRef from a ReadableNode.
 * Uses the node's stored data rather than current frame state.
 */
export function buildRefFromNode(node: ReadableNode): ScopedElementRef {
  return {
    backend_node_id: node.backend_node_id,
    frame_id: node.frame_id,
    loader_id: node.loader_id,
  };
}

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Compute SHA-256 hash of a string.
 */
function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Compute content hash for a BaseSnapshot.
 * Used for change detection in version manager.
 */
export function hashSnapshot(snapshot: BaseSnapshot): string {
  // Hash key node properties that indicate meaningful change
  const content = snapshot.nodes.map((node) => hashNodeContent(node)).join('|');
  return sha256(content);
}

/**
 * Compute content hash for a single node.
 * Captures mutable properties that indicate meaningful change.
 */
export function hashNodeContent(node: ReadableNode): string {
  // Include properties that when changed indicate meaningful update
  const parts = [
    node.backend_node_id.toString(),
    node.kind,
    node.label,
    node.state?.visible?.toString() ?? '',
    node.state?.enabled?.toString() ?? '',
    node.state?.checked?.toString() ?? '',
    node.state?.expanded?.toString() ?? '',
    node.state?.selected?.toString() ?? '',
    node.state?.focused?.toString() ?? '',
    node.attributes?.value ?? '',
  ];
  return sha256(parts.join('::'));
}

/**
 * Compute content hash for an array of nodes.
 * Used for overlay content change detection.
 */
export function hashNodes(nodes: ReadableNode[]): string {
  const content = nodes.map((node) => hashNodeContent(node)).join('|');
  return sha256(content);
}

// ============================================================================
// Snapshot Helpers
// ============================================================================

/**
 * Check if a snapshot has unknown frames (loader_id lookup failed).
 * When true, delta computation should be skipped.
 */
export function hasUnknownFrames(snapshot: BaseSnapshot): boolean {
  return snapshot.meta.warnings?.some((w) => w.includes('unknown frame')) ?? false;
}

/**
 * Create a VersionedSnapshot wrapper.
 */
export function createVersionedSnapshot(
  version: number,
  snapshot: BaseSnapshot
): VersionedSnapshot {
  return {
    version,
    snapshot,
    hash: hashSnapshot(snapshot),
    timestamp: Date.now(),
  };
}

// ============================================================================
// Delta Computation Helpers
// ============================================================================

/**
 * Compute delta confidence score.
 * Lower confidence when too many changes detected.
 */
export function computeDeltaConfidence(
  addedCount: number,
  removedCount: number,
  modifiedCount: number,
  totalNodes: number
): number {
  const changedNodes = addedCount + removedCount + modifiedCount;
  const changeRatio = changedNodes / Math.max(totalNodes, 1);
  // Confidence decreases linearly with change ratio
  // At 50% change, confidence is 0
  return Math.max(0, 1 - changeRatio * 2);
}

/**
 * Check if delta is reliable based on confidence and change ratio.
 */
export function isDeltaReliable(
  confidence: number,
  addedCount: number,
  removedCount: number,
  modifiedCount: number,
  totalNodes: number
): boolean {
  // Confidence threshold from design doc
  if (confidence < 0.6) {
    return false;
  }

  // Also check absolute change ratio for small snapshots
  const changedNodes = addedCount + removedCount + modifiedCount;
  const changeRatio = changedNodes / Math.max(totalNodes, 1);

  // If more than 40% of nodes changed, unreliable
  if (changeRatio > 0.4) {
    return false;
  }

  return true;
}

// ============================================================================
// Node Comparison Helpers
// ============================================================================

/**
 * Check if two nodes represent the same element.
 * Compares full ref (frame_id + loader_id + backend_node_id).
 */
export function isSameElement(a: ScopedElementRef, b: ScopedElementRef): boolean {
  return (
    a.backend_node_id === b.backend_node_id &&
    a.frame_id === b.frame_id &&
    a.loader_id === b.loader_id
  );
}

/**
 * Check if node content changed (for modification detection).
 */
export function didNodeContentChange(oldHash: string, newNode: ReadableNode): boolean {
  return hashNodeContent(newNode) !== oldHash;
}
