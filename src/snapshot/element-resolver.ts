/**
 * Element Resolver
 *
 * Resolves node_id from snapshot to Playwright locator.
 */

import type { Page, Locator } from 'playwright';
import type { ReadableNode } from './snapshot.types.js';

/**
 * Result of parsing a locator string.
 */
export type ParsedLocator =
  | { type: 'role'; role: string; name: string | undefined }
  | { type: 'css'; selector: string };

/**
 * Parse a locator string to determine its type.
 *
 * Supported formats:
 * - role=button                    → { type: 'role', role: 'button' }
 * - role=button[name="Submit"]     → { type: 'role', role: 'button', name: 'Submit' }
 * - button.primary                 → { type: 'css', selector: 'button.primary' }
 *
 * @param locator - Locator string
 * @returns Parsed locator info
 */
export function parseLocatorString(locator: string): ParsedLocator {
  // Check for role= prefix
  if (locator.startsWith('role=')) {
    const rest = locator.slice(5); // Remove 'role='

    // Check for [name="..."] or [name='...']
    const nameMatch = /^(\w+)\[name=["']([^"']+)["']\]$/.exec(rest);
    if (nameMatch) {
      return { type: 'role', role: nameMatch[1], name: nameMatch[2] };
    }

    // Role only (e.g., "role=button")
    const roleOnly = /^(\w+)$/.exec(rest);
    if (roleOnly) {
      return { type: 'role', role: roleOnly[1], name: undefined };
    }
  }

  // Fallback to CSS selector
  return { type: 'css', selector: locator };
}

/**
 * Resolve a ReadableNode to a Playwright Locator.
 *
 * @param page - Playwright Page instance
 * @param node - ReadableNode from snapshot
 * @returns Playwright Locator
 * @throws Error if node has no locator
 */
export function resolveLocator(page: Page, node: ReadableNode): Locator {
  const selector = node.find?.primary;

  if (!selector) {
    throw new Error(`Node ${node.node_id} has no locator`);
  }

  const parsed = parseLocatorString(selector);

  if (parsed.type === 'role') {
    // Use Playwright's getByRole with proper typing
    const options: { name?: string } = {};
    if (parsed.name !== undefined) {
      options.name = parsed.name;
    }
    // Cast to any to avoid strict AriaRole typing issues
    return page.getByRole(parsed.role as Parameters<Page['getByRole']>[0], options);
  }

  // CSS selector fallback
  return page.locator(parsed.selector);
}
