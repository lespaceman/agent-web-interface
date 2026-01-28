/**
 * Session Manager
 *
 * Manages Puppeteer browser lifecycle with a single shared BrowserContext.
 * All pages share cookies/storage within the context.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core';
import { PuppeteerCdpClient } from '../cdp/puppeteer-cdp-client.js';
import { PageRegistry, type PageHandle } from './page-registry.js';
import { getLogger } from '../shared/services/logging.service.js';
import { BrowserSessionError } from '../shared/errors/browser-session.error.js';
import type { ConnectionHealth } from '../state/health.types.js';
import { observationAccumulator } from '../observation/index.js';
import { waitForNetworkQuiet, NAVIGATION_NETWORK_IDLE_TIMEOUT_MS } from './page-stabilization.js';
import { getOrCreateTracker, removeTracker } from './page-network-tracker.js';

/** Type alias for Puppeteer Page (exported for downstream use) */
export type { Page };

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

/** Default user data directory for persistent browser profiles */
const DEFAULT_USER_DATA_DIR = path.join(
  os.homedir(),
  '.cache',
  'athena-browser-mcp',
  'chrome-profile'
);

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

/** Default CDP port for Athena Browser */
const DEFAULT_CDP_PORT = 9223;
/** Default CDP host */
const DEFAULT_CDP_HOST = '127.0.0.1';
/** Default connection timeout in ms (30s to handle slow networks and remote browsers) */
const DEFAULT_CONNECTION_TIMEOUT = 30000;

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

  /** Connection timeout in ms (default: 10000) */
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

/**
 * Get the default Chrome user data directory for the current platform
 */
