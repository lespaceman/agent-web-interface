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
function resolveExistingPage(
  session: SessionManager,
  page_id: string | undefined
): { page_id: string } {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    if (page_id) {
      throw new Error(`Page not found: ${page_id}`);
    } else {
      throw new Error('No page available. Use launch_browser first.');
    }
  }
  session.touchPage(handle.page_id);
  return handle;
}

/**
 * Resolve page_id to full PageHandle with CDP client.
 *
 * @param session - SessionManager instance
 * @param page_id - Optional page identifier
 * @returns Full PageHandle with CDP client
 * @throws Error if no page available
 */
function resolvePageWithCdp(session: SessionManager, page_id: string | undefined): PageHandle {
  const handle = session.resolvePage(page_id);
  if (!handle) {
    if (page_id) {
      throw new Error(`Page not found: ${page_id}`);
    } else {
      throw new Error('No page available. Use launch_browser first.');
    }
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
 */
function buildFormUnderstandingXml(
  pageId: string,
  forms: FormRegion[],
  includeValues: boolean,
  limitations?: string
): string {
  const lines: string[] = [];

  lines.push(`<form_understanding page_id="${escapeXml(pageId)}">`);

  if (limitations) {
    lines.push(`  <limitations runtime_values="partial" reason="${escapeXml(limitations)}" />`);
  }

  lines.push(`  <forms count="${forms.length}">`);

  // Sort forms by form_id for deterministic output
  const sortedForms = [...forms].sort((a, b) => a.form_id.localeCompare(b.form_id));

  for (const form of sortedForms) {
    lines.push(
      `    <form id="${escapeXml(form.form_id)}" ` +
        `intent="${form.intent ?? 'unknown'}" ` +
        `pattern="${form.pattern ?? 'unknown'}" ` +
        `confidence="${form.detection.confidence.toFixed(2)}">`
    );

    // State summary
    lines.push(
      `      <state completion="${form.state.completion_pct}%" ` +
        `can_submit="${form.state.can_submit}" ` +
        `errors="${form.state.error_count}" />`
    );

    // Sort fields by backend_node_id (DOM order proxy) for deterministic output
    const sortedFields = [...form.fields].sort(
      (a, b) => (a.backend_node_id ?? 0) - (b.backend_node_id ?? 0)
    );

    // Fields
    lines.push(`      <fields count="${sortedFields.length}">`);
    for (const field of sortedFields) {
      lines.push(buildFieldXml(field, includeValues, 8));
    }
    lines.push('      </fields>');

    // Sort actions by eid for deterministic output
    const sortedActions = [...form.actions].sort((a, b) => a.eid.localeCompare(b.eid));

    // Actions (submit buttons etc)
    if (sortedActions.length > 0) {
      lines.push(`      <actions count="${sortedActions.length}">`);
      for (const action of sortedActions) {
        lines.push(buildActionXml(action, 8));
      }
      lines.push('      </actions>');
    }

    // Next suggested action
    const nextAction = suggestNextAction(form);
    if (nextAction) {
      lines.push(
        `      <next_action eid="${escapeXml(nextAction.eid)}" ` +
          `label="${escapeXml(nextAction.label)}" ` +
          `reason="${escapeXml(nextAction.reason)}" />`
      );
    }

    lines.push('    </form>');
  }

  lines.push('  </forms>');
  lines.push('</form_understanding>');

  return lines.join('\n');
}

/**
 * Build XML for a single field.
 */
function buildFieldXml(field: FormField, includeValues: boolean, indent: number): string {
  const pad = ' '.repeat(indent);
  const attrs: string[] = [
    `eid="${escapeXml(field.eid)}"`,
    `label="${escapeXml(field.label)}"`,
    `kind="${field.kind}"`,
    `purpose="${field.purpose.semantic_type}"`,
    `filled="${field.state.filled}"`,
    `has_value="${field.state.has_value}"`,
    `enabled="${field.state.enabled}"`,
  ];

  if (field.state.value_source) {
    attrs.push(`value_source="${field.state.value_source}"`);
  }

  if (field.constraints.required) {
    attrs.push('required="true"');
  }

  if (!field.state.valid) {
    attrs.push('invalid="true"');
    if (field.state.validation_message) {
      attrs.push(`error="${escapeXml(field.state.validation_message)}"`);
    }
  }

  if (includeValues && field.state.current_value) {
    attrs.push(`current_value="${escapeXml(field.state.current_value)}"`);
  }

  if (field.depends_on && field.depends_on.length > 0) {
    // Sort dependencies by source_eid for deterministic output
    const sortedDeps = [...field.depends_on].sort((a, b) =>
      a.source_eid.localeCompare(b.source_eid)
    );
    const deps = sortedDeps.map((d) => d.source_eid).join(',');
    attrs.push(`depends_on="${escapeXml(deps)}"`);
  }

  return `${pad}<field ${attrs.join(' ')} />`;
}

/**
 * Build XML for a form action.
 */
function buildActionXml(action: FormAction, indent: number): string {
  const pad = ' '.repeat(indent);
  const attrs: string[] = [
    `eid="${escapeXml(action.eid)}"`,
    `label="${escapeXml(action.label)}"`,
    `type="${action.type}"`,
    `enabled="${action.enabled}"`,
  ];

  if (action.is_primary) {
    attrs.push('primary="true"');
  }

  if (!action.enabled && action.disabled_reason) {
    attrs.push(`blocked_reason="${escapeXml(action.disabled_reason)}"`);
  }

  if (action.blocked_by && action.blocked_by.length > 0) {
    attrs.push(`blocked_by="${action.blocked_by.length} fields"`);
  }

  return `${pad}<action ${attrs.join(' ')} />`;
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
 */
function buildFieldContextXml(
  field: FormField,
  form: FormRegion,
  dependencies: FieldDependency[]
): string {
  const lines: string[] = [];

  lines.push(`<field_context eid="${escapeXml(field.eid)}">`);

  // Field details
  lines.push(
    `  <field label="${escapeXml(field.label)}" ` +
      `kind="${field.kind}" ` +
      `purpose="${field.purpose.semantic_type}" ` +
      `purpose_confidence="${field.purpose.confidence.toFixed(2)}">`
  );

  // Purpose inference signals (sorted for deterministic output)
  const sortedSignals = [...field.purpose.inferred_from].sort();
  lines.push('    <purpose_signals>');
  for (const signal of sortedSignals) {
    lines.push(`      <signal>${escapeXml(signal)}</signal>`);
  }
  lines.push('    </purpose_signals>');

  // State
  const stateAttrs = [
    `filled="${field.state.filled}"`,
    `has_value="${field.state.has_value}"`,
    `valid="${field.state.valid}"`,
    `enabled="${field.state.enabled}"`,
    `focused="${field.state.focused}"`,
  ];
  if (field.state.value_source) {
    stateAttrs.push(`value_source="${field.state.value_source}"`);
  }
  lines.push(`    <state ${stateAttrs.join(' ')} />`);

  // Constraints
  const constraintAttrs: string[] = [`required="${field.constraints.required}"`];
  if (field.constraints.min_length !== undefined) {
    constraintAttrs.push(`min_length="${field.constraints.min_length}"`);
  }
  if (field.constraints.max_length !== undefined) {
    constraintAttrs.push(`max_length="${field.constraints.max_length}"`);
  }
  if (field.constraints.pattern) {
    constraintAttrs.push(`pattern="${escapeXml(field.constraints.pattern)}"`);
  }
  lines.push(`    <constraints ${constraintAttrs.join(' ')} />`);

  // Options (for select/radio), sorted by value for deterministic output
  if (field.constraints.options && field.constraints.options.length > 0) {
    const sortedOptions = [...field.constraints.options].sort((a, b) =>
      a.value.localeCompare(b.value)
    );
    lines.push('    <options>');
    for (const opt of sortedOptions) {
      lines.push(
        `      <option value="${escapeXml(opt.value)}" ` +
          `label="${escapeXml(opt.label)}" ` +
          `selected="${opt.selected ?? false}" ` +
          `${opt.eid ? `eid="${escapeXml(opt.eid)}"` : ''} />`
      );
    }
    lines.push('    </options>');
  }

  lines.push('  </field>');

  // Dependencies (sorted by source_eid, then type for deterministic output)
  if (dependencies.length > 0) {
    const sortedDeps = [...dependencies].sort(
      (a, b) => a.source_eid.localeCompare(b.source_eid) || a.type.localeCompare(b.type)
    );
    lines.push('  <dependencies>');
    for (const dep of sortedDeps) {
      lines.push(
        `    <depends_on source="${escapeXml(dep.source_eid)}" ` +
          `type="${dep.type}" ` +
          `confidence="${dep.confidence.toFixed(2)}" ` +
          `detection="${dep.detection_method}" />`
      );
    }
    lines.push('  </dependencies>');
  }

  // Form context
  lines.push(
    `  <form id="${escapeXml(form.form_id)}" ` +
      `intent="${form.intent ?? 'unknown'}" ` +
      `completion="${form.state.completion_pct}%" />`
  );

  // Next suggested action
  const nextAction = suggestNextAction(form);
  if (nextAction) {
    lines.push(
      `  <next_action eid="${escapeXml(nextAction.eid)}" ` +
        `label="${escapeXml(nextAction.label)}" ` +
        `reason="${escapeXml(nextAction.reason)}" />`
    );
  }

  lines.push('</field_context>');

  return lines.join('\n');
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
  const handle = resolvePageWithCdp(session, input.page_id);
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
  const handle = resolveExistingPage(session, input.page_id);
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
