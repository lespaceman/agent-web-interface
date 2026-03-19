/**
 * Query Engine Module
 *
 * Provides semantic querying of BaseSnapshot data.
 */

// Types
export * from './types/query.types.js';

// Query Engine
export { QueryEngine } from './query-engine.js';
export type { QueryEngineOptions } from './query-engine.js';

// Scoring
export { scoreMatch, calculateMaxPossibleScore, normalizeLabelFilter, SCORING_WEIGHTS } from './scoring.js';

// Disambiguation
export { generateSuggestions, countByAttribute } from './disambiguation.js';

// Fuzzy matching
export { filterByLabelFuzzy } from './fuzzy-match.js';
