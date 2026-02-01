/**
 * XML Output Format Tests
 *
 * Tests for the optimized XML output format (Issue #34).
 * Verifies token-efficient representation with flattened attributes
 * and no unnecessary wrapper elements.
 */
import { describe, it, expect } from 'vitest';
import { buildGetElementDetailsResponse } from '../../../src/tools/response-builder.js';
import { _testExports } from '../../../src/tools/form-tools.js';
import type { NodeDetails } from '../../../src/tools/tool-schemas.js';
import type {
  FormRegion,
  FormField,
  FormAction,
  FieldDependency,
} from '../../../src/form/types.js';

const {
  buildFormUnderstandingXml,
  buildFieldContextXml,
  buildFieldElementXml,
  buildButtonXml,
  suggestNextAction,
} = _testExports;

// ============================================================================
// buildGetElementDetailsResponse Tests
// ============================================================================

describe('buildGetElementDetailsResponse', () => {
  it('should flatten where/layout into root attributes', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: {
        region: 'main',
        group_id: 'form-1',
      },
      layout: {
        bbox: { x: 100, y: 200, w: 80, h: 32 },
      },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    // Should have flattened attributes on root <node>
    expect(result).toContain('eid="btn-1"');
    expect(result).toContain('kind="button"');
    expect(result).toContain('region="main"');
    expect(result).toContain('group="form-1"');
    expect(result).toContain('x="100"');
    expect(result).toContain('y="200"');
    expect(result).toContain('w="80"');
    expect(result).toContain('h="32"');

    // Should NOT have wrapper elements
    expect(result).not.toContain('<where');
    expect(result).not.toContain('<layout');
    expect(result).not.toContain('<result');

    // Label should be content
    expect(result).toContain('>Submit</node>');
  });

  it('should omit default state values (visible=true, enabled=true)', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
      state: {
        visible: true,
        enabled: true,
      },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    // Should NOT include default values
    expect(result).not.toContain('visible=');
    expect(result).not.toContain('enabled=');
  });

  it('should include non-default state values', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
      state: {
        visible: false,
        enabled: false,
        checked: true,
        focused: true,
        required: true,
        invalid: true,
      },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('visible="false"');
    expect(result).toContain('enabled="false"');
    expect(result).toContain('checked="true"');
    expect(result).toContain('focused="true"');
    expect(result).toContain('required="true"');
    expect(result).toContain('invalid="true"');
  });

  it('should include selector (formerly <find>) when present', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
      find: {
        primary: "button >> text='Submit'",
        alternates: ['#submit-btn', '[data-testid="submit"]'],
      },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('<selector');
    // Note: > and ' are escaped in XML
    expect(result).toContain('primary="button &gt;&gt; text=&apos;Submit&apos;"');
    expect(result).toContain('alternates=');
    expect(result).toContain('#submit-btn');
    // Should NOT use old <find> name
    expect(result).not.toContain('<find');
  });

  it('should self-close node when no children', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    // Should have label as content and close immediately
    expect(result).toMatch(/<node[^>]+>Submit<\/node>/);
    // Should be a single line
    expect(result.split('\n').length).toBe(1);
  });

  it('should include group_path as flattened path attribute', () => {
    const node: NodeDetails = {
      eid: 'link-1',
      kind: 'link',
      label: 'Running Shoes',
      where: {
        region: 'main',
        group_id: 'cat-nav',
        group_path: ['Men', 'Shoes', 'Running'],
      },
      layout: { bbox: { x: 0, y: 0, w: 200, h: 30 } },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('path="Men/Shoes/Running"');
    expect(result).not.toContain('group_path=');
  });

  it('should include display and screen_zone when present', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Submit',
      where: { region: 'main' },
      layout: {
        bbox: { x: 100, y: 200, w: 80, h: 32 },
        display: 'flex',
        screen_zone: 'center',
      },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('display="flex"');
    expect(result).toContain('zone="center"');
  });

  it('should render attributes when present', () => {
    const node: NodeDetails = {
      eid: 'input-1',
      kind: 'textbox',
      label: 'Email',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 200, h: 30 } },
      attributes: { input_type: 'email', placeholder: 'Enter email' },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('<attrs');
    expect(result).toContain('input_type="email"');
    expect(result).toContain('placeholder="Enter email"');
  });

  it('should include heading context when present', () => {
    const node: NodeDetails = {
      eid: 'input-1',
      kind: 'textbox',
      label: 'Email',
      where: {
        region: 'main',
        heading_context: 'Contact Information',
      },
      layout: { bbox: { x: 0, y: 0, w: 200, h: 30 } },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('heading="Contact Information"');
  });

  it('should escape XML special characters', () => {
    const node: NodeDetails = {
      eid: 'btn-1',
      kind: 'button',
      label: 'Save & Continue <draft>',
      where: { region: 'main' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 40 } },
    };

    const result = buildGetElementDetailsResponse('page-1', 'snap-1', node);

    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });
});

