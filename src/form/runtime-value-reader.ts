/**
 * Runtime Value Reader
 *
 * Reads actual input values via CDP Runtime domain.
 * CDP DOM.getAttributes only returns HTML attributes, not JavaScript properties.
 * When a user types into an input or JavaScript sets el.value, the actual value
 * is stored as a DOM property. This module reads those runtime values.
 *
 * Features:
 * - Concurrency-limited parallelism
 * - Frame-aware execution (groups by frame_id)
 * - Sensitive field masking
 * - Graceful degradation on timeout/errors
 *
 * @module form/runtime-value-reader
 */

import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { FieldSemanticType } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of reading runtime values for form fields.
 */
export interface RuntimeValueResult {
  /** Map of backend_node_id -> value (undefined = couldn't read, "" = empty, "x" = has value) */
  values: Map<number, string | undefined>;

  /** Fields that couldn't be read (for debugging) */
  errors: string[];

  /** Whether results are partial due to limits */
  partial: boolean;

  /** Reason for partial results */
  partial_reason?: string;
}

/**
 * Request to read a field's runtime value.
 */
export interface FieldValueRequest {
  /** Backend node ID for CDP targeting */
  backend_node_id: number;

  /** Frame ID containing this field */
  frame_id: string;

  /** Semantic type for masking decisions */
  semantic_type: FieldSemanticType;

  /** Input type attribute (for masking: type="password") */
  input_type?: string;

  /** Label text (for masking: label contains sensitive patterns) */
  label?: string;
}

/**
 * Options for reading runtime values.
 */
export interface RuntimeValueReaderOptions {
  /** Maximum number of fields to read (default: 50) */
  maxFieldsToRead?: number;

  /** Maximum concurrent CDP calls (default: 8) */
  concurrencyLimit?: number;

  /** Timeout in milliseconds per batch (default: 2000) */
  timeoutMs?: number;

  /** Whether to mask sensitive field values (default: true) */
  maskSensitive?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Semantic types that are always considered sensitive.
 */
const SENSITIVE_SEMANTIC_TYPES = new Set<FieldSemanticType>([
  'password',
  'password_confirm',
  'card_number',
  'card_cvv',
]);

/**
 * Label patterns that indicate sensitive fields.
 */
const SENSITIVE_LABEL_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'pin',
  'cvv',
  'cvc',
  'card number',
  'credit card',
  'debit card',
  'security code',
];

/**
 * Mask string for sensitive values.
 */
const MASKED_VALUE = '********';

/**
 * Default options.
 */
const DEFAULT_OPTIONS: Required<RuntimeValueReaderOptions> = {
  maxFieldsToRead: 50,
  concurrencyLimit: 8,
  timeoutMs: 2000,
  maskSensitive: true,
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Determine if a field should have its value masked.
 */
function shouldMask(field: FieldValueRequest): boolean {
  // 1. Input type="password"
  if (field.input_type === 'password') {
    return true;
  }

  // 2. Semantic type is sensitive
  if (SENSITIVE_SEMANTIC_TYPES.has(field.semantic_type)) {
    return true;
  }

  // 3. Label/name matches sensitive patterns
  const label = field.label?.toLowerCase() ?? '';
  if (SENSITIVE_LABEL_PATTERNS.some((p) => label.includes(p))) {
    return true;
  }

  return false;
}

/**
 * Simple semaphore for concurrency limiting.
 */
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next?.();
    } else {
      this.permits++;
    }
  }
}

/**
 * Read a single field's runtime value via CDP.
 *
 * Uses DOM.resolveNode to get a JS object reference, then Runtime.callFunctionOn
 * to read the .value property.
 */
async function readSingleFieldValue(
  cdp: CdpClient,
  backendNodeId: number,
  timeoutMs: number
): Promise<string | undefined> {
  // Create a timeout promise
  const timeoutPromise = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  // Create the actual read promise
  const readPromise = (async (): Promise<string | undefined> => {
    try {
      // Resolve the backend node to a Runtime object
      const resolveResult = await cdp.send('DOM.resolveNode', {
        backendNodeId,
      });

      if (!resolveResult.object?.objectId) {
        return undefined;
      }

      const objectId = resolveResult.object.objectId;

      // Call a function on the object to read its value
      const callResult = await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `
          function() {
            // Handle different input types
            if (this.type === 'checkbox' || this.type === 'radio') {
              return this.checked ? 'checked' : '';
            }
            if (this.tagName === 'SELECT') {
              return this.value || '';
            }
            // Default: text inputs, textareas, etc.
            return this.value ?? '';
          }
        `,
        returnByValue: true,
      });

      if (callResult.exceptionDetails) {
        return undefined;
      }

      const value: unknown = callResult.result?.value;
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      // For undefined, null, or object values, return empty string
      return '';
    } catch {
      return undefined;
    }
  })();

  // Race between timeout and read
  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Read runtime values for form fields.
 *
 * Reads the actual DOM property values via CDP Runtime domain.
 * Groups fields by frame_id, uses concurrency limiting, and handles timeouts gracefully.
 *
 * @param cdp - CDP client for the page
 * @param fields - Array of field value requests
 * @param options - Configuration options
 * @returns Result containing values map, errors, and partial status
 */
export async function readRuntimeValues(
  cdp: CdpClient,
  fields: FieldValueRequest[],
  options?: RuntimeValueReaderOptions
): Promise<RuntimeValueResult> {
  const opts: Required<RuntimeValueReaderOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const result: RuntimeValueResult = {
    values: new Map(),
    errors: [],
    partial: false,
  };

  // Guard: no fields
  if (fields.length === 0) {
    return result;
  }

  // Check if we need to limit fields
  let fieldsToProcess = fields;
  if (fields.length > opts.maxFieldsToRead) {
    result.partial = true;
    result.partial_reason = `Limited to ${opts.maxFieldsToRead} fields (${fields.length} total)`;
    fieldsToProcess = fields.slice(0, opts.maxFieldsToRead);
  }

  // Create semaphore for concurrency limiting
  const semaphore = new Semaphore(opts.concurrencyLimit);

  // Track which fields need masking
  const maskingMap = new Map<number, boolean>();
  for (const field of fieldsToProcess) {
    maskingMap.set(field.backend_node_id, opts.maskSensitive && shouldMask(field));
  }

  // Process fields with concurrency limit
  const readPromises = fieldsToProcess.map(async (field) => {
    await semaphore.acquire();

    try {
      const value = await readSingleFieldValue(cdp, field.backend_node_id, opts.timeoutMs);

      if (value === undefined) {
        result.errors.push(`Failed to read value for backend_node_id=${field.backend_node_id}`);
        return { backendNodeId: field.backend_node_id, value: undefined };
      }

      // Apply masking if needed
      const shouldMaskField = maskingMap.get(field.backend_node_id);
      const finalValue = shouldMaskField && value.length > 0 ? MASKED_VALUE : value;

      return { backendNodeId: field.backend_node_id, value: finalValue };
    } finally {
      semaphore.release();
    }
  });

  // Wait for all reads to complete
  const results = await Promise.all(readPromises);

  // Populate the values map
  for (const r of results) {
    result.values.set(r.backendNodeId, r.value);
  }

  return result;
}
