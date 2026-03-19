/**
 * Effect Tracker
 *
 * Computes observed effects by comparing snapshots before and after actions.
 *
 * @module tools/effect-tracker
 */

import type { BaseSnapshot } from '../snapshot/snapshot.types.js';
import { createObservedEffect, type ObservedEffect } from '../form/index.js';

/**
 * Compute an ObservedEffect by comparing snapshots before and after an action.
 *
 * This function analyzes differences between two snapshots to determine:
 * - Which elements became enabled/disabled
 * - Which elements appeared/disappeared
 * - Which elements had their values change
 *
 * @param triggerEid - EID of the element that triggered the action
 * @param actionType - Type of action performed
 * @param prevSnapshot - Snapshot before the action (null if first action)
 * @param currSnapshot - Snapshot after the action
 * @returns ObservedEffect if meaningful changes detected, null otherwise
 */
export function computeObservedEffect(
  triggerEid: string,
  actionType: 'click' | 'type' | 'select' | 'focus' | 'blur',
  prevSnapshot: BaseSnapshot | null,
  currSnapshot: BaseSnapshot
): ObservedEffect | null {
  // Skip if no previous snapshot to compare
  if (!prevSnapshot) {
    return null;
  }

  // Build maps of enabled/visible states
  const beforeEids = new Map<string, boolean>();
  const beforeVisible = new Set<string>();
  const beforeValues = new Map<string, string>();

  for (const node of prevSnapshot.nodes) {
    beforeEids.set(node.node_id, node.state?.enabled ?? true);
    if (node.state?.visible) {
      beforeVisible.add(node.node_id);
    }
    if (node.attributes?.value !== undefined) {
      beforeValues.set(node.node_id, node.attributes.value);
    }
  }

  const afterEids = new Map<string, boolean>();
  const afterVisible = new Set<string>();
  const valueChanges: string[] = [];

  for (const node of currSnapshot.nodes) {
    afterEids.set(node.node_id, node.state?.enabled ?? true);
    if (node.state?.visible) {
      afterVisible.add(node.node_id);
    }
    // Detect value changes
    const prevValue = beforeValues.get(node.node_id);
    const currValue = node.attributes?.value;
    if (currValue !== undefined && currValue !== prevValue) {
      // Skip if this is the trigger element itself (self-change from typing)
      if (node.node_id !== triggerEid) {
        valueChanges.push(node.node_id);
      }
    }
  }

  // Create the observed effect
  const effect = createObservedEffect(
    triggerEid,
    actionType,
    beforeEids,
    afterEids,
    beforeVisible,
    afterVisible,
    valueChanges
  );

  // Only return if there are meaningful changes
  const hasChanges =
    effect.enabled.length > 0 ||
    effect.disabled.length > 0 ||
    effect.appeared.length > 0 ||
    effect.disappeared.length > 0 ||
    effect.value_changed.length > 0;

  return hasChanges ? effect : null;
}
