/**
 * Label Resolver
 *
 * Computes accessible name with fallback strategies.
 *
 * @module snapshot/extractors/label-resolver
 *
 * Sources (priority order):
 * 1. AX tree computed name
 * 2. aria-label attribute
 * 3. aria-labelledby reference (not fully implemented - requires DOM lookup)
 * 4. Associated label element (not fully implemented - requires DOM lookup)
 * 5. Text content (not implemented - requires full DOM)
 * 6. title attribute
 * 7. placeholder attribute
 * 8. alt attribute (images)
 * 9. value attribute (submit buttons)
 * 10. name attribute (form elements)
 * 11. data-testid (fallback)
 */

import type { RawDomNode, RawAxNode } from './types.js';
import { normalizeText, truncate } from '../../lib/text-utils.js';

/**
 * Label source types (for debugging/tracking)
 */
export type LabelSource =
  | 'ax-name'
  | 'aria-label'
  | 'labelledby'
  | 'label-element'
  | 'text-content'
  | 'title'
  | 'placeholder'
  | 'alt'
  | 'value'
  | 'name'
  | 'test-id'
  | 'none';

/**
 * Label resolution result
 */
export interface LabelResolution {
  /** Resolved label text */
  label: string;
  /** Source of the label */
  source: LabelSource;
}

/** Maximum label length before truncation */
const MAX_LABEL_LENGTH = 160;

/**
 * Test ID attribute names to check
 */
const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];

/**
 * Get attribute value from DOM node, normalized and non-empty.
 *
 * @param attributes - DOM attributes record
 * @param name - Attribute name
 * @returns Normalized attribute value or undefined if empty
 */
function getAttr(
  attributes: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!attributes) return undefined;
  const value = attributes[name];
  if (!value) return undefined;
  const normalized = normalizeText(value);
  return normalized || undefined;
}

/**
 * Resolve label for an element from AX and DOM data.
 *
 * @param domNode - Raw DOM node data (optional)
 * @param axNode - Raw AX node data (optional)
 * @returns LabelResolution with label text and source
 */
export function resolveLabel(
  domNode: RawDomNode | undefined,
  axNode: RawAxNode | undefined
): LabelResolution {
  const attributes = domNode?.attributes;
  const nodeName = domNode?.nodeName?.toUpperCase();

  // 1. AX computed name (highest priority)
  if (axNode?.name) {
    const normalized = normalizeText(axNode.name);
    if (normalized) {
      return {
        label: truncate(normalized, MAX_LABEL_LENGTH),
        source: 'ax-name',
      };
    }
  }

  // 2. aria-label
  const ariaLabel = getAttr(attributes, 'aria-label');
  if (ariaLabel) {
    return {
      label: truncate(ariaLabel, MAX_LABEL_LENGTH),
      source: 'aria-label',
    };
  }

  // 3. aria-labelledby (would require DOM lookup - partial support)
  // Currently we don't have the full DOM to resolve references
  // This would be implemented in a more complete version

  // 4. title attribute
  const title = getAttr(attributes, 'title');
  if (title) {
    return {
      label: truncate(title, MAX_LABEL_LENGTH),
      source: 'title',
    };
  }

  // 5. placeholder (inputs, textareas)
  if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
    const placeholder = getAttr(attributes, 'placeholder');
    if (placeholder) {
      return {
        label: truncate(placeholder, MAX_LABEL_LENGTH),
        source: 'placeholder',
      };
    }
  }

  // 6. alt attribute (images)
  if (nodeName === 'IMG' || nodeName === 'IMAGE') {
    const alt = getAttr(attributes, 'alt');
    if (alt) {
      return {
        label: truncate(alt, MAX_LABEL_LENGTH),
        source: 'alt',
      };
    }
  }

  // 7. value attribute (submit/button inputs)
  if (nodeName === 'INPUT') {
    const inputType = attributes?.type?.toLowerCase();
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') {
      const value = getAttr(attributes, 'value');
      if (value) {
        return {
          label: truncate(value, MAX_LABEL_LENGTH),
          source: 'value',
        };
      }
    }
  }

  // 8. name attribute (form elements)
  if (nodeName === 'INPUT' || nodeName === 'SELECT' || nodeName === 'TEXTAREA') {
    const name = getAttr(attributes, 'name');
    if (name) {
      return {
        label: truncate(name, MAX_LABEL_LENGTH),
        source: 'name',
      };
    }
  }

  // 9. data-testid and variants (fallback for debugging)
  for (const testIdAttr of TEST_ID_ATTRS) {
    const testId = getAttr(attributes, testIdAttr);
    if (testId) {
      return {
        label: truncate(testId, MAX_LABEL_LENGTH),
        source: 'test-id',
      };
    }
  }

  // No label found
  return {
    label: '',
    source: 'none',
  };
}
