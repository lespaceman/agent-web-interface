/**
 * Fuzzy Match
 *
 * Fuzzy label matching for query engine.
 * Uses token-based matching with configurable thresholds.
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { FuzzyMatchOptions } from './types/query.types.js';
import { normalizeText, tokenizeForMatching, fuzzyTokensMatch } from '../lib/text-utils.js';

/**
 * Filter nodes by fuzzy label matching.
 * Returns matched nodes and a map of node_id -> match score for relevance calculation.
 */
export function filterByLabelFuzzy(
  nodes: ReadableNode[],
  text: string,
  caseSensitive: boolean,
  options: FuzzyMatchOptions = {}
): { nodes: ReadableNode[]; scores: Map<string, number> } {
  const scores = new Map<string, number>();
  const normalizedQuery = normalizeText(caseSensitive ? text : text.toLowerCase());
  const queryTokens = tokenizeForMatching(normalizedQuery, 10, 2);

  if (queryTokens.length === 0) {
    return { nodes: [], scores };
  }

  const matched = nodes.filter((n) => {
    const normalizedLabel = normalizeText(caseSensitive ? n.label : n.label.toLowerCase());
    const labelTokens = tokenizeForMatching(normalizedLabel, 10, 2);

    const result = fuzzyTokensMatch(labelTokens, queryTokens, {
      minTokenOverlap: options.minTokenOverlap ?? 0.5,
      prefixMatch: options.prefixMatch ?? true,
      minSimilarity: options.minSimilarity ?? 0.8,
    });

    if (result.isMatch) {
      scores.set(n.node_id, result.score);
    }
    return result.isMatch;
  });

  return { nodes: matched, scores };
}
