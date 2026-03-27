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
    });
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

  it('should ignore unknown arguments and warn about them', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const args = parseArgs(['--unknownArg', 'value', '--anotherUnknown']);

    expect(args).toEqual({
      transport: 'stdio',
      port: 3000,
    });

    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--unknownArg" - ignored');
    expect(warnSpy).toHaveBeenCalledWith('Warning: Unknown argument "--anotherUnknown" - ignored');

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
