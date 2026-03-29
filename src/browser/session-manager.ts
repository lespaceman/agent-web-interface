/**
 * Session Manager
 *
 * Manages Puppeteer browser lifecycle with a single shared BrowserContext.
 * All pages share cookies/storage within the context.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
  TargetType,
} from 'puppeteer-core';
import { PuppeteerCdpClient } from '../cdp/puppeteer-cdp-client.js';
import { PageRegistry, type PageHandle } from './page-registry.js';
import { getLogger } from '../shared/services/logging.service.js';
import { BrowserSessionError } from '../shared/errors/browser-session.error.js';
import type { ConnectionHealth } from '../state/health.types.js';
import { observationAccumulator } from '../observation/index.js';
import { waitForNetworkQuiet, NAVIGATION_NETWORK_IDLE_TIMEOUT_MS } from './page-stabilization.js';
import { getOrCreateTracker, removeTracker } from './page-network-tracker.js';
import { getOrCreateRecorder, removeRecorder } from './page-network-recorder.js';
import {
  extractErrorMessage,
  isValidHttpUrl,
  isValidWsUrl,
  readDevToolsActivePort,
  DEFAULT_CDP_PORT,
  DEFAULT_CDP_HOST,
  DEFAULT_CONNECTION_TIMEOUT,
} from './connection-utils.js';
import type {
  ConnectionState,
  ConnectionStateChangeEvent,
  StorageState,
  LaunchOptions,
  ConnectOptions,
} from './session-manager.types.js';

/** Type alias for Puppeteer Page (exported for downstream use) */
export type { Page };

/** Default user data directory for persistent browser profiles */
export const DEFAULT_USER_DATA_DIR = path.join(
  os.homedir(),
  '.cache',
  'agent-web-interface',
  'chrome-profile'
);

