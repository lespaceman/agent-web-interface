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
});
