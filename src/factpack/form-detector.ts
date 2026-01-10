/**
 * Form Detector
 *
 * Detects forms and extracts field information from a BaseSnapshot.
 *
 * Design: Generic First, Specific Second
 * 1. Detect ALL forms with their fields (always works)
 * 2. Infer field semantics (may return 'unknown')
 * 3. Infer form purpose (may return 'generic')
 */

import type { BaseSnapshot, ReadableNode, NodeKind } from '../snapshot/snapshot.types.js';
import { QueryEngine } from '../query/query-engine.js';
import { normalizeText } from '../lib/text-utils.js';
import type {
  FormDetectionResult,
  DetectedForm,
  FormField,
  FormSubmitButton,
  FormValidation,
  FormPurpose,
  FieldSemanticType,
} from './types.js';

// ============================================================================
// Field Semantic Type Mappings
// ============================================================================

/** Autocomplete attribute to semantic type mapping */
const AUTOCOMPLETE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
  username: 'username',
  email: 'email',
  'current-password': 'password',
  'new-password': 'password',
  password: 'password',
  tel: 'phone',
  'tel-national': 'phone',
  'given-name': 'first-name',
  'family-name': 'last-name',
  name: 'full-name',
  'street-address': 'address-line1',
  'address-line1': 'address-line1',
  'address-line2': 'address-line2',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'postal-code',
  country: 'country',
  'country-name': 'country',
  'cc-number': 'card-number',
  'cc-exp': 'card-expiry',
  'cc-exp-month': 'card-expiry',
  'cc-exp-year': 'card-expiry',
  'cc-csc': 'card-cvv',
  search: 'search-query',
};

/** Input type to semantic type mapping */
const INPUT_TYPE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
  email: 'email',
  password: 'password',
  tel: 'phone',
  search: 'search-query',
  url: 'url',
  date: 'date',
  number: 'number',
};

/** Patterns for inferring semantic type from name/label */
const SEMANTIC_PATTERNS: { type: FieldSemanticType; patterns: RegExp[] }[] = [
  { type: 'email', patterns: [/\bemail/i, /\be-mail/i] },
  {
    type: 'password',
    patterns: [/\bpassword/i, /\bpasswd/i, /\bpwd\b/i, /\bsecret/i],
  },
  {
    type: 'password-confirm',
    patterns: [/\bconfirm.?pass/i, /\bpass.?confirm/i, /\brepeat.?pass/i, /\bretype.?pass/i],
  },
  {
    type: 'username',
    patterns: [/\busername/i, /\buser.?name/i, /\blogin/i, /\buser.?id/i],
  },
  { type: 'phone', patterns: [/\bphone/i, /\btel\b/i, /\bmobile/i, /\bcell/i] },
  {
    type: 'first-name',
    patterns: [/\bfirst.?name/i, /\bgiven.?name/i, /\bfname\b/i],
  },
  {
    type: 'last-name',
    patterns: [/\blast.?name/i, /\bfamily.?name/i, /\bsurname/i, /\blname\b/i],
  },
  { type: 'full-name', patterns: [/\bfull.?name/i, /\bname\b/i] },
  {
    type: 'address-line1',
    patterns: [/\baddress.?1/i, /\bstreet/i, /\baddress\b/i],
  },
  { type: 'address-line2', patterns: [/\baddress.?2/i, /\bapt/i, /\bsuite/i] },
  { type: 'city', patterns: [/\bcity/i, /\btown/i, /\blocality/i] },
  { type: 'state', patterns: [/\bstate/i, /\bprovince/i, /\bregion/i] },
  {
    type: 'postal-code',
    patterns: [/\bzip/i, /\bpostal/i, /\bpost.?code/i],
  },
  { type: 'country', patterns: [/\bcountry/i] },
  {
    type: 'card-number',
    patterns: [/\bcard.?num/i, /\bcredit.?card/i, /\bcc.?num/i],
  },
  {
    type: 'card-expiry',
    patterns: [/\bexpir/i, /\bexp.?date/i, /\bexp.?month/i, /\bexp.?year/i],
  },
  { type: 'card-cvv', patterns: [/\bcvv/i, /\bcvc/i, /\bcsc/i, /\bsecurity.?code/i] },
  { type: 'search-query', patterns: [/\bsearch/i, /\bquery/i, /\bq\b/i] },
  { type: 'message', patterns: [/\bmessage/i, /\bcomment/i, /\bdescription/i] },
];

