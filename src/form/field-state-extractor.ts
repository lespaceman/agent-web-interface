/**
 * Field State Extractor
 *
 * Extracts the current state of form fields including values,
 * validity, enabled/disabled status, and sensitivity masking.
 *
 * @module form/field-state-extractor
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { FieldSemanticType, FieldState, FormDetectionConfig } from './types.js';

/**
 * Sensitive field types that should have values masked
 */
export const SENSITIVE_TYPES = new Set<FieldSemanticType>([
  'password',
  'password_confirm',
  'card_number',
  'card_cvv',
]);

/**
 * Extract state for a field.
 *
 * Note: This extracts initial state from the snapshot (HTML attributes).
 * Runtime values may be overlaid later via readRuntimeValues().
 */
export function extractFieldState(
  node: ReadableNode,
  config: FormDetectionConfig,
  semanticType: FieldSemanticType
): FieldState {
  // Get value from HTML attribute, potentially masked
  let currentValue = node.attributes?.value;
  const isSensitive = SENSITIVE_TYPES.has(semanticType);

  if (currentValue && isSensitive && config.mask_sensitive) {
    currentValue = '••••••••';
  }

  // Determine if field has a value (from attribute)
  // Note: Using || here intentionally because we want falsy values (empty string) to fall through
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  const hasValue = Boolean(
    currentValue ||
    node.state?.checked ||
    (node.kind === 'checkbox' && node.state?.checked) ||
    (node.kind === 'radio' && node.state?.checked)
  );
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  // Filled is initially same as hasValue (may be updated after runtime read)
  const filled = hasValue;

  // Determine validity
  const valid = !(node.state?.invalid ?? false);

  return {
    current_value: currentValue,
    value_source: currentValue !== undefined ? 'attribute' : undefined,
    has_value: hasValue,
    filled,
    valid,
    enabled: node.state?.enabled ?? true,
    touched: false, // We can't know this without observing interactions
    focused: node.state?.focused ?? false,
    visible: node.state?.visible ?? true,
  };
}
