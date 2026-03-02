/**
 * Worker Manager
 *
 * Main orchestrator for managing tenant-bound Chrome workers with exclusive
 * lease-based access control. Coordinates worker lifecycle, health monitoring,
 * and lease management.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type {
  WorkerManagerConfig,
  WorkerDescriptor,
  LeaseAcquisitionResult,
  WorkerManagerEvents,
} from './types.js';
import { PortAllocator } from './port-allocator.js';
import { ChromeWorkerProcess } from './chrome-worker-process.js';
import { HealthMonitor } from './health-monitor.js';
import { LeaseManager } from './lease-manager.js';
import { WorkerError } from './errors/index.js';
import { createLogger } from '../shared/services/logging.service.js';

const logger = createLogger('WorkerManager');

/**
 * Type-safe EventEmitter for WorkerManager
 */
interface WorkerManagerEmitter {
  on<K extends keyof WorkerManagerEvents>(
    event: K,
    listener: (data: WorkerManagerEvents[K]) => void
  ): this;
  once<K extends keyof WorkerManagerEvents>(
    event: K,
    listener: (data: WorkerManagerEvents[K]) => void
  ): this;
  emit<K extends keyof WorkerManagerEvents>(event: K, data: WorkerManagerEvents[K]): boolean;
  off<K extends keyof WorkerManagerEvents>(
    event: K,
    listener: (data: WorkerManagerEvents[K]) => void
  ): this;
  removeAllListeners<K extends keyof WorkerManagerEvents>(event?: K): this;
}

/**
 * Internal worker tracking
 */
interface WorkerEntry {
  descriptor: WorkerDescriptor;
  process: ChromeWorkerProcess;
  tenantId: string;
  idleTimerId?: ReturnType<typeof setTimeout>;
  hardTtlTimerId?: ReturnType<typeof setTimeout>;
}

/**
 * Manages tenant-bound Chrome workers with exclusive lease-based access.
 *
 * @example
 * ```typescript
 * const manager = new WorkerManager({
 *   profileBaseDir: '/var/lib/athena/profiles',
 *   idleTimeoutMs: 300000,
 *   hardTtlMs: 7200000,
 *   leaseTtlMs: 300000,
 *   healthCheckIntervalMs: 30000,
 *   portRange: { min: 9300, max: 9399 },
 *   maxWorkers: 100,
 * });
 *
 * // Acquire a worker for a tenant
 * const result = await manager.acquireForTenant('tenant-a', 'controller-1');
 * if (result.success) {
 *   console.log(`CDP endpoint: ${result.cdpEndpoint}`);
 * }
 *
 * // Release when done
 * manager.releaseLease('tenant-a');
 *
 * // Shutdown all workers
 * await manager.shutdown();
 * ```
 */
export class WorkerManager extends EventEmitter implements WorkerManagerEmitter {
  private readonly config: WorkerManagerConfig;
  private readonly portAllocator: PortAllocator;
  private readonly healthMonitor: HealthMonitor;
  private readonly leaseManager: LeaseManager;

  /** Worker entries by worker ID */
  private readonly workers = new Map<string, WorkerEntry>();
  /** Tenant to worker ID mapping */
  private readonly tenantToWorker = new Map<string, string>();

  private _isShuttingDown = false;

  constructor(config: WorkerManagerConfig) {
    super();

    this.config = config;

    // Initialize sub-components
    this.portAllocator = new PortAllocator({
      min: config.portRange.min,
      max: config.portRange.max,
    });

    this.healthMonitor = new HealthMonitor(config.healthCheckIntervalMs, {
      timeoutMs: 5000,
      failureThreshold: 3,
    });

    this.leaseManager = new LeaseManager({
      defaultTtlMs: config.leaseTtlMs,
      cleanupIntervalMs: Math.min(config.leaseTtlMs / 2, 60000),
    });

    // Set up event handlers
    this.setupEventHandlers();

    // Start health monitoring
    this.healthMonitor.start();

    logger.info('WorkerManager initialized', {
      profileBaseDir: config.profileBaseDir,
      portRange: config.portRange,
      maxWorkers: config.maxWorkers,
    });
  }

  /**
   * Get current worker count
   */
  get workerCount(): number {
    return this.workers.size;
  }

  /**
   * Get current lease count
   */
  get leaseCount(): number {
    return this.leaseManager.leaseCount;
  }

