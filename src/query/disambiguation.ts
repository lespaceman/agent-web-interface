/**
 * Disambiguation
 *
 * Generate suggestions to narrow ambiguous query results.
 * Analyzes matched nodes and suggests refinements.
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  FindElementsRequest,
  MatchedNode,
  DisambiguationSuggestion,
} from './types/query.types.js';
import { normalizeText } from '../lib/text-utils.js';
import { normalizeLabelFilter } from './scoring.js';

/**
 * Generate disambiguation suggestions when query matches multiple elements.
 * Suggests refinements that would narrow down the results.
 */
export function generateSuggestions(
  matches: MatchedNode[],
  request: FindElementsRequest
): DisambiguationSuggestion[] {
  const suggestions: DisambiguationSuggestion[] = [];
  const nodes = matches.map((m) => m.node);

  // Only generate suggestions if we have multiple matches
  if (matches.length < 2) return suggestions;

  // 1. Suggest refining by kind if matches have different kinds
  if (request.kind === undefined) {
    const kindCounts = countByAttribute(nodes, (n) => n.kind);
    if (kindCounts.size > 1) {
      for (const [kind, count] of kindCounts) {
        if (count < matches.length) {
          suggestions.push({
            type: 'refine_kind',
            message: `Add kind: "${kind}" to narrow to ${count} result(s)`,
            refinement: { kind },
            expected_matches: count,
          });
        }
      }
    }
  }

  // 2. Suggest refining by region if matches span multiple regions
  if (request.region === undefined) {
    const regionCounts = countByAttribute(nodes, (n) => n.where.region);
    if (regionCounts.size > 1) {
      for (const [region, count] of regionCounts) {
        if (count < matches.length && region !== 'unknown') {
          suggestions.push({
            type: 'refine_region',
            message: `Add region: "${region}" to narrow to ${count} result(s)`,
            refinement: { region },
            expected_matches: count,
          });
        }
      }
    }
  }

  // 3. Suggest refining by group_id if matches have different groups
  if (request.group_id === undefined) {
    const groupCounts = countByAttribute(nodes, (n) => n.where.group_id);
    groupCounts.delete(undefined); // Remove nodes without groups
    if (groupCounts.size >= 1) {
      for (const [groupId, count] of groupCounts) {
        if (groupId !== undefined) {
          suggestions.push({
            type: 'refine_group',
            message: `Add group_id: "${groupId}" to narrow to ${count} result(s)`,
            refinement: { group_id: groupId },
            expected_matches: count,
          });
        }
      }
    }
  }

  // 4. Suggest adding state filters
  if (request.state === undefined) {
    const enabledCount = nodes.filter((n) => n.state?.enabled).length;
    if (enabledCount > 0 && enabledCount < matches.length) {
      suggestions.push({
        type: 'add_state',
        message: `Add state: { enabled: true } to narrow to ${enabledCount} result(s)`,
        refinement: { state: { enabled: true } },
        expected_matches: enabledCount,
      });
    }

    const visibleCount = nodes.filter((n) => n.state?.visible).length;
    if (visibleCount > 0 && visibleCount < matches.length) {
      suggestions.push({
        type: 'add_state',
        message: `Add state: { visible: true } to narrow to ${visibleCount} result(s)`,
        refinement: { state: { visible: true } },
        expected_matches: visibleCount,
      });
    }
  }

  // 5. Suggest refining label to exact match if using contains/fuzzy
  if (request.label !== undefined) {
    const { mode, text } = normalizeLabelFilter(request.label);
    if (mode !== 'exact') {
      const normalizedText = normalizeText(text.toLowerCase());
      const exactCount = nodes.filter(
        (n) => normalizeText(n.label.toLowerCase()) === normalizedText
      ).length;
      if (exactCount > 0 && exactCount < matches.length) {
        suggestions.push({
          type: 'refine_label',
          message: `Use exact label match to narrow to ${exactCount} result(s)`,
          refinement: { label: { text, mode: 'exact' } },
          expected_matches: exactCount,
        });
      }
    }
  }

  // Sort by expected_matches (prefer suggestions that narrow most effectively)
  // and limit to top 5
  return suggestions
    .filter((s) => s.expected_matches > 0 && s.expected_matches < matches.length)
    .sort((a, b) => a.expected_matches - b.expected_matches)
    .slice(0, 5);
}

/**
 * Count nodes by a given attribute.
 */
export function countByAttribute<T>(
  nodes: ReadableNode[],
  getter: (node: ReadableNode) => T
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const node of nodes) {
    const value = getter(node);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
