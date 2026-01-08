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
