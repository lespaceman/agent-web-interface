/**
 * Browser Session Config
 *
 * Defines browser modes and loads configuration from environment variables.
 * Browser config is infrastructure — set once at startup, never per-tool-call.
 *
 * Env vars:
 *   AWI_BROWSER_MODE  - user | persistent | isolated (default: unset = auto fallback)
 *   AWI_CDP_URL       - Explicit CDP endpoint (overrides mode entirely)
 *   AWI_HEADLESS      - true | false (default: false, only for persistent/isolated)
 *
 * @module browser/browser-session-config
 */

/**
 * Browser session modes.
 *
 * - `user`:       Connect to user's running Chrome via well-known profile directory.
 * - `persistent`: Launch Chrome with a dedicated persistent profile.
 * - `isolated`:   Launch Chrome with a temporary profile (deleted on close).
 */
export const BROWSER_MODES = ['user', 'persistent', 'isolated'] as const;

export type BrowserMode = (typeof BROWSER_MODES)[number];

/**
 * Browser session configuration loaded from environment variables.
 */
export interface BrowserSessionConfig {
  /** Browser mode. undefined = auto (fallback chain: user → persistent → isolated) */
  browserMode?: BrowserMode;

  /** Run browser in headless mode. Only relevant for persistent/isolated. */
  headless: boolean;

  /** Explicit CDP endpoint URL. Overrides browserMode entirely. */
  cdpUrl?: string;
}

/**
 * Load browser configuration from environment variables.
 *
 * Called once at session creation. The returned config is immutable
 * for the lifetime of the session.
 */
export function loadBrowserConfig(): BrowserSessionConfig {
  const rawMode = process.env.AWI_BROWSER_MODE?.trim().toLowerCase();
  const browserMode: BrowserMode | undefined = BROWSER_MODES.includes(rawMode as BrowserMode)
    ? (rawMode as BrowserMode)
    : undefined;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must be falsy
  const cdpUrl = process.env.AWI_CDP_URL?.trim() || undefined;

  return {
    browserMode,
    headless: process.env.AWI_HEADLESS?.trim().toLowerCase() === 'true',
    cdpUrl,
  };
}
