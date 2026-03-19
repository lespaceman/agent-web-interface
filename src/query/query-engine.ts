/**
 * Query Engine
 *
 * Simple filter-based engine for querying BaseSnapshot data.
 * Supports filtering by kind, label, region, state, group_id, and heading_context.
 *
 * Future enhancements:
 * - Fuzzy/semantic label matching
 * - Relevance scoring
 * - Disambiguation suggestions
 */

import type {
  BaseSnapshot,
  ReadableNode,
  NodeKind,
  SemanticRegion,
} from '../snapshot/snapshot.types.js';
import type {
  FindElementsRequest,
  FindElementsResponse,
  MatchedNode,
  DisambiguationSuggestion,
  LabelFilter,
  StateConstraint,
  TextMatchMode,
} from './types/query.types.js';
import { normalizeText } from '../lib/text-utils.js';
import { scoreMatch, normalizeLabelFilter } from './scoring.js';
import { generateSuggestions } from './disambiguation.js';
import { filterByLabelFuzzy } from './fuzzy-match.js';

/**
 * Query engine options
 */
export interface QueryEngineOptions {
  /** Default limit for find() results (default: 10) */
  defaultLimit?: number;

  // Future: custom scoring weights
  // weights?: Partial<ScoringWeights>;

  // Future: build indices eagerly
  // eagerIndexing?: boolean;
}

/**
 * Query engine for BaseSnapshot data
 */
export class QueryEngine {
  private readonly snapshot: BaseSnapshot;
  private readonly nodeMap: Map<string, ReadableNode>;
  private readonly defaultLimit: number;

  /**
   * Create a query engine for a snapshot
   */
  constructor(snapshot: BaseSnapshot, options: QueryEngineOptions = {}) {
    this.snapshot = snapshot;
    this.nodeMap = new Map(snapshot.nodes.map((n) => [n.node_id, n]));
    this.defaultLimit = options.defaultLimit ?? 10;
  }

  /**
   * Find elements matching the request
   */
  find(request: FindElementsRequest = {}): FindElementsResponse {
    const startTime = performance.now();
    const limit = request.limit ?? this.defaultLimit;

    let candidates = [...this.snapshot.nodes];
    let labelScores: Map<string, number> | undefined;

    // Apply filters in order of expected selectivity (most selective first)

    // Filter by kind
    if (request.kind !== undefined) {
      candidates = this.filterByKind(candidates, request.kind);
    }

    // Filter by label (with fuzzy support)
    if (request.label !== undefined) {
      const { mode, text, caseSensitive, fuzzyOptions } = normalizeLabelFilter(request.label);

      if (mode === 'fuzzy') {
        const result = filterByLabelFuzzy(candidates, text, caseSensitive, fuzzyOptions);
        candidates = result.nodes;
        labelScores = result.scores;
      } else {
        candidates = this.filterByLabel(candidates, request.label);
      }
    }

    // Filter by region
    if (request.region !== undefined) {
      candidates = this.filterByRegion(candidates, request.region);
    }

    // Filter by state
    if (request.state !== undefined) {
      candidates = this.filterByState(candidates, request.state);
    }

    // Filter by group_id (exact match)
    if (request.group_id !== undefined) {
      candidates = candidates.filter((n) => n.where.group_id === request.group_id);
    }

    // Filter by heading_context (exact match)
    if (request.heading_context !== undefined) {
      candidates = candidates.filter((n) => n.where.heading_context === request.heading_context);
    }

    // Score all candidates
    const scoredMatches: MatchedNode[] = candidates.map((node) => {
      const { relevance, reasons } = scoreMatch(node, request, labelScores?.get(node.node_id));
      return { node, relevance, match_reasons: reasons };
    });

    // Apply min_score filter
    let filteredMatches = scoredMatches;
    if (request.min_score !== undefined) {
      filteredMatches = scoredMatches.filter((m) => (m.relevance ?? 0) >= request.min_score!);
    }

    // Sort by relevance if requested
    if (request.sort_by_relevance) {
      filteredMatches.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    }

    // Record total before applying limit
    const totalMatched = filteredMatches.length;

    // Apply limit
    const limitedMatches = filteredMatches.slice(0, limit);

    // Generate suggestions if requested and results are ambiguous
    let suggestions: DisambiguationSuggestion[] | undefined;
    if (request.include_suggestions && totalMatched > 1) {
      suggestions = generateSuggestions(limitedMatches, request);
      if (suggestions.length === 0) suggestions = undefined;
    }

    return {
      matches: limitedMatches,
      stats: {
        total_matched: totalMatched,
        query_time_ms: performance.now() - startTime,
        nodes_evaluated: this.snapshot.nodes.length,
      },
      suggestions,
    };
  }

