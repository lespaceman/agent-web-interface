/**
 * State Extractor
 *
 * Extracts interactive element state (visible, enabled, checked, etc.)
 * by merging data from AX tree properties, DOM attributes, and layout.
 *
 * @module snapshot/extractors/state-extractor
 *
 * Sources (priority order):
 * 1. AX tree properties (checked, expanded, selected, disabled)
 * 2. DOM attributes (disabled, readonly, required)
 * 3. Computed visibility from layout
 */

import type { NodeState } from '../snapshot.types.js';
import type { RawDomNode, RawAxNode, NodeLayoutInfo, AxProperty } from './types.js';

/**
 * Get AX property value by name.
 *
 * @param properties - Array of AX properties
 * @param name - Property name to find
 * @returns Property value or undefined
 */
function getAxProperty(properties: AxProperty[] | undefined, name: string): unknown {
  if (!properties) return undefined;
  const prop = properties.find((p) => p.name === name);
  return prop?.value?.value;
}

/**
 * Check if DOM node has a boolean attribute (present = true).
 *
 * @param attributes - DOM attributes record
 * @param name - Attribute name
 * @returns true if attribute is present
 */
function hasBooleanAttribute(
  attributes: Record<string, string> | undefined,
  name: string
): boolean {
  if (!attributes) return false;
  return name in attributes;
}

/**
 * Get ARIA attribute value from DOM.
 *
 * @param attributes - DOM attributes record
 * @param name - ARIA attribute name (e.g., 'aria-disabled')
 * @returns Attribute value or undefined
 */
function getAriaAttribute(
  attributes: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!attributes) return undefined;
  return attributes[name];
}

/**
 * Parse checked state from AX property value.
 * AX uses tristate: 'true', 'false', 'mixed'
 *
 * @param value - AX property value
 * @returns boolean for true/false, undefined for mixed or unset
 */
function parseCheckedState(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  // 'mixed' or undefined results in undefined
  return undefined;
}

/**
 * Parse boolean state from various value types.
 *
 * @param value - Value to parse
 * @returns boolean or undefined
 */
function parseBooleanState(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/**
 * Extract state for an interactive element.
 *
 * Merges state from multiple sources:
 * - AX properties (primary source)
 * - DOM attributes (fallback)
 * - Layout information (visibility)
 *
 * @param domNode - Raw DOM node data (optional)
 * @param axNode - Raw AX node data (optional)
 * @param layout - Node layout info (optional)
 * @returns NodeState object
 */
export function extractState(
  domNode: RawDomNode | undefined,
  axNode: RawAxNode | undefined,
  layout: NodeLayoutInfo | undefined
): NodeState {
  const attributes = domNode?.attributes;
  const properties = axNode?.properties;

  // === Visibility ===
  // Primary: layout.isVisible
  // Default: true (assume visible if no layout info)
  const visible = layout?.isVisible ?? true;

  // === Enabled ===
  // Priority: AX disabled > DOM disabled > aria-disabled
  let enabled = true;

  // Check AX disabled property
  const axDisabled = getAxProperty(properties, 'disabled');
  if (axDisabled !== undefined) {
    enabled = !parseBooleanState(axDisabled);
  } else {
    // Fallback to DOM attributes
    if (hasBooleanAttribute(attributes, 'disabled')) {
      enabled = false;
    } else if (getAriaAttribute(attributes, 'aria-disabled') === 'true') {
      enabled = false;
    }
  }

  // === Checked (checkboxes, radios, switches) ===
  const axChecked = getAxProperty(properties, 'checked');
  const checked = parseCheckedState(axChecked);

  // === Expanded (accordions, dropdowns) ===
  const axExpanded = getAxProperty(properties, 'expanded');
  const expanded = parseBooleanState(axExpanded);

  // === Selected (tabs, options) ===
  const axSelected = getAxProperty(properties, 'selected');
  const selected = parseBooleanState(axSelected);

  // === Focused ===
  const axFocused = getAxProperty(properties, 'focused');
  const focused = parseBooleanState(axFocused);

  // === Required ===
  // Check DOM required attribute or aria-required
  let required: boolean | undefined;
  if (hasBooleanAttribute(attributes, 'required')) {
    required = true;
  } else if (getAriaAttribute(attributes, 'aria-required') === 'true') {
    required = true;
  }

  // === Invalid ===
  // Check AX invalid or aria-invalid
  const axInvalid = getAxProperty(properties, 'invalid');
  let invalid: boolean | undefined;
  if (axInvalid !== undefined) {
    // AX invalid can be 'true', 'false', 'grammar', 'spelling'
    invalid = axInvalid === true || axInvalid === 'true' ||
              (typeof axInvalid === 'string' && axInvalid !== 'false');
  } else if (getAriaAttribute(attributes, 'aria-invalid') === 'true') {
    invalid = true;
  }

  // === Readonly ===
  // Check DOM readonly attribute or aria-readonly
  let readonly: boolean | undefined;
  if (hasBooleanAttribute(attributes, 'readonly')) {
    readonly = true;
  } else if (getAriaAttribute(attributes, 'aria-readonly') === 'true') {
    readonly = true;
  }

  // Build state object, omitting undefined values
  const state: NodeState = {
    visible,
    enabled,
  };

  if (checked !== undefined) state.checked = checked;
  if (expanded !== undefined) state.expanded = expanded;
  if (selected !== undefined) state.selected = selected;
  if (focused !== undefined) state.focused = focused;
  if (required !== undefined) state.required = required;
  if (invalid !== undefined) state.invalid = invalid;
  if (readonly !== undefined) state.readonly = readonly;

  return state;
}
