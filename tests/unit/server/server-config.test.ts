/**
 * ServerConfig Tests
 *
 * Tests for initServerConfig, getServerConfig, and resetServerState.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ServerConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should initialize config from CLI args', async () => {
    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    initServerConfig(['--transport', 'http', '--port', '8080']);
    const config = getServerConfig();

    expect(config.transport).toBe('http');
    expect(config.port).toBe(8080);
  });

  it('should return default config when no args provided', async () => {
    const { initServerConfig, getServerConfig } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);
    const config = getServerConfig();

    expect(config).toEqual({
      transport: 'stdio',
      port: 3000,
    });
  });

  it('should throw if getServerConfig called before initServerConfig', async () => {
    const { getServerConfig } = await import('../../../src/server/server-config.js');

    expect(() => getServerConfig()).toThrow('Server config not initialized');
  });

  it('should reset config via resetServerState', async () => {
    const { initServerConfig, getServerConfig, resetServerState } =
      await import('../../../src/server/server-config.js');

    initServerConfig([]);
    expect(getServerConfig()).toBeDefined();

    resetServerState();

    expect(() => getServerConfig()).toThrow('Server config not initialized');
  });
});
