/**
 * Text Normalization and Processing Utilities
 *
 * Pure utility functions for text processing, normalization,
 * and string matching used in element discovery.
 */

/**
 * Normalize text for matching:
 * - Unicode NFKC normalization
 * - Remove zero-width/invisible characters
 * - Collapse whitespace
 */
export function normalizeText(text: string): string {
  return (
    text
      .normalize('NFKC')
      // Remove zero-width/invisible characters
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\u200B-\u200D\uFEFF\u034F\u2060\u180E]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Sanitize accessible name/label hint for selector building
 * Returns undefined if the result is empty or too short
 */
export function sanitizeAccessibleHint(value: string, maxLength = 160): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;

  const tokens = normalized.split(' ').filter(Boolean).slice(0, 12);
  if (tokens.length === 0) return undefined;

  return truncate(tokens.join(' '), maxLength);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Escape string for CSS attribute selector (for display labels).
 * Normalizes and truncates the value.
 */
export function escapeAttributeValue(value: string, maxLength = 120): string {
  return truncate(normalizeText(value), maxLength).replace(/["\\]/g, '\\$&');
}

/**
 * Escape a value for use inside CSS attribute selector quotes.
 * Follows CSS string serialization spec:
 * - Null (U+0000) -> U+FFFD replacement character
 * - Control chars (U+0001-U+001F, U+007F) -> hex escape with trailing space
 * - Quotes and backslashes -> backslash escape
 *
 * Does NOT truncate or normalize. Use for exact-match selectors like [attr="value"].
 *
 * @param value - Raw attribute value
 * @returns String safe for use in [attr="value"] selectors
 */
export function escapeAttrSelectorValue(value: string): string {
  if (!value) return '';

  const result: string[] = [];

  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    const codeUnit = value.charCodeAt(i);

    // Null character -> replacement character
    if (codeUnit === 0) {
      result.push('\uFFFD');
      continue;
    }

    // Control characters (U+0001 to U+001F, U+007F) -> hex escape with trailing space
    if ((codeUnit >= 0x0001 && codeUnit <= 0x001f) || codeUnit === 0x007f) {
      result.push('\\' + codeUnit.toString(16) + ' ');
      continue;
    }

    // Quotes and backslashes -> backslash escape
    if (char === '"' || char === '\\') {
      result.push('\\' + char);
      continue;
    }

    result.push(char);
  }

  return result.join('');
}

/**
 * Escape a name for use in Playwright-style role locators: role=button[name="..."]
 * Only escapes quotes and backslashes - keeps control characters raw.
 * Playwright's role engine matches against actual accessible names, not CSS.
 *
 * @param value - Raw accessible name
 * @returns String safe for use in role=[name="value"] locators
 */
export function escapeRoleLocatorName(value: string): string {
  if (!value) return '';
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Escape a string for use in CSS selectors (CSS.escape() semantics).
 * Does NOT truncate or normalize - uses raw value.
 * Safe for ID selectors (#id), class selectors (.class), etc.
 *
 * Follows CSS.escape() specification:
 * https://drafts.csswg.org/cssom/#the-css.escape()-method
 *
 * @param value - Raw string to escape
 * @returns CSS-escaped string safe for use in selectors
 */
export function cssEscape(value: string): string {
  if (!value) return '';

  const result: string[] = [];
  const length = value.length;

  for (let i = 0; i < length; i++) {
    const char = value.charAt(i);
    const codeUnit = value.charCodeAt(i);

    // Null character -> U+FFFD replacement character
    if (codeUnit === 0) {
      result.push('\uFFFD');
      continue;
    }

    // Control characters (U+0001 to U+001F, U+007F) -> unicode escape
    if ((codeUnit >= 0x0001 && codeUnit <= 0x001f) || codeUnit === 0x007f) {
      result.push('\\' + codeUnit.toString(16) + ' ');
      continue;
    }

    // First character special rules
    if (i === 0) {
      // Digit as first character -> unicode escape
      if (codeUnit >= 0x0030 && codeUnit <= 0x0039) {
        result.push('\\' + codeUnit.toString(16) + ' ');
        continue;
      }
      // Single hyphen -> escape
      if (char === '-' && length === 1) {
        result.push('\\-');
        continue;
      }
      // Hyphen followed by digit -> escape the hyphen
      if (char === '-' && length > 1) {
        const nextCodeUnit = value.charCodeAt(1);
        if (nextCodeUnit >= 0x0030 && nextCodeUnit <= 0x0039) {
          result.push('\\-');
          continue;
        }
      }
    }

    // Safe characters: letters, digits (not first), hyphen, underscore, non-ASCII
    if (
      codeUnit >= 0x0080 || // Non-ASCII
      char === '-' ||
      char === '_' ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) || // 0-9
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) || // A-Z
      (codeUnit >= 0x0061 && codeUnit <= 0x007a) // a-z
    ) {
      result.push(char);
      continue;
    }

    // Everything else gets escaped with backslash
    result.push('\\' + char);
  }

  return result.join('');
}

/**
 * Escape string for XPath string literal
 * XPath doesn't have a standard escape mechanism, so we handle quotes carefully
 */
export function escapeXPathValue(value: string): string {
  if (value.includes("'")) {
    if (value.includes('"')) {
      // Contains both - use concat() to build the string
      const parts = value.split("'");
      return 'concat(' + parts.map((part) => `'${part}'`).join(', "\'", ') + ')';
    }
    // Contains only single quotes - wrap in double quotes
    return `"${value}"`;
  }
  // No single quotes - use as-is (caller wraps in single quotes)
  return value;
}

/**
 * Tokenize text for XPath matching
 * Takes first few significant words to avoid overly specific selectors
 */
export function tokenizeForMatching(text: string, maxTokens = 3, minLength = 2): string[] {
  const normalized = normalizeText(text);
  const words = normalized.split(' ').filter((word) => word.length > minLength);
  return words.slice(0, maxTokens);
}

/**
 * Check if two strings match using fuzzy token-based comparison
 */
export function fuzzyTokenMatch(text: string, query: string, minMatchTokens = 2): boolean {
  const textTokens = new Set(tokenizeForMatching(text.toLowerCase(), 10, 2));
  const queryTokens = tokenizeForMatching(query.toLowerCase(), 5, 2);

  if (queryTokens.length === 0) return false;

  let matchCount = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      matchCount++;
    }
  }

  return matchCount >= Math.min(minMatchTokens, queryTokens.length);
}

