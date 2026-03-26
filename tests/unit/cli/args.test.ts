/**
 * CLI Argument Parsing Tests
 *
 * TDD tests for parseArgs function.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseArgs, type ServerArgs } from '../../../src/cli/args.js';

describe('parseArgs', () => {
  it('should return default options when no args provided', () => {
    const args: ServerArgs = parseArgs([]);

    expect(args).toEqual({
      transport: 'stdio',
      port: 3000,
      headless: false,
      isolated: false,
      browserUrl: undefined,
      wsEndpoint: undefined,
      autoConnect: false,
      userDataDir: undefined,
      channel: undefined,
      executablePath: undefined,
    });
  });

  it('should parse --headless=false', () => {
    const args = parseArgs(['--headless=false']);
    expect(args.headless).toBe(false);
  });

  it('should parse --headless=0', () => {
    const args = parseArgs(['--headless=0']);
    expect(args.headless).toBe(false);
  });

  it('should parse --headless=true', () => {
    const args = parseArgs(['--headless=true']);
    expect(args.headless).toBe(true);
  });

  it('should parse --headless=1', () => {
    const args = parseArgs(['--headless=1']);
    expect(args.headless).toBe(true);
  });

  it('should parse --headless alone as true', () => {
    const args = parseArgs(['--headless']);
    expect(args.headless).toBe(true);
  });

  it('should parse --browserUrl', () => {
    const args = parseArgs(['--browserUrl', 'http://localhost:9222']);
    expect(args.browserUrl).toBe('http://localhost:9222');
  });

  it('should parse --wsEndpoint', () => {
    const args = parseArgs(['--wsEndpoint', 'ws://localhost:9222/devtools/browser/abc']);
    expect(args.wsEndpoint).toBe('ws://localhost:9222/devtools/browser/abc');
  });

  it('should parse --autoConnect', () => {
    const args = parseArgs(['--autoConnect']);
    expect(args.autoConnect).toBe(true);
  });

  it('should parse --isolated', () => {
    const args = parseArgs(['--isolated']);
    expect(args.isolated).toBe(true);
  });

  it('should parse --userDataDir', () => {
    const args = parseArgs(['--userDataDir', '/tmp/chrome-profile']);
    expect(args.userDataDir).toBe('/tmp/chrome-profile');
  });

  it('should parse --channel', () => {
    const args = parseArgs(['--channel', 'chrome-canary']);
    expect(args.channel).toBe('chrome-canary');
  });

  it('should parse --executablePath', () => {
    const args = parseArgs(['--executablePath', '/usr/bin/chromium']);
    expect(args.executablePath).toBe('/usr/bin/chromium');
  });

  it('should parse multiple arguments together', () => {
    const args = parseArgs([
      '--headless=false',
      '--browserUrl',
      'http://localhost:9222',
      '--autoConnect',
      '--channel',
      'chrome-beta',
    ]);

    expect(args.headless).toBe(false);
    expect(args.browserUrl).toBe('http://localhost:9222');
    expect(args.autoConnect).toBe(true);
    expect(args.channel).toBe('chrome-beta');
  });

  it('should ignore unknown arguments and warn about them', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const args = parseArgs(['--unknownArg', 'value', '--anotherUnknown']);

    expect(args).toEqual({
      transport: 'stdio',
      port: 3000,
      headless: false,
      isolated: false,
      browserUrl: undefined,
      wsEndpoint: undefined,
      autoConnect: false,
      userDataDir: undefined,
      channel: undefined,
      executablePath: undefined,
    });

    // Should warn about both unknown arguments
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--unknownArg" - ignored');
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--anotherUnknown" - ignored');

    warnSpy.mockRestore();
  });

  it('should warn about typos in known arguments', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const args = parseArgs(['--hedless', '--autoconnect']);

    // Should use defaults since typos are not recognized
    expect(args.headless).toBe(false);
    expect(args.autoConnect).toBe(false);

    // Should warn about the typos
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--hedless" - ignored');
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--autoconnect" - ignored');

    warnSpy.mockRestore();
  });

  it('should parse --transport stdio', () => {
    const args = parseArgs(['--transport', 'stdio']);
    expect(args.transport).toBe('stdio');
  });

  it('should parse --transport http', () => {
    const args = parseArgs(['--transport', 'http']);
    expect(args.transport).toBe('http');
  });

  it('should warn on unknown transport and default to stdio', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const args = parseArgs(['--transport', 'grpc']);
    expect(args.transport).toBe('stdio');
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown transport "grpc" - defaulting to stdio');
    warnSpy.mockRestore();
  });

  it('should parse --port', () => {
    const args = parseArgs(['--port', '8080']);
    expect(args.port).toBe(8080);
  });

  it('should default port to 3000', () => {
    const args = parseArgs([]);
    expect(args.port).toBe(3000);
  });

  it('should handle arguments in any order', () => {
    const args = parseArgs([
      '--channel',
      'chrome',
      '--headless=false',
      '--userDataDir',
      '/data/profile',
    ]);

    expect(args.channel).toBe('chrome');
    expect(args.headless).toBe(false);
    expect(args.userDataDir).toBe('/data/profile');
  });

  it('should validate port is in range 1-65535', () => {
    const args = parseArgs(['--port', '8080']);
    expect(args.port).toBe(8080);

    const argsMin = parseArgs(['--port', '1']);
    expect(argsMin.port).toBe(1);

    const argsMax = parseArgs(['--port', '65535']);
    expect(argsMax.port).toBe(65535);
  });

  it('should warn and use default for port 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const args = parseArgs(['--port', '0']);
    expect(args.port).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid port "0" - defaulting to 3000');
    warnSpy.mockRestore();
  });

  it('should warn and use default for negative port', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const args = parseArgs(['--port', '-1']);
    expect(args.port).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid port "-1" - defaulting to 3000');
    warnSpy.mockRestore();
  });

  it('should warn and use default for port > 65535', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const args = parseArgs(['--port', '70000']);
    expect(args.port).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid port "70000" - defaulting to 3000');
    warnSpy.mockRestore();
  });

  it('should warn and use default for NaN port', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const args = parseArgs(['--port', 'abc']);
    expect(args.port).toBe(3000);
    expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid port "abc" - defaulting to 3000');
    warnSpy.mockRestore();
  });

  it('should validate HTTP_PORT env var similarly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const originalHttpPort = process.env.HTTP_PORT;

    try {
      // Valid HTTP_PORT
      process.env.HTTP_PORT = '9090';
      expect(parseArgs([]).port).toBe(9090);
      expect(warnSpy).not.toHaveBeenCalled();

      // Port 0
      process.env.HTTP_PORT = '0';
      expect(parseArgs([]).port).toBe(3000);
      expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid HTTP_PORT "0" - defaulting to 3000');
      warnSpy.mockClear();

      // Negative port
      process.env.HTTP_PORT = '-5';
      expect(parseArgs([]).port).toBe(3000);
      expect(warnSpy).toHaveBeenCalledWith('Warning: Invalid HTTP_PORT "-5" - defaulting to 3000');
      warnSpy.mockClear();

      // Port > 65535
      process.env.HTTP_PORT = '99999';
      expect(parseArgs([]).port).toBe(3000);
      expect(warnSpy).toHaveBeenCalledWith(
        'Warning: Invalid HTTP_PORT "99999" - defaulting to 3000'
      );
      warnSpy.mockClear();

      // NaN port
      process.env.HTTP_PORT = 'notanumber';
      expect(parseArgs([]).port).toBe(3000);
      expect(warnSpy).toHaveBeenCalledWith(
        'Warning: Invalid HTTP_PORT "notanumber" - defaulting to 3000'
      );
    } finally {
      if (originalHttpPort === undefined) {
        delete process.env.HTTP_PORT;
      } else {
        process.env.HTTP_PORT = originalHttpPort;
      }
      warnSpy.mockRestore();
    }
  });
});
