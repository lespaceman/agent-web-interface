/**
 * Submit Button Detection
 *
 * Detects submit buttons associated with forms or input clusters
 * using keyword matching and spatial proximity.
 *
 * @module form/submit-detection
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import { BUTTON_KINDS } from './form-actions.js';

/**
 * Submit button keywords
 */
export const SUBMIT_KEYWORDS = [
  'submit',
  'send',
  'continue',
  'next',
  'save',
  'apply',
  'confirm',
  'add to',
  'sign in',
  'log in',
  'sign up',
  'register',
  'search',
  'buy',
  'checkout',
  'purchase',
  'subscribe',
];

/**
 * Find a submit button associated with a form.
 */
export function findSubmitButton(
  snapshot: BaseSnapshot,
  formNode: ReadableNode,
  fieldEids: string[],
  isNodeWithinForm: (node: ReadableNode, formNode: ReadableNode, snapshot: BaseSnapshot) => boolean,
  computeClusterBbox: (
    nodes: ReadableNode[]
  ) => { x: number; y: number; width: number; height: number } | undefined
): ReadableNode | undefined {
  const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));

  for (const button of buttons) {
    // Check if button is within form's scope
    if (!isNodeWithinForm(button, formNode, snapshot)) {
      continue;
    }

    // Check if button label suggests submission
    if (isSubmitButton(button)) {
      return button;
    }
  }

  // Also check buttons near the fields
  if (fieldEids.length > 0) {
    const fieldNodes = fieldEids
      .map((eid) => snapshot.nodes.find((n) => n.node_id === eid))
      .filter((n): n is ReadableNode => n !== undefined);

    return findSubmitButtonNearCluster(snapshot, fieldNodes, computeClusterBbox);
  }

  return undefined;
}

/**
 * Find a submit button near a cluster of inputs.
 */
export function findSubmitButtonNearCluster(
  snapshot: BaseSnapshot,
  cluster: ReadableNode[],
  computeClusterBbox: (
    nodes: ReadableNode[]
  ) => { x: number; y: number; width: number; height: number } | undefined
): ReadableNode | undefined {
  if (cluster.length === 0) return undefined;

  const buttons = snapshot.nodes.filter((n) => BUTTON_KINDS.has(n.kind));
  const clusterBbox = computeClusterBbox(cluster);

  if (!clusterBbox) return undefined;

  // Find buttons near the cluster
  const nearbyButtons = buttons.filter((button) => {
    if (!button.layout?.bbox) return false;
    const btnBbox = button.layout.bbox;

    // Check if button is below or to the right of the cluster
    const isNearX =
      btnBbox.x >= clusterBbox.x - 100 && btnBbox.x <= clusterBbox.x + clusterBbox.width + 100;
    const isNearY =
      btnBbox.y >= clusterBbox.y - 50 && btnBbox.y <= clusterBbox.y + clusterBbox.height + 150;

    return isNearX && isNearY;
  });

  // Find the best submit button candidate
  for (const button of nearbyButtons) {
    if (isSubmitButton(button)) {
      return button;
    }
  }

  return undefined;
}

/**
 * Check if a button looks like a submit button.
 */
export function isSubmitButton(button: ReadableNode): boolean {
  const label = button.label.toLowerCase();

  // Check for submit keywords
  for (const keyword of SUBMIT_KEYWORDS) {
    if (label.includes(keyword)) {
      return true;
    }
  }

  // Check for type="submit" attribute
  if (button.attributes?.input_type === 'submit') {
    return true;
  }

  return false;
}
