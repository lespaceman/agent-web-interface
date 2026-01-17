/**
 * Field Extractor
 *
 * Extracts rich metadata for form fields from a BaseSnapshot.
 * Handles purpose inference, constraint extraction, and state tracking.
 *
 * Purpose inference priority:
 * 1. input type attribute
 * 2. autocomplete attribute
 * 3. aria-label
 * 4. label text
 * 5. placeholder
 * 6. name attribute
 *
 * @module form/field-extractor
 */

import type { BaseSnapshot, ReadableNode } from '../snapshot/snapshot.types.js';
import type {
  FormField,
  FieldPurpose,
  FieldSemanticType,
  FieldConstraints,
  FieldState,
  FieldOption,
  FormDetectionConfig,
} from './types.js';

/**
 * Mapping from input type to semantic type
 */
const INPUT_TYPE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
  email: 'email',
  tel: 'phone',
  password: 'password',
  url: 'url',
  search: 'search',
  date: 'date',
  'datetime-local': 'date',
  time: 'date',
  month: 'date',
  week: 'date',
  number: 'quantity',
  file: 'file',
  color: 'color',
};

/**
 * Mapping from autocomplete attribute to semantic type
 */
const AUTOCOMPLETE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'tel-local': 'phone',
  password: 'password',
  'new-password': 'password',
  'current-password': 'password',
  username: 'username',
  name: 'full_name',
  'given-name': 'first_name',
  'family-name': 'last_name',
  'additional-name': 'name',
  nickname: 'username',
  'street-address': 'street',
  'address-line1': 'street',
  'address-line2': 'address',
  'address-level1': 'state',
  'address-level2': 'city',
  'postal-code': 'zip',
  country: 'country',
  'country-name': 'country',
  'cc-number': 'card_number',
  'cc-exp': 'card_expiry',
  'cc-exp-month': 'card_expiry',
  'cc-exp-year': 'card_expiry',
  'cc-csc': 'card_cvv',
  bday: 'date_of_birth',
  'bday-day': 'date_of_birth',
  'bday-month': 'date_of_birth',
  'bday-year': 'date_of_birth',
  url: 'url',
  photo: 'file',
};

/**
 * Keywords for semantic type inference from labels
 */
const LABEL_KEYWORDS: Record<FieldSemanticType, string[]> = {
  email: ['email', 'e-mail', 'mail address'],
  phone: ['phone', 'telephone', 'mobile', 'cell', 'contact number'],
  password: ['password', 'passcode', 'pin'],
  password_confirm: ['confirm password', 'repeat password', 'retype password', 're-enter password'],
  name: ['name', 'full name'],
  first_name: ['first name', 'given name', 'forename'],
  last_name: ['last name', 'surname', 'family name'],
  full_name: ['full name', 'your name', 'customer name'],
  username: ['username', 'user name', 'user id', 'login', 'account name'],
  address: ['address', 'location'],
  street: ['street', 'address line', 'street address'],
  city: ['city', 'town', 'locality'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'postal code', 'postcode', 'zip code'],
  country: ['country', 'nation'],
  card_number: ['card number', 'credit card', 'debit card', 'card #'],
  card_expiry: ['expiry', 'expiration', 'exp date', 'valid thru'],
  card_cvv: ['cvv', 'cvc', 'security code', 'card verification'],
  date: ['date', 'when'],
  date_of_birth: ['birth', 'dob', 'birthday', 'date of birth'],
  quantity: ['quantity', 'qty', 'amount', 'count', 'number of'],
  price: ['price', 'cost', 'amount', 'total'],
  search: ['search', 'find', 'lookup', 'query'],
  comment: ['comment', 'note', 'remarks', 'feedback'],
  message: ['message', 'text', 'content', 'body'],
  url: ['url', 'website', 'link', 'web address'],
  file: ['file', 'upload', 'attachment', 'document'],
  color: ['color', 'colour'],
  selection: ['select', 'choose', 'option'],
  toggle: ['enable', 'disable', 'turn on', 'turn off'],
  consent: ['agree', 'consent', 'accept', 'terms', 'privacy', 'subscribe'],
  unknown: [],
};

/**
 * Name patterns for semantic type inference.
 * Maps common naming patterns (camelCase, snake_case, kebab-case) to semantic types.
 */
