/**
 * Field Extractor Tests
 *
 * Tests for form field extraction and purpose inference.
 */

import { describe, it, expect } from 'vitest';
import { extractFields, extractFieldByEid } from '../../../src/form/field-extractor.js';
import { DEFAULT_FORM_DETECTION_CONFIG } from '../../../src/form/types.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

// Helper to create a minimal snapshot for testing
function createSnapshot(nodes: Partial<ReadableNode>[]): BaseSnapshot {
  return {
    snapshot_id: 'test-snapshot',
    url: 'https://example.com',
    title: 'Test Page',
    viewport: { width: 1920, height: 1080 },
    captured_at: new Date().toISOString(),
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.length,
    },
    nodes: nodes.map((n, i) => ({
      node_id: n.node_id ?? `n${i}`,
      backend_node_id: n.backend_node_id ?? i + 100,
      frame_id: 'main',
      loader_id: 'loader-1',
      kind: n.kind ?? 'input',
      label: n.label ?? '',
      where: {
        region: 'main' as const,
        ...n.where,
      },
      layout: {
        bbox: { x: 0, y: i * 50, w: 200, h: 40 },
        ...n.layout,
      },
      state: {
        visible: true,
        enabled: true,
        ...n.state,
      },
      ...n,
    })) as ReadableNode[],
  };
}

