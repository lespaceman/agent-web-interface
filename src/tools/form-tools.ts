/**
 * Form Tools
 *
 * MCP tool handlers for form understanding.
 * Provides semantic understanding of form-like interactions.
 */

import { z } from 'zod';
import { getSnapshotStore } from './browser-tools.js';
import {
  detectForms,
  getDependencyTracker,
  computeFormState,
  readRuntimeValues,
  type FormRegion,
  type FormField,
  type FormAction,
  type FieldDependency,
  type FieldValueRequest,
} from '../form/index.js';
import { escapeXml } from '../lib/text-utils.js';
import type { SessionManager } from '../browser/session-manager.js';
import type { PageHandle } from '../browser/page-registry.js';

// Module-level reference to session manager (set via initializeFormTools)
let sessionManager: SessionManager | null = null;

/**
 * Initialize form tools with a session manager instance.
 * Must be called before using any form tool handlers.
 *
 * @param manager - SessionManager instance
 */
export function initializeFormTools(manager: SessionManager): void {
  sessionManager = manager;
}

/**
 * Get the session manager, throwing if not initialized.
 */
function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error('Form tools not initialized. Call initializeFormTools() first.');
  }
  return sessionManager;
}

/**
 * Resolve page_id to a PageHandle, throwing if not found.
 *
 * @param session - SessionManager instance
 * @param page_id - Optional page identifier
 * @returns PageHandle for the resolved page
 * @throws Error if no page available
 */
function resolvePage(session: SessionManager, page_id: string | undefined): PageHandle {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    const message = page_id
      ? `Page not found: ${page_id}`
      : 'No page available. Use navigate first.';
    throw new Error(message);
  }
  session.touchPage(handle.page_id);
  return handle;
}

// ============================================================================
// Input/Output Schemas
// ============================================================================

/**
 * get_form_understanding input schema
 */
export const GetFormUnderstandingInputSchema = z.object({
  /** Page identifier (optional, defaults to MRU page) */
  page_id: z.string().optional(),
  /** Form ID to get specific form (optional) */
  form_id: z.string().optional(),
  /** Include field values in response (default: false for security) */
  include_values: z.boolean().default(false),
});

export type GetFormUnderstandingInput = z.infer<typeof GetFormUnderstandingInputSchema>;

/**
 * get_field_context input schema
 */
export const GetFieldContextInputSchema = z.object({
  /** Page identifier (optional, defaults to MRU page) */
  page_id: z.string().optional(),
  /** Element ID of the field */
  eid: z.string(),
});

export type GetFieldContextInput = z.infer<typeof GetFieldContextInputSchema>;

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Build XML response for form understanding.
 *
 * Optimized format with no wrapper elements, flattened attributes, and label as content.
 * Fields use their kind as tag name (textbox, checkbox, etc.), actions use button tag.
 */
function buildFormUnderstandingXml(
  pageId: string,
  forms: FormRegion[],
  includeValues: boolean,
  limitations?: string
): string {
  const lines: string[] = [];

  const limitAttr = limitations ? ` limitations="${escapeXml(limitations)}"` : '';
  lines.push(`<forms page="${escapeXml(pageId)}"${limitAttr}>`);

  // Sort forms by form_id for deterministic output
  const sortedForms = [...forms].sort((a, b) => a.form_id.localeCompare(b.form_id));

  for (const form of sortedForms) {
    // Form attributes with flattened state
    const formAttrs = [
      `id="${escapeXml(form.form_id)}"`,
      `intent="${form.intent ?? 'unknown'}"`,
      `completion="${form.state.completion_pct}%"`,
    ];
    if (!form.state.can_submit) formAttrs.push('can_submit="false"');
    if (form.state.error_count > 0) formAttrs.push(`errors="${form.state.error_count}"`);

    lines.push(`  <form ${formAttrs.join(' ')}>`);

    // Sort fields by backend_node_id (DOM order proxy) for deterministic output
    const sortedFields = [...form.fields].sort(
      (a, b) => (a.backend_node_id ?? 0) - (b.backend_node_id ?? 0)
    );

    // Fields - use kind as tag name, label as content
    for (const field of sortedFields) {
      lines.push(buildFieldElementXml(field, includeValues, 4));
    }

    // Sort actions by eid for deterministic output
    const sortedActions = [...form.actions].sort((a, b) => a.eid.localeCompare(b.eid));

    // Actions as <button> elements
    for (const action of sortedActions) {
      lines.push(buildButtonXml(action, 4));
    }

    // Next suggested action
    const nextAction = suggestNextAction(form);
    if (nextAction) {
      lines.push(
        `    <next eid="${escapeXml(nextAction.eid)}" reason="${escapeXml(nextAction.reason)}" />`
      );
    }

    lines.push('  </form>');
  }

  lines.push('</forms>');

  return lines.join('\n');
}

