/**
 * WorkerManager Unit Tests
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function, @typescript-eslint/no-unsafe-return */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LeaseDescriptor, WorkerManagerConfig } from '../../../src/worker/types.js';

// ============================================================
// Mock storage on globalThis - set up before mocks are hoisted
(globalThis as any).__wmMocks = {
  portAllocator: null,
  healthMonitor: null,
  leaseManager: null,
  chromeProcesses: new Map(),
  leaseCallbacks: { expired: [], revoked: [] },
};
// ============================================================

// ============================================================
// Constructor mocks (hoisted, read from globalThis storage)
// ============================================================

// Mock logging service
vi.mock('../../../src/shared/services/logging.service.js', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    warning: () => {},
    error: () => {},
  }),
}));

// Mock PortAllocator
vi.mock('../../../src/worker/port-allocator.js', () => ({
  PortAllocator: function () {
    const storage = (globalThis as any).__wmMocks;
    Object.assign(this, storage.portAllocator);
    return this;
  },
}));

// Mock HealthMonitor - needs EventEmitter inheritance
vi.mock('../../../src/worker/health-monitor.js', async () => {
  const { EventEmitter } = await import('events');
  class MockHealthMonitor extends EventEmitter {
    constructor() {
      super();
      const storage = (globalThis as any).__wmMocks;
      Object.assign(this, storage.healthMonitor);
    }
  }
  return { HealthMonitor: MockHealthMonitor };
});

// Mock LeaseManager
vi.mock('../../../src/worker/lease-manager.js', () => ({
  LeaseManager: function () {
    const storage = (globalThis as any).__wmMocks;
    Object.assign(this, storage.leaseManager);
    return this;
  },
}));

// Mock ChromeWorkerProcess - needs EventEmitter inheritance
vi.mock('../../../src/worker/chrome-worker-process.js', async () => {
  const { EventEmitter } = await import('events');
  const { vi } = await import('vitest');

  class MockChromeWorkerProcess extends EventEmitter {
    workerId: any;
    port: any;
    profileDir: any;
    pid: any;
    cdpEndpoint: any;
    start: any;
    stop: any;
    kill: any;

    constructor(config: any) {
      super();
      const storage = (globalThis as any).__wmMocks;

      this.workerId = config.workerId;
      this.port = config.port;
      this.profileDir = config.profileDir;
      this.start = vi.fn(() => {
        this.pid = 12345;
        this.cdpEndpoint = `http://127.0.0.1:${config.port}`;
        return Promise.resolve();
      });
      this.stop = vi.fn();
      this.kill = vi.fn();

      storage.chromeProcesses.set(config.workerId, this);
    }
  }

  return { ChromeWorkerProcess: MockChromeWorkerProcess };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  rm: () => Promise.resolve(undefined),
}));

import { WorkerManager } from '../../../src/worker/worker-manager.js';

// Local reference to the globalThis mock storage for easier access in tests
const mockStorage = (globalThis as any).__wmMocks;

/**
 * Create fresh mock instances for each test
 */
function createFreshMocks(): void {
  mockStorage.leaseCallbacks = {
    expired: [],
    revoked: [],
  };

  mockStorage.chromeProcesses = new Map();

  mockStorage.portAllocator = {
    allocateVerified: vi.fn().mockResolvedValue(9300),
    release: vi.fn(),
    allocatedCount: 0,
    capacity: 100,
  };

  mockStorage.healthMonitor = {
    start: vi.fn(),
    stop: vi.fn(),
    registerWorker: vi.fn(),
    unregisterWorker: vi.fn(),
  };

  mockStorage.leaseManager = {
    acquire: vi.fn().mockReturnValue({
      success: true,
      lease: {
        leaseId: 'lease-1',
        tenantId: 'tenant-a',
        workerId: 'w-123',
        controllerId: 'controller-1',
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 300000,
        status: 'active',
      },
      workerId: 'w-123',
    }),
    release: vi.fn().mockReturnValue(true),
    refresh: vi.fn().mockReturnValue(true),
    revoke: vi.fn(),
    hasLease: vi.fn().mockReturnValue(false),
    getLease: vi.fn().mockReturnValue(undefined),
    isLeaseHeldBy: vi.fn().mockReturnValue(false),
    stop: vi.fn(),
    leaseCount: 0,
    onLeaseExpired: vi.fn((cb: (lease: LeaseDescriptor) => void) =>
      mockStorage.leaseCallbacks.expired.push(cb)
    ),
    onLeaseRevoked: vi.fn((cb: (lease: LeaseDescriptor, reason: string) => void) =>
      mockStorage.leaseCallbacks.revoked.push(cb)
    ),
  };
}

