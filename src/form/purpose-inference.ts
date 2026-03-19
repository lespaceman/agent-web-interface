/**
 * Purpose Inference
 *
 * Infers the semantic purpose of form fields based on input type,
 * autocomplete attributes, label text, and naming patterns.
 *
 * Priority order:
 * 1. input type attribute
 * 2. autocomplete attribute
 * 3. aria-label / label text
 * 4. placeholder
 * 5. name attribute patterns
 *
 * @module form/purpose-inference
 */

import type { ReadableNode } from '../snapshot/snapshot.types.js';
import type { FieldPurpose, FieldSemanticType } from './types.js';

/**
 * Mapping from input type to semantic type
 */
export const INPUT_TYPE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
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
export const AUTOCOMPLETE_TO_SEMANTIC: Record<string, FieldSemanticType> = {
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
export const LABEL_KEYWORDS: Record<FieldSemanticType, string[]> = {
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
export const NAME_PATTERNS: Record<string, FieldSemanticType> = {
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
export function extractNamePatterns(
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
 * Infer the semantic purpose of a field.
 */
export function inferPurpose(node: ReadableNode): FieldPurpose {
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
