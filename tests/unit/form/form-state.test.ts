/**
 * Form State Tests
 *
 * Tests for the computeFormState pure function.
 */

import { describe, it, expect } from 'vitest';
import { computeFormState } from '../../../src/form/form-state.js';
import type { FormField } from '../../../src/form/types.js';

// Helper to create a minimal field for testing
function createField(overrides: Partial<FormField> = {}): FormField {
  return {
    eid: 'f-1',
    backend_node_id: 100,
    frame_id: 'main',
    label: 'Test Field',
    kind: 'input',
    purpose: {
      semantic_type: 'unknown',
      confidence: 0.5,
      inferred_from: [],
    },
    constraints: {
      required: false,
      required_confidence: 0,
      ...overrides.constraints,
    },
    state: {
      has_value: false,
      filled: false,
      valid: true,
      enabled: true,
      touched: false,
      focused: false,
      visible: true,
      ...overrides.state,
    },
    ...overrides,
  };
}

describe('computeFormState', () => {
  describe('pure function behavior', () => {
    it('should return same output for same input', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result1 = computeFormState(fields);
      const result2 = computeFormState(fields);

      expect(result1).toEqual(result2);
    });

    it('should not mutate input fields', () => {
      const fields = [
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const fieldsCopy = JSON.stringify(fields);
      computeFormState(fields);

      expect(JSON.stringify(fields)).toBe(fieldsCopy);
    });
  });

  describe('completion percentage', () => {
    it('should return 100% when no required fields', () => {
      const fields = [
        createField({ constraints: { required: false, required_confidence: 0 } }),
        createField({ constraints: { required: false, required_confidence: 0 } }),
      ];

      const result = computeFormState(fields);

      expect(result.completion_pct).toBe(100);
    });

    it('should return 0% when no required fields are filled', () => {
      const fields = [
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.completion_pct).toBe(0);
    });

    it('should return 50% when half of required fields are filled', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.completion_pct).toBe(50);
    });

    it('should return 100% when all required fields are filled', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.completion_pct).toBe(100);
    });

    it('should round completion percentage', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-3',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      // 1/3 = 33.33... should round to 33
      expect(result.completion_pct).toBe(33);
    });
  });

  describe('can_submit logic', () => {
    it('should be true when all required fields filled and no errors', () => {
      const fields = [
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.can_submit).toBe(true);
    });

    it('should be false when required fields are not filled', () => {
      const fields = [
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.can_submit).toBe(false);
    });

    it('should be false when there are validation errors', () => {
      const fields = [
        createField({
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: false,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.can_submit).toBe(false);
    });

    it('should be true with no required fields and no errors', () => {
      const fields = [
        createField({
          constraints: { required: false, required_confidence: 0 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.can_submit).toBe(true);
    });
  });

  describe('error counting', () => {
    it('should count fields with valid=false as errors', () => {
      const fields = [
        createField({
          eid: 'f-1',
          state: {
            filled: true,
            has_value: true,
            valid: false,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          state: {
            filled: true,
            has_value: true,
            valid: false,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-3',
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.error_count).toBe(2);
    });

    it('should return 0 errors when all fields are valid', () => {
      const fields = [
        createField({
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.error_count).toBe(0);
    });
  });

  describe('dirty state', () => {
    it('should be true when any field is touched', () => {
      const fields = [
        createField({
          eid: 'f-1',
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: true,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.dirty).toBe(true);
    });

    it('should be false when no field is touched', () => {
      const fields = [
        createField({
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.dirty).toBe(false);
    });
  });

  describe('required counts', () => {
    it('should count required fields correctly', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
        }),
        createField({
          eid: 'f-3',
          constraints: { required: false, required_confidence: 0 },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.required_count).toBe(2);
    });

    it('should count filled required fields correctly', () => {
      const fields = [
        createField({
          eid: 'f-1',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-2',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: false,
            has_value: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
        createField({
          eid: 'f-3',
          constraints: { required: true, required_confidence: 1 },
          state: {
            filled: true,
            has_value: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ];

      const result = computeFormState(fields);

      expect(result.required_count).toBe(3);
      expect(result.filled_required_count).toBe(2);
    });
  });

  describe('empty fields array', () => {
    it('should handle empty fields array', () => {
      const result = computeFormState([]);

      expect(result.completion_pct).toBe(100);
      expect(result.error_count).toBe(0);
      expect(result.can_submit).toBe(true);
      expect(result.dirty).toBe(false);
      expect(result.required_count).toBe(0);
      expect(result.filled_required_count).toBe(0);
    });
  });
});