  /**
   * Check if shutdown is in progress
   */
  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /**
   * Acquire a worker for a tenant.
   * Creates a new worker if one doesn't exist for the tenant.
   *
   * @param tenantId - Tenant identifier
   * @param controllerId - Controller/session identifier
   * @param ttlMs - Optional custom lease TTL
   * @returns Lease acquisition result with CDP endpoint
   */
  async acquireForTenant(
    tenantId: string,
    controllerId: string,
    ttlMs?: number
  ): Promise<LeaseAcquisitionResult> {
    if (this._isShuttingDown) {
      return {
        success: false,
        error: 'WorkerManager is shutting down',
        errorCode: 'OPERATION_FAILED',
      };
    }

    // Check if tenant already has a worker
    const workerId = this.tenantToWorker.get(tenantId);

    if (workerId) {
      const entry = this.workers.get(workerId);

      if (entry?.descriptor.state === 'running') {
        // Try to acquire lease on existing worker
        const leaseResult = this.leaseManager.acquire(tenantId, controllerId, workerId, ttlMs);

        if (leaseResult.success) {
          this.resetIdleTimer(entry);

          this.emit('leaseAcquired', {
            leaseId: leaseResult.lease!.leaseId,
            tenantId,
            controllerId,
          });

          return {
            ...leaseResult,
            cdpEndpoint: entry.descriptor.cdpEndpoint,
          };
        }

        return leaseResult;
      }

      // Worker exists but not running - clean it up
      await this.cleanupWorker(workerId, 'not running');
    }

    // Create new worker for tenant
    try {
      const newWorkerId = await this.createWorker(tenantId);

      // Acquire lease on new worker
      const leaseResult = this.leaseManager.acquire(tenantId, controllerId, newWorkerId, ttlMs);

      if (leaseResult.success) {
        const entry = this.workers.get(newWorkerId)!;

        this.emit('leaseAcquired', {
          leaseId: leaseResult.lease!.leaseId,
          tenantId,
          controllerId,
        });

        return {
          ...leaseResult,
          cdpEndpoint: entry.descriptor.cdpEndpoint,
        };
      }

      return leaseResult;
    } catch (error) {
      const workerError =
        error instanceof WorkerError
          ? error
          : WorkerError.operationFailed('acquire worker', error as Error);

      return {
        success: false,
        error: workerError.message,
        errorCode: workerError.code,
      };
    }
  }

  /**
   * Release a tenant's lease.
   *
   * @param tenantId - Tenant identifier
   * @param controllerId - Optional controller ID to validate ownership
   * @returns true if lease was released
   */
  releaseLease(tenantId: string, controllerId?: string): boolean {
    const lease = this.leaseManager.getLease(tenantId);
    const released = this.leaseManager.release(tenantId, controllerId);

    if (released && lease) {
      this.emit('leaseReleased', {
        leaseId: lease.leaseId,
        tenantId,
      });

      // Start idle timer for the worker
      const workerId = this.tenantToWorker.get(tenantId);
      if (workerId) {
        const entry = this.workers.get(workerId);
        if (entry) {
          this.startIdleTimer(entry);
        }
      }
    }

    return released;
  }

  /**
   * Refresh a tenant's lease.
   *
   * @param tenantId - Tenant identifier
   * @param ttlMs - Optional new TTL
   * @returns true if lease was refreshed
   */
  refreshLease(tenantId: string, ttlMs?: number): boolean {
    try {
      const refreshed = this.leaseManager.refresh(tenantId, ttlMs);

      if (refreshed) {
        // Reset idle timer
        const workerId = this.tenantToWorker.get(tenantId);
        if (workerId) {
          const entry = this.workers.get(workerId);
          if (entry) {
            this.resetIdleTimer(entry);
          }
        }
      }

      return refreshed;
    } catch {
      return false;
    }
  }

  /**
   * Get the CDP endpoint for a tenant's worker.
   *
   * @param tenantId - Tenant identifier
   * @returns CDP endpoint URL or undefined if no active worker
   */
  getCdpEndpoint(tenantId: string): string | undefined {
    const workerId = this.tenantToWorker.get(tenantId);
    if (!workerId) return undefined;

    const entry = this.workers.get(workerId);
    return entry?.descriptor.cdpEndpoint;
  }

