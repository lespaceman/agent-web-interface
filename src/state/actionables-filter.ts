/**
 * Actionables Filter
 *
 * Select and rank interactive elements for LLM context.
 * Filter to active layer, score by relevance, cap at max count.
 */

import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';
import type { ScoringContext } from './types.js';

// Interactive element kinds
const INTERACTIVE_KINDS: NodeKind[] = [
  'link',
  'button',
  'input',
  'textarea',
  'select',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'tab',
  'menuitem',
];

/**
 * Check if node kind is interactive.
 */
export function isInteractiveKind(kind: NodeKind): boolean {
  return INTERACTIVE_KINDS.includes(kind);
}

// ============================================================================
// Actionables Selection
// ============================================================================

/**
 * Select actionable elements from snapshot.
 *
 * Filtering rules:
 * 1. Only interactive elements
 * 2. Only visible elements
 * 3. Only from active layer
 * 4. Score by relevance
 * 5. Cap at maxCount
 *
 * @param snapshot - Compiled snapshot
 * @param activeLayer - Active layer name
 * @param maxCount - Maximum number of actionables to return
 * @param context - Scoring context (optional)
 * @returns Selected nodes sorted by relevance
 */
export function selectActionables(
  snapshot: BaseSnapshot,
  activeLayer: string,
  maxCount: number,
  context?: ScoringContext
): ReadableNode[] {
  // Filter to candidates
  const candidates = snapshot.nodes.filter((node) => {
    // Must be interactive
    if (!isInteractiveKind(node.kind)) {
      return false;
    }

    // Must be visible
    if (!node.state?.visible) {
      return false;
    }

    // Must be in active layer
    const nodeLayer = getNodeLayer(node);
    if (nodeLayer !== activeLayer) {
      return false;
    }

    return true;
  });

  // Score each candidate
  const scored = candidates.map((node) => ({
    node,
    score: scoreActionable(node, context),
  }));

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Cap at maxCount
  return scored.slice(0, maxCount).map((s) => s.node);
}

// ============================================================================
// Scoring Algorithm
// ============================================================================

/**
 * Score an actionable element by relevance.
 *
 * Scoring factors:
 * - Enabled state (+0.2)
 * - Role importance (button/input: +0.3, link: +0.25, etc.)
 * - Semantic region (main: +0.15, dialog: +0.2)
 * - Screen position (above-fold: +0.1)
 * - Has label (+0.15)
 * - Primary CTA (+0.3)
 * - Currently focused (+0.2)
 *
 * @param node - Node to score
 * @param context - Scoring context
 * @returns Score from 0-1
 */
export function scoreActionable(node: ReadableNode, context?: ScoringContext): number {
  let score = 0.5; // Base score

  // Visibility required (already filtered, but double-check)
  if (!node.state?.visible) {
    return 0;
  }

  // Enabled state
  if (node.state?.enabled) {
    score += 0.2;
  }

  // Role importance
  const roleWeight: Partial<Record<NodeKind, number>> = {
    button: 0.3,
    link: 0.25,
    input: 0.3,
    textarea: 0.25,
    select: 0.25,
    checkbox: 0.2,
    radio: 0.2,
    switch: 0.2,
    combobox: 0.25,
    slider: 0.15,
    tab: 0.2,
    menuitem: 0.2,
  };
  score += roleWeight[node.kind] ?? 0.1;

  // Semantic region (main/dialog favored)
  const region = node.where.region ?? 'unknown';
  if (region === 'main') {
    score += 0.15;
  } else if (region === 'dialog') {
    score += 0.2;
  }

  // Above fold (from layout.screen_zone)
  if (node.layout.screen_zone?.includes('above-fold')) {
    score += 0.1;
  }

  // Has label (actionable without label is suspect)
  if (node.label.trim().length > 0) {
    score += 0.15;
  }

  // Primary CTA (from FactPack if available)
  if (context?.primaryCTA?.node_id === node.node_id) {
    score += 0.3;
  }

  // Currently focused
  if (node.state?.focused) {
    score += 0.2;
  }

  // Cap at 1.0
  return Math.min(score, 1.0);
}

// ============================================================================
// Layer Determination
// ============================================================================

/**
 * Determine which layer a node belongs to.
 * Simplified: use region as proxy.
 *
 * Modal elements are in 'dialog' region.
 * Everything else is in 'main'.
 *
 * TODO: Make this more sophisticated by checking node ancestry
 * and matching against detected layer root EIDs.
 *
 * @param node - Node to check
 * @returns Layer name
 */
function getNodeLayer(node: ReadableNode): string {
  const region = node.where.region ?? 'unknown';

  // Dialog region maps to modal layer
  if (region === 'dialog') {
    return 'modal';
  }

  // Everything else maps to main layer
  // TODO: Add drawer and popover detection based on ancestry
  return 'main';
}
