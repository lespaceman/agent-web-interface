/**
 * Package version constant.
 *
 * Reads the version from package.json at build time via createRequire,
 * providing a single source of truth for all entry points.
 *
 * @module shared/version
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from the current file to find package.json.
 * Works from both src/ (dev) and dist/src/ (built) locations.
 */
function findPackageVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8')) as {
        version: string;
      };
      return pkg.version;
    } catch {
      dir = dirname(dir);
    }
  }
  console.warn('Warning: Could not find package.json to read version — defaulting to 0.0.0');
  return '0.0.0';
}

export const VERSION = findPackageVersion();