/**
 * Build XML element for a form field using kind as tag name and label as content.
 * Omits default values (enabled=true, filled=false).
 */
function buildFieldElementXml(field: FormField, includeValues: boolean, indent: number): string {
  const pad = ' '.repeat(indent);
  const attrs: string[] = [
    `eid="${escapeXml(field.eid)}"`,
    `purpose="${field.purpose.semantic_type}"`,
  ];

  // Only include non-default states
  if (field.state.filled) attrs.push('filled="true"');
  if (!field.state.enabled) attrs.push('enabled="false"');
  if (!field.state.valid) {
    attrs.push('invalid="true"');
    if (field.state.validation_message) {
      attrs.push(`error="${escapeXml(field.state.validation_message)}"`);
    }
  }

  if (field.constraints.required) attrs.push('required="true"');

  if (includeValues && field.state.current_value) {
    attrs.push(`value="${escapeXml(field.state.current_value)}"`);
  }

  if (field.depends_on && field.depends_on.length > 0) {
    const sortedDeps = [...field.depends_on].sort((a, b) =>
      a.source_eid.localeCompare(b.source_eid)
    );
    const deps = sortedDeps.map((d) => d.source_eid).join(',');
    attrs.push(`depends="${escapeXml(deps)}"`);
  }

  // Use kind as tag name
  const tag = field.kind;
  return `${pad}<${tag} ${attrs.join(' ')}>${escapeXml(field.label)}</${tag}>`;
}

/**
 * Build XML element for a form action as <button>.
 * Omits default values (enabled=true).
 */
function buildButtonXml(action: FormAction, indent: number): string {
  const pad = ' '.repeat(indent);
  const attrs: string[] = [`eid="${escapeXml(action.eid)}"`, `type="${action.type}"`];

  // Only include non-defaults
  if (!action.enabled) attrs.push('enabled="false"');
  if (action.is_primary) attrs.push('primary="true"');

  if (!action.enabled && action.disabled_reason) {
    attrs.push(`blocked="${escapeXml(action.disabled_reason)}"`);
  }

  return `${pad}<button ${attrs.join(' ')}>${escapeXml(action.label)}</button>`;
}

/**
 * Suggest the next action for a form.
 */
function suggestNextAction(
  form: FormRegion
): { eid: string; label: string; reason: string } | undefined {
  // Find first required unfilled field that is enabled
  const nextRequired = form.fields.find(
    (f) => f.constraints.required && !f.state.filled && f.state.enabled
  );

  if (nextRequired) {
    return {
      eid: nextRequired.eid,
      label: nextRequired.label,
      reason: 'Next required field',
    };
  }

  // Find first unfilled optional field that is enabled
  const nextOptional = form.fields.find((f) => !f.state.filled && f.state.enabled);

  if (nextOptional) {
    return {
      eid: nextOptional.eid,
      label: nextOptional.label,
      reason: 'Optional field',
    };
  }

  // Check if form can be submitted
  if (form.state.can_submit) {
    const submitAction = form.actions.find((a) => a.type === 'submit' && a.enabled);
    if (submitAction) {
      return {
        eid: submitAction.eid,
        label: submitAction.label,
        reason: 'Form ready to submit',
      };
    }
  }

  return undefined;
}

/**
 * Build XML for field context.
 *
 * Optimized format with flattened attributes and no unnecessary wrappers.
 * Label is text content, state/constraints are root attributes, defaults omitted.
 */
