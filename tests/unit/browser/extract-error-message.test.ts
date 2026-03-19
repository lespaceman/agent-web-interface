/**
 * Tests for extractErrorMessage utility function
 *
 * Covers all branches of the error message extraction logic:
 * - Error instances (with message, with only name, empty)
 * - String errors
 * - Objects with .message, .error, .reason properties
 * - JSON-serializable objects
 * - Empty objects
 * - Circular reference objects
 * - Primitives (null, undefined, numbers, booleans)
 */

import { describe, it, expect } from 'vitest';
import { extractErrorMessage } from '../../../src/browser/connection-utils.js';

describe('extractErrorMessage', () => {
  describe('Error instances', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Something went wrong');
      expect(extractErrorMessage(error)).toBe('Something went wrong');
    });

    it('should use error name when message is empty', () => {
      const error = new Error('');
      error.name = 'CustomError';
      expect(extractErrorMessage(error)).toBe('CustomError');
    });

    it('should return "Unknown Error" for Error with no message or name', () => {
      const error = new Error('');
      error.name = '';
      expect(extractErrorMessage(error)).toBe('Unknown Error');
    });

    it('should handle TypeError', () => {
      const error = new TypeError('Cannot read property');
      expect(extractErrorMessage(error)).toBe('Cannot read property');
    });

    it('should handle RangeError', () => {
      const error = new RangeError('Out of bounds');
      expect(extractErrorMessage(error)).toBe('Out of bounds');
    });
  });

  describe('string errors', () => {
    it('should return string as-is', () => {
      expect(extractErrorMessage('Plain string error')).toBe('Plain string error');
    });

    it('should handle empty string', () => {
      expect(extractErrorMessage('')).toBe('');
    });
  });

  describe('error-like objects', () => {
    it('should extract .message property from object', () => {
      const error = { message: 'Object with message' };
      expect(extractErrorMessage(error)).toBe('Object with message');
    });

    it('should extract .error property from object', () => {
      const error = { error: 'Object with error property' };
      expect(extractErrorMessage(error)).toBe('Object with error property');
    });

    it('should extract .reason property from object', () => {
      const error = { reason: 'Object with reason property' };
      expect(extractErrorMessage(error)).toBe('Object with reason property');
    });

    it('should prefer .message over .error and .reason', () => {
      const error = { message: 'message wins', error: 'error loses', reason: 'reason loses' };
      expect(extractErrorMessage(error)).toBe('message wins');
    });

    it('should prefer .error over .reason when no .message', () => {
      const error = { error: 'error wins', reason: 'reason loses' };
      expect(extractErrorMessage(error)).toBe('error wins');
    });
  });

  describe('JSON-serializable objects', () => {
    it('should stringify objects without known properties', () => {
      const error = { code: 123, details: 'Something happened' };
      expect(extractErrorMessage(error)).toBe('{"code":123,"details":"Something happened"}');
    });

    it('should handle nested objects', () => {
      const error = { nested: { value: 42 } };
      expect(extractErrorMessage(error)).toBe('{"nested":{"value":42}}');
    });

    it('should handle arrays', () => {
      const error = ['error1', 'error2'];
      expect(extractErrorMessage(error)).toBe('["error1","error2"]');
    });
  });

  describe('empty objects', () => {
    it('should describe empty object with keys', () => {
      const error = {};
      expect(extractErrorMessage(error)).toBe('Unknown error object: empty');
    });

    it('should list keys for object that stringifies to {}', () => {
      // Object with getters that return undefined will stringify to {}
      const error: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(error, 'hidden', {
        value: 'secret',
        enumerable: false,
      });
      // This will stringify to {} but has no enumerable keys
      expect(extractErrorMessage(error)).toBe('Unknown error object: empty');
    });
  });

  describe('circular references', () => {
    it('should handle circular reference objects', () => {
      const error: Record<string, unknown> = { name: 'circular' };
      error.self = error; // Create circular reference

      const result = extractErrorMessage(error);
      expect(result).toMatch(/Non-serializable error:/);
      expect(result).toContain('[object Object]');
    });
  });

  describe('primitives', () => {
    it('should handle null', () => {
      expect(extractErrorMessage(null)).toBe('null');
    });

    it('should handle undefined', () => {
      expect(extractErrorMessage(undefined)).toBe('undefined');
    });

    it('should handle numbers', () => {
      expect(extractErrorMessage(42)).toBe('42');
      expect(extractErrorMessage(0)).toBe('0');
      expect(extractErrorMessage(-1)).toBe('-1');
      expect(extractErrorMessage(NaN)).toBe('NaN');
      expect(extractErrorMessage(Infinity)).toBe('Infinity');
    });

    it('should handle booleans', () => {
      expect(extractErrorMessage(true)).toBe('true');
      expect(extractErrorMessage(false)).toBe('false');
    });

    it('should handle symbols', () => {
      const sym = Symbol('test');
      expect(extractErrorMessage(sym)).toBe('Symbol(test)');
    });

    it('should handle BigInt', () => {
      const bigint = BigInt(9007199254740991);
      expect(extractErrorMessage(bigint)).toBe('9007199254740991');
    });
  });

  describe('edge cases', () => {
    it('should handle object with non-string message property', () => {
      const error = { message: 123 }; // message is number, not string
      // Should fall through to JSON stringify since message is not a string
      expect(extractErrorMessage(error)).toBe('{"message":123}');
    });

    it('should handle object with null message property', () => {
      const error = { message: null };
      expect(extractErrorMessage(error)).toBe('{"message":null}');
    });

    it('should handle Date objects', () => {
      const date = new Date('2026-01-29T00:00:00Z');
      expect(extractErrorMessage(date)).toBe('"2026-01-29T00:00:00.000Z"');
    });

    it('should handle RegExp objects', () => {
      // RegExp stringifies to '{}' but has no enumerable keys
      const regex: unknown = /test/gi;
      expect(extractErrorMessage(regex)).toBe('Unknown error object: empty');
    });
  });
});
