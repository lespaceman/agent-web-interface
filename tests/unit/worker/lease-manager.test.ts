/**
 * LeaseManager Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logging service
vi.mock('../../../src/shared/services/logging.service.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}));

import { LeaseManager } from '../../../src/worker/lease-manager.js';
import { WorkerError } from '../../../src/worker/errors/index.js';

describe('LeaseManager', () => {
  let manager: LeaseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new LeaseManager({ defaultTtlMs: 5000 });
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('acquire', () => {
    it('should acquire a new lease', () => {
      const result = manager.acquire('tenant-a', 'controller-1', 'w-123');

      expect(result.success).toBe(true);
      expect(result.lease).toBeDefined();
      expect(result.lease?.tenantId).toBe('tenant-a');
      expect(result.lease?.controllerId).toBe('controller-1');
      expect(result.lease?.workerId).toBe('w-123');
      expect(result.lease?.status).toBe('active');
      expect(result.workerId).toBe('w-123');
    });

    it('should set correct expiration time', () => {
      const now = Date.now();
      const result = manager.acquire('tenant-a', 'controller-1', 'w-123');

      expect(result.lease?.acquiredAt).toBe(now);
      expect(result.lease?.expiresAt).toBe(now + 5000);
    });

    it('should use custom TTL when provided', () => {
      const now = Date.now();
      const result = manager.acquire('tenant-a', 'controller-1', 'w-123', 10000);

      expect(result.lease?.expiresAt).toBe(now + 10000);
    });

    it('should refresh lease when same controller acquires again', () => {
      const result1 = manager.acquire('tenant-a', 'controller-1', 'w-123');
      const originalExpires = result1.lease?.expiresAt;

      vi.advanceTimersByTime(1000);

      const result2 = manager.acquire('tenant-a', 'controller-1', 'w-123');

      expect(result2.success).toBe(true);
      expect(result2.lease?.leaseId).toBe(result1.lease?.leaseId); // Same lease
      expect(result2.lease?.expiresAt).toBeGreaterThan(originalExpires!); // Extended
    });

    it('should reject when different controller tries to acquire active lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      const result = manager.acquire('tenant-a', 'controller-2', 'w-123');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('LEASE_ALREADY_HELD');
      expect(result.error).toContain('another controller');
    });

    it('should allow acquisition after lease expires', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      // Advance past expiration
      vi.advanceTimersByTime(6000);

      const result = manager.acquire('tenant-a', 'controller-2', 'w-456');

      expect(result.success).toBe(true);
      expect(result.lease?.controllerId).toBe('controller-2');
      expect(result.lease?.workerId).toBe('w-456');
    });

    it('should generate unique lease IDs', () => {
      const result1 = manager.acquire('tenant-a', 'controller-1', 'w-1');
      manager.release('tenant-a');
      const result2 = manager.acquire('tenant-a', 'controller-1', 'w-2');

      expect(result1.lease?.leaseId).not.toBe(result2.lease?.leaseId);
    });
  });

  describe('release', () => {
    it('should release a lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      const released = manager.release('tenant-a');

      expect(released).toBe(true);
      expect(manager.hasLease('tenant-a')).toBe(false);
    });

    it('should return false for non-existent lease', () => {
      const released = manager.release('non-existent');
      expect(released).toBe(false);
    });

    it('should validate controller ownership when specified', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      // Wrong controller
      const released1 = manager.release('tenant-a', 'controller-2');
      expect(released1).toBe(false);
      expect(manager.hasLease('tenant-a')).toBe(true);

      // Correct controller
      const released2 = manager.release('tenant-a', 'controller-1');
      expect(released2).toBe(true);
      expect(manager.hasLease('tenant-a')).toBe(false);
    });
  });

  describe('refresh', () => {
    it('should refresh an active lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');
      const originalExpires = manager.getLease('tenant-a')!.expiresAt;

      vi.advanceTimersByTime(2000);
      const timeAfterAdvance = Date.now();

      manager.refresh('tenant-a');

      const refreshedLease = manager.getLease('tenant-a');
      // New expiration should be current time + TTL, which is greater than original
      // since we advanced time but didn't consume the full TTL
      expect(refreshedLease?.expiresAt).toBe(timeAfterAdvance + 5000);
      // The new expiration should be later than the original would have been
      // because we essentially "reset the clock" on the TTL
      expect(refreshedLease?.expiresAt).toBe(originalExpires + 2000);
    });

    it('should use custom TTL when refreshing', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(2000);
      const now = Date.now();

      manager.refresh('tenant-a', 20000);

      const lease = manager.getLease('tenant-a');
      expect(lease?.expiresAt).toBe(now + 20000);
    });

    it('should throw LEASE_NOT_FOUND for non-existent lease', () => {
      expect(() => manager.refresh('non-existent')).toThrow(WorkerError);

      try {
        manager.refresh('non-existent');
      } catch (error) {
        expect(WorkerError.isWorkerError(error)).toBe(true);
        if (WorkerError.isWorkerError(error)) {
          expect(error.code).toBe('LEASE_NOT_FOUND');
        }
      }
    });

    it('should throw LEASE_EXPIRED for expired lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000); // Past expiration

      expect(() => manager.refresh('tenant-a')).toThrow(WorkerError);

      try {
        manager.refresh('tenant-a');
      } catch (error) {
        expect(WorkerError.isWorkerError(error)).toBe(true);
        if (WorkerError.isWorkerError(error)) {
          expect(error.code).toBe('LEASE_EXPIRED');
        }
      }
    });
  });

  describe('revoke', () => {
    it('should revoke a lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      manager.revoke('tenant-a', 'worker crashed');

      expect(manager.hasLease('tenant-a')).toBe(false);
    });

    it('should call revocation callbacks', () => {
      const callback = vi.fn();
      manager.onLeaseRevoked(callback);

      manager.acquire('tenant-a', 'controller-1', 'w-123');
      manager.revoke('tenant-a', 'worker crashed');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
        'worker crashed'
      );
    });

    it('should handle non-existent lease gracefully', () => {
      // Should not throw
      manager.revoke('non-existent', 'reason');
    });
  });

  describe('hasLease', () => {
    it('should return true for active lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');
      expect(manager.hasLease('tenant-a')).toBe(true);
    });

    it('should return false for non-existent lease', () => {
      expect(manager.hasLease('non-existent')).toBe(false);
    });

    it('should return false for expired lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000);

      expect(manager.hasLease('tenant-a')).toBe(false);
    });
  });

  describe('getLease', () => {
    it('should return lease for tenant', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      const lease = manager.getLease('tenant-a');

      expect(lease).toBeDefined();
      expect(lease?.tenantId).toBe('tenant-a');
    });

    it('should return undefined for non-existent tenant', () => {
      const lease = manager.getLease('non-existent');
      expect(lease).toBeUndefined();
    });
  });

  describe('getLeaseHolder', () => {
    it('should return controller ID', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      const holder = manager.getLeaseHolder('tenant-a');
      expect(holder).toBe('controller-1');
    });

    it('should return undefined for non-existent tenant', () => {
      const holder = manager.getLeaseHolder('non-existent');
      expect(holder).toBeUndefined();
    });
  });

  describe('isLeaseHeldBy', () => {
    it('should return true for correct controller', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');
      expect(manager.isLeaseHeldBy('tenant-a', 'controller-1')).toBe(true);
    });

    it('should return false for wrong controller', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');
      expect(manager.isLeaseHeldBy('tenant-a', 'controller-2')).toBe(false);
    });

    it('should return false for expired lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000);

      expect(manager.isLeaseHeldBy('tenant-a', 'controller-1')).toBe(false);
    });

    it('should return false for non-existent tenant', () => {
      expect(manager.isLeaseHeldBy('non-existent', 'controller-1')).toBe(false);
    });
  });

  describe('getWorkerIdForTenant', () => {
    it('should return worker ID for active lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');
      expect(manager.getWorkerIdForTenant('tenant-a')).toBe('w-123');
    });

    it('should return undefined for expired lease', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000);

      expect(manager.getWorkerIdForTenant('tenant-a')).toBeUndefined();
    });

    it('should return undefined for non-existent tenant', () => {
      expect(manager.getWorkerIdForTenant('non-existent')).toBeUndefined();
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired leases', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-1');
      manager.acquire('tenant-b', 'controller-2', 'w-2');

      vi.advanceTimersByTime(6000);

      const cleaned = manager.cleanupExpired();

      expect(cleaned).toBe(2);
      expect(manager.leaseCount).toBe(0);
    });

    it('should call expiration callbacks', () => {
      const callback = vi.fn();
      manager.onLeaseExpired(callback);

      manager.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000);

      manager.cleanupExpired();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    });

    it('should not remove active leases', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-1');

      vi.advanceTimersByTime(2000); // Not expired yet

      const cleaned = manager.cleanupExpired();

      expect(cleaned).toBe(0);
      expect(manager.hasLease('tenant-a')).toBe(true);
    });
  });

  describe('getAllLeases', () => {
    it('should return all leases', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-1');
      manager.acquire('tenant-b', 'controller-2', 'w-2');

      const leases = manager.getAllLeases();

      expect(leases).toHaveLength(2);
      expect(leases.map((l) => l.tenantId)).toContain('tenant-a');
      expect(leases.map((l) => l.tenantId)).toContain('tenant-b');
    });

    it('should return empty array when no leases', () => {
      const leases = manager.getAllLeases();
      expect(leases).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all leases', () => {
      manager.acquire('tenant-a', 'controller-1', 'w-1');
      manager.acquire('tenant-b', 'controller-2', 'w-2');

      manager.clear();

      expect(manager.leaseCount).toBe(0);
    });
  });

  describe('leaseCount', () => {
    it('should return correct count', () => {
      expect(manager.leaseCount).toBe(0);

      manager.acquire('tenant-a', 'controller-1', 'w-1');
      expect(manager.leaseCount).toBe(1);

      manager.acquire('tenant-b', 'controller-2', 'w-2');
      expect(manager.leaseCount).toBe(2);

      manager.release('tenant-a');
      expect(manager.leaseCount).toBe(1);
    });
  });

  describe('cleanup interval', () => {
    it('should auto-cleanup expired leases', () => {
      const managerWithCleanup = new LeaseManager({
        defaultTtlMs: 5000,
        cleanupIntervalMs: 1000,
      });

      managerWithCleanup.acquire('tenant-a', 'controller-1', 'w-123');

      vi.advanceTimersByTime(6000);

      expect(managerWithCleanup.hasLease('tenant-a')).toBe(false);

      managerWithCleanup.stop();
    });
  });
});
