/**
 * Session Manager Types
 *
 * Type definitions for browser session management.
 */

/**
 * Connection state machine states
 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'failed';

/**
 * Event emitted on connection state changes
 */
export interface ConnectionStateChangeEvent {
  previousState: ConnectionState;
  currentState: ConnectionState;
  timestamp: Date;
}

/**
 * Storage state for cookies and localStorage.
 * Puppeteer doesn't have a built-in storageState type like Playwright.
 */
export interface StorageState {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }[];
  origins: {
    origin: string;
    localStorage: { name: string; value: string }[];
  }[];
}

/**
 * Options for launching a new browser
 */
export interface LaunchOptions {
  /** Run browser in headless mode (default: false) */
  headless?: boolean;

  /** Viewport dimensions */
  viewport?: { width: number; height: number };

  /** Chrome channel to use */
  channel?: 'chrome' | 'chrome-canary' | 'chrome-beta' | 'chrome-dev';

  /** Path to Chrome executable (overrides channel) */
  executablePath?: string;

  /** Use isolated temp profile instead of persistent (default: false) */
  isolated?: boolean;

  /** Directory for persistent browser profile (user data dir) */
  userDataDir?: string;

  /** Additional Chrome command-line arguments */
  args?: string[];

  /** Use pipe transport instead of WebSocket (default: true, more secure) */
  pipe?: boolean;
}

/**
 * Options for connecting to an existing browser via CDP
 */
export interface ConnectOptions {
  /** WebSocket endpoint URL (e.g., ws://localhost:9222/devtools/browser/...) */
  browserWSEndpoint?: string;

  /** HTTP endpoint URL for Puppeteer to discover WebSocket (e.g., http://localhost:9222) */
  browserURL?: string;

  /** CDP endpoint URL (legacy, converted to browserURL) */
  endpointUrl?: string;

  /** CDP host (default: 127.0.0.1) - used if no endpoint provided */
  host?: string;

  /** CDP port (default: 9223) - used if no endpoint provided */
  port?: number;

  /** Connection timeout in ms (default: 30000) */
  timeout?: number;

  /**
   * Auto-connect to Chrome 144+ with UI-based remote debugging enabled.
   * Reads DevToolsActivePort file from Chrome's user data directory.
   * Requires user to enable remote debugging at chrome://inspect/#remote-debugging
   */
  autoConnect?: boolean;

  /** Chrome user data directory for autoConnect (default: ~/.config/google-chrome on Linux) */
  userDataDir?: string;
}