function buildFieldContextXml(
  field: FormField,
  form: FormRegion,
  dependencies: FieldDependency[]
): string {
  const lines: string[] = [];

  // Build root <field> attributes
  const attrs: string[] = [
    `eid="${escapeXml(field.eid)}"`,
    `kind="${field.kind}"`,
    `purpose="${field.purpose.semantic_type}"`,
    `confidence="${field.purpose.confidence.toFixed(2)}"`,
  ];

  // Signals as comma-separated attribute (sorted for deterministic output)
  const sortedSignals = [...field.purpose.inferred_from].sort();
  if (sortedSignals.length > 0) {
    attrs.push(`signals="${escapeXml(sortedSignals.join(', '))}"`);
  }

  // State flags (only include non-defaults)
  if (field.state.filled) attrs.push('filled="true"');
  if (!field.state.enabled) attrs.push('enabled="false"');
  if (!field.state.valid) attrs.push('valid="false"');
  if (field.state.focused) attrs.push('focused="true"');
  if (field.state.value_source) {
    attrs.push(`value_source="${field.state.value_source}"`);
  }

  // Constraints (only include non-defaults)
  if (field.constraints.required) attrs.push('required="true"');
  if (field.constraints.min_length !== undefined) {
    attrs.push(`min_length="${field.constraints.min_length}"`);
  }
  if (field.constraints.max_length !== undefined) {
    attrs.push(`max_length="${field.constraints.max_length}"`);
  }
  if (field.constraints.pattern) {
    attrs.push(`pattern="${escapeXml(field.constraints.pattern)}"`);
  }

  // Validation error
  if (!field.state.valid && field.state.validation_message) {
    attrs.push(`error="${escapeXml(field.state.validation_message)}"`);
  }

  // Dependencies summary (eids of fields this depends on)
  if (dependencies.length > 0) {
    const depEids = [...new Set(dependencies.map((d) => d.source_eid))].sort();
    attrs.push(`depends="${escapeXml(depEids.join(','))}"`);
  }

  // Start field element with label as content
  lines.push(`<field ${attrs.join(' ')}>${escapeXml(field.label)}`);

  // Options (for select/radio), sorted by value for deterministic output
  const hasOptions = field.constraints.options && field.constraints.options.length > 0;
  if (hasOptions) {
    const sortedOptions = [...field.constraints.options!].sort((a, b) =>
      a.value.localeCompare(b.value)
    );
    for (const opt of sortedOptions) {
      const optAttrs = [`value="${escapeXml(opt.value)}"`];
      if (opt.selected) optAttrs.push('selected="true"');
      if (opt.eid) optAttrs.push(`eid="${escapeXml(opt.eid)}"`);
      lines.push(`  <option ${optAttrs.join(' ')}>${escapeXml(opt.label)}</option>`);
    }
  }

  // Dependencies (sorted by source_eid, then type for deterministic output)
  if (dependencies.length > 0) {
    const sortedDeps = [...dependencies].sort(
      (a, b) => a.source_eid.localeCompare(b.source_eid) || a.type.localeCompare(b.type)
    );
    for (const dep of sortedDeps) {
      lines.push(
        `  <dependency source="${escapeXml(dep.source_eid)}" ` +
          `type="${dep.type}" confidence="${dep.confidence.toFixed(2)}" />`
      );
    }
  }

  // Form context
  lines.push(
    `  <form id="${escapeXml(form.form_id)}" ` +
      `intent="${form.intent ?? 'unknown'}" completion="${form.state.completion_pct}%" />`
  );

  // Next suggested action
  const nextAction = suggestNextAction(form);
  if (nextAction) {
    lines.push(
      `  <next eid="${escapeXml(nextAction.eid)}" reason="${escapeXml(nextAction.reason)}" />`
    );
  }

  lines.push('</field>');

  return lines.join('\n');
}

// ============================================================================
// Test Exports (for unit testing XML output format)
// ============================================================================

