/**
 * EID Linker
 *
 * Links DOM observations to snapshot nodes by semantic matching.
 * Since observations are captured in browser context (no access to CDP backend_node_id),
 * we perform post-hoc matching after snapshot capture using semantic signals:
 * - Tag → Kind mapping
 * - Role matching
 * - Label/text fuzzy matching
 */

import type { DOMObservation, ObservationGroups } from './observation.types.js';
import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';
import type { ElementRegistry } from '../state/element-registry.js';
import { fuzzyTokensMatch, tokenizeForMatching } from '../lib/text-utils.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for observation-to-node matching.
 */
export interface EidLinkerOptions {
  /** Minimum score threshold for a valid match (0-1). Default: 0.5 */
  minMatchScore?: number;

  /** Enable fuzzy text matching. Default: true */
  fuzzyTextMatch?: boolean;

  /** Minimum token overlap for fuzzy matching. Default: 0.5 */
  minTokenOverlap?: number;
}

/**
 * Result of eid linking operation.
 */
export interface EidLinkingResult {
  /** Number of observations that were linked */
  linked: number;

  /** Number of observations that could not be linked */
  unlinked: number;

  /** Total observations processed */
  total: number;
}

// ============================================================================
// Scoring Constants
// ============================================================================

/** Score contribution for tag/kind match (required for any match) */
const SCORE_TAG_MATCH = 0.3;

/** Score contribution for ARIA role match */
const SCORE_ROLE_MATCH = 0.25;

/** Score contribution for text/label match */
const SCORE_TEXT_MATCH = 0.3;

/** Score contribution for dialog context match */
const SCORE_DIALOG_CONTEXT = 0.15;

// ============================================================================
// Tag to Kind Mapping
// ============================================================================

/**
 * Map HTML tags from observations to possible NodeKind values in snapshots.
 * A tag can map to multiple kinds since role can change the semantic meaning.
 */
const TAG_TO_KINDS: Record<string, NodeKind[]> = {
  // Links
  a: ['link'],

  // Buttons
  button: ['button'],

  // Inputs
  input: ['input', 'checkbox', 'radio', 'switch', 'slider'],
  textarea: ['textarea'],
  select: ['select', 'combobox'],

  // Structural with role variants
  div: ['generic', 'dialog', 'section', 'button', 'link'],
  span: ['generic', 'text'],
  section: ['section', 'generic'],

  // Dialog-specific
  dialog: ['dialog'],

  // Navigation
  nav: ['navigation'],
  form: ['form'],

  // Content
  h1: ['heading'],
  h2: ['heading'],
  h3: ['heading'],
  h4: ['heading'],
  h5: ['heading'],
  h6: ['heading'],
  p: ['paragraph', 'text'],
  img: ['image'],

  // Lists
  ul: ['list'],
  ol: ['list'],
  li: ['listitem'],

  // Media
  video: ['media'],
  audio: ['media'],

  // Table
  table: ['table'],
};

/**
 * Role to Kind mapping - when observation has explicit ARIA role.
 */