  /**
   * Check if a tenant has an active lease.
   */
  hasActiveLease(tenantId: string): boolean {
    return this.leaseManager.hasLease(tenantId);
  }

  /**
   * Check if a specific controller holds the lease for a tenant.
   */
  isLeaseHeldBy(tenantId: string, controllerId: string): boolean {
    return this.leaseManager.isLeaseHeldBy(tenantId, controllerId);
  }

  /**
   * Get worker descriptor for a tenant.
   */
  getWorkerForTenant(tenantId: string): WorkerDescriptor | undefined {
    const workerId = this.tenantToWorker.get(tenantId);
    if (!workerId) return undefined;

    return this.workers.get(workerId)?.descriptor;
  }

  /**
   * Stop a specific worker.
   *
   * @param tenantId - Tenant identifier
   * @param reason - Reason for stopping
   */
  async stopWorker(tenantId: string, reason: string): Promise<void> {
    const workerId = this.tenantToWorker.get(tenantId);
    if (!workerId) return;

    await this.cleanupWorker(workerId, reason);
  }

  /**
   * Shutdown the WorkerManager and all workers.
   */
  async shutdown(): Promise<void> {
    if (this._isShuttingDown) return;

    this._isShuttingDown = true;
    logger.info('WorkerManager shutting down');

    // Stop health monitoring
    this.healthMonitor.stop();

    // Stop lease cleanup
    this.leaseManager.stop();

    // Stop all workers
    const stopPromises = Array.from(this.workers.keys()).map((workerId) =>
      this.cleanupWorker(workerId, 'shutdown')
    );

    await Promise.all(stopPromises);

    logger.info('WorkerManager shutdown complete');
  }

  /**
   * Create a new worker for a tenant.
   */
  private async createWorker(tenantId: string): Promise<string> {
    // Check worker limit
    if (this.workers.size >= this.config.maxWorkers) {
      throw WorkerError.maxWorkersReached(this.config.maxWorkers, this.workers.size);
    }

    // Allocate port
    const port = await this.portAllocator.allocateVerified();

    const workerId = `w-${randomUUID().slice(0, 8)}`;
    const profileDir = join(this.config.profileBaseDir, tenantId);

    logger.info('Creating worker', { workerId, tenantId, port, profileDir });

    // Create worker descriptor
    const now = Date.now();
    const descriptor: WorkerDescriptor = {
      workerId,
      tenantId,
      state: 'starting',
      port,
      profileDir,
      createdAt: now,
      lastUsedAt: now,
    };

    // Create Chrome process
    const process = new ChromeWorkerProcess({
      workerId,
      port,
      profileDir,
      chromePath: this.config.chromePath,
    });

    // Create entry
    const entry: WorkerEntry = {
      descriptor,
      process,
      tenantId,
    };

    this.workers.set(workerId, entry);
    this.tenantToWorker.set(tenantId, workerId);

    // Set up process event handlers
    this.setupWorkerProcessHandlers(entry);

    try {
      // Start the process
      await process.start();

      // Update descriptor
      descriptor.state = 'running';
      descriptor.pid = process.pid;
      descriptor.cdpEndpoint = process.cdpEndpoint;
      descriptor.startedAt = Date.now();

      // Register with health monitor
      this.healthMonitor.registerWorker(workerId, port);

      // Start hard TTL timer
      this.startHardTtlTimer(entry);

      this.emit('workerCreated', { workerId, tenantId });
      this.emit('workerStarted', {
        workerId,
        tenantId,
        cdpEndpoint: descriptor.cdpEndpoint!,
      });

      logger.info('Worker started', {
        workerId,
        tenantId,
        pid: descriptor.pid,
        cdpEndpoint: descriptor.cdpEndpoint,
      });

      return workerId;
    } catch (error) {
      // Clean up on failure
      this.workers.delete(workerId);
      this.tenantToWorker.delete(tenantId);
      this.portAllocator.release(port);

      throw error;
    }
  }