/** Patterns for submit button labels */
const SUBMIT_BUTTON_PATTERNS = [
  /\bsubmit/i,
  /\bsend/i,
  /\bsign.?up/i,
  /\bsign.?in/i,
  /\blog.?in/i,
  /\bregister/i,
  /\bcreate/i,
  /\bcontinue/i,
  /\bsave/i,
  /\bsearch/i,
  /\bsubscribe/i,
  /\bjoin/i,
  /\bcheckout/i,
  /\bplace.?order/i,
  /\bpay/i,
  /\bbuy/i,
  /\badd.?to.?cart/i,
  /\bconfirm/i,
  /\bapply/i,
  /\bgo\b/i,
  /\bnext/i,
  /\bdone/i,
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Infer semantic type from field attributes and label.
 * Returns 'unknown' with low confidence if no inference possible.
 */
function inferFieldSemanticType(node: ReadableNode): {
  type: FieldSemanticType;
  confidence: number;
} {
  // Priority 1: autocomplete attribute (highest confidence)
  if (node.attributes?.autocomplete) {
    const autocomplete = node.attributes.autocomplete.toLowerCase();
    // Handle compound values like "shipping address-line1"
    for (const [key, type] of Object.entries(AUTOCOMPLETE_TO_SEMANTIC)) {
      if (autocomplete.includes(key)) {
        return { type, confidence: 0.95 };
      }
    }
  }

  // Priority 2: input type (high confidence)
  const inputType = node.attributes?.input_type?.toLowerCase() ?? '';
  if (inputType && INPUT_TYPE_TO_SEMANTIC[inputType]) {
    return { type: INPUT_TYPE_TO_SEMANTIC[inputType], confidence: 0.85 };
  }

  // Priority 3: name/label patterns
  const textToMatch = [
    node.label,
    node.attributes?.placeholder,
    // Note: We don't have direct access to name attr in ReadableNode,
    // but test_id might contain it
    node.attributes?.test_id,
  ]
    .filter(Boolean)
    .join(' ');

  const normalized = normalizeText(textToMatch);

  for (const { type, patterns } of SEMANTIC_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return { type, confidence: 0.7 };
      }
    }
  }

  // No match - return unknown
  return { type: 'unknown', confidence: 0.2 };
}

/**
 * Check if a node looks like a submit button.
 */
function isSubmitButton(node: ReadableNode): boolean {
  // Check kind
  if (node.kind !== 'button') {
    return false;
  }

  // Check label patterns
  const label = normalizeText(node.label);
  if (SUBMIT_BUTTON_PATTERNS.some((p) => p.test(label))) {
    return true;
  }

  // Check input type
  if (node.attributes?.input_type === 'submit') {
    return true;
  }

  return false;
}

/**
 * Extract FormField from a ReadableNode.
 */
function nodeToFormField(node: ReadableNode): FormField {
  const semantic = inferFieldSemanticType(node);

  return {
    node_id: node.node_id,
    backend_node_id: node.backend_node_id,
    kind: node.kind,
    label: node.label,
    input_type: node.attributes?.input_type ?? 'text',
    required: node.state?.required ?? false,
    invalid: node.state?.invalid ?? false,
    disabled: !(node.state?.enabled ?? true),
    readonly: node.state?.readonly ?? false,
    has_value: Boolean(node.attributes?.value),
    placeholder: node.attributes?.placeholder,
    autocomplete: node.attributes?.autocomplete,
    semantic_type: semantic.type,
    semantic_confidence: semantic.confidence,
  };
}

/**
 * Infer form purpose from field patterns.
 * Returns 'generic' with low confidence if no pattern matches.
 */
