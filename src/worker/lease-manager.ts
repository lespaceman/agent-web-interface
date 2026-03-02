/**
 * Lease Manager
 *
 * Manages exclusive leases for worker access.
 * Each tenant can hold at most one lease at a time.
 */

import { randomUUID } from 'crypto';
import type { LeaseDescriptor, LeaseAcquisitionResult } from './types.js';
import { WorkerError } from './errors/index.js';
import { createLogger } from '../shared/services/logging.service.js';

const logger = createLogger('LeaseManager');

/**
 * Configuration for LeaseManager
 */
export interface LeaseManagerConfig {
  /** Default lease TTL in milliseconds */
  defaultTtlMs: number;
  /** Interval for checking expired leases (ms) */
  cleanupIntervalMs?: number;
}

/**
 * Manages exclusive leases for tenant workers.
 *
 * @example
 * ```typescript
 * const leaseManager = new LeaseManager({ defaultTtlMs: 300000 });
 *
 * // Acquire a lease
 * const result = leaseManager.acquire('tenant-a', 'controller-1', 'w-123');
 * if (result.success) {
 *   console.log(`Lease acquired: ${result.lease.leaseId}`);
 * }
 *
 * // Refresh the lease before it expires
 * leaseManager.refresh('tenant-a');
 *
 * // Release when done
 * leaseManager.release('tenant-a');
 * ```
 */
export class LeaseManager {
  private readonly defaultTtlMs: number;
  private readonly leases = new Map<string, LeaseDescriptor>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Callbacks for lease expiration */
  private onLeaseExpiredCallbacks: ((lease: LeaseDescriptor) => void)[] = [];
  /** Callbacks for lease revocation */
  private onLeaseRevokedCallbacks: ((lease: LeaseDescriptor, reason: string) => void)[] = [];

  constructor(config: LeaseManagerConfig) {
    this.defaultTtlMs = config.defaultTtlMs;

    // Start cleanup interval if specified
    if (config.cleanupIntervalMs && config.cleanupIntervalMs > 0) {
      this.startCleanupInterval(config.cleanupIntervalMs);
    }
  }

  /**
   * Get number of active leases
   */
  get leaseCount(): number {
    return this.leases.size;
  }

  /**
   * Acquire a lease for a tenant
   *
   * @param tenantId - Tenant identifier
   * @param controllerId - Controller/session identifier
   * @param workerId - Worker to lease
   * @param ttlMs - Optional custom TTL (uses default if not specified)
   * @returns Lease acquisition result
   */
  acquire(
    tenantId: string,
    controllerId: string,
    workerId: string,
    ttlMs?: number
  ): LeaseAcquisitionResult {
    const existingLease = this.leases.get(tenantId);

    // Check if lease already exists
    if (existingLease) {
      // If same controller, just refresh
      if (existingLease.controllerId === controllerId) {
        this.refreshLease(existingLease, ttlMs);
        return {
          success: true,
          lease: existingLease,
          workerId: existingLease.workerId,
        };
      }

      // Different controller - check if lease is still active
      if (existingLease.status === 'active' && existingLease.expiresAt > Date.now()) {
        logger.debug('Lease acquisition blocked - held by different controller', {
          tenantId,
          controllerId,
          heldBy: existingLease.controllerId,
        });

        return {
          success: false,
          error: 'Lease is held by another controller',
          errorCode: 'LEASE_ALREADY_HELD',
        };
      }

      // Lease expired - clean it up and allow new acquisition
      this.leases.delete(tenantId);
    }

    // Create new lease
    const now = Date.now();
    const lease: LeaseDescriptor = {
      leaseId: randomUUID(),
      tenantId,
      workerId,
      controllerId,
      acquiredAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      status: 'active',
    };

    this.leases.set(tenantId, lease);

    logger.info('Lease acquired', {
      leaseId: lease.leaseId,
      tenantId,
      controllerId,
      workerId,
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });

    return {
      success: true,
      lease,
      workerId,
    };
  }

  /**
   * Release a lease
   *
   * @param tenantId - Tenant identifier
   * @param controllerId - Optional controller ID to validate ownership
   * @returns true if lease was released
   */
  release(tenantId: string, controllerId?: string): boolean {
    const lease = this.leases.get(tenantId);

    if (!lease) {
      return false;
    }

    // Validate controller ownership if specified
    if (controllerId && lease.controllerId !== controllerId) {
      logger.debug('Lease release rejected - wrong controller', {
        tenantId,
        controllerId,
        actualController: lease.controllerId,
      });
      return false;
    }

    this.leases.delete(tenantId);

    logger.info('Lease released', {
      leaseId: lease.leaseId,
      tenantId,
      controllerId: lease.controllerId,
    });

    return true;
  }