/** @internal Exported for testing only */
export const _testExports = {
  buildFormUnderstandingXml,
  buildFieldContextXml,
  buildFieldElementXml,
  buildButtonXml,
  suggestNextAction,
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get form understanding for a page.
 *
 * Detects form regions and extracts rich metadata about fields,
 * dependencies, and state. Reads actual runtime values via CDP
 * to provide accurate filled/has_value status.
 */
export async function getFormUnderstanding(rawInput: unknown): Promise<string> {
  const input = GetFormUnderstandingInputSchema.parse(rawInput);
  const session = getSessionManager();
  const snapshotStore = getSnapshotStore();

  // Resolve page with CDP client for runtime value reading
  const handle = resolvePage(session, input.page_id);
  const pageId = handle.page_id;

  // Get snapshot for the page
  const snapshot = snapshotStore.getByPageId(pageId);
  if (!snapshot) {
    return '<error>No snapshot available. Use capture_snapshot first.</error>';
  }

  // Detect forms
  const allForms = detectForms(snapshot);

  // Filter by form_id if specified
  const forms = input.form_id ? allForms.filter((f) => f.form_id === input.form_id) : allForms;

  if (forms.length === 0 && input.form_id) {
    return `<error>Form not found: ${escapeXml(input.form_id)}</error>`;
  }

  // Read runtime values for form fields
  const allFields = forms.flatMap((f) => f.fields);
  let limitations: string | undefined;

  if (allFields.length > 0) {
    // Build field value requests
    const fieldRequests: FieldValueRequest[] = allFields.map((f) => ({
      backend_node_id: f.backend_node_id,
      frame_id: f.frame_id,
      semantic_type: f.purpose.semantic_type,
      input_type: snapshot.nodes.find((n) => n.node_id === f.eid)?.attributes?.input_type,
      label: f.label,
    }));

    const runtimeResult = await readRuntimeValues(handle.cdp, fieldRequests, {
      maxFieldsToRead: 50,
      concurrencyLimit: 8,
      timeoutMs: 2000,
      maskSensitive: true,
    });

    // Update field states with runtime values
    for (const form of forms) {
      for (const field of form.fields) {
        const runtimeValue = runtimeResult.values.get(field.backend_node_id);

        if (runtimeValue !== undefined) {
          // Runtime read succeeded
          field.state.has_value = runtimeValue.length > 0;
          field.state.filled = runtimeValue.length > 0;
          field.state.value_source = 'runtime';

          if (input.include_values) {
            field.state.current_value = runtimeValue; // Already masked if sensitive
          }
        } else {
          // Runtime read failed - be conservative, don't trust attribute
          // Keep existing filled state from snapshot but mark source as unknown
          field.state.value_source = undefined; // Unknown
        }
      }

      // Recompute form state after field updates
      form.state = computeFormState(form.fields);
    }

    if (runtimeResult.partial) {
      limitations = runtimeResult.partial_reason;
    }
  }

  // Enrich fields with observed dependencies
  const tracker = getDependencyTracker();
  for (const form of forms) {
    for (const field of form.fields) {
      const deps = tracker.getDependenciesFor(pageId, field.eid);
      if (deps.length > 0) {
        field.depends_on = deps;
      }
      const dependents = tracker.getDependentsOf(pageId, field.eid);
      if (dependents.length > 0) {
        field.dependents = dependents;
      }
    }
  }

  return buildFormUnderstandingXml(pageId, forms, input.include_values, limitations);
}

/**
 * Get context for a specific field.
 *
 * Returns detailed information about a field including purpose inference,
 * constraints, dependencies, and suggested next action.
 */
export function getFieldContext(rawInput: unknown): string {
  const input = GetFieldContextInputSchema.parse(rawInput);
  const session = getSessionManager();
  const snapshotStore = getSnapshotStore();

  // Resolve page
  const handle = resolvePage(session, input.page_id);
  const pageId = handle.page_id;

  // Get snapshot for the page
  const snapshot = snapshotStore.getByPageId(pageId);
  if (!snapshot) {
    return '<error>No snapshot available. Use capture_snapshot first.</error>';
  }

  // Find the field's form
  const allForms = detectForms(snapshot);
  let targetField: FormField | undefined;
  let targetForm: FormRegion | undefined;

  for (const form of allForms) {
    const field = form.fields.find((f) => f.eid === input.eid);
    if (field) {
      targetField = field;
      targetForm = form;
      break;
    }
  }

  if (!targetField || !targetForm) {
    return `<error>Field not found in any form: ${escapeXml(input.eid)}</error>`;
  }

  // Get dependencies
  const tracker = getDependencyTracker();
  const dependencies = tracker.getDependenciesFor(pageId, input.eid);

  return buildFieldContextXml(targetField, targetForm, dependencies);
}