const NAME_PATTERNS: Record<string, FieldSemanticType> = {
  // Email patterns
  email: 'email',
  emailaddress: 'email',
  email_address: 'email',
  'email-address': 'email',
  useremail: 'email',
  user_email: 'email',
  // Phone patterns
  phone: 'phone',
  phonenumber: 'phone',
  phone_number: 'phone',
  'phone-number': 'phone',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  // Password patterns
  password: 'password',
  passwd: 'password',
  pass: 'password',
  confirmpassword: 'password_confirm',
  confirm_password: 'password_confirm',
  passwordconfirm: 'password_confirm',
  // Name patterns
  firstname: 'first_name',
  first_name: 'first_name',
  'first-name': 'first_name',
  givenname: 'first_name',
  lastname: 'last_name',
  last_name: 'last_name',
  'last-name': 'last_name',
  familyname: 'last_name',
  fullname: 'full_name',
  full_name: 'full_name',
  // Username
  username: 'username',
  user_name: 'username',
  userid: 'username',
  user_id: 'username',
  // Address
  streetaddress: 'street',
  street_address: 'street',
  addressline: 'street',
  address_line: 'street',
  city: 'city',
  state: 'state',
  province: 'state',
  zip: 'zip',
  zipcode: 'zip',
  zip_code: 'zip',
  postalcode: 'zip',
  postal_code: 'zip',
  country: 'country',
  // Payment
  cardnumber: 'card_number',
  card_number: 'card_number',
  ccnumber: 'card_number',
  cc_number: 'card_number',
  cvv: 'card_cvv',
  cvc: 'card_cvv',
  expiry: 'card_expiry',
  expiration: 'card_expiry',
  // Dates
  dateofbirth: 'date_of_birth',
  date_of_birth: 'date_of_birth',
  dob: 'date_of_birth',
  birthday: 'date_of_birth',
  birthdate: 'date_of_birth',
};

/**
 * Extract semantic type from naming patterns.
 *
 * @param label - The accessible label
 * @param testId - Optional test ID attribute
 * @returns Object with inferred type and signal description
 */
function extractNamePatterns(
  label: string,
  testId: string
): { type: FieldSemanticType; signal: string } {
  // Normalize label to check against patterns
  const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9_-]/g, '');

  // Check label against patterns
  for (const [pattern, type] of Object.entries(NAME_PATTERNS)) {
    if (normalizedLabel.includes(pattern)) {
      return { type, signal: `label matches pattern "${pattern}"` };
    }
  }

  // Check test_id against patterns
  if (testId) {
    const normalizedTestId = testId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    for (const [pattern, type] of Object.entries(NAME_PATTERNS)) {
      if (normalizedTestId.includes(pattern)) {
        return { type, signal: `test_id matches pattern "${pattern}"` };
      }
    }
  }

  return { type: 'unknown', signal: '' };
}

/**
 * Sensitive field types that should have values masked
 */
const SENSITIVE_TYPES = new Set<FieldSemanticType>([
  'password',
  'password_confirm',
  'card_number',
  'card_cvv',
]);

/**
 * Extract form fields from a snapshot for given field EIDs.
 *
 * @param snapshot - BaseSnapshot containing the nodes
 * @param fieldEids - Array of node IDs to extract as fields
 * @param config - Form detection configuration
 * @returns Array of FormField objects
 */
export function extractFields(
  snapshot: BaseSnapshot,
  fieldEids: string[],
  config: FormDetectionConfig
): FormField[] {
  const fields: FormField[] = [];

  for (let sequence = 0; sequence < fieldEids.length; sequence++) {
    const eid = fieldEids[sequence];
    const node = snapshot.nodes.find((n) => n.node_id === eid);

    if (!node) continue;

    const field = extractField(node, sequence, snapshot, config);
    if (field) {
      fields.push(field);
    }
  }

  // Detect radio groups and link them
  linkRadioGroups(fields, snapshot);

  return fields;
}

/**
 * Extract a single form field from a node.
 */
function extractField(
  node: ReadableNode,
  sequence: number,
  snapshot: BaseSnapshot,
  config: FormDetectionConfig
): FormField | null {
  // Infer purpose
  const purpose = inferPurpose(node);

  // Extract constraints
  const constraints = extractConstraints(node, snapshot);

  // Extract state
  const state = extractFieldState(node, config, purpose.semantic_type);

  return {
    eid: node.node_id,
    backend_node_id: node.backend_node_id,
    frame_id: node.frame_id,
    label: node.label,
    kind: node.kind,
    purpose,
    constraints,
    state,
    sequence,
  };
}

