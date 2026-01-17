/**
 * Form Detector Tests
 *
 * Tests for form region detection with various HTML patterns.
 */

import { describe, it, expect } from 'vitest';
import { FormDetector, detectForms } from '../../../src/form/form-detector.js';
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

describe('FormDetector', () => {
  describe('detect explicit forms', () => {
    it('should detect a form element with role="form"', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'form-1',
          kind: 'form',
          label: 'Contact Form',
          attributes: { role: 'form' },
          layout: { bbox: { x: 0, y: 0, w: 400, h: 300 } },
        },
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
          attributes: { input_type: 'email' },
        },
        {
          node_id: 'message-input',
          kind: 'textarea',
          label: 'Message',
        },
        {
          node_id: 'submit-btn',
          kind: 'button',
          label: 'Send',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const form = forms[0];
      expect(form.detection.method).toBe('semantic');
      expect(form.detection.confidence).toBeGreaterThan(0.3);
    });

    it('should detect a search form with role="search"', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'search-form',
          kind: 'form',
          label: 'Search',
          attributes: { role: 'search' },
          layout: { bbox: { x: 0, y: 0, w: 300, h: 50 } },
        },
        {
          node_id: 'search-input',
          kind: 'input',
          label: 'Search',
          attributes: { input_type: 'search', placeholder: 'Search...' },
        },
        {
          node_id: 'search-btn',
          kind: 'button',
          label: 'Search',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const searchForm = forms.find((f) => f.intent === 'search');
      expect(searchForm).toBeDefined();
    });
  });

  describe('infer form intent', () => {
    it('should infer login intent from email + password fields', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'form-1',
          kind: 'form',
          label: 'Login',
          layout: { bbox: { x: 0, y: 0, w: 400, h: 200 } },
        },
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
          node_id: 'login-btn',
          kind: 'button',
          label: 'Sign In',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const loginForm = forms[0];
      expect(loginForm.intent).toBe('login');
    });

    it('should infer signup intent from signup keywords', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'form-1',
          kind: 'form',
          label: 'Create Account',
          where: { region: 'main', heading_context: 'Sign Up' },
          layout: { bbox: { x: 0, y: 0, w: 400, h: 300 } },
        },
        {
          node_id: 'name-input',
          kind: 'input',
          label: 'Full Name',
        },
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
          attributes: { input_type: 'email' },
        },
        {
          node_id: 'password-input',
          kind: 'input',
          label: 'Create password',
          attributes: { input_type: 'password' },
        },
        {
          node_id: 'signup-btn',
          kind: 'button',
          label: 'Register',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const signupForm = forms[0];
      expect(signupForm.intent).toBe('signup');
    });
  });

  describe('detect formless forms', () => {
    it('should detect an implicit form from clustered inputs', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'email-input',
          kind: 'input',
          label: 'Email',
          attributes: { input_type: 'email' },
          layout: { bbox: { x: 50, y: 100, w: 200, h: 40 } },
        },
        {
          node_id: 'password-input',
          kind: 'input',
          label: 'Password',
          attributes: { input_type: 'password' },
          layout: { bbox: { x: 50, y: 150, w: 200, h: 40 } },
        },
        {
          node_id: 'login-btn',
          kind: 'button',
          label: 'Log In',
          layout: { bbox: { x: 50, y: 200, w: 100, h: 40 } },
        },
      ]);

      const forms = detectForms(snapshot, { detect_formless: true });

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const form = forms[0];
      expect(form.detection.method).toBe('structural');
      expect(form.fields.length).toBeGreaterThanOrEqual(2);
    });

    it('should not detect formless forms when disabled', () => {
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
      ]);

      const forms = detectForms(snapshot, { detect_formless: false });

      // Should not find any forms since there's no explicit form element
      // and formless detection is disabled
      expect(forms.length).toBe(0);
    });
  });

  describe('form state computation', () => {
    it('should compute completion percentage from required fields', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'form-1',
          kind: 'form',
          label: 'Test Form',
          layout: { bbox: { x: 0, y: 0, w: 400, h: 300 } },
        },
        {
          node_id: 'field-1',
          kind: 'input',
          label: 'Required Field 1',
          state: { required: true, visible: true, enabled: true },
          attributes: { value: 'filled' },
        },
        {
          node_id: 'field-2',
          kind: 'input',
          label: 'Required Field 2',
          state: { required: true, visible: true, enabled: true },
        },
        {
          node_id: 'submit-btn',
          kind: 'button',
          label: 'Submit',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const form = forms[0];
      // 1 out of 2 required fields filled = 50%
      expect(form.state.completion_pct).toBe(50);
      expect(form.state.can_submit).toBe(false);
    });

    it('should report can_submit when all required fields are filled', () => {
      const snapshot = createSnapshot([
        {
          node_id: 'form-1',
          kind: 'form',
          label: 'Test Form',
          layout: { bbox: { x: 0, y: 0, w: 400, h: 200 } },
        },
        {
          node_id: 'field-1',
          kind: 'input',
          label: 'Required Field',
          state: { required: true, visible: true, enabled: true },
          attributes: { value: 'filled' },
        },
        {
          node_id: 'submit-btn',
          kind: 'button',
          label: 'Submit',
        },
      ]);

      const forms = detectForms(snapshot);

      expect(forms.length).toBeGreaterThanOrEqual(1);
      const form = forms[0];
      expect(form.state.completion_pct).toBe(100);
      expect(form.state.can_submit).toBe(true);
    });
  });

  describe('FormDetector class', () => {
    it('should accept custom configuration', () => {
      const detector = new FormDetector({
        min_confidence: 0.5,
        detect_formless: false,
        cluster_distance: 100,
      });

      const snapshot = createSnapshot([
        {
          node_id: 'input-1',
          kind: 'input',
          label: 'Test',
        },
      ]);

      const forms = detector.detect(snapshot);

      // With high min_confidence and no explicit form, should return empty
      expect(forms.length).toBe(0);
    });
  });
});
