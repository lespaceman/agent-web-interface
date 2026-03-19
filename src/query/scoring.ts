/**
 * Scoring
 *
 * Relevance scoring for query matches.
 * Calculates how well a node matches the query request.
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  FindElementsRequest,
  MatchReason,
  LabelFilter,
  StateConstraint,
  TextMatchMode,
} from './types/query.types.js';

/**
 * Scoring weights for relevance calculation.
 * Values represent the maximum contribution each signal can add to the score.
 */
export const SCORING_WEIGHTS = {
  labelMatch: {
    exact: 0.4,
    contains: 0.3,
    fuzzy: 0.25, // Base, multiplied by fuzzy match quality
  },
  kindMatch: 0.15,
  regionMatch: 0.12,
  stateMatch: 0.03, // Per matching state property (max ~0.27 for 9 props)
  groupMatch: 0.08,
  headingMatch: 0.08,
  visibility: 0.02,
} as const;

/**
 * Normalize a label filter to its constituent parts.
 * Shared helper used by both scoring and the query engine.
 */
export function normalizeLabelFilter(filter: string | LabelFilter): {
  text: string;
  mode: TextMatchMode;
  caseSensitive: boolean;
  fuzzyOptions?: import('./types/query.types.js').FuzzyMatchOptions;
} {
  if (typeof filter === 'string') {
    return { text: filter, mode: 'contains', caseSensitive: false };
  }
  return {
    text: filter.text,
    mode: filter.mode ?? 'contains',
    caseSensitive: filter.caseSensitive ?? false,
    fuzzyOptions: filter.fuzzyOptions,
  };
}

/**
 * Calculate relevance score and match reasons for a node.
 *
 * @param node - The node to score
 * @param request - The original query request
 * @param labelMatchScore - Pre-computed label match score (for fuzzy matching)
 * @returns Relevance score (0-1) and list of reasons
 */
export function scoreMatch(
  node: ReadableNode,
  request: FindElementsRequest,
  labelMatchScore?: number
): { relevance: number; reasons: MatchReason[] } {
  let relevance = 0;
  const reasons: MatchReason[] = [];

  // Label scoring
  if (request.label !== undefined) {
    const { mode } = normalizeLabelFilter(request.label);
    let labelContribution: number;

    if (mode === 'fuzzy' && labelMatchScore !== undefined) {
      // Fuzzy: base weight * match quality
      labelContribution = SCORING_WEIGHTS.labelMatch.fuzzy * labelMatchScore;
    } else if (mode === 'exact') {
      labelContribution = SCORING_WEIGHTS.labelMatch.exact;
    } else {
      labelContribution = SCORING_WEIGHTS.labelMatch.contains;
    }

    relevance += labelContribution;
    reasons.push({
      type: 'label',
      description: `Label "${truncateLabel(node.label)}" matches query`,
      score_contribution: labelContribution,
    });
  }

  // Kind scoring
  if (request.kind !== undefined) {
    relevance += SCORING_WEIGHTS.kindMatch;
    reasons.push({
      type: 'kind',
      description: `Kind "${node.kind}" matches filter`,
      score_contribution: SCORING_WEIGHTS.kindMatch,
    });
  }

  // Region scoring
  if (request.region !== undefined) {
    relevance += SCORING_WEIGHTS.regionMatch;
    reasons.push({
      type: 'region',
      description: `Region "${node.where.region}" matches filter`,
      score_contribution: SCORING_WEIGHTS.regionMatch,
    });
  }

  // State scoring (per matched property)
  if (request.state !== undefined && node.state) {
    const matchedStates = Object.keys(request.state).filter(
      (k) =>
        request.state![k as keyof StateConstraint] !== undefined &&
        request.state![k as keyof StateConstraint] === node.state![k as keyof StateConstraint]
    );
    const stateContribution = matchedStates.length * SCORING_WEIGHTS.stateMatch;
    if (stateContribution > 0) {
      relevance += stateContribution;
      reasons.push({
        type: 'state',
        description: `States match: ${matchedStates.join(', ')}`,
        score_contribution: stateContribution,
      });
    }
  }

  // Group scoring
  if (request.group_id !== undefined) {
    relevance += SCORING_WEIGHTS.groupMatch;
    reasons.push({
      type: 'group',
      description: `Group "${node.where.group_id}" matches`,
      score_contribution: SCORING_WEIGHTS.groupMatch,
    });
  }

  // Heading context scoring
  if (request.heading_context !== undefined) {
    relevance += SCORING_WEIGHTS.headingMatch;
    reasons.push({
      type: 'heading',
      description: `Heading context "${node.where.heading_context}" matches`,
      score_contribution: SCORING_WEIGHTS.headingMatch,
    });
  }

  // Visibility bonus (always applied if node is visible)
  if (node.state?.visible) {
    relevance += SCORING_WEIGHTS.visibility;
  }

  // Normalize to 0-1 range based on what was actually queried
  // This gives higher scores when fewer filters are used but all match
  const maxPossible = calculateMaxPossibleScore(request);
  const normalizedRelevance = maxPossible > 0 ? Math.min(1, relevance / maxPossible) : 0;

  return { relevance: normalizedRelevance, reasons };
}

/**
 * Calculate the maximum possible score given the request filters.
 */
export function calculateMaxPossibleScore(request: FindElementsRequest): number {
  let max = SCORING_WEIGHTS.visibility; // Always possible

  if (request.label !== undefined) {
    const { mode } = normalizeLabelFilter(request.label);
    max += SCORING_WEIGHTS.labelMatch[mode];
  }
  if (request.kind !== undefined) max += SCORING_WEIGHTS.kindMatch;
  if (request.region !== undefined) max += SCORING_WEIGHTS.regionMatch;
  if (request.state !== undefined) {
    const stateCount = Object.keys(request.state).filter(
      (k) => request.state![k as keyof StateConstraint] !== undefined
    ).length;
    max += stateCount * SCORING_WEIGHTS.stateMatch;
  }
  if (request.group_id !== undefined) max += SCORING_WEIGHTS.groupMatch;
  if (request.heading_context !== undefined) max += SCORING_WEIGHTS.headingMatch;

  return max;
}

/**
 * Truncate a label for display in reasons.
 */
function truncateLabel(label: string, maxLength = 30): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + '…';
}
