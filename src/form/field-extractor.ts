/**
 * Field Extractor
 *
 * Extracts rich metadata for form fields from a BaseSnapshot.
 * Handles purpose inference, constraint extraction, and state tracking.
 *
 * Purpose inference priority:
 * 1. input type attribute
 * 2. autocomplete attribute
 * 3. aria-label
 * 4. label text
 * 5. placeholder
 * 6. name attribute
 *
 * @module form/field-extractor
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type { FormField, FormDetectionConfig } from './types.js';
import { inferPurpose } from './purpose-inference.js';
import { extractConstraints, sameRadioGroup } from './constraint-extraction.js';
import { extractFieldState } from './field-state-extractor.js';

/**
 * Extract form fields from a snapshot for given field EIDs.
 *
 * @param snapshot - BaseSnapshot containing the nodes
 * @param fieldEids - Array of node IDs to extract as fields
 * @param config - Form detection configuration
 * @returns Array of FormField objects
 */
export function extractFields(
  snapshot: BaseSnapshot,
  fieldEids: string[],
  config: FormDetectionConfig
): FormField[] {
  const fields: FormField[] = [];

  for (let sequence = 0; sequence < fieldEids.length; sequence++) {
    const eid = fieldEids[sequence];
    const node = snapshot.nodes.find((n) => n.node_id === eid);

    if (!node) continue;

    const field = extractField(node, sequence, snapshot, config);
    if (field) {
      fields.push(field);
    }
  }

  // Detect radio groups and link them
  linkRadioGroups(fields, snapshot);

  return fields;
}

/**
 * Extract a single form field from a node.
 */
function extractField(
  node: ReadableNode,
  sequence: number,
  snapshot: BaseSnapshot,
  config: FormDetectionConfig
): FormField | null {
  // Infer purpose
  const purpose = inferPurpose(node);

  const constraints = extractConstraints(node, snapshot);
  const state = extractFieldState(node, config, purpose.semantic_type);

  return {
    eid: node.node_id,
    backend_node_id: node.backend_node_id,
    frame_id: node.frame_id,
    label: node.label,
    kind: node.kind,
    purpose,
    constraints,
    state,
    sequence,
  };
}

/**
 * Link radio buttons into groups.
 */
function linkRadioGroups(fields: FormField[], snapshot: BaseSnapshot): void {
  const radioFields = fields.filter((f) => f.kind === 'radio');

  // Group by heading context + region
  const groups = new Map<string, FormField[]>();

  for (const field of radioFields) {
    const node = snapshot.nodes.find((n) => n.node_id === field.eid);
    if (!node) continue;

    // Find existing group this radio belongs to
    let matched = false;
    for (const [key, group] of groups) {
      const groupNode = snapshot.nodes.find((n) => n.node_id === group[0].eid);
      if (groupNode && sameRadioGroup(node, groupNode)) {
        group.push(field);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(`radio-${groups.size}`, [field]);
    }
  }

  // Link fields within each group
  let groupIndex = 0;
  for (const group of groups.values()) {
    if (group.length > 1) {
      const groupId = `radio-group-${groupIndex++}`;
      for (const field of group) {
        field.group_id = groupId;
        field.dependents = group.filter((f) => f.eid !== field.eid).map((f) => f.eid);
      }
    }
  }
}

/**
 * Extract a single field by EID.
 */
export function extractFieldByEid(
  snapshot: BaseSnapshot,
  eid: string,
  config: FormDetectionConfig
): FormField | null {
  const node = snapshot.nodes.find((n) => n.node_id === eid);
  if (!node) return null;
  return extractField(node, 0, snapshot, config);
}