describe('Field Extractor', () => {
  describe('extractFields', () => {
    it('should extract fields by EIDs', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
          attributes: { input_type: 'email' },
        },
        {
          node_id: 'password-input',
          kind: 'input',
          label: 'Password',
          attributes: { input_type: 'password' },
        },
        {
          node_id: 'other-element',
          kind: 'button',
          label: 'Submit',
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['email-input', 'password-input'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields.length).toBe(2);
      expect(fields[0].eid).toBe('email-input');
      expect(fields[1].eid).toBe('password-input');
    });

    it('should assign sequence numbers', () => {
      const snapshot = createSnapshot([
        { node_id: 'field-1', kind: 'input', label: 'First' },
        { node_id: 'field-2', kind: 'input', label: 'Second' },
        { node_id: 'field-3', kind: 'input', label: 'Third' },
      ]);

      const fields = extractFields(
        snapshot,
        ['field-1', 'field-2', 'field-3'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].sequence).toBe(0);
      expect(fields[1].sequence).toBe(1);
      expect(fields[2].sequence).toBe(2);
    });
  });

  describe('purpose inference', () => {
    it('should infer email purpose from input type', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Your email',
          attributes: { input_type: 'email' },
        },
      ]);

      const fields = extractFields(snapshot, ['email-input'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('email');
      expect(fields[0].purpose.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should infer password purpose from input type', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'password-input',
          kind: 'input',
          label: 'Enter password',
          attributes: { input_type: 'password' },
        },
      ]);

      const fields = extractFields(snapshot, ['password-input'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('password');
    });

    it('should infer purpose from autocomplete attribute', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'name-input',
          kind: 'input',
          label: 'Name',
          attributes: { autocomplete: 'given-name' },
        },
      ]);

      const fields = extractFields(snapshot, ['name-input'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('first_name');
    });

    it('should infer purpose from label text', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'phone-input',
          kind: 'input',
          label: 'Phone Number',
        },
      ]);

      const fields = extractFields(snapshot, ['phone-input'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('phone');
    });

    it('should infer checkbox as toggle', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'toggle-checkbox',
          kind: 'checkbox',
          label: 'Remember me',
        },
      ]);

      const fields = extractFields(snapshot, ['toggle-checkbox'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('toggle');
    });

    it('should infer consent from terms-related checkbox', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'consent-checkbox',
          kind: 'checkbox',
          label: 'I agree to terms',
        },
      ]);

      const fields = extractFields(snapshot, ['consent-checkbox'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('consent');
    });

    it('should infer radio as selection', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'option-1',
          kind: 'radio',
          label: 'Option A',
        },
      ]);

      const fields = extractFields(snapshot, ['option-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('selection');
    });
  });

  describe('state extraction', () => {
    it('should extract enabled state', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'enabled-input',
          kind: 'input',
          label: 'Enabled',
          state: { visible: true, enabled: true },
        },
        {
          node_id: 'disabled-input',
          kind: 'input',
          label: 'Disabled',
          state: { visible: true, enabled: false },
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['enabled-input', 'disabled-input'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].state.enabled).toBe(true);
      expect(fields[1].state.enabled).toBe(false);
    });

    it('should detect filled state from value', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'filled-input',
          kind: 'input',
          label: 'Name',
          attributes: { value: 'John' },
        },
        {
          node_id: 'empty-input',
          kind: 'input',
          label: 'Email',
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['filled-input', 'empty-input'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].state.filled).toBe(true);
      expect(fields[1].state.filled).toBe(false);
    });

    it('should detect filled state from checked checkbox', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'checked-checkbox',
          kind: 'checkbox',
          label: 'Terms',
          state: { visible: true, enabled: true, checked: true },
        },
        {
          node_id: 'unchecked-checkbox',
          kind: 'checkbox',
          label: 'Newsletter',
          state: { visible: true, enabled: true, checked: false },
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['checked-checkbox', 'unchecked-checkbox'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].state.filled).toBe(true);
      expect(fields[1].state.filled).toBe(false);
    });

    it('should detect invalid state', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'invalid-input',
          kind: 'input',
          label: 'Email',
          state: { visible: true, enabled: true, invalid: true },
        },
      ]);

      const fields = extractFields(snapshot, ['invalid-input'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].state.valid).toBe(false);
    });
  });

  describe('constraint extraction', () => {
    it('should extract required state', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'required-input',
          kind: 'input',
          label: 'Name *',
          state: { visible: true, enabled: true, required: true },
        },
        {
          node_id: 'optional-input',
          kind: 'input',
          label: 'Nickname',
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['required-input', 'optional-input'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].constraints.required).toBe(true);
      expect(fields[1].constraints.required).toBe(false);
    });

    it('should infer required from label asterisk', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'input-with-asterisk',
          kind: 'input',
          label: 'Email *',
        },
      ]);

      const fields = extractFields(
        snapshot,
        ['input-with-asterisk'],
        DEFAULT_FORM_DETECTION_CONFIG
      );

      expect(fields[0].constraints.required).toBe(true);
      expect(fields[0].constraints.required_confidence).toBeLessThan(1.0);
    });
  });

  describe('value masking', () => {
    it('should mask password values', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'password-input',
          kind: 'input',
          label: 'Password',
          attributes: { input_type: 'password', value: 'secret123' },
        },
      ]);

      const fields = extractFields(snapshot, ['password-input'], {
        ...DEFAULT_FORM_DETECTION_CONFIG,
        mask_sensitive: true,
      });

      expect(fields[0].state.current_value).toBe('••••••••');
    });

    it('should not mask non-sensitive values', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'name-input',
          kind: 'input',
          label: 'Name',
          attributes: { value: 'John Doe' },
        },
      ]);

      const fields = extractFields(snapshot, ['name-input'], {
        ...DEFAULT_FORM_DETECTION_CONFIG,
        mask_sensitive: true,
      });

      expect(fields[0].state.current_value).toBe('John Doe');
    });
  });

  describe('extractFieldByEid', () => {
    it('should extract a single field by EID', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
          attributes: { input_type: 'email' },
        },
      ]);

      const field = extractFieldByEid(snapshot, 'email-input', DEFAULT_FORM_DETECTION_CONFIG);

      expect(field).not.toBeNull();
      expect(field?.eid).toBe('email-input');
      expect(field?.purpose.semantic_type).toBe('email');
    });

    it('should return null for non-existent EID', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
        },
      ]);

      const field = extractFieldByEid(snapshot, 'non-existent', DEFAULT_FORM_DETECTION_CONFIG);

      expect(field).toBeNull();
    });
  });

  describe('name pattern inference', () => {
    it('should infer purpose from camelCase naming patterns in test_id', () => {
      // Using test_id to test name patterns without triggering label keyword matching
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'Field 1', // Generic label that won't match keywords
          attributes: { test_id: 'firstName' },
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('first_name');
      expect(fields[0].purpose.confidence).toBeGreaterThanOrEqual(0.5);
      expect(fields[0].purpose.inferred_from.some((s) => s.includes('pattern'))).toBe(true);
    });

    it('should infer purpose from snake_case naming patterns', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'phone_number',
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('phone');
    });

    it('should infer purpose from test_id attribute', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'Enter value',
          attributes: { test_id: 'email-input-field' },
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('email');
    });

    it('should detect date of birth patterns via test_id', () => {
      // Using test_id to avoid "date" keyword match from LABEL_KEYWORDS
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'Enter value', // Generic label
          attributes: { test_id: 'dateOfBirth' },
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('date_of_birth');
    });

    it('should prefer higher confidence signals over name patterns', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'useremail', // Would match 'email' pattern
          attributes: { input_type: 'tel' }, // But input type says tel
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      // Input type has higher confidence (0.95) than name pattern (0.5)
      expect(fields[0].purpose.semantic_type).toBe('phone');
    });

    it('should use name patterns when label has no keyword matches', () => {
      // This tests that name patterns are used when label keywords don't match
      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'postalcode', // Will match name pattern for 'zip'
        },
      ]);

      const fields = extractFields(snapshot, ['input-1'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].purpose.semantic_type).toBe('zip');
    });
  });

  describe('select options extraction', () => {
    it('should extract options from combobox with value', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'country-select',
          kind: 'combobox',
          label: 'Country',
          attributes: { value: 'USA' },
        },
      ]);

      const fields = extractFields(snapshot, ['country-select'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].constraints.options).toBeDefined();
      expect(fields[0].constraints.options?.length).toBeGreaterThan(0);
      expect(fields[0].constraints.options?.[0].value).toBe('USA');
      expect(fields[0].constraints.options?.[0].selected).toBe(true);
    });

    it('should extract options from related listitem nodes', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'dropdown',
          kind: 'combobox',
          label: 'Select option',
          where: { region: 'main' as const, group_id: 'dropdown-group' },
        },
        {
          node_id: 'option-1',
          kind: 'listitem',
          label: 'Option A',
          where: { region: 'main' as const, group_id: 'dropdown-group' },
          state: { visible: true, enabled: true, selected: true },
        },
        {
          node_id: 'option-2',
          kind: 'listitem',
          label: 'Option B',
          where: { region: 'main' as const, group_id: 'dropdown-group' },
          state: { visible: true, enabled: true, selected: false },
        },
      ]);

      const fields = extractFields(snapshot, ['dropdown'], DEFAULT_FORM_DETECTION_CONFIG);

      expect(fields[0].constraints.options).toBeDefined();
      expect(fields[0].constraints.options?.length).toBe(2);
      expect(fields[0].constraints.options?.some((o) => o.label === 'Option A')).toBe(true);
      expect(fields[0].constraints.options?.some((o) => o.label === 'Option B')).toBe(true);
    });

    it('should handle select element with no options gracefully', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'empty-select',
          kind: 'select',
          label: 'Choose',
        },
      ]);

      const fields = extractFields(snapshot, ['empty-select'], DEFAULT_FORM_DETECTION_CONFIG);

      // Should not throw, options array should be empty or undefined
      expect(fields[0].constraints.options?.length ?? 0).toBe(0);
    });
  });
});
