/**
 * Constraint Extraction
 *
 * Extracts validation constraints and options for form fields
 * including required state, radio options, and select options.
 *
 * @module form/constraint-extraction
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { FieldConstraints, FieldOption } from './types.js';

/**
 * Extract constraints for a field.
 */
export function extractConstraints(node: ReadableNode, snapshot: BaseSnapshot): FieldConstraints {
  const constraints: FieldConstraints = {
    required: false,
    required_confidence: 0,
  };

  // Check required state
  if (node.state?.required) {
    constraints.required = true;
    constraints.required_confidence = 1.0;
  } else {
    // Check label for required indicators
    const label = node.label.toLowerCase();
    if (label.includes('*') || label.includes('required')) {
      constraints.required = true;
      constraints.required_confidence = 0.8;
    }
  }

  // Extract options for select/radio/combobox
  if (node.kind === 'radio') {
    // Find related radio buttons with same name pattern
    constraints.options = extractRadioOptions(node, snapshot);
  } else if (node.kind === 'combobox' || node.kind === 'select') {
    // Extract options for select/combobox elements
    constraints.options = extractSelectOptions(node, snapshot);
  }

  // TODO: Extract more constraints from DOM attributes
  // - minlength, maxlength
  // - min, max, step
  // - pattern

  return constraints;
}

/**
 * Check if two radio nodes belong to the same group.
 * Uses `name` attribute as primary signal, falls back to heading/group context.
 */
export function sameRadioGroup(a: ReadableNode, b: ReadableNode): boolean {
  if (a.where.region !== b.where.region) return false;
  if (a.attributes?.name && b.attributes?.name) return a.attributes.name === b.attributes.name;
  return (
    a.where.heading_context === b.where.heading_context || a.where.group_id === b.where.group_id
  );
}

/**
 * Extract options for radio button groups.
 */
export function extractRadioOptions(node: ReadableNode, snapshot: BaseSnapshot): FieldOption[] {
  const options: FieldOption[] = [];

  const radioButtons = snapshot.nodes.filter((n) => n.kind === 'radio' && sameRadioGroup(node, n));

  for (const radio of radioButtons) {
    options.push({
      value: radio.label,
      label: radio.label,
      selected: radio.state?.checked === true || radio.state?.checked === 'mixed',
      disabled: !(radio.state?.enabled ?? true),
      eid: radio.node_id,
    });
  }

  return options;
}

/**
 * Extract options for select/combobox elements.
 *
 * Attempts to find option elements by looking for:
 * 1. Nodes in the same group with 'listitem' kind
 * 2. Nodes with 'menuitem' kind that share the same region/group
 * 3. If value is set, creates a single option representing current selection
 *
 * Note: Full option extraction may require additional CDP calls.
 * This provides a best-effort extraction from available snapshot data.
 */
export function extractSelectOptions(node: ReadableNode, snapshot: BaseSnapshot): FieldOption[] {
  const options: FieldOption[] = [];

  // Look for listitem or menuitem nodes in the same group_id
  if (node.where.group_id) {
    const potentialOptions = snapshot.nodes.filter(
      (n) =>
        (n.kind === 'listitem' || n.kind === 'menuitem') &&
        n.where.group_id === node.where.group_id &&
        n.node_id !== node.node_id
    );

    for (const opt of potentialOptions) {
      const isSelected = opt.state?.selected ?? false;
      options.push({
        value: opt.label,
        label: opt.label,
        selected: isSelected,
        disabled: !(opt.state?.enabled ?? true),
        eid: opt.node_id,
      });
    }
  }

  // If we found options, return them
  if (options.length > 0) {
    return options;
  }

  // Fallback: if node has a value, create a single option for the current selection
  // This at least lets us know what's currently selected even if we can't see all options
  if (node.attributes?.value) {
    options.push({
      value: node.attributes.value,
      label: node.attributes.value,
      selected: true,
    });
  }

  return options;
}
