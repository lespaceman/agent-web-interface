/**
 * Form Actions
 *
 * Extracts action buttons (submit, cancel, reset, etc.) associated
 * with form regions using spatial proximity and keyword matching.
 *
 * @module form/form-actions
 */

import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';
import type { FormRegion, FormSignal, FormCandidate } from './types.js';
import { isSubmitButton } from './submit-detection.js';

/**
 * Interactive input kinds
 */
export const INPUT_KINDS = new Set<NodeKind>([
  'input',
  'textarea',
  'select',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
]);

/**
 * Button kinds that could be submit buttons
 */
export const BUTTON_KINDS = new Set<NodeKind>(['button']);

/**
 * Signal weights for form detection
 */
export const SIGNAL_WEIGHTS: Record<FormSignal['type'], number> = {
  form_tag: 0.5,
  role_form: 0.45,
  role_search: 0.4,
  fieldset: 0.3,
  input_cluster: 0.25,
  label_input_pairs: 0.2,
  submit_button: 0.3,
  form_keywords: 0.15,
  naming_pattern: 0.1,
};

/**
 * Extract form action buttons.
 */
export function extractFormActions(
  snapshot: BaseSnapshot,
  candidate: FormCandidate,
  computeClusterBbox: (
    nodes: ReadableNode[]
  ) => { x: number; y: number; width: number; height: number } | undefined
): FormRegion['actions'] {
  const actions: FormRegion['actions'] = [];
  const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));

  for (const button of buttons) {
    // Skip disabled buttons for now but still include them
    const isSubmit = isSubmitButton(button);
    const isNearForm = candidate.bbox
      ? isButtonNearBbox(button, candidate.bbox)
      : candidate.field_eids.length === 0 ||
        isButtonNearFields(button, snapshot, candidate.field_eids, computeClusterBbox);

    if (!isNearForm) continue;

    // Determine action type
    let type: FormRegion['actions'][0]['type'] = 'action';
    const label = button.label.toLowerCase();

    if (isSubmit) {
      type = 'submit';
    } else if (label.includes('cancel') || label.includes('close')) {
      type = 'cancel';
    } else if (label.includes('back') || label.includes('previous')) {
      type = 'back';
    } else if (label.includes('next') || label.includes('continue')) {
      type = 'next';
    } else if (label.includes('reset') || label.includes('clear')) {
      type = 'reset';
    }

    actions.push({
      eid: button.node_id,
      backend_node_id: button.backend_node_id,
      label: button.label,
      type,
      enabled: button.state?.enabled ?? true,
      is_primary: isSubmit,
    });
  }

  return actions;
}

/**
 * Check if a button is near a bounding box.
 */
export function isButtonNearBbox(
  button: ReadableNode,
  bbox: NonNullable<FormCandidate['bbox']>
): boolean {
  if (!button.layout?.bbox) return false;
  const btnBbox = button.layout.bbox;

  const isNearX = btnBbox.x >= bbox.x - 100 && btnBbox.x <= bbox.x + bbox.width + 100;
  const isNearY = btnBbox.y >= bbox.y - 50 && btnBbox.y <= bbox.y + bbox.height + 150;

  return isNearX && isNearY;
}

/**
 * Check if a button is near a set of fields.
 */
export function isButtonNearFields(
  button: ReadableNode,
  snapshot: BaseSnapshot,
  fieldEids: string[],
  computeClusterBbox: (
    nodes: ReadableNode[]
  ) => { x: number; y: number; width: number; height: number } | undefined
): boolean {
  const fieldNodes = fieldEids
    .map((eid) => snapshot.nodes.find((n) => n.node_id === eid))
    .filter((n): n is ReadableNode => n !== undefined);

  const clusterBbox = computeClusterBbox(fieldNodes);
  if (!clusterBbox) return false;

  return isButtonNearBbox(button, clusterBbox);
}
