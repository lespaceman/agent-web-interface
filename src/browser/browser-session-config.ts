/**
 * Browser Session Config
 *
 * Defines the browser configuration that agents can specify per session.
 * Each session can independently choose to launch a new browser or connect
 * to an existing one, with its own headless/headed preference.
 *
 * @module browser/browser-session-config
 */

/**
 * Per-session browser configuration.
 *
 * Agents pass this to `configure_browser` before their first browser-touching tool.
 * If not provided, sensible defaults are used (launch, headed, persistent profile).
 */
export interface BrowserSessionConfig {
  /** Launch a new browser or connect to an existing one. Default: 'launch' */
  mode?: 'launch' | 'connect';

  /** Run browser in headless mode. Default: false */
  headless?: boolean;

  /** Use an isolated temp profile instead of persistent. Default: false */
  isolated?: boolean;

  /** HTTP endpoint URL for connecting to an existing browser */
  browserUrl?: string;

  /** WebSocket endpoint URL for connecting to an existing browser */
  wsEndpoint?: string;

  /** Auto-connect to Chrome 144+ via DevToolsActivePort */
  autoConnect?: boolean;

  /** Chrome user data directory */
  userDataDir?: string;

  /** Chrome channel to use */
  channel?: 'chrome' | 'chrome-canary' | 'chrome-beta' | 'chrome-dev';

  /** Path to Chrome executable (overrides channel) */
  executablePath?: string;
}

/**
 * Returns sensible default browser configuration.
 *
 * Launch a headed Chrome with a persistent profile — the most common
 * configuration for interactive browser automation.
 */
export function defaultBrowserConfig(): BrowserSessionConfig {
  return {
    mode: 'launch',
    headless: false,
    isolated: false,
  };
}