const ROLE_TO_KIND = {
  alert: 'generic', // alerts are typically generic divs with role
  alertdialog: 'dialog',
  dialog: 'dialog',
  button: 'button',
  link: 'link',
  textbox: 'input',
  checkbox: 'checkbox',
  radio: 'radio',
  combobox: 'combobox',
  listbox: 'combobox',
  menu: 'navigation',
  menuitem: 'menuitem',
  tab: 'tab',
  tabpanel: 'section',
  navigation: 'navigation',
  form: 'form',
  search: 'form',
} as const satisfies Record<string, NodeKind>;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Link observations to snapshot nodes by computing eids.
 *
 * Mutates observations in-place, setting the `eid` field for matched observations.
 * Only processes 'appeared' observations (disappeared elements don't exist in snapshot).
 *
 * @param observations - Observation groups to link
 * @param snapshot - Current snapshot to match against
 * @param registry - Element registry for eid lookup
 * @param options - Matching configuration
 * @returns Statistics about linking operation
 */
export function linkObservationsToSnapshot(
  observations: ObservationGroups,
  snapshot: BaseSnapshot,
  registry: ElementRegistry,
  options: EidLinkerOptions = {}
): EidLinkingResult {
  // Build index once for efficient lookup
  const nodeIndex = buildNodeIndex(snapshot);

  let linked = 0;
  let unlinked = 0;

  // Collect all appeared observations from both groups
  const toProcess = [
    ...observations.duringAction.filter((o) => o.type === 'appeared'),
    ...observations.sincePrevious.filter((o) => o.type === 'appeared'),
  ];

  for (const observation of toProcess) {
    const match = findBestMatch(observation, nodeIndex, options);

    if (match) {
      // Look up eid from registry using backend_node_id
      const eid = registry.getEidByBackendNodeId(match.backend_node_id);
      if (eid) {
        observation.eid = eid;
        linked++;
      } else {
        unlinked++;
      }
    } else {
      unlinked++;
    }
  }

  return {
    linked,
    unlinked,
    total: toProcess.length,
  };
}

/**
 * Build an index of snapshot nodes by kind for efficient lookup.
 *
 * @param snapshot - Snapshot to index
 * @returns Map from NodeKind to array of nodes
 */
export function buildNodeIndex(snapshot: BaseSnapshot): Map<NodeKind, ReadableNode[]> {
  const index = new Map<NodeKind, ReadableNode[]>();

  for (const node of snapshot.nodes) {
    const kind = node.kind;
    const nodes = index.get(kind) ?? [];
    nodes.push(node);
    index.set(kind, nodes);
  }

  return index;
}

/**
 * Find the best matching node for an observation.
 *
 * @param observation - The observation to match
 * @param nodeIndex - Pre-built index of nodes by kind
 * @param options - Matching options
 * @returns Best matching node or undefined if no match meets threshold
 */
export function findBestMatch(
  observation: DOMObservation,
  nodeIndex: Map<NodeKind, ReadableNode[]>,
  options: EidLinkerOptions = {}
): ReadableNode | undefined {
  const { minMatchScore = 0.5 } = options;

  // Get candidate kinds based on tag and role
  const candidateKinds = getCandidateKinds(observation);

  // Collect all candidate nodes
  const candidates: ReadableNode[] = [];
  for (const kind of candidateKinds) {
    const nodesOfKind = nodeIndex.get(kind);
    if (nodesOfKind) {
      candidates.push(...nodesOfKind);
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  // Score each candidate and find best match
  let bestMatch: ReadableNode | undefined;
  let bestScore = minMatchScore; // Must exceed threshold

  for (const node of candidates) {
    const score = computeMatchScore(observation, node, options);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = node;
    }
  }

  return bestMatch;
}

/**
 * Get candidate NodeKind values for an observation based on tag and role.
 */
export function getCandidateKinds(observation: DOMObservation): NodeKind[] {
  const tag = observation.content.tag.toLowerCase();
  const role = observation.content.role?.toLowerCase();

  const kinds = new Set<NodeKind>();

  // Add kinds from tag mapping
  const tagKinds = TAG_TO_KINDS[tag];
  if (tagKinds) {
    for (const kind of tagKinds) {
      kinds.add(kind);
    }
  }

  // Add kind from role mapping (higher priority when present)
  if (role && role in ROLE_TO_KIND) {
    kinds.add(ROLE_TO_KIND[role as keyof typeof ROLE_TO_KIND]);
  }

  // Fallback to generic if nothing matched
  if (kinds.size === 0) {
    kinds.add('generic');
  }

  return Array.from(kinds);
}

/**
 * Compute match score between an observation and a snapshot node.
 *
 * Scoring breakdown:
 * - Tag/Kind match: 0.3 (required - if no match, return 0)
 * - Role match: 0.25
 * - Label fuzzy match: 0.3
 * - Dialog context match: 0.15
 *
 * @param observation - DOM observation
 * @param node - Snapshot node
 * @param options - Matching options
 * @returns Score from 0-1 (0 = no match, 1 = perfect match)
 */
export function computeMatchScore(
  observation: DOMObservation,
  node: ReadableNode,
  options: EidLinkerOptions = {}
): number {
  const { fuzzyTextMatch = true, minTokenOverlap = 0.5 } = options;

  const content = observation.content;
  let score = 0;

  // Tag/Kind match check (required)
  const candidateKinds = getCandidateKinds(observation);
  if (!candidateKinds.includes(node.kind)) {
    return 0; // No match possible
  }
  score += SCORE_TAG_MATCH;

  // Role match (when observation has explicit role that matches node kind)
  const role = content.role?.toLowerCase();
  if (
    role &&
    role in ROLE_TO_KIND &&
    ROLE_TO_KIND[role as keyof typeof ROLE_TO_KIND] === node.kind
  ) {
    score += SCORE_ROLE_MATCH;
  }

  // Label/text matching
  if (content.text && node.label) {
    const normalizedObsText = content.text.toLowerCase().trim();
    const normalizedNodeLabel = node.label.toLowerCase().trim();

    // Exact match
    if (normalizedObsText === normalizedNodeLabel) {
      score += SCORE_TEXT_MATCH;
    } else if (fuzzyTextMatch) {
      // Fuzzy match
      const obsTokens = tokenizeForMatching(normalizedObsText, 10, 2);
      const nodeTokens = tokenizeForMatching(normalizedNodeLabel, 10, 2);

      const result = fuzzyTokensMatch(nodeTokens, obsTokens, { minTokenOverlap });
      if (result.isMatch) {
        score += SCORE_TEXT_MATCH * result.score;
      }
    }
  }

  // Dialog context bonus - if observation is dialog and node is in dialog region
  if (observation.signals.isDialog && node.where.region === 'dialog') {
    score += SCORE_DIALOG_CONTEXT;
  }

  // Cap at 1.0
  return Math.min(score, 1.0);
}
