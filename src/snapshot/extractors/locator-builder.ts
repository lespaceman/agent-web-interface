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
import { escapeAttributeValue } from '../../lib/text-utils.js';

/**
 * Test ID attributes to check (in priority order)
 */
const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];

/**
 * Build a CSS attribute selector.
 *
 * @param attr - Attribute name
 * @param value - Attribute value
 * @returns CSS attribute selector string
 */
function attrSelector(attr: string, value: string): string {
  return `[${attr}="${escapeAttributeValue(value)}"]`;
}

/**
 * Build a role-based locator.
 *
 * @param role - AX role
 * @param name - Accessible name (optional)
 * @returns Role locator string
 */
function roleLocator(role: string, name?: string): string {
  if (name) {
    return `role=${role}[name="${escapeAttributeValue(name)}"]`;
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
  label: string
): NodeLocators {
  const attributes = domNode?.attributes ?? {};
  const role = axNode?.role;
  const nodeName = domNode?.nodeName?.toLowerCase();

  const alternates: string[] = [];
  let primary: string | undefined;

  // 1. Test ID (highest priority)
  for (const testIdAttr of TEST_ID_ATTRS) {
    const testId = attributes[testIdAttr];
    if (testId) {
      if (!primary) {
        primary = attrSelector(testIdAttr, testId);
      } else {
        alternates.push(attrSelector(testIdAttr, testId));
      }
      break; // Only use first test ID found
    }
  }

  // 2. Role + name locator
  if (role) {
    const roleSelector = roleLocator(role, label || undefined);
    if (!primary) {
      primary = roleSelector;
    } else if (label) {
      // Only add as alternate if it has a name (more specific)
      alternates.push(roleSelector);
    }
  }

  // 3. CSS ID selector
  const id = attributes.id;
  if (id) {
    const idSelector = `#${escapeAttributeValue(id)}`;
    if (!primary) {
      primary = idSelector;
    } else {
      alternates.push(idSelector);
    }
  }

  // 4. aria-label selector
  const ariaLabel = attributes['aria-label'];
  if (ariaLabel) {
    const ariaSelector = attrSelector('aria-label', ariaLabel);
    if (!primary) {
      primary = ariaSelector;
    } else if (!alternates.includes(ariaSelector)) {
      alternates.push(ariaSelector);
    }
  }

  // 5. Form name attribute (for inputs)
  const nameAttr = attributes.name;
  if (nameAttr && (nodeName === 'input' || nodeName === 'select' || nodeName === 'textarea')) {
    const nameSelector = attrSelector('name', nameAttr);
    if (!primary) {
      primary = nameSelector;
    } else if (!alternates.includes(nameSelector)) {
      alternates.push(nameSelector);
    }
  }

  // 6. Class-based selector
  const className = getFirstMeaningfulClass(attributes.class);
  if (className && nodeName) {
    const classSelector = `${nodeName}.${className}`;
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

  return result;
}