// ============================================================================
// Fuzzy Matching Utilities
// ============================================================================

/**
 * Calculate Levenshtein (edit) distance between two strings.
 * Uses optimized single-row algorithm with O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Early exit for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Single row of previous distances
  let prevRow = new Array<number>(m + 1);
  let currRow = new Array<number>(m + 1);

  // Initialize first row
  for (let i = 0; i <= m; i++) {
    prevRow[i] = i;
  }

  // Fill in the rest
  for (let j = 1; j <= n; j++) {
    currRow[0] = j;

    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i] + 1, // deletion
        currRow[i - 1] + 1, // insertion
        prevRow[i - 1] + cost // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[m];
}

/**
 * Calculate similarity ratio (0-1) between two strings based on Levenshtein distance.
 * Returns 1 for identical strings, 0 for completely different strings.
 */
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // Both empty strings are identical
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Options for fuzzy token matching
 */
export interface FuzzyTokenMatchOptions {
  /** Minimum token overlap ratio (0-1) for a match. Default: 0.5 */
  minTokenOverlap?: number;
  /** Enable prefix matching for tokens. Default: true */
  prefixMatch?: boolean;
  /** Minimum edit distance similarity (0-1) for similar tokens. Default: 0.8 */
  minSimilarity?: number;
}

/**
 * Result from fuzzy token matching
 */
export interface FuzzyTokenMatchResult {
  /** Whether the tokens match based on options */
  isMatch: boolean;
  /** Match score (0-1) based on token overlap quality */
  score: number;
}