// ============================================================================
// buildFormUnderstandingXml Tests
// ============================================================================

describe('buildFormUnderstandingXml', () => {
  const createMockForm = (overrides: Partial<FormRegion> = {}): FormRegion => ({
    form_id: 'form-1',
    detection: { method: 'semantic', confidence: 0.85, signals: [] },
    intent: 'login',
    fields: [],
    actions: [],
    state: {
      completion_pct: 50,
      error_count: 0,
      can_submit: true,
      dirty: false,
      required_count: 2,
      filled_required_count: 1,
    },
    ...overrides,
  });

  const createMockField = (overrides: Partial<FormField> = {}): FormField => ({
    eid: 'field-1',
    backend_node_id: 100,
    frame_id: 'main',
    label: 'Email',
    kind: 'textbox',
    purpose: { semantic_type: 'email', confidence: 0.9, inferred_from: ['input type'] },
    constraints: { required: true, required_confidence: 1.0 },
    state: {
      has_value: false,
      filled: false,
      valid: true,
      enabled: true,
      touched: false,
      focused: false,
      visible: true,
    },
    ...overrides,
  });

  it('should use <forms> as root with page attribute', () => {
    const form = createMockForm();

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toMatch(/^<forms page="page-1">/);
    expect(result).toMatch(/<\/forms>$/);
    // Should NOT have old wrapper elements
    expect(result).not.toContain('<form_understanding');
    expect(result).not.toContain('count="');
  });

  it('should flatten form state into attributes', () => {
    const form = createMockForm({
      state: {
        completion_pct: 75,
        error_count: 2,
        can_submit: false,
        dirty: true,
        required_count: 4,
        filled_required_count: 3,
      },
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toContain('completion="75%"');
    expect(result).toContain('can_submit="false"');
    expect(result).toContain('errors="2"');
    // Should NOT have separate <state> element
    expect(result).not.toContain('<state');
  });

  it('should omit can_submit when true (default)', () => {
    const form = createMockForm({ state: { ...createMockForm().state, can_submit: true } });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).not.toContain('can_submit=');
  });

  it('should omit errors when zero (default)', () => {
    const form = createMockForm({ state: { ...createMockForm().state, error_count: 0 } });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).not.toContain('errors=');
  });

  it('should use field kind as tag name', () => {
    const form = createMockForm({
      fields: [
        createMockField({ eid: 'f1', kind: 'textbox', label: 'Email' }),
        createMockField({ eid: 'f2', kind: 'checkbox', label: 'Remember me' }),
        createMockField({ eid: 'f3', kind: 'combobox', label: 'Country' }),
      ],
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toContain('<textbox');
    expect(result).toContain('</textbox>');
    expect(result).toContain('<checkbox');
    expect(result).toContain('</checkbox>');
    expect(result).toContain('<combobox');
    expect(result).toContain('</combobox>');
    // Should NOT use generic <field> tag
    expect(result).not.toMatch(/<field\s/);
  });

  it('should use label as element content', () => {
    const form = createMockForm({
      fields: [createMockField({ eid: 'f1', kind: 'textbox', label: 'Username' })],
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toContain('>Username</textbox>');
    // Should NOT have label as attribute
    expect(result).not.toContain('label="Username"');
  });

  it('should use <button> for actions', () => {
    const form = createMockForm({
      actions: [
        {
          eid: 'btn-1',
          backend_node_id: 200,
          label: 'Sign In',
          type: 'submit',
          enabled: true,
          is_primary: true,
        },
      ],
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toContain('<button');
    expect(result).toContain('>Sign In</button>');
    expect(result).toContain('type="submit"');
    expect(result).toContain('primary="true"');
    // Should NOT use old <action> tag
    expect(result).not.toContain('<action');
  });

  it('should use <next> for suggested next action', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          eid: 'f1',
          kind: 'textbox',
          label: 'Email',
          constraints: { required: true, required_confidence: 1.0 },
          state: {
            has_value: false,
            filled: false,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
          },
        }),
      ],
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).toContain('<next');
    expect(result).toContain('eid="f1"');
    expect(result).toContain('reason="Next required field"');
    // Should NOT use old <next_action> tag
    expect(result).not.toContain('<next_action');
  });

  it('should include limitations when provided', () => {
    const form = createMockForm();

    const result = buildFormUnderstandingXml('page-1', [form], false, 'Timeout reached');

    expect(result).toContain('limitations="Timeout reached"');
  });

  it('should include value when include_values is true', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          state: {
            has_value: true,
            filled: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
            current_value: 'test@example.com',
          },
        }),
      ],
    });

    const result = buildFormUnderstandingXml('page-1', [form], true);

    expect(result).toContain('value="test@example.com"');
  });

  it('should not include value when include_values is false', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          state: {
            has_value: true,
            filled: true,
            valid: true,
            enabled: true,
            touched: false,
            focused: false,
            visible: true,
            current_value: 'test@example.com',
          },
        }),
      ],
    });

    const result = buildFormUnderstandingXml('page-1', [form], false);

    expect(result).not.toContain('value="test@example.com"');
  });
});

