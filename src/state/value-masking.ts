/**
 * Value Masking
 *
 * Masks sensitive field values (passwords, tokens, SSNs) for safe display.
 *
 * @module state/value-masking
 */

/**
 * Sensitive field name patterns (case-insensitive).
 * Values in these fields will be masked.
 */
export const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'auth',
  'key',
  'api_key',
  'apikey',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'ssn',
  'social',
  'credit',
  'card',
];

/**
 * Input types that should always be masked.
 */
export const MASKED_INPUT_TYPES = ['password'];

/**
 * Input types with partial masking (show first/last chars).
 */
export const PARTIAL_MASK_TYPES = ['email', 'tel', 'phone'];

/**
 * Mask sensitive values in val_hint.
 *
 * Rules:
 * - password type: always full mask
 * - sensitive field names: always full mask
 * - email/tel: partial mask (show first/last chars)
 * - default: truncate to 12 chars, mask middle
 */
export function maskValue(value: string, inputType?: string, label?: string): string {
  // Strip newlines first
  const cleanValue = value.replace(/[\r\n]/g, ' ').trim();

  if (!cleanValue) return '';

  // Password type: always full mask
  if (inputType && MASKED_INPUT_TYPES.includes(inputType.toLowerCase())) {
    return '••••••••';
  }

  // Check sensitive field names
  const lowerLabel = (label ?? '').toLowerCase();
  for (const pattern of SENSITIVE_FIELD_PATTERNS) {
    if (lowerLabel.includes(pattern)) {
      return '***';
    }
  }

  // Email/tel: partial mask
  if (inputType && PARTIAL_MASK_TYPES.includes(inputType.toLowerCase())) {
    return partialMask(cleanValue);
  }

  // Default: truncate and partial mask if long
  if (cleanValue.length <= 12) {
    return cleanValue;
  }

  return partialMask(cleanValue.substring(0, 12));
}

/**
 * Partial mask: show first 2 and last 2 chars.
 * Example: "example@email.com" -> "ex•••om"
 */
export function partialMask(value: string): string {
  if (value.length <= 4) {
    return '••••';
  }

  const first = value.substring(0, 2);
  const last = value.substring(value.length - 2);
  return `${first}•••${last}`;
}