function inferFormPurpose(fields: FormField[]): {
  purpose: FormPurpose;
  confidence: number;
  signals: string[];
} {
  const signals: string[] = [];
  const semanticTypes = new Set(fields.map((f) => f.semantic_type));

  // Check for specific patterns

  // Search form: single search field
  if (
    fields.length === 1 &&
    (semanticTypes.has('search-query') || fields[0].input_type === 'search')
  ) {
    return { purpose: 'search', confidence: 0.9, signals: ['single-search-field'] };
  }

  // Login: email/username + password, no password-confirm
  if (
    (semanticTypes.has('email') || semanticTypes.has('username')) &&
    semanticTypes.has('password') &&
    !semanticTypes.has('password-confirm')
  ) {
    return {
      purpose: 'login',
      confidence: 0.85,
      signals: ['email-or-username', 'password', 'no-confirm'],
    };
  }

  // Signup: email + password + password-confirm
  if (
    semanticTypes.has('email') &&
    semanticTypes.has('password') &&
    semanticTypes.has('password-confirm')
  ) {
    return {
      purpose: 'signup',
      confidence: 0.85,
      signals: ['email', 'password', 'password-confirm'],
    };
  }

  // Signup variant: email + password + name fields
  if (
    semanticTypes.has('email') &&
    semanticTypes.has('password') &&
    (semanticTypes.has('first-name') ||
      semanticTypes.has('last-name') ||
      semanticTypes.has('full-name'))
  ) {
    return {
      purpose: 'signup',
      confidence: 0.8,
      signals: ['email', 'password', 'name-fields'],
    };
  }

  // Checkout: card fields
  if (
    semanticTypes.has('card-number') ||
    (semanticTypes.has('card-expiry') && semanticTypes.has('card-cvv'))
  ) {
    return {
      purpose: 'checkout',
      confidence: 0.9,
      signals: ['card-fields'],
    };
  }

  // Shipping/Billing: address fields
  if (
    semanticTypes.has('address-line1') ||
    (semanticTypes.has('city') && semanticTypes.has('postal-code'))
  ) {
    // Try to distinguish shipping from billing by looking for card fields nearby
    if (semanticTypes.has('card-number')) {
      return { purpose: 'billing', confidence: 0.7, signals: ['address-with-card'] };
    }
    return { purpose: 'shipping', confidence: 0.7, signals: ['address-fields'] };
  }

  // Newsletter: email only (or email with name)
  if (semanticTypes.has('email') && !semanticTypes.has('password') && fields.length <= 3) {
    return { purpose: 'newsletter', confidence: 0.75, signals: ['email-only', 'few-fields'] };
  }

  // Contact: name + email + message
  if (
    semanticTypes.has('email') &&
    semanticTypes.has('message') &&
    (semanticTypes.has('full-name') ||
      semanticTypes.has('first-name') ||
      semanticTypes.has('last-name'))
  ) {
    return { purpose: 'contact', confidence: 0.75, signals: ['name', 'email', 'message'] };
  }

  // Password reset: password + password-confirm, no email/username
  if (
    semanticTypes.has('password') &&
    semanticTypes.has('password-confirm') &&
    !semanticTypes.has('email') &&
    !semanticTypes.has('username')
  ) {
    return {
      purpose: 'password-reset',
      confidence: 0.7,
      signals: ['password', 'confirm', 'no-email'],
    };
  }

  // Profile: has name/email/phone but no password
  if (
    !semanticTypes.has('password') &&
    (semanticTypes.has('email') || semanticTypes.has('phone') || semanticTypes.has('first-name'))
  ) {
    return {
      purpose: 'profile',
      confidence: 0.5,
      signals: ['no-password', 'personal-fields'],
    };
  }

  // Generic fallback
  signals.push('no-pattern-match');
  return { purpose: 'generic', confidence: 0.3, signals };
}

/**
 * Calculate form validation state.
 */
function calculateValidation(fields: FormField[], submitButton?: FormSubmitButton): FormValidation {
  const errorCount = fields.filter((f) => f.invalid).length;
  const requiredUnfilled = fields.filter((f) => f.required && !f.has_value).length;
  const hasErrors = errorCount > 0;

  const readyToSubmit =
    !hasErrors &&
    requiredUnfilled === 0 &&
    (submitButton?.enabled ?? true) &&
    (submitButton?.visible ?? true);

  return {
    has_errors: hasErrors,
    error_count: errorCount,
    required_unfilled: requiredUnfilled,
    ready_to_submit: readyToSubmit,
  };
}