// ============================================================================
// buildFieldElementXml Tests
// ============================================================================

describe('buildFieldElementXml', () => {
  const createMockField = (overrides: Partial<FormField> = {}): FormField => ({
    eid: 'field-1',
    backend_node_id: 100,
    frame_id: 'main',
    label: 'Email',
    kind: 'textbox',
    purpose: { semantic_type: 'email', confidence: 0.9, inferred_from: ['input type'] },
    constraints: { required: false, required_confidence: 0.5 },
    state: {
      has_value: false,
      filled: false,
      valid: true,
      enabled: true,
      touched: false,
      focused: false,
      visible: true,
    },
    ...overrides,
  });

  it('should omit filled="false" (default)', () => {
    const field = createMockField({ state: { ...createMockField().state, filled: false } });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).not.toContain('filled=');
  });

  it('should include filled="true" when filled', () => {
    const field = createMockField({ state: { ...createMockField().state, filled: true } });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).toContain('filled="true"');
  });

  it('should omit enabled="true" (default)', () => {
    const field = createMockField({ state: { ...createMockField().state, enabled: true } });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).not.toContain('enabled=');
  });

  it('should include enabled="false" when disabled', () => {
    const field = createMockField({ state: { ...createMockField().state, enabled: false } });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).toContain('enabled="false"');
  });

  it('should include invalid and error when not valid', () => {
    const field = createMockField({
      state: {
        ...createMockField().state,
        valid: false,
        validation_message: 'Invalid email format',
      },
    });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).toContain('invalid="true"');
    expect(result).toContain('error="Invalid email format"');
  });

  it('should use depends instead of depends_on', () => {
    const field = createMockField({
      depends_on: [
        {
          source_eid: 'country',
          type: 'enables',
          confidence: 0.9,
          detection_method: 'aria_controls',
        },
      ],
    });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).toContain('depends="country"');
    expect(result).not.toContain('depends_on=');
  });

  it('should sort and join multiple dependencies', () => {
    const field = createMockField({
      depends_on: [
        {
          source_eid: 'field-c',
          type: 'enables',
          confidence: 0.9,
          detection_method: 'aria_controls',
        },
        {
          source_eid: 'field-a',
          type: 'reveals',
          confidence: 0.8,
          detection_method: 'observed_mutation',
        },
      ],
    });

    const result = buildFieldElementXml(field, false, 0);

    expect(result).toContain('depends="field-a,field-c"');
  });
});