/**
 * Infer the semantic purpose of a field.
 */
function inferPurpose(node: ReadableNode): FieldPurpose {
  const inferredFrom: string[] = [];
  let semanticType: FieldSemanticType = 'unknown';
  let confidence = 0;

  // Priority 1: Input type attribute (high confidence)
  const inputType = node.attributes?.input_type;
  if (inputType && INPUT_TYPE_TO_SEMANTIC[inputType]) {
    semanticType = INPUT_TYPE_TO_SEMANTIC[inputType];
    confidence = 0.95;
    inferredFrom.push(`input_type="${inputType}"`);
  }

  // Priority 2: Autocomplete attribute (high confidence)
  const autocomplete = node.attributes?.autocomplete;
  if (autocomplete && AUTOCOMPLETE_TO_SEMANTIC[autocomplete]) {
    const autoType = AUTOCOMPLETE_TO_SEMANTIC[autocomplete];
    if (semanticType === 'unknown' || confidence < 0.9) {
      semanticType = autoType;
      confidence = Math.max(confidence, 0.9);
      inferredFrom.push(`autocomplete="${autocomplete}"`);
    }
  }

  // Priority 3-5: Label, placeholder, aria-label (medium confidence)
  // Note: node.label is the computed accessible name which includes aria-label,
  // aria-labelledby, and other ARIA labeling mechanisms
  if (semanticType === 'unknown' || confidence < 0.8) {
    const textSources = [
      { text: node.label, source: 'label', confidence: 0.7 },
      { text: node.attributes?.placeholder, source: 'placeholder', confidence: 0.65 },
    ];

    for (const { text, source, confidence: sourceConfidence } of textSources) {
      if (!text) continue;
      const lowerText = text.toLowerCase();

      for (const [type, keywords] of Object.entries(LABEL_KEYWORDS)) {
        if (type === 'unknown') continue;

        for (const keyword of keywords) {
          if (lowerText.includes(keyword)) {
            if (semanticType === 'unknown' || confidence < sourceConfidence) {
              semanticType = type as FieldSemanticType;
              confidence = Math.max(confidence, sourceConfidence);
              inferredFrom.push(`${source} contains "${keyword}"`);
            }
            break;
          }
        }
        if (semanticType !== 'unknown' && confidence >= 0.7) break;
      }
      if (semanticType !== 'unknown' && confidence >= 0.7) break;
    }
  }

  // Priority 6: Name attribute patterns (low confidence: 0.5)
  // Detect naming conventions like camelCase (firstName), snake_case (first_name),
  // or kebab-case (first-name) that may indicate field purpose
  if (semanticType === 'unknown' || confidence < 0.5) {
    const testId = node.attributes?.test_id ?? '';
    const namePatterns = extractNamePatterns(node.label, testId);
    if (namePatterns.type !== 'unknown') {
      semanticType = namePatterns.type;
      confidence = Math.max(confidence, 0.5);
      inferredFrom.push(namePatterns.signal);
    }
  }

  // Fallback based on node kind
  if (semanticType === 'unknown') {
    switch (node.kind) {
      case 'checkbox':
        semanticType = 'toggle';
        confidence = 0.5;
        inferredFrom.push('node kind is checkbox');
        break;
      case 'radio':
        semanticType = 'selection';
        confidence = 0.5;
        inferredFrom.push('node kind is radio');
        break;
      case 'select':
      case 'combobox':
        semanticType = 'selection';
        confidence = 0.5;
        inferredFrom.push(`node kind is ${node.kind}`);
        break;
      case 'textarea':
        semanticType = 'message';
        confidence = 0.4;
        inferredFrom.push('node kind is textarea');
        break;
      case 'slider':
        semanticType = 'quantity';
        confidence = 0.4;
        inferredFrom.push('node kind is slider');
        break;
    }
  }

  return {
    semantic_type: semanticType,
    confidence,
    inferred_from: inferredFrom.length > 0 ? inferredFrom : ['no signals found'],
  };
}

/**
 * Extract constraints for a field.
 */