/**
 * Manages browser lifecycle and page creation.
 *
 * Supports two modes:
 * - launch(): Start a new browser instance
 * - connect(): Connect to an existing browser via CDP
 *
 * Each SessionController owns its own SessionManager instance for
 * per-session browser isolation.
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
  /** Last known WebSocket endpoint, saved during detach() for potential reconnection */
  private _lastWsEndpoint: string | undefined;
  /** Promise for in-flight launch/connect operation */
  private _connectionPromise: Promise<void> | null = null;

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
   * Get the in-flight connection promise, if any.
   * Callers can await this instead of starting a duplicate launch/connect.
   */
  get connectionPromise(): Promise<void> | null {
    return this._connectionPromise;
  }

  /**
   * Get the last known WebSocket endpoint URL.
   * Saved during detach() for potential reconnection to the same browser.
   */
  get lastWsEndpoint(): string | undefined {
    return this._lastWsEndpoint;
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

    this._connectionPromise = this._doLaunch(options);
    try {
      await this._connectionPromise;
    } finally {
      this._connectionPromise = null;
    }
  }

  /**
   * Internal launch implementation with timeout.
   */
  private async _doLaunch(options: LaunchOptions): Promise<void> {
    this.transitionTo('connecting');
    const {
      headless = true,
      viewport,
      channel = 'chrome',
      executablePath,
      isolated = false,
      userDataDir,
      args = [],
    } = options;

    // Determine profile directory
    let profileDir: string | undefined;
    if (!isolated) {
      profileDir = userDataDir ?? DEFAULT_USER_DATA_DIR;
      await fs.promises.mkdir(profileDir, { recursive: true });
    }

    // Persistent profiles use WebSocket transport so other sessions can reconnect.
    // Isolated (temp) profiles use pipe transport (faster, no network exposure).
    const pipe = options.pipe ?? !profileDir;

    this.logger.info('Launching browser', {
      headless,
      viewport,
      channel,
      isolated,
      hasPersistentProfile: !!profileDir,
    });

    let browser: Browser | null = null;
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Build Chrome args
      const chromeArgs = [
        '--hide-crash-restore-bubble',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        ...args,
      ];

      const launchPromise = puppeteer.launch({
        channel: executablePath ? undefined : channel,
        executablePath,
        headless,
        userDataDir: profileDir,
        defaultViewport: viewport ?? null,
        pipe,
        args: chromeArgs,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            BrowserSessionError.connectionTimeout('chrome launch', DEFAULT_CONNECTION_TIMEOUT)
          );
        }, DEFAULT_CONNECTION_TIMEOUT);
      });

      try {
        browser = await Promise.race([launchPromise, timeoutPromise]);
      } catch (raceError) {
        // If timeout won the race, the launch may complete later — clean up the orphan
        launchPromise
          .then((b) => b.close())
          .catch(() => {
            /* best-effort */
          });
        throw raceError;
      }

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

      // Re-throw BrowserSessionError as-is, wrap others
      if (BrowserSessionError.isBrowserSessionError(error)) {
        throw error;
      }
      throw BrowserSessionError.connectionFailed(
        error instanceof Error ? error : new Error(extractErrorMessage(error)),
        { operation: 'launch' }
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Connect to an existing browser via CDP.
   *
   * Use this to connect to any Chromium browser with remote debugging enabled.
   *
   * @param options - Connection options (browserWSEndpoint, browserURL, or autoConnect)
   * @throws BrowserSessionError if browser is already running, connection in progress, or URL is invalid
   *
   * @example
   * ```typescript
   * // Connect to browser on default port
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

    this._connectionPromise = this._doConnect(options);
    try {
      await this._connectionPromise;
    } finally {
      this._connectionPromise = null;
    }
  }

  /**
   * Internal connect implementation.
   */
  private async _doConnect(options: ConnectOptions): Promise<void> {
    const timeout = options.timeout ?? DEFAULT_CONNECTION_TIMEOUT;
    let connectOptions: {
      browserWSEndpoint?: string;
      browserURL?: string;
      channel?: 'chrome' | 'chrome-beta' | 'chrome-canary' | 'chrome-dev';
    };
    let endpointForLogging: string;
    const operation = options.autoConnect ? 'autoConnect' : 'connect';

    // Determine connection method
    if (options.autoConnect && !options.userDataDir) {
      // Chrome 144+ auto-connect using Puppeteer's native channel option.
      // Puppeteer reads DevToolsActivePort from Chrome's default user data dir.
      connectOptions = { channel: 'chrome' };
      endpointForLogging = 'channel:chrome';
      this.logger.info('Auto-connect: using Puppeteer channel:chrome');
    } else if (options.autoConnect && options.userDataDir) {
      // Custom userDataDir (e.g., reconnecting to agent's own launched profile).
      // Puppeteer's channel option doesn't support custom dirs, so read manually.
      try {
        const wsEndpoint = await readDevToolsActivePort(options.userDataDir);
        connectOptions = { browserWSEndpoint: wsEndpoint };
        endpointForLogging = wsEndpoint;
        this.logger.info('Auto-connect: found DevToolsActivePort', {
          userDataDir: options.userDataDir,
          wsEndpoint,
        });
      } catch (error) {
        throw BrowserSessionError.connectionFailed(
          error instanceof Error ? error : new Error(extractErrorMessage(error)),
          { operation: 'autoConnect', userDataDir: options.userDataDir }
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
      // targetFilter excludes chrome extension targets (service workers, background
      // pages, extension tabs) that cause Puppeteer's ChromeTargetManager to hang
      // during initialization. Chrome 144's UI-based remote debugging exposes
      // extension targets in non-default browser contexts; Puppeteer's
      // Target.setAutoAttach fails for those sessions (-32001), leaving them stuck
      // in #targetIdsForInit so connect() never resolves.
      // See: https://github.com/puppeteer/puppeteer/issues/11627
      const connectionPromise = puppeteer.connect({
        ...connectOptions,
        defaultViewport: null,
        targetFilter: (target) => {
          if (target.url().startsWith('chrome-extension://')) return false;
          if (target.type() === TargetType.SERVICE_WORKER) return false;
          if (target.type() === TargetType.BACKGROUND_PAGE) return false;
          return true;
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(BrowserSessionError.connectionTimeout(endpointForLogging, timeout));
        }, timeout);
      });

      try {
        browser = await Promise.race([connectionPromise, timeoutPromise]);
      } catch (raceError) {
        // If timeout won the race, the connect may complete later — clean up the orphan
        connectionPromise
          .then((b) => b.disconnect())
          .catch(() => {
            /* best-effort */
          });
        throw raceError;
      }

      // Get the default context (existing browser's context)
      const contexts = browser.browserContexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        // If no context exists, use default (shouldn't normally happen)
        this.context = browser.defaultBrowserContext();
      }

      this.browser = browser;
      this.isExternalBrowser = !options.ownedReconnect;

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
        error instanceof Error ? error : new Error(extractErrorMessage(error)),
        { endpointUrl: endpointForLogging, operation }
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
   * When connecting to an external browser, use this to
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

    if (!this.browser?.connected || !this.context) {
      this.registry.clear();
      this.transitionTo('failed');
      throw BrowserSessionError.browserDisconnected({
        page_id,
        url,
        connectionMode: this.isExternalBrowser ? 'external' : 'launched',
      });
    }

    try {
      // Wait for DOM ready first (fast baseline)
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });

      // Mark navigation on tracker and recorder (bumps generation to ignore stale events)
      const tracker = getOrCreateTracker(handle.page);
      tracker.markNavigation();
      const recorder = getOrCreateRecorder(handle.page);
      recorder.markNavigation();

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
      if (isDisconnectedNavigationError(error)) {
        this.logger.warning('Navigation failed because browser/page disconnected', {
          page_id,
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        this.browser = null;
        this.context = null;
        this.registry.clear();
        this.transitionTo('failed');
        throw BrowserSessionError.browserDisconnected({
          page_id,
          url,
          connectionMode: this.isExternalBrowser ? 'external' : 'launched',
        });
      }

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
    // Already shutting down - avoid re-entrant calls
    if (this._connectionState === 'disconnecting') {
      return;
    }

    // If connection is in progress, wait for it to complete/fail first
    if (this._connectionPromise) {
      try {
        await this._connectionPromise;
      } catch {
        // Connection failed — that's fine, we're shutting down anyway
      }
    }

    // No browser to shut down - just reset state so we can reconnect
    if (!this.browser) {
      this.registry.clear();
      this.transitionTo('idle');
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
   * Detach from the browser without closing it.
   *
   * The browser process continues running after detach, allowing it to
   * survive MCP server exit. The WebSocket endpoint is saved for potential
   * reconnection via connect({ browserWSEndpoint }).
   *
   * This is a no-op if the browser is not connected.
   */
  async detach(): Promise<void> {
    if (!this.browser || this._connectionState === 'disconnecting') {
      return;
    }

    this.transitionTo('disconnecting');
    this.logger.info('Detaching from browser (browser will keep running)');

    // Remove browser disconnect listener to prevent duplicate handling
    this.removeBrowserListeners();

    // Save the WebSocket endpoint before disconnecting (for potential reconnection)
    try {
      if ('wsEndpoint' in this.browser && typeof this.browser.wsEndpoint === 'function') {
        this._lastWsEndpoint = (this.browser.wsEndpoint as () => string)();
      }
    } catch {
      // wsEndpoint may not be available (e.g., pipe transport)
      this.logger.debug('Could not retrieve wsEndpoint during detach');
    }

    // Close/detach all CDP sessions concurrently (best-effort)
    const pages = this.registry.list();
    const results = await Promise.allSettled(pages.map((page) => page.cdp.close()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        this.logger.debug('CDP session close failed during detach', {
          page_id: pages[i].page_id,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }

    // Disconnect from browser without closing it
    void this.browser.disconnect();

    // Clean up internal state
    this.browser = null;
    this.context = null;
    this.registry.clear();

    this.transitionTo('idle');
    this.logger.info('Detached from browser successfully');
  }

  /**
   * Create an isolated BrowserContext for per-session cookie/storage isolation.
   *
   * Each isolated context has its own cookie jar and storage, ensuring
   * that different tenant sessions cannot access each other's data.
   *
   * @returns A new isolated BrowserContext
   * @throws Error if browser is not connected
   */
  async createIsolatedContext(): Promise<BrowserContext> {
    if (!this.browser?.connected) {
      throw new Error('Browser not connected');
    }
    return await this.browser.createBrowserContext();
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
   * Sync registry with actual browser pages.
   *
   * Adopts any browser pages not yet registered. This ensures the registry
   * reflects the true state of the browser, especially after reconnection
   * or when external tabs are opened.
   *
   * Note: This method does NOT remove stale/closed pages from the registry.
   * Failed adoptions (e.g., CDP session errors) are logged as warnings but do not throw.
   * Successfully synced pages have network tracking set up.
   *
   * @returns Array of all PageHandle objects after sync (includes previously registered pages)
   */
  async syncPages(): Promise<PageHandle[]> {
    if (!this.context) {
      return this.registry.list();
    }

    const browserPages = await this.context.pages();

    for (const page of browserPages) {
      // Skip if already registered
      if (this.registry.findByPage(page)) {
        continue;
      }

      // Skip closed pages
      if (page.isClosed()) {
        continue;
      }

      // Adopt the unregistered page
      try {
        const cdpSession = await page.createCDPSession();
        const cdpClient = new PuppeteerCdpClient(cdpSession);
        const handle = this.registry.register(page, cdpClient);
        this.registry.updateMetadata(handle.page_id, { url: page.url() });
        await this.setupPageTracking(page);
        this.logger.debug('Synced unregistered page', { page_id: handle.page_id, url: page.url() });
      } catch (err) {
        this.logger.warning('Failed to sync page', {
          url: page.url(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return this.registry.list();
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
      // Handle unexpected disconnect during connected or connecting states
      // (not during intentional shutdown/disconnecting)
      if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
        this.logger.warning('Browser disconnected unexpectedly', {
          state: this._connectionState,
        });
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

    const recorder = getOrCreateRecorder(page);
    recorder.attach(page);

    page.on('close', () => {
      removeTracker(page);
      removeRecorder(page);
    });
  }
}

function isDisconnectedNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Attempted to use detached Frame') ||
    message.includes('detached frame') ||
    message.includes('Frame detached') ||
    message.includes('Target closed') ||
    message.includes('Session closed') ||
    message.includes('Browsing context already closed') ||
    message.includes('browser has disconnected')
  );
}
