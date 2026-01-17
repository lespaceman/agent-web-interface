/**
 * Runtime Value Reader Tests
 *
 * Tests for reading runtime values via CDP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readRuntimeValues,
  type FieldValueRequest,
  type RuntimeValueReaderOptions,
} from '../../../src/form/runtime-value-reader.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

// Helper to create a mock CDP client
function createMockCdp(
  sendImpl?: (method: string, _params?: unknown) => Promise<unknown>
): CdpClient {
  return {
    send: vi.fn(sendImpl ?? (() => Promise.resolve({}))),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    isActive: vi.fn().mockReturnValue(true),
  };
}

// Helper to create a field value request
function createFieldRequest(
  backendNodeId: number,
  overrides: Partial<FieldValueRequest> = {}
): FieldValueRequest {
  return {
    backend_node_id: backendNodeId,
    frame_id: 'main',
    semantic_type: 'unknown',
    ...overrides,
  };
}

describe('readRuntimeValues', () => {
  let mockCdp: CdpClient;

  beforeEach(() => {
    mockCdp = createMockCdp();
  });

  describe('basic value reading', () => {
    it('should return empty map for empty fields array', async () => {
      const result = await readRuntimeValues(mockCdp, []);

      expect(result.values.size).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.partial).toBe(false);
    });

    it('should read value for a single field', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'test value' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBe('test value');
      expect(result.errors).toHaveLength(0);
      expect(result.partial).toBe(false);
    });

    it('should handle empty string values', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: '' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBe('');
    });

    it('should handle multiple fields', async () => {
      let callCount = 0;
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          callCount++;
          return Promise.resolve({ object: { objectId: `obj-${callCount}` } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: `value-${callCount}` } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100), createFieldRequest(101), createFieldRequest(102)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.size).toBe(3);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle DOM.resolveNode failure gracefully', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: null });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle Runtime.callFunctionOn exception', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ exceptionDetails: { text: 'Error' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle CDP send throwing', async () => {
      mockCdp = createMockCdp(() => Promise.reject(new Error('CDP error')));

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('max fields limit', () => {
    it('should limit fields to maxFieldsToRead', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'value' } });
        }
        return Promise.resolve({});
      });

      const fields = Array.from({ length: 60 }, (_, i) => createFieldRequest(100 + i));
      const options: RuntimeValueReaderOptions = { maxFieldsToRead: 50 };

      const result = await readRuntimeValues(mockCdp, fields, options);

      expect(result.values.size).toBe(50);
      expect(result.partial).toBe(true);
      expect(result.partial_reason).toContain('Limited to 50 fields');
    });

    it('should not set partial when under limit', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'value' } });
        }
        return Promise.resolve({});
      });

      const fields = Array.from({ length: 10 }, (_, i) => createFieldRequest(100 + i));

      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.partial).toBe(false);
      expect(result.partial_reason).toBeUndefined();
    });
  });

  describe('sensitive field masking', () => {
    it('should mask password fields by input_type', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'secret123' } });
        }
        return Promise.resolve({});
      });

      const fields = [
        createFieldRequest(100, { input_type: 'password', semantic_type: 'unknown' }),
      ];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('********');
    });

    it('should mask password fields by semantic_type', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'secret123' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { semantic_type: 'password' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('********');
    });

    it('should mask card_number fields by semantic_type', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: '4111111111111111' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { semantic_type: 'card_number' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('********');
    });

    it('should mask card_cvv fields by semantic_type', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: '123' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { semantic_type: 'card_cvv' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('********');
    });

    it('should mask fields with sensitive label patterns', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'secret' } });
        }
        return Promise.resolve({});
      });

      const fields = [
        createFieldRequest(100, { label: 'Enter your password', semantic_type: 'unknown' }),
      ];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('********');
    });

    it('should not mask empty sensitive values', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: '' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { input_type: 'password' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      // Empty value should stay empty, not be masked
      expect(result.values.get(100)).toBe('');
    });

    it('should not mask when maskSensitive is false', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'secret123' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { input_type: 'password' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: false });

      expect(result.values.get(100)).toBe('secret123');
    });

    it('should not mask non-sensitive fields', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'regular value' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100, { semantic_type: 'email', label: 'Email Address' })];
      const result = await readRuntimeValues(mockCdp, fields, { maskSensitive: true });

      expect(result.values.get(100)).toBe('regular value');
    });
  });

  describe('concurrency limiting', () => {
    it('should respect concurrencyLimit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          // Simulate async work
          return new Promise((resolve) => {
            setTimeout(() => {
              currentConcurrent--;
              resolve({ object: { objectId: 'obj-123' } });
            }, 10);
          });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'value' } });
        }
        return Promise.resolve({});
      });

      const fields = Array.from({ length: 20 }, (_, i) => createFieldRequest(100 + i));
      const options: RuntimeValueReaderOptions = { concurrencyLimit: 4 };

      await readRuntimeValues(mockCdp, fields, options);

      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });
  });

  describe('tri-state values', () => {
    it('should return undefined for failed reads', async () => {
      mockCdp = createMockCdp(() => Promise.reject(new Error('CDP error')));

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBeUndefined();
    });

    it('should return empty string for empty values', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: '' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBe('');
    });

    it('should return actual value for filled fields', async () => {
      mockCdp = createMockCdp((method: string) => {
        if (method === 'DOM.resolveNode') {
          return Promise.resolve({ object: { objectId: 'obj-123' } });
        }
        if (method === 'Runtime.callFunctionOn') {
          return Promise.resolve({ result: { value: 'filled value' } });
        }
        return Promise.resolve({});
      });

      const fields = [createFieldRequest(100)];
      const result = await readRuntimeValues(mockCdp, fields);

      expect(result.values.get(100)).toBe('filled value');
    });
  });
});