function extractConstraints(node: ReadableNode, snapshot: BaseSnapshot): FieldConstraints {
  const constraints: FieldConstraints = {
    required: false,
    required_confidence: 0,
  };

  // Check required state
  if (node.state?.required) {
    constraints.required = true;
    constraints.required_confidence = 1.0;
  } else {
    // Check label for required indicators
    const label = node.label.toLowerCase();
    if (label.includes('*') || label.includes('required')) {
      constraints.required = true;
      constraints.required_confidence = 0.8;
    }
  }

  // Extract options for select/radio/combobox
  if (node.kind === 'radio') {
    // Find related radio buttons with same name pattern
    constraints.options = extractRadioOptions(node, snapshot);
  } else if (node.kind === 'combobox' || node.kind === 'select') {
    // Extract options for select/combobox elements
    constraints.options = extractSelectOptions(node, snapshot);
  }

  // TODO: Extract more constraints from DOM attributes
  // - minlength, maxlength
  // - min, max, step
  // - pattern

  return constraints;
}

/**
 * Extract options for radio button groups.
 */
function extractRadioOptions(node: ReadableNode, snapshot: BaseSnapshot): FieldOption[] {
  const options: FieldOption[] = [];

  // Find all radio buttons in the same region/group
  const radioButtons = snapshot.nodes.filter(
    (n) =>
      n.kind === 'radio' &&
      n.where.region === node.where.region &&
      (n.where.heading_context === node.where.heading_context ||
        n.where.group_id === node.where.group_id)
  );

  for (const radio of radioButtons) {
    options.push({
      value: radio.label,
      label: radio.label,
      selected: radio.state?.checked ?? false,
      disabled: !(radio.state?.enabled ?? true),
      eid: radio.node_id,
    });
  }

  return options;
}

/**
 * Extract options for select/combobox elements.
 *
 * Attempts to find option elements by looking for:
 * 1. Nodes in the same group with 'listitem' kind
 * 2. Nodes with 'menuitem' kind that share the same region/group
 * 3. If value is set, creates a single option representing current selection
 *
 * Note: Full option extraction may require additional CDP calls.
 * This provides a best-effort extraction from available snapshot data.
 */
function extractSelectOptions(node: ReadableNode, snapshot: BaseSnapshot): FieldOption[] {
  const options: FieldOption[] = [];

  // Look for listitem or menuitem nodes in the same group_id
  if (node.where.group_id) {
    const potentialOptions = snapshot.nodes.filter(
      (n) =>
        (n.kind === 'listitem' || n.kind === 'menuitem') &&
        n.where.group_id === node.where.group_id &&
        n.node_id !== node.node_id
    );

    for (const opt of potentialOptions) {
      const isSelected = opt.state?.selected ?? false;
      options.push({
        value: opt.label,
        label: opt.label,
        selected: isSelected,
        disabled: !(opt.state?.enabled ?? true),
        eid: opt.node_id,
      });
    }
  }

  // If we found options, return them
  if (options.length > 0) {
    return options;
  }

  // Fallback: if node has a value, create a single option for the current selection
  // This at least lets us know what's currently selected even if we can't see all options
  if (node.attributes?.value) {
    options.push({
      value: node.attributes.value,
      label: node.attributes.value,
      selected: true,
    });
  }

  return options;
}

/**
 * Extract state for a field.
 *
 * Note: This extracts initial state from the snapshot (HTML attributes).
 * Runtime values may be overlaid later via readRuntimeValues().
 */
function extractFieldState(
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

/**
 * Link radio buttons into groups.
 */
function linkRadioGroups(fields: FormField[], snapshot: BaseSnapshot): void {
  const radioFields = fields.filter((f) => f.kind === 'radio');

  // Group by heading context + region
  const groups = new Map<string, FormField[]>();

  for (const field of radioFields) {
    const node = snapshot.nodes.find((n) => n.node_id === field.eid);
    if (!node) continue;

    const key = `${node.where.region}:${node.where.heading_context ?? ''}:${node.where.group_id ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(field);
    groups.set(key, group);
  }

  // Link fields within each group
  let groupIndex = 0;
  for (const group of groups.values()) {
    if (group.length > 1) {
      const groupId = `radio-group-${groupIndex++}`;
      for (const field of group) {
        field.group_id = groupId;
        field.dependents = group.filter((f) => f.eid !== field.eid).map((f) => f.eid);
      }
    }
  }
}

/**
 * Extract a single field by EID.
 */
export function extractFieldByEid(
  snapshot: BaseSnapshot,
  eid: string,
  config: FormDetectionConfig
): FormField | null {
  const node = snapshot.nodes.find((n) => n.node_id === eid);
  if (!node) return null;
  return extractField(node, 0, snapshot, config);
}
