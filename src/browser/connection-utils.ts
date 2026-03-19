/**
 * Connection Utilities
 *
 * Utility functions for browser connection management:
 * - Error message extraction
 * - URL validation
 * - Chrome DevTools port discovery
 * - CDP connection constants
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default CDP port for browser automation */
export const DEFAULT_CDP_PORT = 9223;
/** Default CDP host */
export const DEFAULT_CDP_HOST = '127.0.0.1';
/** Default connection timeout in ms (30s to handle slow networks and remote browsers) */
export const DEFAULT_CONNECTION_TIMEOUT = 30000;

/**
 * Extract a meaningful error message from any thrown value.
 * Exported for testing.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown Error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    // Check common error-like properties
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.reason === 'string') return obj.reason;
    // Try to stringify, but handle circular refs
    try {
      const str = JSON.stringify(error);
      return str !== '{}' ? str : `Unknown error object: ${Object.keys(obj).join(', ') || 'empty'}`;
    } catch {
      return `Non-serializable error: ${Object.prototype.toString.call(error)}`;
    }
  }
  return String(error);
}

/**
 * Validates that a URL is a valid HTTP/HTTPS endpoint URL.
 *
 * @param urlString - URL string to validate
 * @returns true if valid http(s) URL
 */
export function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates that a URL is a valid WebSocket endpoint URL.
 *
 * @param urlString - URL string to validate
 * @returns true if valid ws(s) URL
 */
export function isValidWsUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

/**
 * Get the default Chrome user data directory for the current platform
 */
export function getDefaultChromeUserDataDir(): string {
  const platform = os.platform();
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    case 'win32':
      return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    default: // linux
      return path.join(home, '.config', 'google-chrome');
  }
}

/**
 * Read the DevToolsActivePort file from Chrome's user data directory.
 * Chrome 144+ writes this file when remote debugging is enabled via chrome://inspect/#remote-debugging
 *
 * @param userDataDir - Chrome user data directory
 * @returns WebSocket URL for CDP connection
 * @throws Error if file not found or invalid
 */
export async function readDevToolsActivePort(userDataDir: string): Promise<string> {
  const portFilePath = path.join(userDataDir, 'DevToolsActivePort');

  try {
    const content = await fs.promises.readFile(portFilePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new Error(`Invalid DevToolsActivePort content: ${content}`);
    }

    const [rawPort, wsPath] = lines;
    const port = parseInt(rawPort, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port in DevToolsActivePort: ${rawPort}`);
    }

    return `ws://127.0.0.1:${port}${wsPath}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `DevToolsActivePort file not found at ${portFilePath}. ` +
          'Make sure Chrome is running and remote debugging is enabled at chrome://inspect/#remote-debugging'
      );
    }
    throw error;
  }
}
