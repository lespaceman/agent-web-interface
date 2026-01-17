/**
 * Form State Calculator
 *
 * Pure functions for computing form state from field data.
 * Extracted to enable recomputation after runtime value enrichment.
 *
 * @module form/form-state
 */

import type { FormState, FormField } from './types.js';

/**
 * Compute form state from an array of fields.
 *
 * This is a pure function that calculates:
 * - Completion percentage (based on required fields)
 * - Error count (fields that are invalid)
 * - Can submit status (all required filled + no errors)
 * - Dirty status (any field has been touched)
 *
 * @param fields - Array of FormField objects
 * @returns Computed FormState
 */
export function computeFormState(fields: FormField[]): FormState {
  const requiredFields = fields.filter((f) => f.constraints.required);
  const filledRequiredFields = requiredFields.filter((f) => f.state.filled);
  const errorFields = fields.filter((f) => !f.state.valid);
  const dirtyFields = fields.filter((f) => f.state.touched);

  const completionPct =
    requiredFields.length > 0
      ? Math.round((filledRequiredFields.length / requiredFields.length) * 100)
      : 100;

  const canSubmit =
    errorFields.length === 0 && filledRequiredFields.length === requiredFields.length;

  return {
    completion_pct: completionPct,
    error_count: errorFields.length,
    can_submit: canSubmit,
    dirty: dirtyFields.length > 0,
    required_count: requiredFields.length,
    filled_required_count: filledRequiredFields.length,
  };
}
