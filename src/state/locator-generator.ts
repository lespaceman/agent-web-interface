/**
 * Locator Generator
 *
 * Generate stable locators for actionable elements.
 * Preference order: AX (accessibility tree) > CSS > XPath (avoid)
 *
 * Locators are layer-scoped when in modal/drawer/popover layers.
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { LocatorInfo } from './types.js';

// ============================================================================
// Layer Scope Configuration
// ============================================================================

/**
 * Layer scope prefixes for Playwright locators.
 * Used to scope locators to the active layer.
 */
const LAYER_SCOPES: Record<string, string> = {
  modal: 'role=dialog[aria-modal="true"] >> ',
  drawer: 'role=complementary >> ',
  popover: 'role=menu >> ',
  main: '', // No scope for main layer
};

/**
 * CSS layer scope prefixes.
 */
const CSS_LAYER_SCOPES: Record<string, string> = {
  modal: '[role="dialog"][aria-modal="true"] ',
  drawer: '[role="complementary"] ',
  popover: '[role="menu"] ',
  main: '',
};

// ============================================================================
// Locator Generation
// ============================================================================

/**
 * Generate locator information for a node.
 * Always includes preferred AX locator, optionally includes CSS fallback.
 * Locators are scoped to the active layer when not in main.
 *
 * @param node - Node to generate locator for
 * @param layer - Active layer for scoping (optional)
 * @returns Locator information
 */
export function generateLocator(node: ReadableNode, layer?: string): LocatorInfo {
  const role = node.attributes?.role ?? node.kind;
  const name = node.label.trim();

  // Determine layer scope
  const activeLayer = layer ?? getNodeLayer(node);
  const axScope = LAYER_SCOPES[activeLayer] ?? '';
  const cssScope = CSS_LAYER_SCOPES[activeLayer] ?? '';

  // AX locator (most stable - accessibility tree)
  const axLocator = axScope + buildAxLocator(role, name);

  // CSS fallback (try test-id, name, aria-label)
  const cssLocator = buildCssLocator(node, cssScope);

  return {
    preferred: { ax: axLocator },
    fallback: cssLocator ? { css: cssLocator } : undefined,
  };
}

/**
 * Determine which layer a node belongs to from its region.
 *
 * @param node - Node to check
 * @returns Layer name
 */
function getNodeLayer(node: ReadableNode): string {
  const region = node.where.region ?? 'unknown';
  return region === 'dialog' ? 'modal' : 'main';
}

// ============================================================================
// AX Locator (Preferred)
// ============================================================================

/**
 * Build accessibility tree locator.
 * Format: "role=button[name*="Submit"]"
 *
 * @param role - Element role
 * @param name - Accessible name
 * @returns AX locator string
 */
function buildAxLocator(role: string, name: string): string {
  if (name === '') {
    return `role=${role}`;
  }

  // Truncate name to 40 chars and escape
  const truncatedName = name.substring(0, 40);
  const escapedName = escapeAttr(truncatedName);

  return `role=${role}[name*="${escapedName}"]`;
}

// ============================================================================
// CSS Locator (Fallback)
// ============================================================================

/**
 * Build CSS locator fallback.
 * Try in order:
 * 1. data-testid
 * 2. name attribute
 * 3. aria-label
 * 4. (skip - no generic selector)
 *
 * @param node - Node to generate CSS locator for
 * @param scope - Layer scope prefix
 * @returns CSS locator string or undefined
 */
function buildCssLocator(node: ReadableNode, scope: string): string | undefined {
  const attrs = node.attributes as Record<string, unknown> | undefined;

  // Try test-id first (most stable)
  const testId = attrs?.['data-testid'];
  if (typeof testId === 'string') {
    return `${scope}[data-testid="${escapeAttr(testId)}"]`;
  }

  // Try name attribute (for inputs)
  const name = attrs?.name;
  if (typeof name === 'string') {
    return `${scope}[name="${escapeAttr(name)}"]`;
  }

  // Try aria-label
  const ariaLabel = attrs?.['aria-label'];
  if (typeof ariaLabel === 'string') {
    return `${scope}[aria-label*="${escapeAttr(ariaLabel)}"]`;
  }

  // No suitable CSS locator found
  return undefined;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape attribute value for use in selectors.
 * Escapes quotes and backslashes.
 *
 * @param value - Raw attribute value
 * @returns Escaped value
 */
function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
