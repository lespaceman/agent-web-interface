/**
 * HealthMonitor Unit Tests
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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { HealthMonitor } from '../../../src/worker/health-monitor.js';

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    monitor = new HealthMonitor(1000, { timeoutMs: 100, failureThreshold: 2 });
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create monitor with default config', () => {
      const defaultMonitor = new HealthMonitor();
      expect(defaultMonitor.isRunning).toBe(false);
      expect(defaultMonitor.workerCount).toBe(0);
    });

    it('should create monitor with custom config', () => {
      const customMonitor = new HealthMonitor(5000, { timeoutMs: 2000 });
      expect(customMonitor.isRunning).toBe(false);
    });
  });

  describe('registerWorker', () => {
    it('should register a worker', () => {
      monitor.registerWorker('w-123', 9300);
      expect(monitor.isWorkerRegistered('w-123')).toBe(true);
      expect(monitor.workerCount).toBe(1);
    });

    it('should handle duplicate registration', () => {
      monitor.registerWorker('w-123', 9300);
      monitor.registerWorker('w-123', 9300); // Should not throw
      expect(monitor.workerCount).toBe(1);
    });

    it('should register multiple workers', () => {
      monitor.registerWorker('w-1', 9300);
      monitor.registerWorker('w-2', 9301);
      monitor.registerWorker('w-3', 9302);
      expect(monitor.workerCount).toBe(3);
    });
  });

  describe('unregisterWorker', () => {
    it('should unregister a worker', () => {
      monitor.registerWorker('w-123', 9300);
      const removed = monitor.unregisterWorker('w-123');
      expect(removed).toBe(true);
      expect(monitor.isWorkerRegistered('w-123')).toBe(false);
      expect(monitor.workerCount).toBe(0);
    });

    it('should return false for non-existent worker', () => {
      const removed = monitor.unregisterWorker('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('getWorkerHealth', () => {
    it('should return health state for registered worker', () => {
      monitor.registerWorker('w-123', 9300);
      const health = monitor.getWorkerHealth('w-123');

      expect(health).toBeDefined();
      expect(health?.workerId).toBe('w-123');
      expect(health?.port).toBe(9300);
      expect(health?.healthy).toBe(true); // Initially healthy
    });

    it('should return undefined for non-existent worker', () => {
      const health = monitor.getWorkerHealth('non-existent');
      expect(health).toBeUndefined();
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy result on successful response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            Browser: 'Chrome/120.0.0.0',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9300/devtools/browser/abc',
          }),
      });

      const result = await monitor.performHealthCheck(9300);

      expect(result.healthy).toBe(true);
      expect(result.responseTimeMs).toBeDefined();
      expect(result.versionInfo?.Browser).toBe('Chrome/120.0.0.0');
    });

    it('should return unhealthy result on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await monitor.performHealthCheck(9300);

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should return unhealthy result on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await monitor.performHealthCheck(9300);

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should return unhealthy result on timeout', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'TimeoutError';
      mockFetch.mockRejectedValueOnce(timeoutError);

      const result = await monitor.performHealthCheck(9300);

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Timeout');
    });
  });

  describe('start/stop', () => {
    it('should start periodic monitoring', async () => {
      monitor.registerWorker('w-123', 9300);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' }),
      });

      monitor.start();
      expect(monitor.isRunning).toBe(true);

      // Initial check happens immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance to trigger another check
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should stop periodic monitoring', async () => {
      monitor.registerWorker('w-123', 9300);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' }),
      });

      monitor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      monitor.stop();
      expect(monitor.isRunning).toBe(false);

      // No more checks should happen
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent', () => {
      monitor.start();
      monitor.start(); // Should not throw
      expect(monitor.isRunning).toBe(true);

      monitor.stop();
      monitor.stop(); // Should not throw
      expect(monitor.isRunning).toBe(false);
    });
  });

  describe('health state changes', () => {
    it('should emit healthChange event when worker becomes unhealthy', async () => {
      monitor.registerWorker('w-123', 9300);

      const healthChanges: { workerId: string; healthy: boolean }[] = [];
      monitor.on('healthChange', (data: { workerId: string; healthy: boolean }) => {
        healthChanges.push({ workerId: data.workerId, healthy: data.healthy });
      });

      // First failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      await monitor.checkWorkerById('w-123');

      // Still healthy (threshold is 2)
      expect(healthChanges).toHaveLength(0);
      expect(monitor.getWorkerHealth('w-123')?.healthy).toBe(true);

      // Second failure - should trigger unhealthy
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      await monitor.checkWorkerById('w-123');

      expect(healthChanges).toHaveLength(1);
      expect(healthChanges[0]).toEqual({ workerId: 'w-123', healthy: false });
      expect(monitor.getWorkerHealth('w-123')?.healthy).toBe(false);
    });

    it('should emit healthChange event when worker becomes healthy', async () => {
      monitor.registerWorker('w-123', 9300);

      // Make worker unhealthy first
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await monitor.checkWorkerById('w-123');
      await monitor.checkWorkerById('w-123');
      expect(monitor.getWorkerHealth('w-123')?.healthy).toBe(false);

      const healthChanges: { workerId: string; healthy: boolean }[] = [];
      monitor.on('healthChange', (data: { workerId: string; healthy: boolean }) => {
        healthChanges.push({ workerId: data.workerId, healthy: data.healthy });
      });

      // Worker comes back
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' }),
      });
      await monitor.checkWorkerById('w-123');

      expect(healthChanges).toHaveLength(1);
      expect(healthChanges[0]).toEqual({ workerId: 'w-123', healthy: true });
    });

    it('should reset consecutive failures on successful check', async () => {
      monitor.registerWorker('w-123', 9300);

      // One failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      await monitor.checkWorkerById('w-123');
      expect(monitor.getWorkerHealth('w-123')?.consecutiveFailures).toBe(1);

      // Success resets the counter
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' }),
      });
      await monitor.checkWorkerById('w-123');
      expect(monitor.getWorkerHealth('w-123')?.consecutiveFailures).toBe(0);
    });
  });

  describe('checkWorkerById', () => {
    it('should return error for non-registered worker', async () => {
      const result = await monitor.checkWorkerById('non-existent');

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('not registered');
    });
  });

  describe('getUnhealthyWorkers', () => {
    it('should return empty array when all workers are healthy', () => {
      monitor.registerWorker('w-1', 9300);
      monitor.registerWorker('w-2', 9301);

      expect(monitor.getUnhealthyWorkers()).toEqual([]);
    });

    it('should return list of unhealthy workers', async () => {
      monitor.registerWorker('w-1', 9300);
      monitor.registerWorker('w-2', 9301);

      // Make w-1 unhealthy
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await monitor.checkWorkerById('w-1');
      await monitor.checkWorkerById('w-1'); // Second failure triggers unhealthy

      const unhealthy = monitor.getUnhealthyWorkers();
      expect(unhealthy).toContain('w-1');
      expect(unhealthy).not.toContain('w-2');
    });
  });

  describe('resetWorkerHealth', () => {
    it('should reset health state', async () => {
      monitor.registerWorker('w-123', 9300);

      // Make unhealthy
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      await monitor.checkWorkerById('w-123');
      await monitor.checkWorkerById('w-123');
      expect(monitor.getWorkerHealth('w-123')?.healthy).toBe(false);

      // Reset
      monitor.resetWorkerHealth('w-123');

      const health = monitor.getWorkerHealth('w-123');
      expect(health?.healthy).toBe(true);
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.lastCheck).toBeUndefined();
    });

    it('should handle non-existent worker gracefully', () => {
      // Should not throw
      monitor.resetWorkerHealth('non-existent');
    });
  });

  describe('clear', () => {
    it('should remove all registered workers', () => {
      monitor.registerWorker('w-1', 9300);
      monitor.registerWorker('w-2', 9301);
      expect(monitor.workerCount).toBe(2);

      monitor.clear();

      expect(monitor.workerCount).toBe(0);
    });
  });

  describe('checkAllWorkers', () => {
    it('should check all registered workers', async () => {
      monitor.registerWorker('w-1', 9300);
      monitor.registerWorker('w-2', 9301);
      monitor.registerWorker('w-3', 9302);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ Browser: 'Chrome' }),
      });

      await monitor.checkAllWorkers();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9300/json/version',
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9301/json/version',
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9302/json/version',
        expect.any(Object)
      );
    });
  });
});