  /**
   * Clean up a worker.
   */
  private async cleanupWorker(workerId: string, reason: string): Promise<void> {
    const entry = this.workers.get(workerId);
    if (!entry) return;

    logger.info('Cleaning up worker', { workerId, tenantId: entry.tenantId, reason });

    // Clear timers
    if (entry.idleTimerId) {
      clearTimeout(entry.idleTimerId);
    }
    if (entry.hardTtlTimerId) {
      clearTimeout(entry.hardTtlTimerId);
    }

    // Revoke any lease
    this.leaseManager.revoke(entry.tenantId, reason);

    // Unregister from health monitor
    this.healthMonitor.unregisterWorker(workerId);

    // Stop the process
    try {
      await entry.process.stop();
    } catch (error) {
      logger.warning('Error stopping worker process', { workerId, error });
      entry.process.kill();
    }

    // Release port
    this.portAllocator.release(entry.descriptor.port);

    // Remove from maps
    this.workers.delete(workerId);
    this.tenantToWorker.delete(entry.tenantId);

    entry.descriptor.state = 'stopped';

    this.emit('workerStopped', {
      workerId,
      tenantId: entry.tenantId,
      reason,
    });
  }

  /**
   * Set up event handlers for sub-components.
   */
  private setupEventHandlers(): void {
    // Health monitor events
    this.healthMonitor.on(
      'healthChange',
      ({ workerId, healthy }: { workerId: string; healthy: boolean }) => {
        if (!healthy) {
          const entry = this.workers.get(workerId);
          if (entry) {
            logger.warning('Worker became unhealthy', { workerId, tenantId: entry.tenantId });
            // Could trigger restart here if needed
          }
        }
      }
    );

    // Lease expiration events
    this.leaseManager.onLeaseExpired((lease) => {
      this.emit('leaseExpired', {
        leaseId: lease.leaseId,
        tenantId: lease.tenantId,
      });

      // Start idle timer for the worker
      const entry = this.workers.get(lease.workerId);
      if (entry) {
        this.startIdleTimer(entry);
      }
    });

    // Lease revocation events
    this.leaseManager.onLeaseRevoked((lease, reason) => {
      this.emit('leaseRevoked', {
        leaseId: lease.leaseId,
        tenantId: lease.tenantId,
        reason,
      });
    });
  }

  /**
   * Set up event handlers for a worker process.
   */
  private setupWorkerProcessHandlers(entry: WorkerEntry): void {
    const { process, descriptor } = entry;

    process.on(
      'exit',
      ({ code, signal }: { code: number | null; signal: string | null }) => {
        // Only handle if not already cleaned up
        if (!this.workers.has(descriptor.workerId)) return;

        descriptor.state = 'crashed';

        this.emit('workerCrashed', {
          workerId: descriptor.workerId,
          tenantId: entry.tenantId,
          exitCode: code,
        });

        // Revoke lease on crash
        this.leaseManager.revoke(
          entry.tenantId,
          `worker crashed (exit: ${code}, signal: ${signal})`
        );

        // Clean up
        void this.cleanupWorker(descriptor.workerId, 'crashed');
      }
    );

    process.on('error', ({ error }: { error: Error }) => {
      logger.error('Worker process error', error, {
        workerId: descriptor.workerId,
      });
    });
  }

  /**
   * Start idle timer for a worker.
   */
  private startIdleTimer(entry: WorkerEntry): void {
    // Clear existing timer
    if (entry.idleTimerId) {
      clearTimeout(entry.idleTimerId);
    }

    entry.idleTimerId = setTimeout(() => {
      logger.info('Worker idle timeout reached', {
        workerId: entry.descriptor.workerId,
        tenantId: entry.tenantId,
      });
      void this.cleanupWorker(entry.descriptor.workerId, 'idle timeout');
    }, this.config.idleTimeoutMs);
  }

  /**
   * Reset idle timer (on activity).
   */
  private resetIdleTimer(entry: WorkerEntry): void {
    if (entry.idleTimerId) {
      clearTimeout(entry.idleTimerId);
      entry.idleTimerId = undefined;
    }
    entry.descriptor.lastUsedAt = Date.now();
  }

  /**
   * Start hard TTL timer for a worker.
   */
  private startHardTtlTimer(entry: WorkerEntry): void {
    entry.hardTtlTimerId = setTimeout(() => {
      logger.info('Worker hard TTL reached', {
        workerId: entry.descriptor.workerId,
        tenantId: entry.tenantId,
      });
      void this.cleanupWorker(entry.descriptor.workerId, 'hard TTL');
    }, this.config.hardTtlMs);
  }
}
