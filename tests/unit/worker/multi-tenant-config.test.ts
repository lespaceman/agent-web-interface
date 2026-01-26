/**
 * Multi-Tenant Configuration Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getMultiTenantConfig,
  validateMultiTenantConfig,
} from '../../../src/worker/multi-tenant-config.js';

describe('MultiTenantConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getMultiTenantConfig', () => {
    it('should return disabled config when MULTI_TENANT_MODE is not set', () => {
      delete process.env.MULTI_TENANT_MODE;

      const config = getMultiTenantConfig();

      expect(config.enabled).toBe(false);
      expect(config.tenantId).toBe('');
      expect(config.controllerId).toBe('');
    });

    it('should return disabled config when MULTI_TENANT_MODE is false', () => {
      process.env.MULTI_TENANT_MODE = 'false';

      const config = getMultiTenantConfig();

      expect(config.enabled).toBe(false);
    });

    it('should throw when MULTI_TENANT_MODE is true but TENANT_ID is missing', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      delete process.env.TENANT_ID;

      expect(() => getMultiTenantConfig()).toThrow(
        'TENANT_ID environment variable is required when MULTI_TENANT_MODE is enabled'
      );
    });

    it('should return enabled config with tenant ID', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';

      const config = getMultiTenantConfig();

      expect(config.enabled).toBe(true);
      expect(config.tenantId).toBe('tenant-123');
      expect(config.controllerId).toMatch(/^ctrl-[a-f0-9]{8}$/);
    });

    it('should use provided CONTROLLER_ID', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';
      process.env.CONTROLLER_ID = 'my-controller';

      const config = getMultiTenantConfig();

      expect(config.controllerId).toBe('my-controller');
    });

    it('should use custom WORKER_PROFILE_DIR', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';
      process.env.WORKER_PROFILE_DIR = '/custom/profiles';

      const config = getMultiTenantConfig();

      expect(config.workerConfig.profileBaseDir).toBe('/custom/profiles');
    });

    it('should use default profile dir when not set', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';

      const config = getMultiTenantConfig();

      expect(config.workerConfig.profileBaseDir).toBe('/tmp/athena-workers');
    });

    it('should parse numeric environment variables', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';
      process.env.WORKER_IDLE_TIMEOUT_MS = '600000';
      process.env.WORKER_HARD_TTL_MS = '3600000';
      process.env.WORKER_LEASE_TTL_MS = '120000';
      process.env.WORKER_HEALTH_CHECK_INTERVAL_MS = '15000';
      process.env.WORKER_PORT_MIN = '9400';
      process.env.WORKER_PORT_MAX = '9499';
      process.env.WORKER_MAX_COUNT = '50';

      const config = getMultiTenantConfig();

      expect(config.workerConfig.idleTimeoutMs).toBe(600000);
      expect(config.workerConfig.hardTtlMs).toBe(3600000);
      expect(config.workerConfig.leaseTtlMs).toBe(120000);
      expect(config.workerConfig.healthCheckIntervalMs).toBe(15000);
      expect(config.workerConfig.portRange.min).toBe(9400);
      expect(config.workerConfig.portRange.max).toBe(9499);
      expect(config.workerConfig.maxWorkers).toBe(50);
    });

    it('should use defaults for invalid numeric values', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';
      process.env.WORKER_IDLE_TIMEOUT_MS = 'invalid';
      process.env.WORKER_PORT_MIN = 'abc';

      const config = getMultiTenantConfig();

      expect(config.workerConfig.idleTimeoutMs).toBe(300_000); // default
      expect(config.workerConfig.portRange.min).toBe(9300); // default
    });

    it('should use CHROME_PATH when provided', () => {
      process.env.MULTI_TENANT_MODE = 'true';
      process.env.TENANT_ID = 'tenant-123';
      process.env.CHROME_PATH = '/usr/local/bin/chrome';

      const config = getMultiTenantConfig();

      expect(config.workerConfig.chromePath).toBe('/usr/local/bin/chrome');
    });
  });

  describe('validateMultiTenantConfig', () => {
    it('should not throw for disabled config', () => {
      const config = {
        enabled: false,
        tenantId: '',
        controllerId: '',
        workerConfig: {
          profileBaseDir: '/tmp',
          idleTimeoutMs: 300_000,
          hardTtlMs: 7_200_000,
          leaseTtlMs: 300_000,
          healthCheckIntervalMs: 30_000,
          portRange: { min: 9300, max: 9399 },
          maxWorkers: 100,
        },
      };

      expect(() => validateMultiTenantConfig(config)).not.toThrow();
    });

    it('should throw for invalid port range', () => {
      const config = {
        enabled: true,
        tenantId: 'tenant-123',
        controllerId: 'ctrl-123',
        workerConfig: {
          profileBaseDir: '/tmp',
          idleTimeoutMs: 300_000,
          hardTtlMs: 7_200_000,
          leaseTtlMs: 300_000,
          healthCheckIntervalMs: 30_000,
          portRange: { min: 9400, max: 9300 }, // invalid: min > max
          maxWorkers: 100,
        },
      };

      expect(() => validateMultiTenantConfig(config)).toThrow(
        'Invalid port range: WORKER_PORT_MIN (9400) > WORKER_PORT_MAX (9300)'
      );
    });

    it('should warn when maxWorkers exceeds port capacity', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = {
        enabled: true,
        tenantId: 'tenant-123',
        controllerId: 'ctrl-123',
        workerConfig: {
          profileBaseDir: '/tmp',
          idleTimeoutMs: 300_000,
          hardTtlMs: 7_200_000,
          leaseTtlMs: 300_000,
          healthCheckIntervalMs: 30_000,
          portRange: { min: 9300, max: 9309 }, // capacity: 10
          maxWorkers: 50, // exceeds capacity
        },
      };

      validateMultiTenantConfig(config);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WORKER_MAX_COUNT (50) exceeds port range capacity (10)')
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