describe('WorkerManager', () => {
  let manager: WorkerManager | undefined;
  let config: WorkerManagerConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    createFreshMocks();

    config = {
      profileBaseDir: '/tmp/profiles',
      idleTimeoutMs: 300000,
      hardTtlMs: 7200000,
      leaseTtlMs: 300000,
      healthCheckIntervalMs: 30000,
      portRange: { min: 9300, max: 9399 },
      maxWorkers: 10,
    };

    manager = new WorkerManager(config);
  });

  afterEach(async () => {
    if (manager && !manager.isShuttingDown) {
      await manager.shutdown();
    }
    manager = undefined;
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(manager!.workerCount).toBe(0);
      expect(manager!.isShuttingDown).toBe(false);
    });

    it('should start health monitoring', () => {
      expect(mockStorage.healthMonitor!.start).toHaveBeenCalled();
    });
  });

  describe('acquireForTenant', () => {
    it('should create a new worker for a tenant', async () => {
      const result = await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(result.success).toBe(true);
      expect(result.cdpEndpoint).toBe('http://127.0.0.1:9300');
      expect(manager!.workerCount).toBe(1);
    });

    it('should register worker with health monitor', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(mockStorage.healthMonitor!.registerWorker).toHaveBeenCalledWith(
        expect.stringMatching(/^w-/),
        9300
      );
    });

    it('should return existing worker for same tenant', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      // Second acquisition should not create new worker
      mockStorage.portAllocator!.allocateVerified.mockClear();

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(mockStorage.portAllocator!.allocateVerified).not.toHaveBeenCalled();
    });

    it('should reject when lease is held by different controller', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      // Simulate lease already held
      mockStorage.leaseManager!.acquire.mockReturnValue({
        success: false,
        error: 'Lease is held by another controller',
        errorCode: 'LEASE_ALREADY_HELD',
      });

      const result = await manager!.acquireForTenant('tenant-a', 'controller-2');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('LEASE_ALREADY_HELD');
    });

    it('should return error when max workers reached', async () => {
      // Create a new manager with max 1 worker
      createFreshMocks();
      const limitedManager = new WorkerManager({ ...config, maxWorkers: 1 });

      await limitedManager.acquireForTenant('tenant-a', 'controller-1');

      const result = await limitedManager.acquireForTenant('tenant-b', 'controller-2');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MAX_WORKERS_REACHED');

      await limitedManager.shutdown();
    });

    it('should return error during shutdown', async () => {
      await manager!.shutdown();

      const result = await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('shutting down');
    });

    it('should emit workerCreated and workerStarted events', async () => {
      const createdEvents: { tenantId: string }[] = [];
      const startedEvents: { cdpEndpoint: string }[] = [];

      manager!.on('workerCreated', (data: { tenantId: string }) => createdEvents.push(data));
      manager!.on('workerStarted', (data: { cdpEndpoint: string }) => startedEvents.push(data));

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(createdEvents).toHaveLength(1);
      expect(createdEvents[0].tenantId).toBe('tenant-a');

      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].cdpEndpoint).toBe('http://127.0.0.1:9300');
    });

    it('should emit leaseAcquired event', async () => {
      const events: { tenantId: string; controllerId: string }[] = [];
      manager!.on('leaseAcquired', (data: { tenantId: string; controllerId: string }) =>
        events.push(data)
      );

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-a');
      expect(events[0].controllerId).toBe('controller-1');
    });
  });

  describe('releaseLease', () => {
    it('should release a lease', async () => {
      mockStorage.leaseManager!.getLease.mockReturnValue({
        leaseId: 'lease-1',
        tenantId: 'tenant-a',
      });

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      const released = manager!.releaseLease('tenant-a');

      expect(released).toBe(true);
      expect(mockStorage.leaseManager!.release).toHaveBeenCalledWith('tenant-a', undefined);
    });

    it('should emit leaseReleased event', async () => {
      mockStorage.leaseManager!.getLease.mockReturnValue({
        leaseId: 'lease-1',
        tenantId: 'tenant-a',
      });

      const events: { tenantId: string }[] = [];
      manager!.on('leaseReleased', (data: { tenantId: string }) => events.push(data));

      await manager!.acquireForTenant('tenant-a', 'controller-1');
      manager!.releaseLease('tenant-a');

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-a');
    });

    it('should return false for non-existent lease', () => {
      mockStorage.leaseManager!.release.mockReturnValue(false);

      const released = manager!.releaseLease('non-existent');

      expect(released).toBe(false);
    });
  });

  describe('refreshLease', () => {
    it('should refresh an active lease', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      const refreshed = manager!.refreshLease('tenant-a');

      expect(refreshed).toBe(true);
      expect(mockStorage.leaseManager!.refresh).toHaveBeenCalledWith('tenant-a', undefined);
    });

    it('should return false when refresh fails', () => {
      mockStorage.leaseManager!.refresh.mockImplementation(() => {
        throw new Error('Lease not found');
      });

      const refreshed = manager!.refreshLease('tenant-a');

      expect(refreshed).toBe(false);
    });
  });

  describe('getCdpEndpoint', () => {
    it('should return CDP endpoint for tenant with worker', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      const endpoint = manager!.getCdpEndpoint('tenant-a');

      expect(endpoint).toBe('http://127.0.0.1:9300');
    });

    it('should return undefined for non-existent tenant', () => {
      const endpoint = manager!.getCdpEndpoint('non-existent');
      expect(endpoint).toBeUndefined();
    });
  });

  describe('hasActiveLease', () => {
    it('should delegate to lease manager', () => {
      mockStorage.leaseManager!.hasLease.mockReturnValue(true);

      const hasLease = manager!.hasActiveLease('tenant-a');

      expect(hasLease).toBe(true);
      expect(mockStorage.leaseManager!.hasLease).toHaveBeenCalledWith('tenant-a');
    });
  });

  describe('isLeaseHeldBy', () => {
    it('should delegate to lease manager', () => {
      mockStorage.leaseManager!.isLeaseHeldBy.mockReturnValue(true);

      const isHeld = manager!.isLeaseHeldBy('tenant-a', 'controller-1');

      expect(isHeld).toBe(true);
      expect(mockStorage.leaseManager!.isLeaseHeldBy).toHaveBeenCalledWith(
        'tenant-a',
        'controller-1'
      );
    });
  });

  describe('getWorkerForTenant', () => {
    it('should return worker descriptor', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      const worker = manager!.getWorkerForTenant('tenant-a');

      expect(worker).toBeDefined();
      expect(worker?.tenantId).toBe('tenant-a');
      expect(worker?.state).toBe('running');
    });

    it('should return undefined for non-existent tenant', () => {
      const worker = manager!.getWorkerForTenant('non-existent');
      expect(worker).toBeUndefined();
    });
  });

  describe('stopWorker', () => {
    it('should stop a worker', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      await manager!.stopWorker('tenant-a', 'manual stop');

      expect(manager!.workerCount).toBe(0);
    });

    it('should emit workerStopped event', async () => {
      const events: { reason: string }[] = [];
      manager!.on('workerStopped', (data: { reason: string }) => events.push(data));

      await manager!.acquireForTenant('tenant-a', 'controller-1');
      await manager!.stopWorker('tenant-a', 'manual stop');

      expect(events).toHaveLength(1);
      expect(events[0].reason).toBe('manual stop');
    });

    it('should revoke lease on stop', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');
      await manager!.stopWorker('tenant-a', 'manual stop');

      expect(mockStorage.leaseManager!.revoke).toHaveBeenCalledWith('tenant-a', 'manual stop');
    });

    it('should release port on stop', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');
      await manager!.stopWorker('tenant-a', 'manual stop');

      expect(mockStorage.portAllocator!.release).toHaveBeenCalledWith(9300);
    });
  });

  describe('shutdown', () => {
    it('should stop all workers', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      mockStorage.portAllocator!.allocateVerified.mockResolvedValue(9301);
      await manager!.acquireForTenant('tenant-b', 'controller-2');

      await manager!.shutdown();

      expect(manager!.workerCount).toBe(0);
      expect(manager!.isShuttingDown).toBe(true);
    });

    it('should stop health monitoring', async () => {
      await manager!.shutdown();

      expect(mockStorage.healthMonitor!.stop).toHaveBeenCalled();
    });

    it('should stop lease manager', async () => {
      await manager!.shutdown();

      expect(mockStorage.leaseManager!.stop).toHaveBeenCalled();
    });

    it('should be idempotent', async () => {
      await manager!.shutdown();
      await manager!.shutdown(); // Should not throw
    });
  });

  describe('idle timeout', () => {
    it('should stop worker after idle timeout', async () => {
      mockStorage.leaseManager!.getLease.mockReturnValue({
        leaseId: 'lease-1',
        tenantId: 'tenant-a',
      });

      await manager!.acquireForTenant('tenant-a', 'controller-1');
      manager!.releaseLease('tenant-a');

      // Advance past idle timeout
      await vi.advanceTimersByTimeAsync(config.idleTimeoutMs + 1000);

      expect(manager!.workerCount).toBe(0);
    });
  });

  describe('hard TTL', () => {
    it('should stop worker after hard TTL', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      // Advance past hard TTL
      await vi.advanceTimersByTimeAsync(config.hardTtlMs + 1000);

      expect(manager!.workerCount).toBe(0);
    });
  });

  describe('worker crash handling', () => {
    it('should handle worker crash', async () => {
      const events: { exitCode: number | null }[] = [];
      manager!.on('workerCrashed', (data: { exitCode: number | null }) => events.push(data));

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      // Get the mock process and simulate crash
      const mockProcess: any = Array.from(mockStorage.chromeProcesses.values())[0];
      mockProcess.emit('exit', { code: 1, signal: null });

      // Allow async cleanup
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      expect(events[0].exitCode).toBe(1);
    });

    it('should revoke lease on crash', async () => {
      await manager!.acquireForTenant('tenant-a', 'controller-1');

      const mockProcess: any = Array.from(mockStorage.chromeProcesses.values())[0];
      mockProcess.emit('exit', { code: 1, signal: null });

      await vi.advanceTimersByTimeAsync(0);

      expect(mockStorage.leaseManager!.revoke).toHaveBeenCalledWith(
        'tenant-a',
        expect.stringContaining('crashed')
      );
    });
  });

  describe('lease expiration handling', () => {
    it('should emit leaseExpired event', async () => {
      const events: { tenantId: string }[] = [];
      manager!.on('leaseExpired', (data: { tenantId: string }) => events.push(data));

      await manager!.acquireForTenant('tenant-a', 'controller-1');

      // Trigger lease expiration callback
      const lease = {
        leaseId: 'lease-1',
        tenantId: 'tenant-a',
        workerId: 'w-123',
        controllerId: 'controller-1',
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 300000,
        status: 'active' as const,
      };
      for (const cb of mockStorage.leaseCallbacks.expired) {
        cb(lease);
      }

      expect(events).toHaveLength(1);
      expect(events[0].tenantId).toBe('tenant-a');
    });
  });
});