/**
 * Find form fields belonging to a form.
 * Uses group_id matching or proximity heuristics.
 */
function findFormFields(
  formNode: ReadableNode,
  engine: QueryEngine,
  includeDisabled: boolean
): FormField[] {
  const inputKinds: NodeKind[] = ['input', 'textarea', 'select', 'combobox', 'checkbox', 'radio'];

  const fields: FormField[] = [];
  const seenIds = new Set<string>();

  // Method 1: Find by group_id
  if (formNode.where.group_id) {
    for (const kind of inputKinds) {
      const matches = engine.find({
        kind,
        group_id: formNode.where.group_id,
        limit: 50,
      });

      for (const match of matches.matches) {
        if (seenIds.has(match.node.node_id)) continue;
        if (!includeDisabled && !(match.node.state?.enabled ?? true)) continue;

        seenIds.add(match.node.node_id);
        fields.push(nodeToFormField(match.node));
      }
    }
  }

  // Method 2: Find by heading_context if few results
  if (fields.length < 2 && formNode.where.heading_context) {
    for (const kind of inputKinds) {
      const matches = engine.find({
        kind,
        heading_context: formNode.where.heading_context,
        limit: 50,
      });

      for (const match of matches.matches) {
        if (seenIds.has(match.node.node_id)) continue;
        if (!includeDisabled && !(match.node.state?.enabled ?? true)) continue;

        seenIds.add(match.node.node_id);
        fields.push(nodeToFormField(match.node));
      }
    }
  }

  return fields;
}

/**
 * Find submit button for a form.
 */
function findSubmitButton(
  formNode: ReadableNode,
  engine: QueryEngine
): FormSubmitButton | undefined {
  // Look for buttons in the same group
  const buttons = engine.find({
    kind: 'button',
    group_id: formNode.where.group_id,
    state: { visible: true },
    limit: 10,
  });

  for (const match of buttons.matches) {
    if (isSubmitButton(match.node)) {
      return {
        node_id: match.node.node_id,
        backend_node_id: match.node.backend_node_id,
        label: match.node.label,
        enabled: match.node.state?.enabled ?? true,
        visible: match.node.state?.visible ?? true,
      };
    }
  }

  // Fallback: look for any visible button with submit-like label
  const allButtons = engine.find({
    kind: 'button',
    state: { visible: true },
    limit: 20,
  });

  for (const match of allButtons.matches) {
    if (isSubmitButton(match.node)) {
      return {
        node_id: match.node.node_id,
        backend_node_id: match.node.backend_node_id,
        label: match.node.label,
        enabled: match.node.state?.enabled ?? true,
        visible: match.node.state?.visible ?? true,
      };
    }
  }

  return undefined;
}

/**
 * Calculate form prominence score for primary form selection.
 */
