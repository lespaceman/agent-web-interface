/**
 * Multi-Tenant Configuration
 *
 * Parses and validates environment variables for multi-tenant mode.
 */

import { randomUUID } from 'crypto';
import { DEFAULT_WORKER_CONFIG, type WorkerManagerConfig } from './types.js';

/**
 * Multi-tenant mode configuration
 */
export interface MultiTenantConfig {
  /** Whether multi-tenant mode is enabled */
  enabled: boolean;
  /** Tenant identifier (required when enabled) */
  tenantId: string;
  /** Controller/session identifier (auto-generated if not provided) */
  controllerId: string;
  /** WorkerManager configuration */
  workerConfig: WorkerManagerConfig;
}

/**
 * Parse integer from environment variable with default
 */
function parseIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse and validate multi-tenant configuration from environment variables.
 *
 * Environment variables:
 * - MULTI_TENANT_MODE: Enable multi-tenant mode (true/false)
 * - TENANT_ID: Unique tenant identifier (required when enabled)
 * - CONTROLLER_ID: Session/controller ID (auto-generated if not provided)
 * - WORKER_PROFILE_DIR: Base directory for Chrome profiles (default: /tmp/athena-workers)
 * - WORKER_IDLE_TIMEOUT_MS: Idle worker timeout (default: 300000 = 5 min)
 * - WORKER_HARD_TTL_MS: Max worker runtime (default: 7200000 = 2 hrs)
 * - WORKER_LEASE_TTL_MS: Lease TTL (default: 300000 = 5 min)
 * - WORKER_HEALTH_CHECK_INTERVAL_MS: Health check interval (default: 30000 = 30 sec)
 * - WORKER_PORT_MIN: Minimum CDP port (default: 9300)
 * - WORKER_PORT_MAX: Maximum CDP port (default: 9399)
 * - WORKER_MAX_COUNT: Maximum concurrent workers (default: 100)
 * - CHROME_PATH: Path to Chrome executable (auto-detected if not set)
 *
 * @returns Multi-tenant configuration
 * @throws Error if MULTI_TENANT_MODE is true but TENANT_ID is not provided
 */
export function getMultiTenantConfig(): MultiTenantConfig {
  const enabled = process.env.MULTI_TENANT_MODE === 'true';

  if (!enabled) {
    return {
      enabled: false,
      tenantId: '',
      controllerId: '',
      workerConfig: {
        profileBaseDir: '/tmp/athena-workers',
        ...DEFAULT_WORKER_CONFIG,
      },
    };
  }

  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'TENANT_ID environment variable is required when MULTI_TENANT_MODE is enabled'
    );
  }

  const controllerId = process.env.CONTROLLER_ID ?? `ctrl-${randomUUID().substring(0, 8)}`;
  const profileBaseDir = process.env.WORKER_PROFILE_DIR ?? '/tmp/athena-workers';

  const workerConfig: WorkerManagerConfig = {
    profileBaseDir,
    idleTimeoutMs: parseIntEnv('WORKER_IDLE_TIMEOUT_MS', DEFAULT_WORKER_CONFIG.idleTimeoutMs),
    hardTtlMs: parseIntEnv('WORKER_HARD_TTL_MS', DEFAULT_WORKER_CONFIG.hardTtlMs),
    leaseTtlMs: parseIntEnv('WORKER_LEASE_TTL_MS', DEFAULT_WORKER_CONFIG.leaseTtlMs),
    healthCheckIntervalMs: parseIntEnv(
      'WORKER_HEALTH_CHECK_INTERVAL_MS',
      DEFAULT_WORKER_CONFIG.healthCheckIntervalMs
    ),
    portRange: {
      min: parseIntEnv('WORKER_PORT_MIN', DEFAULT_WORKER_CONFIG.portRange.min),
      max: parseIntEnv('WORKER_PORT_MAX', DEFAULT_WORKER_CONFIG.portRange.max),
    },
    maxWorkers: parseIntEnv('WORKER_MAX_COUNT', DEFAULT_WORKER_CONFIG.maxWorkers),
    chromePath: process.env.CHROME_PATH,
  };

  return {
    enabled,
    tenantId,
    controllerId,
    workerConfig,
  };
}

/**
 * Validate that multi-tenant config is properly set up.
 * Logs warnings for common misconfigurations.
 */
export function validateMultiTenantConfig(config: MultiTenantConfig): void {
  if (!config.enabled) return;

  // Check port range validity
  if (config.workerConfig.portRange.min > config.workerConfig.portRange.max) {
    throw new Error(
      `Invalid port range: WORKER_PORT_MIN (${config.workerConfig.portRange.min}) > WORKER_PORT_MAX (${config.workerConfig.portRange.max})`
    );
  }

  // Check maxWorkers fits in port range
  const portCapacity =
    config.workerConfig.portRange.max - config.workerConfig.portRange.min + 1;
  if (config.workerConfig.maxWorkers > portCapacity) {
    console.warn(
      `[WARN] WORKER_MAX_COUNT (${config.workerConfig.maxWorkers}) exceeds port range capacity (${portCapacity}). Effective limit will be ${portCapacity}.`
    );
  }
}
