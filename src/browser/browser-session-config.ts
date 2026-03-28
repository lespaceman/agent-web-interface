/**
 * Browser Session Config
 *
 * Defines the browser configuration that agents can specify per session.
 * Each session can independently choose to launch a new browser or connect
 * to an existing one, with its own headless/headed preference.
 *
 * Env var AWI_CDP_URL overrides to connect to an existing CDP endpoint.
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
  /** Run browser in headless mode. Default: false */
  headless?: boolean;

  /** Use an isolated temp profile instead of persistent. Default: false */
  isolated?: boolean;

  /** Auto-connect to Chrome 144+ via DevToolsActivePort */
  autoConnect?: boolean;
}

/**
 * Returns sensible default browser configuration.
 *
 * Launch a headed Chrome with a persistent profile — the most common
 * configuration for interactive browser automation.
 */
export function defaultBrowserConfig(): BrowserSessionConfig {
  return {
    headless: false,
    isolated: false,
  };
}