function calculateFormProminence(form: DetectedForm): number {
  let score = 0;

  // More fields = more prominent
  score += Math.min(form.fields.length * 0.1, 0.5);

  // Has submit button
  if (form.submit_button) {
    score += 0.2;
  }

  // Has title/heading
  if (form.title) {
    score += 0.1;
  }

  // Purpose is classified (not generic)
  if (form.purpose !== 'generic') {
    score += 0.2;
  }

  return score;
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Options for form detection.
 */
export interface FormDetectionOptions {
  /** Include disabled fields (default: true) */
  include_disabled_fields?: boolean;
}

/**
 * Detect forms in a BaseSnapshot.
 *
 * @param snapshot - The snapshot to analyze
 * @param options - Detection options
 * @returns Detection result with all forms and metadata
 */
export function detectForms(
  snapshot: BaseSnapshot,
  options: FormDetectionOptions = {}
): FormDetectionResult {
  const startTime = performance.now();
  const engine = new QueryEngine(snapshot);
  const includeDisabled = options.include_disabled_fields ?? true;

  // Step 1: Find all form containers (by AX role)
  const formNodes = engine.find({
    kind: 'form',
    limit: 50,
  });

  // Step 2: Extract form information
  const forms: DetectedForm[] = [];

  for (const match of formNodes.matches) {
    const formNode = match.node;

    const title = formNode.where.heading_context ?? formNode.label ?? undefined;
    const fields = findFormFields(formNode, engine, includeDisabled);
    const submitButton = findSubmitButton(formNode, engine);
    const validation = calculateValidation(fields, submitButton);
    const purposeInfo = inferFormPurpose(fields);

    forms.push({
      node_id: formNode.node_id,
      backend_node_id: formNode.backend_node_id,
      title,
      action: formNode.attributes?.action,
      method: formNode.attributes?.method,
      fields,
      submit_button: submitButton,
      validation,
      purpose: purposeInfo.purpose,
      purpose_confidence: purposeInfo.confidence,
      purpose_signals: purposeInfo.signals,
    });
  }

  // Step 2b: Fallback - detect forms by region when no form nodes found
  // Many forms (like GitHub's login) don't have an accessible name,
  // so they don't get the "form" AX role. We can detect them by finding
  // form fields in the "form" region.
  if (forms.length === 0) {
    const regionBasedForm = detectFormByRegion(snapshot, engine, includeDisabled);
    if (regionBasedForm) {
      forms.push(regionBasedForm);
    }
  }

  // Step 3: Select primary form (most prominent)
  let primaryForm: DetectedForm | undefined;
  if (forms.length > 0) {
    const sortedForms = [...forms].sort(
      (a, b) => calculateFormProminence(b) - calculateFormProminence(a)
    );
    primaryForm = sortedForms[0];
  }

  const detectionTimeMs = performance.now() - startTime;

  return {
    forms,
    primary_form: primaryForm,
    meta: {
      total_detected: forms.length,
      classified_count: forms.filter((f) => f.purpose !== 'generic').length,
      detection_time_ms: detectionTimeMs,
    },
  };
}

/**
 * Detect a form by looking for form fields in the "form" region.
 * This is a fallback for forms that don't have an accessible name
 * and thus don't expose the "form" AX role.
 */
function detectFormByRegion(
  snapshot: BaseSnapshot,
  _engine: QueryEngine,
  includeDisabled: boolean
): DetectedForm | null {
  // Find all nodes in the "form" region
  const formRegionNodes = snapshot.nodes.filter((n) => n.where.region === 'form');

  if (formRegionNodes.length === 0) {
    return null;
  }

  // Find form fields (inputs, textboxes, checkboxes, etc.)
  const fieldKinds: NodeKind[] = ['input', 'combobox', 'checkbox', 'switch', 'radio', 'textarea'];
  const fieldNodes = formRegionNodes.filter(
    (n) => fieldKinds.includes(n.kind) && (includeDisabled || n.state?.enabled !== false)
  );

  if (fieldNodes.length === 0) {
    return null;
  }

  // Find submit button in the form region
  const submitNode = formRegionNodes.find(
    (n) =>
      n.kind === 'button' &&
      n.state?.enabled !== false &&
      (n.attributes?.input_type === 'submit' ||
        /^(sign\s*in|log\s*in|submit|send|continue|register|create|save)/i.test(n.label))
  );

  // Build fields array using the nodeToFormField helper
  const fields: FormField[] = fieldNodes.map((node) => nodeToFormField(node));

  // Build submit button
  const submitButton: FormSubmitButton | undefined = submitNode
    ? {
        node_id: submitNode.node_id,
        backend_node_id: submitNode.backend_node_id,
        label: submitNode.label,
        enabled: submitNode.state?.enabled ?? true,
        visible: submitNode.state?.visible ?? true,
      }
    : undefined;

  const validation = calculateValidation(fields, submitButton);
  const purposeInfo = inferFormPurpose(fields);

  // Get heading context from the first field if available
  const title = fieldNodes[0]?.where.heading_context;

  // Use the first field's node_id as the form's node_id (synthetic form)
  const firstField = fieldNodes[0];

  return {
    node_id: `form-region-${firstField.node_id}`,
    backend_node_id: firstField.backend_node_id,
    title,
    fields,
    submit_button: submitButton,
    validation,
    purpose: purposeInfo.purpose,
    purpose_confidence: purposeInfo.confidence,
    purpose_signals: purposeInfo.signals,
  };
}