function getDefaultChromeUserDataDir(): string {
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
async function readDevToolsActivePort(userDataDir: string): Promise<string> {
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

/**
 * Validates that a URL is a valid HTTP/HTTPS endpoint URL.
 *
 * @param urlString - URL string to validate
 * @returns true if valid http(s) URL
 */
function isValidHttpUrl(urlString: string): boolean {
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
function isValidWsUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'ws:' || url.protocol === 'wss:';
  } catch {
    return false;
  }
}

/**
 * Manages browser lifecycle and page creation.
 *
 * Supports two modes:
 * - launch(): Start a new browser instance
 * - connect(): Connect to an existing browser via CDP (e.g., Athena Browser)
 */
export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private readonly registry: PageRegistry;
  private readonly logger = getLogger();
  private isExternalBrowser = false;
  /** Connection state machine */
  private _connectionState: ConnectionState = 'idle';
  /** State change listeners */
  private readonly stateChangeListeners = new Set<(event: ConnectionStateChangeEvent) => void>();
  /** Browser disconnect handler reference for cleanup */
  private browserDisconnectHandler: (() => void) | null = null;

  constructor() {
    this.registry = new PageRegistry();
  }

  /**
   * Get current connection state
   */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /**
   * Transition to a new connection state
   */
  private transitionTo(newState: ConnectionState): void {
    const previousState = this._connectionState;
    if (previousState === newState) return;

    this._connectionState = newState;
    this.logger.debug('Connection state changed', { previousState, currentState: newState });

    // Notify listeners
    const event: ConnectionStateChangeEvent = {
      previousState,
      currentState: newState,
      timestamp: new Date(),
    };
    for (const listener of this.stateChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(
          'State change listener error',
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(listener: (event: ConnectionStateChangeEvent) => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  /**
   * Launch a new browser with optional configuration.
   *
   * @param options - Browser launch options
   * @throws BrowserSessionError if browser is already running or connection in progress
   */
  async launch(options: LaunchOptions = {}): Promise<void> {
    if (this._connectionState !== 'idle' && this._connectionState !== 'failed') {
      throw BrowserSessionError.invalidState(this._connectionState, 'launch');
    }

    this.transitionTo('connecting');
    const {
      headless = true,
      viewport,
      channel = 'chrome',
      executablePath,
      isolated = false,
      userDataDir,
      args = [],
      pipe = true,
    } = options;

    // Determine profile directory
    let profileDir: string | undefined;
    if (!isolated) {
      profileDir = userDataDir ?? DEFAULT_USER_DATA_DIR;
      await fs.promises.mkdir(profileDir, { recursive: true });
    }

    this.logger.info('Launching browser', {
      headless,
      viewport,
      channel,
      isolated,
      hasPersistentProfile: !!profileDir,
    });

    let browser: Browser | null = null;

    try {
      // Build Chrome args
      const chromeArgs = [
        '--hide-crash-restore-bubble',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        ...args,
      ];

      browser = await puppeteer.launch({
        channel: executablePath ? undefined : channel,
        executablePath,
        headless,
        userDataDir: profileDir,
        defaultViewport: viewport ?? null,
        pipe,
        args: chromeArgs,
      });

      // Get the default context (first one)
      this.context = browser.defaultBrowserContext();
      this.browser = browser;
      this.isExternalBrowser = false;

      // Setup disconnect listener
      this.setupBrowserListeners();

      this.transitionTo('connected');
      this.logger.info('Browser launched successfully');
    } catch (error) {
      // Cleanup on failure - ignore close errors as browser may be in bad state
      if (browser) {
        await browser.close().catch(() => {
          /* Intentionally empty - cleanup is best-effort */
        });
      }
      this.transitionTo('failed');
      throw BrowserSessionError.connectionFailed(
        error instanceof Error ? error : new Error(String(error)),
        { operation: 'launch' }
      );
    }
  }

  /**
   * Connect to an existing browser via CDP.
   *
   * Use this to connect to Athena Browser or any Chromium with remote debugging enabled.
   *
   * @param options - Connection options (browserWSEndpoint, browserURL, or autoConnect)
   * @throws BrowserSessionError if browser is already running, connection in progress, or URL is invalid
   *
   * @example
   * ```typescript
   * // Connect to Athena Browser on default port
   * await session.connect();
   *
   * // Connect to custom endpoint (HTTP - Puppeteer discovers WebSocket)
   * await session.connect({ browserURL: 'http://localhost:9222' });
   *
   * // Connect via WebSocket directly
   * await session.connect({ browserWSEndpoint: 'ws://localhost:9222/devtools/browser/...' });
   *
   * // Auto-connect to Chrome 144+ with UI-based remote debugging
   * await session.connect({ autoConnect: true });
   * ```
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this._connectionState !== 'idle' && this._connectionState !== 'failed') {
      throw BrowserSessionError.invalidState(this._connectionState, 'connect');
    }

    const timeout = options.timeout ?? DEFAULT_CONNECTION_TIMEOUT;
    let connectOptions: { browserWSEndpoint?: string; browserURL?: string };
    let endpointForLogging: string;

    // Determine connection method
    if (options.autoConnect) {
      // Chrome 144+ auto-connect via DevToolsActivePort
      const userDataDir = options.userDataDir ?? getDefaultChromeUserDataDir();
      try {
        const wsEndpoint = await readDevToolsActivePort(userDataDir);
        connectOptions = { browserWSEndpoint: wsEndpoint };
        endpointForLogging = wsEndpoint;
        this.logger.info('Auto-connect: found DevToolsActivePort', { userDataDir, wsEndpoint });
      } catch (error) {
        throw BrowserSessionError.connectionFailed(
          error instanceof Error ? error : new Error(String(error)),
          { operation: 'autoConnect', userDataDir }
        );
      }
    } else if (options.browserWSEndpoint) {
      // Direct WebSocket connection
      if (!isValidWsUrl(options.browserWSEndpoint)) {
        throw BrowserSessionError.invalidUrl(options.browserWSEndpoint);
      }
      connectOptions = { browserWSEndpoint: options.browserWSEndpoint };
      endpointForLogging = options.browserWSEndpoint;
    } else if (options.browserURL) {
      // HTTP endpoint - Puppeteer discovers WebSocket
      if (!isValidHttpUrl(options.browserURL)) {
        throw BrowserSessionError.invalidUrl(options.browserURL);
      }
      connectOptions = { browserURL: options.browserURL };
      endpointForLogging = options.browserURL;
    } else if (options.endpointUrl) {
      // Legacy endpointUrl support - convert to appropriate option
      if (isValidWsUrl(options.endpointUrl)) {
        connectOptions = { browserWSEndpoint: options.endpointUrl };
      } else if (isValidHttpUrl(options.endpointUrl)) {
        connectOptions = { browserURL: options.endpointUrl };
      } else {
        throw BrowserSessionError.invalidUrl(options.endpointUrl);
      }
      endpointForLogging = options.endpointUrl;
    } else {
      // Default: construct HTTP URL from host/port
      const host = options.host ?? process.env.CEF_BRIDGE_HOST ?? DEFAULT_CDP_HOST;
      const port = options.port ?? Number(process.env.CEF_BRIDGE_PORT ?? DEFAULT_CDP_PORT);
      const browserURL = `http://${host}:${port}`;
      connectOptions = { browserURL };
      endpointForLogging = browserURL;
    }

    this.transitionTo('connecting');
    this.logger.info('Connecting to browser via CDP', { endpoint: endpointForLogging, timeout });

    let browser: Browser | null = null;
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Connect with timeout
      const connectionPromise = puppeteer.connect({
        ...connectOptions,
        defaultViewport: null,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(BrowserSessionError.connectionTimeout(endpointForLogging, timeout));
        }, timeout);
      });

      browser = await Promise.race([connectionPromise, timeoutPromise]);

      // Get the default context (existing browser's context)
      const contexts = browser.browserContexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        // If no context exists, use default (shouldn't happen with Athena)
        this.context = browser.defaultBrowserContext();
      }

      this.browser = browser;
      this.isExternalBrowser = true;

      // Setup disconnect listener
      this.setupBrowserListeners();

      // Get page count for logging
      const pages = await this.context.pages();

      this.transitionTo('connected');
      this.logger.info('Connected to browser successfully', {
        contexts: contexts.length,
        pages: pages.length,
      });
    } catch (error) {
      // Cleanup on failure - for external browsers, disconnect instead of close
      if (browser) {
        await browser.disconnect().catch(() => {
          /* Intentionally empty - cleanup is best-effort */
        });
      }
      this.transitionTo('failed');
      this.logger.error('Failed to connect', error instanceof Error ? error : undefined, {
        endpoint: endpointForLogging,
      });

      // Re-throw BrowserSessionError as-is, wrap others
      if (BrowserSessionError.isBrowserSessionError(error)) {
        throw error;
      }
      throw BrowserSessionError.connectionFailed(
        error instanceof Error ? error : new Error(String(error)),
        { endpointUrl: endpointForLogging }
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Get the number of pages in the browser context.
   *
   * @returns Number of pages, or 0 if browser not running
   */
  async getPageCount(): Promise<number> {
    if (!this.context) {
      return 0;
    }
    const pages = await this.context.pages();
    return pages.length;
  }

  /**
   * Adopt an existing page from the connected browser.
   *
   * When connecting to an external browser (like Athena), use this to
   * register existing pages instead of creating new ones.
   *
   * This method is idempotent - calling it twice on the same page
   * returns the existing handle without creating a new CDP session.
   *
   * @param index - Page index (default: 0 for first/active page)
   * @returns PageHandle for the adopted page
   * @throws Error if browser not connected or page index invalid
   */
  async adoptPage(index = 0): Promise<PageHandle> {
    if (!this.context) {
      throw new Error('Browser not running');
    }

    const pages = await this.context.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid page index: ${index}. Browser has ${pages.length} pages.`);
    }

    const page = pages[index];

    // Check if already adopted (idempotent behavior)
    const existing = this.registry.findByPage(page);
    if (existing) {
      this.logger.debug('Page already adopted', { page_id: existing.page_id });
      return existing;
    }

    const cdpSession = await page.createCDPSession();
    const cdpClient = new PuppeteerCdpClient(cdpSession);
    const handle = this.registry.register(page, cdpClient);

    this.registry.updateMetadata(handle.page_id, { url: page.url() });

    await this.setupPageTracking(page);

    this.logger.debug('Adopted page', { page_id: handle.page_id, url: page.url() });

    return handle;
  }

  /**
   * Create a new page, optionally navigating to a URL
   *
   * @param url - Optional URL to navigate to
   * @returns PageHandle for the new page
   * @throws Error if browser not running
   */
  async createPage(url?: string): Promise<PageHandle> {
    if (!this.context) {
      throw new Error('Browser not running');
    }

    const page = await this.context.newPage();
    const cdpSession = await page.createCDPSession();
    const cdpClient = new PuppeteerCdpClient(cdpSession);
    const handle = this.registry.register(page, cdpClient);

    this.logger.debug('Created page', { page_id: handle.page_id });

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      this.registry.updateMetadata(handle.page_id, { url: page.url() });
    }

    await this.setupPageTracking(page);

    return handle;
  }

  /**
   * Get a page handle by its ID
   *
   * @param page_id - The page identifier
   * @returns PageHandle if found, undefined otherwise
   */
  getPage(page_id: string): PageHandle | undefined {
    return this.registry.get(page_id);
  }

  /**
   * Touch a page to mark it as most recently used.
   *
   * Call this on page access to update MRU tracking.
   *
   * @param page_id - The page identifier
   */
  touchPage(page_id: string): void {
    this.registry.touch(page_id);
  }

  /**
   * Resolve page_id to a PageHandle.
   *
   * If page_id is provided, returns the specified page.
   * If page_id is omitted, returns the most recently used page.
   * Does NOT auto-create pages.
   *
   * @param page_id - Optional page identifier
   * @returns PageHandle if found, undefined otherwise
   */
  resolvePage(page_id?: string): PageHandle | undefined {
    if (page_id) {
      return this.getPage(page_id);
    }
    return this.registry.getMostRecent();
  }

  /**
   * Resolve page_id to a PageHandle, creating a new page if needed.
   *
   * If page_id is provided, returns the specified page (throws if not found).
   * If page_id is omitted, returns the most recently used page or creates one.
   *
   * @param page_id - Optional page identifier
   * @returns PageHandle for the resolved or created page
   * @throws Error if page_id is provided but not found, or if browser not running
   */
  async resolvePageOrCreate(page_id?: string): Promise<PageHandle> {
    if (page_id) {
      const handle = this.getPage(page_id);
      if (!handle) {
        throw new Error(`Page not found: ${page_id}`);
      }
      return handle;
    }

    return this.registry.getMostRecent() ?? (await this.createPage());
  }

  /**
   * Close a page and its CDP session
   *
   * @param page_id - The page identifier
   * @returns true if page was closed, false if not found
   */
  async closePage(page_id: string): Promise<boolean> {
    const handle = this.registry.get(page_id);
    if (!handle) {
      return false;
    }

    // Cleanup network tracker before closing
    removeTracker(handle.page);

    try {
      // Close CDP session first
      await handle.cdp.close();
    } catch (error) {
      this.logger.debug('Error closing CDP session', {
        page_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Close the page
      await handle.page.close();
    } catch (error) {
      this.logger.debug('Error closing page', {
        page_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Remove from registry
    this.registry.remove(page_id);

    this.logger.debug('Closed page', { page_id });

    return true;
  }

  /**
   * Navigate a page to a URL
   *
   * Waits for both DOM ready and network idle to ensure the page is fully loaded.
   * Network idle timeout is generous (5s) but never throws - pages with persistent
   * connections (websockets, long-polling, analytics) may never reach idle.
   *
   * @param page_id - The page identifier
   * @param url - URL to navigate to
   * @throws Error if page not found or navigation fails
   */
  async navigateTo(page_id: string, url: string): Promise<void> {
    const handle = this.registry.get(page_id);
    if (!handle) {
      throw new Error('Page not found');
    }

    try {
      // Wait for DOM ready first (fast baseline)
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });

      // Mark navigation on tracker (bumps generation to ignore stale events)
      const tracker = getOrCreateTracker(handle.page);
      tracker.markNavigation();

      // Then wait for network to settle (catches API calls)
      const networkIdle = await waitForNetworkQuiet(
        handle.page,
        NAVIGATION_NETWORK_IDLE_TIMEOUT_MS
      );
      if (!networkIdle) {
        this.logger.debug('Network did not reach idle state', { page_id, url });
      }

      this.registry.updateMetadata(page_id, {
        url: handle.page.url(),
      });

      // Re-inject observation accumulator (new document context)
      await observationAccumulator.inject(handle.page);

      this.logger.debug('Navigated page', { page_id, url });
    } catch (error) {
      this.logger.error('Navigation failed', error instanceof Error ? error : undefined, {
        page_id,
        url,
      });
      throw error;
    }
  }

  /**
   * Shutdown the browser session.
   *
   * For launched browsers: closes all pages, context, and browser.
   * For connected browsers: disconnects but does NOT close the browser.
   */
  async shutdown(): Promise<void> {
    // Check if there's anything to shut down
    if (!this.browser || this._connectionState === 'disconnecting') {
      return;
    }

    this.transitionTo('disconnecting');
    this.logger.info('Shutting down browser session', {
      isExternalBrowser: this.isExternalBrowser,
    });

    // Remove browser disconnect listener to prevent duplicate handling
    this.removeBrowserListeners();

    // Close/detach all CDP sessions
    const pages = this.registry.list();
    for (const page of pages) {
      try {
        await page.cdp.close();
      } catch (err) {
        // CDP session may already be closed
        this.logger.debug('CDP session close failed during shutdown', {
          page_id: page.page_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (this.isExternalBrowser) {
      // For external browser: just disconnect, don't close pages or browser
      if (this.browser) {
        // disconnect() is synchronous in Puppeteer
        void this.browser.disconnect();
      }
      this.logger.info('Disconnected from external browser (not closing it)');
    } else {
      // For launched browser: close everything
      for (const page of pages) {
        try {
          await page.page.close();
        } catch (err) {
          // Page may already be closed
          this.logger.debug('Page close failed during shutdown', {
            page_id: page.page_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Close browser (this closes all pages and contexts)
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (err) {
          // Browser may already be closed
          this.logger.debug('Browser close failed during shutdown', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.browser = null;
    this.context = null;
    this.isExternalBrowser = false;
    this.registry.clear();

    this.transitionTo('idle');
    this.logger.info('Browser session shutdown complete');
  }

  /**
   * Check if browser is running
   *
   * @returns true if browser is active
   */
  isRunning(): boolean {
    return this.browser?.connected ?? false;
  }

  /**
   * Get connection health status.
   *
   * Goes beyond binary connected/not-connected to detect degraded CDP sessions:
   * - 'healthy': Browser connected, all CDP sessions operational
   * - 'degraded': Browser connected, but some CDP sessions dead (recoverable)
   * - 'failed': Browser disconnected
   *
   * @returns Connection health status
   */
  async getConnectionHealth(): Promise<ConnectionHealth> {
    if (this._connectionState !== 'connected' || !this.context) {
      return 'failed';
    }

    const pages = this.registry.list();
    if (pages.length === 0) {
      return 'healthy';
    }

    const results = await Promise.all(
      pages.map(async (pageHandle) => {
        // Check if page is closed using Puppeteer's isClosed() method
        if (pageHandle.page.isClosed()) {
          return false;
        }

        if (!pageHandle.cdp.isActive()) {
          return false;
        }

        try {
          await pageHandle.cdp.send('Page.getFrameTree', undefined);
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warning('CDP probe failed', { page_id: pageHandle.page_id, error: message });
          return false;
        }
      })
    );

    return results.every(Boolean) ? 'healthy' : 'degraded';
  }

  /**
   * Rebind CDP session for a page.
   *
   * Use when CDP session is dead but page is still valid.
   * This creates a new CDP session and updates the registry.
   *
   * @param page_id - Page ID to rebind
   * @returns New PageHandle with fresh CDP session
   * @throws Error if page not found, page is closed, or browser context unavailable
   */
  async rebindCdpSession(page_id: string): Promise<PageHandle> {
    const handle = this.registry.get(page_id);
    if (!handle) {
      throw new Error(`Page not found: ${page_id}`);
    }

    // Check if page is still accessible
    if (handle.page.isClosed()) {
      throw new Error(`Page is closed: ${page_id}`);
    }

    if (!this.context) {
      throw new Error('Browser context not available');
    }

    // Close old CDP session (best effort)
    try {
      await handle.cdp.close();
    } catch (err) {
      // May already be closed
      this.logger.debug('Old CDP session close failed during rebind', {
        page_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Create new CDP session (Puppeteer creates CDP from page, not context)
    const cdpSession = await handle.page.createCDPSession();
    const newCdp = new PuppeteerCdpClient(cdpSession);

    // Update registry with new handle
    const newHandle: PageHandle = {
      ...handle,
      cdp: newCdp,
    };

    this.registry.replace(page_id, newHandle);

    this.logger.info('Rebound CDP session', { page_id });

    return newHandle;
  }

  /**
   * Save the current storage state (cookies, localStorage).
   *
   * Note: Puppeteer doesn't have built-in storageState like Playwright.
   * This method collects cookies and localStorage manually.
   *
   * @param savePath - Optional file path to save state to. If not provided, returns the state object.
   * @returns The storage state object
   * @throws Error if browser not running
   */
  async saveStorageState(savePath?: string): Promise<StorageState> {
    if (!this.context) {
      throw new Error('Browser not running');
    }

    // Get cookies from all pages
    const pages = await this.context.pages();
    const allCookies = await Promise.all(pages.map((page) => page.cookies()));
    const cookieSet = new Map<string, StorageState['cookies'][0]>();

    // Deduplicate cookies by name+domain+path
    for (const pageCookies of allCookies) {
      for (const cookie of pageCookies) {
        const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
        cookieSet.set(key, {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly ?? false,
          secure: cookie.secure ?? false,
          sameSite: (cookie.sameSite ?? undefined) as 'Strict' | 'Lax' | 'None' | undefined,
        });
      }
    }

    // Get localStorage from each origin
    const originsMap = new Map<string, { name: string; value: string }[]>();
    for (const page of pages) {
      try {
        const url = page.url();
        if (!url || url === 'about:blank') continue;

        const origin = new URL(url).origin;
        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
        const localStorage = await page.evaluate(() => {
          const storage = (globalThis as any).localStorage;
          const items: { name: string; value: string }[] = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key) {
              items.push({ name: key, value: storage.getItem(key) ?? '' });
            }
          }
          return items;
        });
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
        originsMap.set(origin, localStorage);
      } catch (err) {
        // Page may not be accessible
        this.logger.debug('Failed to extract localStorage during storage state save', {
          url: page.url(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const state: StorageState = {
      cookies: Array.from(cookieSet.values()),
      origins: Array.from(originsMap.entries()).map(([origin, localStorage]) => ({
        origin,
        localStorage,
      })),
    };

    if (savePath) {
      await fs.promises.writeFile(savePath, JSON.stringify(state, null, 2));
    }

    return state;
  }

  /**
   * List all active pages
   *
   * @returns Array of PageHandle objects
   */
  listPages(): PageHandle[] {
    return this.registry.list();
  }

  /**
   * Get the page count
   *
   * @returns Number of active pages
   */
  pageCount(): number {
    return this.registry.size();
  }

  /**
   * Setup browser event listeners for disconnect detection.
   * Called after successful browser launch or connect.
   */
  private setupBrowserListeners(): void {
    if (!this.browser) return;

    // Store reference for cleanup
    this.browserDisconnectHandler = () => {
      // Only handle if we're in connected state (not during intentional shutdown)
      if (this._connectionState === 'connected') {
        this.logger.warning('Browser disconnected unexpectedly');
        this.browser = null;
        this.context = null;
        this.registry.clear();
        this.transitionTo('failed');
      }
    };

    this.browser.on('disconnected', this.browserDisconnectHandler);
  }

  /**
   * Remove browser event listeners.
   * Called during shutdown to prevent duplicate handling.
   */
  private removeBrowserListeners(): void {
    if (this.browser && this.browserDisconnectHandler) {
      this.browser.off('disconnected', this.browserDisconnectHandler);
      this.browserDisconnectHandler = null;
    }
  }

  /**
   * Setup tracking infrastructure for a page.
   * Injects observation accumulator and attaches network tracker.
   */
  private async setupPageTracking(page: Page): Promise<void> {
    await observationAccumulator.inject(page);

    const tracker = getOrCreateTracker(page);
    tracker.attach(page);

    page.on('close', () => removeTracker(page));
  }
}