// ============================================================================
// buildButtonXml Tests
// ============================================================================

describe('buildButtonXml', () => {
  const createMockAction = (overrides: Partial<FormAction> = {}): FormAction => ({
    eid: 'btn-1',
    backend_node_id: 200,
    label: 'Submit',
    type: 'submit',
    enabled: true,
    is_primary: false,
    ...overrides,
  });

  it('should omit enabled="true" (default)', () => {
    const action = createMockAction({ enabled: true });

    const result = buildButtonXml(action, 0);

    expect(result).not.toContain('enabled=');
  });

  it('should include enabled="false" and blocked reason when disabled', () => {
    const action = createMockAction({
      enabled: false,
      disabled_reason: 'Required fields missing',
    });

    const result = buildButtonXml(action, 0);

    expect(result).toContain('enabled="false"');
    expect(result).toContain('blocked="Required fields missing"');
    // Should NOT use old attribute names
    expect(result).not.toContain('blocked_reason=');
    expect(result).not.toContain('blocked_by=');
  });

  it('should include primary="true" when is_primary', () => {
    const action = createMockAction({ is_primary: true });

    const result = buildButtonXml(action, 0);

    expect(result).toContain('primary="true"');
  });

  it('should use label as content', () => {
    const action = createMockAction({ label: 'Sign In' });

    const result = buildButtonXml(action, 0);

    expect(result).toContain('>Sign In</button>');
    expect(result).not.toContain('label="Sign In"');
  });
});

// ============================================================================
// buildFieldContextXml Tests
// ============================================================================

