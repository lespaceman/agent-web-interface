/**
 * Attribute Extractor
 *
 * Extracts element-specific attributes for the NodeAttributes field.
 * Handles input type, placeholder, href, src, alt, heading level,
 * form action/method, test IDs, and explicit role attributes.
 *
 * @module snapshot/extractors/attribute-extractor
 */

import type { RawDomNode, RawAxNode } from './types.js';
import type { NodeKind, NodeAttributes } from '../snapshot.types.js';

/**
 * Options for attribute extraction
 */
export interface AttributeExtractionOptions {
  /** Include input values (default: false for security) */
  includeValues?: boolean;

  /** Redact password field values (default: true) */
  redactSensitive?: boolean;

  /** Remove sensitive query params from URLs (default: true) */
  sanitizeUrls?: boolean;
}

/**
 * Default extraction options
 */
const DEFAULT_OPTIONS: Required<AttributeExtractionOptions> = {
  includeValues: false,
  redactSensitive: true,
  sanitizeUrls: true,
};

/**
 * Sensitive query parameter names to strip from URLs
 */
const SENSITIVE_PARAMS = new Set([
  'token',
  'key',
  'api_key',
  'apikey',
  'auth',
  'password',
  'secret',
  'access_token',
  'refresh_token',
  'session',
  'sessionid',
  'session_id',
  'credential',
  'credentials',
]);

/**
 * Maximum URL length before truncation
 */
const MAX_URL_LENGTH = 200;

/**
 * Test ID attribute names in priority order
 */
const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];

/**
 * Sanitize a URL by removing sensitive query parameters.
 *
 * @param url - URL to sanitize
 * @returns Sanitized URL
 */
export function sanitizeUrl(url: string): string {
  // Handle relative URLs - just truncate if needed
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return truncateUrl(url);
  }

  try {
    const parsed = new URL(url);

    // Remove sensitive params
    const paramsToDelete: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_PARAMS.has(lowerKey)) {
        paramsToDelete.push(key);
      }
    }
    for (const key of paramsToDelete) {
      parsed.searchParams.delete(key);
    }

    return truncateUrl(parsed.toString());
  } catch {
    // Invalid URL, return as-is (truncated)
    return truncateUrl(url);
  }
}

/**
 * Truncate a URL if it exceeds maximum length.
 *
 * @param url - URL to truncate
 * @returns Truncated URL with '...' suffix if needed
 */
function truncateUrl(url: string): string {
  if (url.length <= MAX_URL_LENGTH) {
    return url;
  }
  return url.substring(0, MAX_URL_LENGTH) + '...';
}

/**
 * Extract domain + path from an image src URL.
 *
 * @param src - Image source URL
 * @returns Domain and path only (no query params)
 */
function extractImageSrc(src: string): string {
  // Handle data URLs
  if (src.startsWith('data:')) {
    return '[data-url]';
  }

  // Handle relative URLs
  if (!src.startsWith('http://') && !src.startsWith('https://')) {
    return src;
  }

  try {
    const parsed = new URL(src);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return src;
  }
}

/**
 * Extract heading level from tag name.
 *
 * @param tagName - HTML tag name (e.g., 'H1', 'H2')
 * @returns Heading level (1-6) or undefined
 */
function getHeadingLevelFromTag(tagName: string): number | undefined {
  const match = /^H([1-6])$/.exec(tagName.toUpperCase());
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Get heading level from AX node properties.
 *
 * @param axNode - Accessibility node
 * @returns Heading level from AX properties or undefined
 */
function getHeadingLevelFromAx(axNode: RawAxNode | undefined): number | undefined {
  if (!axNode?.properties) {
    return undefined;
  }

  const levelProp = axNode.properties.find((p) => p.name === 'level');
  if (levelProp?.value?.value !== undefined) {
    const level = Number(levelProp.value.value);
    if (level >= 1 && level <= 6) {
      return level;
    }
  }
  return undefined;
}

/**
 * Extract test ID from DOM attributes.
 *
 * @param attrs - DOM attributes
 * @returns Test ID or undefined
 */
function extractTestId(attrs: Record<string, string>): string | undefined {
  for (const attrName of TEST_ID_ATTRS) {
    const value = attrs[attrName];
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract element-specific attributes based on NodeKind.
 *
 * @param domNode - Raw DOM node (can be undefined)
 * @param kind - Semantic node kind
 * @param options - Extraction options
 * @param axNode - Optional AX node for additional properties
 * @returns NodeAttributes or undefined if no attributes
 */
export function extractAttributes(
  domNode: RawDomNode | undefined,
  kind: NodeKind,
  options: AttributeExtractionOptions = {},
  axNode?: RawAxNode
): NodeAttributes | undefined {
  if (!domNode) {
    return undefined;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const attrs: NodeAttributes = {};
  const domAttrs = domNode.attributes ?? {};

  // Input type (only for input kind)
  if (kind === 'input' && domAttrs.type) {
    attrs.input_type = domAttrs.type;
  }

  // Placeholder (any kind)
  if (domAttrs.placeholder && domAttrs.placeholder.length > 0) {
    attrs.placeholder = domAttrs.placeholder;
  }

  // Value extraction (with redaction)
  if (opts.includeValues && domAttrs.value !== undefined) {
    const isPassword = domAttrs.type?.toLowerCase() === 'password';
    if (isPassword && opts.redactSensitive) {
      attrs.value = '[REDACTED]';
    } else {
      attrs.value = domAttrs.value;
    }
  }

  // Link href (only for link kind)
  if (kind === 'link' && domAttrs.href) {
    attrs.href = opts.sanitizeUrls ? sanitizeUrl(domAttrs.href) : domAttrs.href;
  }

  // Image alt and src (only for image kind)
  if (kind === 'image') {
    if (domAttrs.alt) {
      attrs.alt = domAttrs.alt;
    }
    if (domAttrs.src) {
      attrs.src = extractImageSrc(domAttrs.src);
    }
  }

  // Heading level (only for heading kind)
  if (kind === 'heading') {
    // AX tree level takes precedence (more accurate for ARIA headings)
    const axLevel = getHeadingLevelFromAx(axNode);
    const tagLevel = getHeadingLevelFromTag(domNode.nodeName);
    attrs.heading_level = axLevel ?? tagLevel;
  }

  // Form action and method (only for form kind)
  if (kind === 'form') {
    if (domAttrs.action) {
      attrs.action = domAttrs.action;
    }
    if (domAttrs.method) {
      attrs.method = domAttrs.method;
    }
  }

  // Autocomplete (for input/select/combobox kinds)
  if (domAttrs.autocomplete) {
    attrs.autocomplete = domAttrs.autocomplete;
  }

  // Test ID (any kind)
  const testId = extractTestId(domAttrs);
  if (testId) {
    attrs.test_id = testId;
  }

  // Explicit role attribute (any kind)
  if (domAttrs.role) {
    attrs.role = domAttrs.role;
  }

  // Return undefined if no attributes were extracted
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}