/**
 * Enhanced fuzzy token matching with similarity scoring.
 * Supports exact matching, prefix matching, and edit distance similarity.
 *
 * @param textTokens - Tokens from the text being searched
 * @param queryTokens - Tokens from the search query
 * @param options - Matching options
 * @returns Match result with score
 */
export function fuzzyTokensMatch(
  textTokens: string[],
  queryTokens: string[],
  options: FuzzyTokenMatchOptions = {}
): FuzzyTokenMatchResult {
  const { minTokenOverlap = 0.5, prefixMatch = true, minSimilarity = 0.8 } = options;

  if (queryTokens.length === 0) {
    return { isMatch: false, score: 0 };
  }

  let totalScore = 0;

  for (const queryToken of queryTokens) {
    let bestMatch = 0;

    for (const textToken of textTokens) {
      // Exact match - perfect score
      if (textToken === queryToken) {
        bestMatch = 1;
        break;
      }

      // Prefix match - high score (query token is prefix of text token)
      if (prefixMatch && textToken.startsWith(queryToken)) {
        bestMatch = Math.max(bestMatch, 0.9);
        continue;
      }

      // Prefix match - query token contains text token (slightly lower)
      if (prefixMatch && queryToken.startsWith(textToken)) {
        bestMatch = Math.max(bestMatch, 0.85);
        continue;
      }

      // Edit distance similarity - typo tolerance
      const similarity = stringSimilarity(textToken, queryToken);
      if (similarity >= minSimilarity) {
        bestMatch = Math.max(bestMatch, similarity);
      }
    }

    totalScore += bestMatch;
  }

  const overlapRatio = totalScore / queryTokens.length;

  return {
    isMatch: overlapRatio >= minTokenOverlap,
    score: overlapRatio,
  };
}

/**
 * Minimal DOM node interface for text content extraction.
 * Compatible with RawDomNode from extractors.
 */
export interface TextContentNode {
  /** Node type (3 = TEXT_NODE) */
  nodeType: number;
  /** Text content for text nodes */
  nodeValue?: string;
  /** Child node IDs (backendNodeIds) */
  childNodeIds?: number[];
}

/** DOM node type constant for text nodes */
const TEXT_NODE_TYPE = 3;

/**
 * Extract text content from a DOM node by concatenating text-node children.
 * Uses depth-limited traversal to avoid performance issues.
 *
 * @param nodeId - Backend node ID of the element
 * @param domNodes - Map of backendNodeId -> node with nodeType, nodeValue, childNodeIds
 * @param maxDepth - Maximum depth to traverse (default: 2)
 * @returns Normalized text content or undefined if none found
 */
export function getTextContent(
  nodeId: number,
  domNodes: Map<number, TextContentNode>,
  maxDepth = 2
): string | undefined {
  const parts: string[] = [];

  function traverse(currentNodeId: number, depth: number): void {
    if (depth > maxDepth) return;

    const node = domNodes.get(currentNodeId);
    if (!node) return;

    // Collect text from text nodes
    if (node.nodeType === TEXT_NODE_TYPE && node.nodeValue) {
      const trimmed = node.nodeValue.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }

    // Traverse children
    if (node.childNodeIds) {
      for (const childId of node.childNodeIds) {
        traverse(childId, depth + 1);
      }
    }
  }

  traverse(nodeId, 0);

  if (parts.length === 0) return undefined;

  const result = normalizeText(parts.join(' '));
  return result || undefined;
}

/**
 * Build an XML attribute string, choosing quote style to minimize escaping.
 * Uses single quotes when value contains double quotes (common in selectors).
 *
 * @param name - Attribute name
 * @param value - Attribute value
 * @returns Formatted attribute string like `name="value"` or `name='value'`
 */
export function xmlAttr(name: string, value: string): string {
  if (!value) return `${name}=""`;

  const hasDoubleQuote = value.includes('"');
  const hasSingleQuote = value.includes("'");

  // Prefer single quotes when value contains double quotes (common in selectors)
  if (hasDoubleQuote && !hasSingleQuote) {
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `${name}='${escaped}'`;
  }

  // Default: double-quote wrapping with full escaping
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return `${name}="${escaped}"`;
}
