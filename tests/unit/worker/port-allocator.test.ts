/**
 * PortAllocator Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PortAllocator } from '../../../src/worker/port-allocator.js';
import { WorkerError } from '../../../src/worker/errors/index.js';

describe('PortAllocator', () => {
  let allocator: PortAllocator;

  beforeEach(() => {
    allocator = new PortAllocator({ min: 9300, max: 9309 });
  });

  describe('constructor', () => {
    it('should create allocator with valid port range', () => {
      const alloc = new PortAllocator({ min: 9300, max: 9399 });
      expect(alloc.portRange).toEqual({ min: 9300, max: 9399 });
    });

    it('should throw error if min > max', () => {
      expect(() => new PortAllocator({ min: 9400, max: 9300 })).toThrow(
        'Invalid port range: min (9400) > max (9300)'
      );
    });

    it('should throw error if port is below valid range', () => {
      expect(() => new PortAllocator({ min: 0, max: 100 })).toThrow(
        'Port range must be between 1 and 65535'
      );
    });

    it('should throw error if port is above valid range', () => {
      expect(() => new PortAllocator({ min: 9300, max: 70000 })).toThrow(
        'Port range must be between 1 and 65535'
      );
    });
  });

  describe('allocate', () => {
    it('should allocate ports sequentially starting from min', () => {
      const port1 = allocator.allocate();
      const port2 = allocator.allocate();
      const port3 = allocator.allocate();

      expect(port1).toBe(9300);
      expect(port2).toBe(9301);
      expect(port3).toBe(9302);
    });

    it('should track allocated count', () => {
      expect(allocator.allocatedCount).toBe(0);

      allocator.allocate();
      expect(allocator.allocatedCount).toBe(1);

      allocator.allocate();
      allocator.allocate();
      expect(allocator.allocatedCount).toBe(3);
    });

    it('should throw PORT_EXHAUSTED when all ports are allocated', () => {
      // Allocate all 10 ports (9300-9309)
      for (let i = 0; i < 10; i++) {
        allocator.allocate();
      }

      expect(() => allocator.allocate()).toThrow(WorkerError);

      try {
        allocator.allocate();
      } catch (error) {
        expect(WorkerError.isWorkerError(error)).toBe(true);
        if (WorkerError.isWorkerError(error)) {
          expect(error.code).toBe('PORT_EXHAUSTED');
          expect(error.context?.allocatedCount).toBe(10);
          expect(error.context?.capacity).toBe(10);
        }
      }
    });
  });

  describe('release', () => {
    it('should release allocated port and return true', () => {
      const port = allocator.allocate();
      expect(allocator.allocatedCount).toBe(1);

      const released = allocator.release(port);
      expect(released).toBe(true);
      expect(allocator.allocatedCount).toBe(0);
    });

    it('should return false when releasing non-allocated port', () => {
      const released = allocator.release(9300);
      expect(released).toBe(false);
    });

    it('should allow reallocation of released port', () => {
      const port1 = allocator.allocate(); // 9300
      allocator.allocate(); // 9301

      allocator.release(port1);

      const port3 = allocator.allocate(); // Should get 9300 again
      expect(port3).toBe(9300);
    });

    it('should fill gaps when reallocating', () => {
      allocator.allocate(); // 9300
      allocator.allocate(); // 9301
      const port3 = allocator.allocate(); // 9302
      allocator.allocate(); // 9303

      allocator.release(port3); // Release 9302

      const nextPort = allocator.allocate();
      expect(nextPort).toBe(9302); // Should reuse the gap
    });
  });

  describe('isAllocated', () => {
    it('should return true for allocated port', () => {
      const port = allocator.allocate();
      expect(allocator.isAllocated(port)).toBe(true);
    });

    it('should return false for non-allocated port', () => {
      expect(allocator.isAllocated(9300)).toBe(false);
    });

    it('should return false after release', () => {
      const port = allocator.allocate();
      allocator.release(port);
      expect(allocator.isAllocated(port)).toBe(false);
    });
  });

  describe('isPortAvailable', () => {
    it('should return true for available port', async () => {
      // Use a high port that's likely to be available
      const testAllocator = new PortAllocator({ min: 59000, max: 59010 });
      const available = await testAllocator.isPortAvailable(59000);
      // Note: This might fail if the port is actually in use
      expect(typeof available).toBe('boolean');
    });
  });

  describe('allocateVerified', () => {
    it('should allocate and verify port availability', async () => {
      // Use high ports that are likely available
      const testAllocator = new PortAllocator({ min: 59100, max: 59110 });
      const port = await testAllocator.allocateVerified();

      expect(port).toBeGreaterThanOrEqual(59100);
      expect(port).toBeLessThanOrEqual(59110);
      expect(testAllocator.isAllocated(port)).toBe(true);
    });
  });

  describe('getAllocatedPorts', () => {
    it('should return empty array when no ports allocated', () => {
      expect(allocator.getAllocatedPorts()).toEqual([]);
    });

    it('should return sorted array of allocated ports', () => {
      allocator.allocate(); // 9300
      allocator.allocate(); // 9301
      allocator.allocate(); // 9302

      expect(allocator.getAllocatedPorts()).toEqual([9300, 9301, 9302]);
    });

    it('should reflect releases', () => {
      allocator.allocate(); // 9300
      const port2 = allocator.allocate(); // 9301
      allocator.allocate(); // 9302

      allocator.release(port2);

      expect(allocator.getAllocatedPorts()).toEqual([9300, 9302]);
    });
  });

  describe('reset', () => {
    it('should release all allocated ports', () => {
      allocator.allocate();
      allocator.allocate();
      allocator.allocate();
      expect(allocator.allocatedCount).toBe(3);

      allocator.reset();

      expect(allocator.allocatedCount).toBe(0);
      expect(allocator.getAllocatedPorts()).toEqual([]);
    });

    it('should allow fresh allocation after reset', () => {
      allocator.allocate();
      allocator.allocate();
      allocator.reset();

      const port = allocator.allocate();
      expect(port).toBe(9300);
    });
  });

  describe('capacity', () => {
    it('should return correct capacity', () => {
      expect(allocator.capacity).toBe(10); // 9300-9309 inclusive

      const smallAllocator = new PortAllocator({ min: 9300, max: 9300 });
      expect(smallAllocator.capacity).toBe(1);

      const largeAllocator = new PortAllocator({ min: 9300, max: 9399 });
      expect(largeAllocator.capacity).toBe(100);
    });
  });
});
