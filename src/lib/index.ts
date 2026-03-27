/**
 * Reusable algorithms and utilities
 */

// Text processing utilities
export {
  normalizeText,
  truncate,
  escapeAttrSelectorValue,
  cssEscape,
  escapeRoleLocatorName,
  escapeXPathValue,
  tokenizeForMatching,
  fuzzyTokensMatch,
  getTextContent,
  escapeXml,
  xmlAttr,
  type TextContentNode,
  type FuzzyTokenMatchOptions,
  type FuzzyTokenMatchResult,
} from './text-utils.js';