  /**
   * Get a single element by node_id
   */
  getById(nodeId: string): ReadableNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  /**
   * Get snapshot metadata
   */
  getSnapshotInfo(): { snapshot_id: string; node_count: number } {
    return {
      snapshot_id: this.snapshot.snapshot_id,
      node_count: this.snapshot.nodes.length,
    };
  }

  /**
   * Get all nodes (respects limit)
   */
  getAllNodes(limit?: number): ReadableNode[] {
    const effectiveLimit = limit ?? this.defaultLimit;
    return this.snapshot.nodes.slice(0, effectiveLimit);
  }

  // ===========================================================================
  // Private filter methods
  // ===========================================================================

  /**
   * Filter nodes by kind(s)
   */
  private filterByKind(nodes: ReadableNode[], kind: NodeKind | NodeKind[]): ReadableNode[] {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return nodes.filter((n) => kinds.includes(n.kind));
  }

  /**
   * Filter nodes by label text
   */
  private filterByLabel(nodes: ReadableNode[], filter: string | LabelFilter): ReadableNode[] {
    const { text, mode, caseSensitive } = normalizeLabelFilter(filter);

    if (!text) {
      return nodes;
    }

    return nodes.filter((n) => this.matchLabel(n.label, text, mode, caseSensitive));
  }

  /**
   * Check if a label matches the search text
   */
  private matchLabel(
    label: string,
    searchText: string,
    mode: TextMatchMode,
    caseSensitive: boolean
  ): boolean {
    const normalizedLabel = normalizeText(caseSensitive ? label : label.toLowerCase());
    const normalizedSearch = normalizeText(caseSensitive ? searchText : searchText.toLowerCase());

    switch (mode) {
      case 'exact':
        return normalizedLabel === normalizedSearch;
      case 'contains':
      default:
        return normalizedLabel.includes(normalizedSearch);
    }

    // Future: fuzzy matching
    // case 'fuzzy':
    //   return fuzzyTokenMatch(normalizedLabel, normalizedSearch);
  }

  /**
   * Filter nodes by region(s)
   */
  private filterByRegion(
    nodes: ReadableNode[],
    region: SemanticRegion | SemanticRegion[]
  ): ReadableNode[] {
    const regions = Array.isArray(region) ? region : [region];
    return nodes.filter((n) => regions.includes(n.where.region));
  }

  /**
   * Filter nodes by state constraints
   */
  private filterByState(nodes: ReadableNode[], constraint: StateConstraint): ReadableNode[] {
    return nodes.filter((n) => this.matchState(n, constraint));
  }

  /**
   * Check if a node matches all state constraints
   */
  private matchState(node: ReadableNode, constraint: StateConstraint): boolean {
    // Nodes without state don't match state constraints
    if (!node.state) {
      return false;
    }

    // Check each constraint field
    for (const [key, requiredValue] of Object.entries(constraint)) {
      if (requiredValue === undefined) {
        continue;
      }

      const actualValue = node.state[key as keyof StateConstraint];

      // If the constraint is set but the node doesn't have this state property,
      // it doesn't match (unless we're checking for false and it's undefined)
      if (actualValue === undefined) {
        // undefined is treated as false for boolean constraints
        if (requiredValue === false) {
          continue;
        }
        return false;
      }

      if (actualValue !== requiredValue) {
        return false;
      }
    }

    return true;
  }
}
