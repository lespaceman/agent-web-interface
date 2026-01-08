/**
 * Locator Builder
 *
 * Generates stable locators for element interaction.
 *
 * @module snapshot/extractors/locator-builder
 *
 * Strategies (priority order):
 * 1. test-id (data-testid, data-test, data-cy)
 * 2. Role + accessible name
 * 3. CSS ID selector
 * 4. Role + unique attribute
 * 5. CSS selector (class combo)
 * 6. Tag-based fallback
 */

import type { NodeLocators } from '../snapshot.types.js';
import type { RawDomNode, RawAxNode } from './types.js';
import {
  escapeAttrSelectorValue,
  escapeRoleLocatorName,
  cssEscape,
  normalizeText,
} from '../../lib/text-utils.js';

/**
 * Test ID attributes to check (in priority order)
 */
const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];

/** Prevent oversized locators that can bloat snapshots or break consumers. */
const MAX_LOCATOR_VALUE_LENGTH = 200;

function isLocatorValueWithinLimit(value: string): boolean {
  return value.length <= MAX_LOCATOR_VALUE_LENGTH;
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const codeUnit = value.charCodeAt(i);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function canUseRoleName(value: string): boolean {
  return isLocatorValueWithinLimit(value) && !hasControlCharacters(value);
}

/**
 * Build a CSS attribute selector for exact match.
 * Uses raw value with only quote escaping (no truncation/normalization).
 *
 * @param attr - Attribute name
 * @param value - Attribute value (raw)
 * @returns CSS attribute selector string
 */
function attrSelector(attr: string, value: string): string {
  return `[${attr}="${escapeAttrSelectorValue(value)}"]`;
}

/**
 * Build a role-based locator using raw accessible name.
 * Uses escapeRoleLocatorName for Playwright-style role selectors
 * (only escapes quotes/backslashes, keeps control chars raw).
 *
 * @param role - AX role
 * @param name - Raw accessible name (not normalized/truncated)
 * @returns Role locator string
 */
function roleLocator(role: string, name?: string): string {
  if (name) {
    return `role=${role}[name="${escapeRoleLocatorName(name)}"]`;
  }
  return `role=${role}`;
}

/**
 * Get the first non-generic class name from a class list.
 *
 * @param classList - Space-separated class names
 * @returns First meaningful class or undefined
 */
function getFirstMeaningfulClass(classList: string | undefined): string | undefined {
  if (!classList) return undefined;

  const genericClasses = new Set([
    'container',
    'wrapper',
    'inner',
    'outer',
    'content',
    'row',
    'col',
    'column',
    'flex',
    'grid',
    'block',
    'inline',
    'hidden',
    'visible',
  ]);

  const classes = classList.split(/\s+/).filter(Boolean);

  // Return first non-generic class
  for (const cls of classes) {
    if (!genericClasses.has(cls.toLowerCase())) {
      return cls;
    }
  }

  // If all are generic, return first one
  return classes[0];
}

/**
 * Build locators for an element.
 *
 * @param domNode - Raw DOM node data (optional)
 * @param axNode - Raw AX node data (optional)
 * @param label - Resolved accessible label
 * @returns NodeLocators with primary and alternates
 */
export function buildLocators(
  domNode: RawDomNode | undefined,
  axNode: RawAxNode | undefined,
  _label: string
): NodeLocators {
  const attributes = domNode?.attributes ?? {};
  const role = axNode?.role;
  const nodeName = domNode?.nodeName?.toLowerCase();

  const alternates: string[] = [];
  let primary: string | undefined;

  // 1. Test ID (highest priority)
  for (const testIdAttr of TEST_ID_ATTRS) {
    const testId = attributes[testIdAttr];
    if (testId && isLocatorValueWithinLimit(testId)) {
      if (!primary) {
        primary = attrSelector(testIdAttr, testId);
      } else {
        alternates.push(attrSelector(testIdAttr, testId));
      }
      break; // Only use first test ID found
    }
  }

  // 2. Role + name locator - use RAW accessible name (not normalized label)
  if (role) {
    // Prefer axNode.name if present and non-empty after trim
    // For aria-label fallback, normalize whitespace to match typical AX behavior
    let rawName: string | undefined;

    if (axNode?.name?.trim()) {
      // Use raw AX name as-is (preserves its original whitespace)
      rawName = axNode.name;
    } else if (attributes['aria-label']) {
      // Fallback: normalize aria-label whitespace to match typical AX computed behavior
      const normalized = normalizeText(attributes['aria-label']);
      rawName = normalized || undefined;
    }

    if (rawName && canUseRoleName(rawName)) {
      const roleSelector = roleLocator(role, rawName);
      if (!primary) {
        primary = roleSelector;
      } else {
        // Add as alternate since it has a specific name
        alternates.push(roleSelector);
      }
    } else {
      // No name available - emit bare role locator as fallback (not specific enough for alternate)
      primary ??= roleLocator(role);
    }
  }

  // 3. CSS ID selector (use cssEscape for proper escaping of special chars)
  const id = attributes.id;
  if (id && isLocatorValueWithinLimit(id)) {
    const idSelector = `#${cssEscape(id)}`;
    if (!primary) {
      primary = idSelector;
    } else {
      alternates.push(idSelector);
    }
  }

  // 4. aria-label selector
  const ariaLabel = attributes['aria-label'];
  if (ariaLabel && isLocatorValueWithinLimit(ariaLabel)) {
    const ariaSelector = attrSelector('aria-label', ariaLabel);
    if (!primary) {
      primary = ariaSelector;
    } else if (!alternates.includes(ariaSelector)) {
      alternates.push(ariaSelector);
    }
  }

  // 5. Form name attribute (for inputs)
  const nameAttr = attributes.name;
  if (
    nameAttr &&
    isLocatorValueWithinLimit(nameAttr) &&
    (nodeName === 'input' || nodeName === 'select' || nodeName === 'textarea')
  ) {
    const nameSelector = attrSelector('name', nameAttr);
    if (!primary) {
      primary = nameSelector;
    } else if (!alternates.includes(nameSelector)) {
      alternates.push(nameSelector);
    }
  }

  // 6. Class-based selector (use cssEscape for proper escaping of special chars)
  const className = getFirstMeaningfulClass(attributes.class);
  if (className && nodeName && isLocatorValueWithinLimit(className)) {
    const classSelector = `${nodeName}.${cssEscape(className)}`;
    if (!primary) {
      primary = classSelector;
    } else if (!alternates.includes(classSelector)) {
      alternates.push(classSelector);
    }
  }

  // 7. Tag-based fallback
  primary ??= nodeName ?? '*';

  // Build result
  const result: NodeLocators = {
    primary,
  };

  // Filter out duplicates and limit alternates
  const uniqueAlternates = [...new Set(alternates)]
    .filter((alt) => alt !== primary && alt.length > 0)
    .slice(0, 3); // Limit to 3 alternates

  if (uniqueAlternates.length > 0) {
    result.alternates = uniqueAlternates;
  }

  // Include frame/shadow paths if present (for cross-boundary element targeting)
  if (domNode?.framePath && domNode.framePath.length > 0) {
    result.frame_path = domNode.framePath.map(String);
  }

  if (domNode?.shadowPath && domNode.shadowPath.length > 0) {
    result.shadow_path = domNode.shadowPath.map(String);
  }

  return result;
}