  /**
   * Refresh a lease to extend its TTL
   *
   * @param tenantId - Tenant identifier
   * @param ttlMs - Optional new TTL (uses default if not specified)
   * @returns true if lease was refreshed
   * @throws WorkerError if lease not found or expired
   */
  refresh(tenantId: string, ttlMs?: number): boolean {
    const lease = this.leases.get(tenantId);

    if (!lease) {
      throw WorkerError.leaseNotFound(tenantId);
    }

    if (lease.status !== 'active') {
      throw WorkerError.leaseExpired(tenantId, lease.expiresAt);
    }

    if (lease.expiresAt <= Date.now()) {
      lease.status = 'expired';
      throw WorkerError.leaseExpired(tenantId, lease.expiresAt);
    }

    this.refreshLease(lease, ttlMs);
    return true;
  }

  /**
   * Revoke a lease (typically on worker crash)
   *
   * @param tenantId - Tenant identifier
   * @param reason - Reason for revocation
   */
  revoke(tenantId: string, reason: string): void {
    const lease = this.leases.get(tenantId);

    if (!lease) {
      return;
    }

    lease.status = 'revoked';
    this.leases.delete(tenantId);

    logger.info('Lease revoked', {
      leaseId: lease.leaseId,
      tenantId,
      reason,
    });

    // Notify callbacks
    for (const callback of this.onLeaseRevokedCallbacks) {
      try {
        callback(lease, reason);
      } catch (err) {
        logger.error('Error in lease revoked callback', err instanceof Error ? err : undefined, {
          errorMessage: String(err),
        });
      }
    }
  }

  /**
   * Check if a tenant has an active lease
   */
  hasLease(tenantId: string): boolean {
    const lease = this.leases.get(tenantId);
    if (!lease) return false;

    // Check if expired
    if (lease.expiresAt <= Date.now()) {
      lease.status = 'expired';
      return false;
    }

    return lease.status === 'active';
  }

  /**
   * Get the lease for a tenant (if any)
   */
  getLease(tenantId: string): LeaseDescriptor | undefined {
    return this.leases.get(tenantId);
  }

  /**
   * Get the lease holder (controller) for a tenant
   */
  getLeaseHolder(tenantId: string): string | undefined {
    const lease = this.leases.get(tenantId);
    return lease?.controllerId;
  }

  /**
   * Check if a specific controller holds the lease for a tenant
   */
  isLeaseHeldBy(tenantId: string, controllerId: string): boolean {
    const lease = this.leases.get(tenantId);
    if (!lease) return false;

    if (lease.expiresAt <= Date.now()) {
      return false;
    }

    return lease.status === 'active' && lease.controllerId === controllerId;
  }

  /**
   * Get the worker ID for a tenant's lease
   */
  getWorkerIdForTenant(tenantId: string): string | undefined {
    const lease = this.leases.get(tenantId);
    if (lease?.status !== 'active' || lease.expiresAt <= Date.now()) {
      return undefined;
    }
    return lease.workerId;
  }

  /**
   * Register a callback for lease expiration
   */
  onLeaseExpired(callback: (lease: LeaseDescriptor) => void): void {
    this.onLeaseExpiredCallbacks.push(callback);
  }

  /**
   * Register a callback for lease revocation
   */
  onLeaseRevoked(callback: (lease: LeaseDescriptor, reason: string) => void): void {
    this.onLeaseRevokedCallbacks.push(callback);
  }

  /**
   * Clean up expired leases
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [tenantId, lease] of this.leases.entries()) {
      if (lease.status === 'active' && lease.expiresAt <= now) {
        lease.status = 'expired';
        this.leases.delete(tenantId);
        cleaned++;

        logger.info('Lease expired', {
          leaseId: lease.leaseId,
          tenantId,
          controllerId: lease.controllerId,
        });

        // Notify callbacks
        for (const callback of this.onLeaseExpiredCallbacks) {
          try {
            callback(lease);
          } catch (err) {
            logger.error('Error in lease expired callback', err instanceof Error ? err : undefined, {
              errorMessage: String(err),
            });
          }
        }
      }
    }

    return cleaned;
  }

  /**
   * Get all active leases
   */
  getAllLeases(): LeaseDescriptor[] {
    return Array.from(this.leases.values());
  }

  /**
   * Clear all leases
   */
  clear(): void {
    this.leases.clear();
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Internal: refresh lease TTL
   */
  private refreshLease(lease: LeaseDescriptor, ttlMs?: number): void {
    const now = Date.now();
    lease.expiresAt = now + (ttlMs ?? this.defaultTtlMs);

    logger.debug('Lease refreshed', {
      leaseId: lease.leaseId,
      tenantId: lease.tenantId,
      newExpiresAt: lease.expiresAt,
    });
  }

  /**
   * Internal: start cleanup interval
   */
  private startCleanupInterval(intervalMs: number): void {
    this.cleanupIntervalId = setInterval(() => {
      const cleaned = this.cleanupExpired();
      if (cleaned > 0) {
        logger.debug('Cleaned up expired leases', { count: cleaned });
      }
    }, intervalMs);
  }
}
