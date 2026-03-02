/**
 * Health Monitor
 *
 * Monitors the health of Chrome workers by periodically checking
 * their CDP endpoints via /json/version.
 */

import { EventEmitter } from 'events';
import type { HealthCheckResult, CdpVersionInfo, HealthMonitorEvents } from './types.js';
import { createLogger } from '../shared/services/logging.service.js';

const logger = createLogger('HealthMonitor');

/**
 * Configuration for health checking
 */
export interface HealthCheckConfig {
  /** Timeout for individual health checks (ms) */
  timeoutMs?: number;
  /** Number of consecutive failures before considered unhealthy */
  failureThreshold?: number;
}

/**
 * Default health check configuration
 */
const DEFAULT_HEALTH_CONFIG: Required<HealthCheckConfig> = {
  timeoutMs: 5000,
  failureThreshold: 3,
};

/**
 * Track health state for a worker
 */
interface WorkerHealthState {
  workerId: string;
  port: number;
  healthy: boolean;
  consecutiveFailures: number;
  lastCheck?: HealthCheckResult;
  lastCheckTime?: number;
}

/**
 * Type-safe EventEmitter for HealthMonitor
 */
interface HealthMonitorEmitter {
  on<K extends keyof HealthMonitorEvents>(
    event: K,
    listener: (data: HealthMonitorEvents[K]) => void
  ): this;
  once<K extends keyof HealthMonitorEvents>(
    event: K,
    listener: (data: HealthMonitorEvents[K]) => void
  ): this;
  emit<K extends keyof HealthMonitorEvents>(event: K, data: HealthMonitorEvents[K]): boolean;
  off<K extends keyof HealthMonitorEvents>(
    event: K,
    listener: (data: HealthMonitorEvents[K]) => void
  ): this;
  removeAllListeners<K extends keyof HealthMonitorEvents>(event?: K): this;
}

/**
 * Monitors the health of Chrome workers.
 *
 * @example
 * ```typescript
 * const monitor = new HealthMonitor({ intervalMs: 30000 });
 *
 * monitor.on('healthChange', ({ workerId, healthy, result }) => {
 *   if (!healthy) {
 *     console.log(`Worker ${workerId} became unhealthy: ${result.error}`);
 *   }
 * });
 *
 * monitor.registerWorker('w-123', 9300);
 * monitor.start();
 *
 * // Later...
 * monitor.unregisterWorker('w-123');
 * monitor.stop();
 * ```
 */
export class HealthMonitor extends EventEmitter implements HealthMonitorEmitter {
  private readonly intervalMs: number;
  private readonly config: Required<HealthCheckConfig>;
  private readonly workers = new Map<string, WorkerHealthState>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(intervalMs = 30_000, config: HealthCheckConfig = {}) {
    super();
    this.intervalMs = intervalMs;
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /**
   * Check if the monitor is currently running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the number of registered workers
   */
  get workerCount(): number {
    return this.workers.size;
  }

  /**
   * Register a worker for health monitoring
   *
   * @param workerId - Unique worker identifier
   * @param port - CDP port number
   */
  registerWorker(workerId: string, port: number): void {
    if (this.workers.has(workerId)) {
      logger.warning('Worker already registered for health monitoring', { workerId });
      return;
    }

    this.workers.set(workerId, {
      workerId,
      port,
      healthy: true, // Assume healthy until proven otherwise
      consecutiveFailures: 0,
    });

    logger.debug('Worker registered for health monitoring', { workerId, port });
  }

  /**
   * Unregister a worker from health monitoring
   *
   * @param workerId - Unique worker identifier
   * @returns true if the worker was found and removed
   */
  unregisterWorker(workerId: string): boolean {
    const removed = this.workers.delete(workerId);
    if (removed) {
      logger.debug('Worker unregistered from health monitoring', { workerId });
    }
    return removed;
  }

  /**
   * Check if a worker is registered
   */
  isWorkerRegistered(workerId: string): boolean {
    return this.workers.has(workerId);
  }

  /**
   * Get the current health state of a worker
   */
  getWorkerHealth(workerId: string): WorkerHealthState | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Start periodic health monitoring
   */
  start(): void {
    if (this._isRunning) {
      logger.warning('Health monitor is already running');
      return;
    }

    this._isRunning = true;

    // Run initial check immediately
    void this.checkAllWorkers();

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      void this.checkAllWorkers();
    }, this.intervalMs);

    logger.info('Health monitor started', { intervalMs: this.intervalMs });
  }

  /**
   * Stop periodic health monitoring
   */
  stop(): void {
    if (!this._isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this._isRunning = false;
    logger.info('Health monitor stopped');
  }

  /**
   * Check health of all registered workers
   */
  async checkAllWorkers(): Promise<void> {
    const checks = Array.from(this.workers.values()).map((state) => this.checkWorker(state));
    await Promise.all(checks);
  }

  /**
   * Check health of a specific worker by ID
   *
   * @param workerId - Worker identifier
   * @returns Health check result
   */
  async checkWorkerById(workerId: string): Promise<HealthCheckResult> {
    const state = this.workers.get(workerId);
    if (!state) {
      return {
        healthy: false,
        error: `Worker ${workerId} is not registered`,
      };
    }

    return this.checkWorker(state);
  }

  /**
   * Perform a single health check on a worker
   */
  private async checkWorker(state: WorkerHealthState): Promise<HealthCheckResult> {
    const result = await this.performHealthCheck(state.port);

    state.lastCheck = result;
    state.lastCheckTime = Date.now();

    const wasHealthy = state.healthy;

    if (result.healthy) {
      state.consecutiveFailures = 0;
      state.healthy = true;
    } else {
      state.consecutiveFailures++;

      // Only mark as unhealthy after threshold is reached
      if (state.consecutiveFailures >= this.config.failureThreshold) {
        state.healthy = false;
      }
    }

    // Emit event if health state changed
    if (wasHealthy !== state.healthy) {
      logger.info('Worker health state changed', {
        workerId: state.workerId,
        healthy: state.healthy,
        consecutiveFailures: state.consecutiveFailures,
      });

      this.emit('healthChange', {
        workerId: state.workerId,
        healthy: state.healthy,
        result,
      });
    }

    return result;
  }

  /**
   * Perform a health check against the CDP endpoint
   *
   * @param port - CDP port number
   * @returns Health check result
   */
  async performHealthCheck(port: number): Promise<HealthCheckResult> {
    const url = `http://127.0.0.1:${port}/json/version`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        return {
          healthy: false,
          responseTimeMs: Date.now() - startTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const versionInfo = (await response.json()) as CdpVersionInfo;

      return {
        healthy: true,
        responseTimeMs: Date.now() - startTime,
        versionInfo,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.name === 'TimeoutError'
            ? `Timeout after ${this.config.timeoutMs}ms`
            : error.message
          : String(error);

      return {
        healthy: false,
        responseTimeMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Get all unhealthy workers
   */
  getUnhealthyWorkers(): string[] {
    return Array.from(this.workers.entries())
      .filter(([_, state]) => !state.healthy)
      .map(([workerId]) => workerId);
  }

  /**
   * Reset health state for a worker (e.g., after restart)
   */
  resetWorkerHealth(workerId: string): void {
    const state = this.workers.get(workerId);
    if (state) {
      state.healthy = true;
      state.consecutiveFailures = 0;
      state.lastCheck = undefined;
      state.lastCheckTime = undefined;
    }
  }

  /**
   * Clear all registered workers
   */
  clear(): void {
    this.workers.clear();
  }
}