describe('buildFieldContextXml', () => {
  const createMockField = (overrides: Partial<FormField> = {}): FormField => ({
    eid: 'field-1',
    backend_node_id: 100,
    frame_id: 'main',
    label: 'Email',
    kind: 'textbox',
    purpose: {
      semantic_type: 'email',
      confidence: 0.85,
      inferred_from: ['input type', 'label text'],
    },
    constraints: { required: true, required_confidence: 1.0 },
    state: {
      has_value: false,
      filled: false,
      valid: true,
      enabled: true,
      touched: false,
      focused: false,
      visible: true,
    },
    ...overrides,
  });

  const createMockForm = (overrides: Partial<FormRegion> = {}): FormRegion => ({
    form_id: 'form-1',
    detection: { method: 'semantic', confidence: 0.85, signals: [] },
    intent: 'login',
    fields: [],
    actions: [],
    state: {
      completion_pct: 50,
      error_count: 0,
      can_submit: true,
      dirty: false,
      required_count: 2,
      filled_required_count: 1,
    },
    ...overrides,
  });

  it('should use <field> as root with flattened attributes', () => {
    const field = createMockField();
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    expect(result).toMatch(/^<field\s/);
    expect(result).toMatch(/<\/field>$/);
    expect(result).toContain('eid="field-1"');
    expect(result).toContain('kind="textbox"');
    expect(result).toContain('purpose="email"');
    expect(result).toContain('confidence="0.85"');
    // Should NOT have old wrapper
    expect(result).not.toContain('<field_context');
  });

  it('should include signals as comma-separated attribute', () => {
    const field = createMockField({
      purpose: {
        semantic_type: 'email',
        confidence: 0.9,
        inferred_from: ['input type', 'label text', 'placeholder'],
      },
    });
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    // Signals should be sorted and joined
    expect(result).toContain('signals="input type, label text, placeholder"');
    // Should NOT have <purpose_signals> wrapper
    expect(result).not.toContain('<purpose_signals');
    expect(result).not.toContain('<signal>');
  });

  it('should use label as element content', () => {
    const field = createMockField({ label: 'Email Address' });
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    expect(result).toContain('>Email Address');
    expect(result).not.toContain('label="Email Address"');
  });

  it('should flatten state into root attributes', () => {
    const field = createMockField({
      state: {
        has_value: true,
        filled: true,
        valid: false,
        enabled: false,
        touched: true,
        focused: true,
        visible: true,
        value_source: 'runtime',
      },
    });
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    expect(result).toContain('filled="true"');
    expect(result).toContain('enabled="false"');
    expect(result).toContain('valid="false"');
    expect(result).toContain('focused="true"');
    expect(result).toContain('value_source="runtime"');
    // Should NOT have separate <state> element
    expect(result).not.toContain('<state');
  });

  it('should flatten constraints into root attributes', () => {
    const field = createMockField({
      constraints: {
        required: true,
        required_confidence: 1.0,
        min_length: 5,
        max_length: 100,
        pattern: '^[a-z]+$',
      },
    });
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    expect(result).toContain('required="true"');
    expect(result).toContain('min_length="5"');
    expect(result).toContain('max_length="100"');
    expect(result).toContain('pattern="^[a-z]+$"');
    // Should NOT have separate <constraints> element
    expect(result).not.toContain('<constraints');
  });

  it('should include depends attribute with dependency eids', () => {
    const field = createMockField();
    const form = createMockForm();
    const dependencies: FieldDependency[] = [
      {
        source_eid: 'country',
        type: 'enables',
        confidence: 0.9,
        detection_method: 'aria_controls',
      },
      {
        source_eid: 'region',
        type: 'populates',
        confidence: 0.8,
        detection_method: 'observed_mutation',
      },
    ];

    const result = buildFieldContextXml(field, form, dependencies);

    expect(result).toContain('depends="country,region"');
  });

  it('should use <dependency> instead of <depends_on> for details', () => {
    const field = createMockField();
    const form = createMockForm();
    const dependencies: FieldDependency[] = [
      {
        source_eid: 'country',
        type: 'enables',
        confidence: 0.9,
        detection_method: 'aria_controls',
      },
    ];

    const result = buildFieldContextXml(field, form, dependencies);

    expect(result).toContain('<dependency');
    expect(result).toContain('source="country"');
    expect(result).toContain('type="enables"');
    expect(result).toContain('confidence="0.90"');
    // Should NOT use old naming
    expect(result).not.toContain('<depends_on');
    expect(result).not.toContain('detection=');
  });

  it('should use <next> instead of <next_action>', () => {
    const field = createMockField({
      constraints: { required: true, required_confidence: 1.0 },
      state: {
        has_value: false,
        filled: false,
        valid: true,
        enabled: true,
        touched: false,
        focused: false,
        visible: true,
      },
    });
    const form = createMockForm({ fields: [field] });

    const result = buildFieldContextXml(field, form, []);

    expect(result).toContain('<next');
    expect(result).toContain('reason=');
    expect(result).not.toContain('<next_action');
  });

  it('should include options for select fields', () => {
    const field = createMockField({
      kind: 'combobox',
      constraints: {
        required: false,
        required_confidence: 0.5,
        options: [
          { value: 'us', label: 'United States', selected: true, eid: 'opt-us' },
          { value: 'ca', label: 'Canada', selected: false, eid: 'opt-ca' },
        ],
      },
    });
    const form = createMockForm();

    const result = buildFieldContextXml(field, form, []);

    expect(result).toContain('<option');
    expect(result).toContain('value="ca"');
    expect(result).toContain('>Canada</option>');
    expect(result).toContain('value="us"');
    expect(result).toContain('selected="true"');
    expect(result).toContain('eid="opt-us"');
    // Should NOT have <options> wrapper
    expect(result).not.toContain('<options>');
  });
});

// ============================================================================
// suggestNextAction Tests
// ============================================================================

describe('suggestNextAction', () => {
  const createMockForm = (overrides: Partial<FormRegion> = {}): FormRegion => ({
    form_id: 'form-1',
    detection: { method: 'semantic', confidence: 0.85, signals: [] },
    fields: [],
    actions: [],
    state: {
      completion_pct: 0,
      error_count: 0,
      can_submit: false,
      dirty: false,
      required_count: 0,
      filled_required_count: 0,
    },
    ...overrides,
  });

  const createMockField = (overrides: Partial<FormField> = {}): FormField => ({
    eid: 'field-1',
    backend_node_id: 100,
    frame_id: 'main',
    label: 'Field',
    kind: 'textbox',
    purpose: { semantic_type: 'unknown', confidence: 0.5, inferred_from: [] },
    constraints: { required: false, required_confidence: 0.5 },
    state: {
      has_value: false,
      filled: false,
      valid: true,
      enabled: true,
      touched: false,
      focused: false,
      visible: true,
    },
    ...overrides,
  });

  it('should suggest first unfilled required field', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          eid: 'email',
          label: 'Email',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: false, enabled: true },
        }),
        createMockField({
          eid: 'password',
          label: 'Password',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: false, enabled: true },
        }),
      ],
    });

    const result = suggestNextAction(form);

    expect(result).toEqual({
      eid: 'email',
      label: 'Email',
      reason: 'Next required field',
    });
  });

  it('should suggest optional field when all required are filled', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          eid: 'email',
          label: 'Email',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: true, enabled: true },
        }),
        createMockField({
          eid: 'nickname',
          label: 'Nickname',
          constraints: { required: false, required_confidence: 0.5 },
          state: { ...createMockField().state, filled: false, enabled: true },
        }),
      ],
    });

    const result = suggestNextAction(form);

    expect(result).toEqual({
      eid: 'nickname',
      label: 'Nickname',
      reason: 'Optional field',
    });
  });

  it('should suggest submit when form is ready', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          eid: 'email',
          label: 'Email',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: true, enabled: true },
        }),
      ],
      actions: [
        {
          eid: 'submit-btn',
          backend_node_id: 200,
          label: 'Sign In',
          type: 'submit',
          enabled: true,
          is_primary: true,
        },
      ],
      state: { ...createMockForm().state, can_submit: true },
    });

    const result = suggestNextAction(form);

    expect(result).toEqual({
      eid: 'submit-btn',
      label: 'Sign In',
      reason: 'Form ready to submit',
    });
  });

  it('should return undefined when nothing to suggest', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          state: { ...createMockField().state, filled: true, enabled: true },
        }),
      ],
      state: { ...createMockForm().state, can_submit: false },
    });

    const result = suggestNextAction(form);

    expect(result).toBeUndefined();
  });

  it('should skip disabled fields', () => {
    const form = createMockForm({
      fields: [
        createMockField({
          eid: 'disabled-field',
          label: 'Disabled',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: false, enabled: false },
        }),
        createMockField({
          eid: 'enabled-field',
          label: 'Enabled',
          constraints: { required: true, required_confidence: 1.0 },
          state: { ...createMockField().state, filled: false, enabled: true },
        }),
      ],
    });

    const result = suggestNextAction(form);

    expect(result?.eid).toBe('enabled-field');
  });
});
