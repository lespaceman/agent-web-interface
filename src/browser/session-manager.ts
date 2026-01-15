/**
 * Session Manager
 *
 * Manages Playwright browser lifecycle with a single shared BrowserContext.
 * All pages share cookies/storage within the context.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { PlaywrightCdpClient } from '../cdp/playwright-cdp-client.js';
import { PageRegistry, type PageHandle } from './page-registry.js';
import { getLogger } from '../shared/services/logging.service.js';
import { BrowserSessionError } from '../shared/errors/browser-session.error.js';
import type { ConnectionHealth } from '../state/health.types.js';
import { observationAccumulator } from '../observation/index.js';
import { waitForNetworkQuiet, NAVIGATION_NETWORK_IDLE_TIMEOUT_MS } from './page-stabilization.js';
import { getOrCreateTracker, removeTracker } from './page-network-tracker.js';

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
 * Re-exports Playwright's BrowserContext storageState return type for convenience.
 */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Options for launching a new browser
 */
export interface LaunchOptions {
  /** Run browser in headless mode (default: true) */
  headless?: boolean;

  /** Viewport dimensions */
  viewport?: { width: number; height: number };

  /** Custom user agent string */
  userAgent?: string;

  /** Browser locale (e.g., 'en-US') */
  locale?: string;

  /** Timezone ID (e.g., 'America/New_York') */
  timezone?: string;

  /** Path to storage state file or storage state object (cookies, localStorage) */
  storageState?: string | StorageState;

  /** Directory for persistent browser profile (user data dir) */
  userDataDir?: string;
}

/** Default CDP port for Athena Browser */
const DEFAULT_CDP_PORT = 9223;
/** Default CDP host */
const DEFAULT_CDP_HOST = '127.0.0.1';
/** Default connection timeout in ms */
const DEFAULT_CONNECTION_TIMEOUT = 10000;

/**
 * Options for connecting to an existing browser via CDP
 */
export interface ConnectOptions {
  /** CDP endpoint URL (default: http://127.0.0.1:9223) */
  endpointUrl?: string;

  /** CDP host (default: 127.0.0.1) - used if endpointUrl not provided */
  host?: string;

  /** CDP port (default: 9223) - used if endpointUrl not provided */
  port?: number;

  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
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
  /** Whether context was launched with userDataDir (persistent profile) */
  private isPersistentContext = false;
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
      userAgent,
      locale,
      timezone,
      storageState,
      userDataDir,
    } = options;

    this.logger.info('Launching browser', {
      headless,
      viewport,
      locale,
      timezone,
      hasPersistentProfile: !!userDataDir,
    });

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      // Build context options (used for both regular and persistent contexts)
      const contextOptions: Parameters<Browser['newContext']>[0] = {};

      if (viewport) {
        contextOptions.viewport = viewport;
      }
      if (userAgent) {
        contextOptions.userAgent = userAgent;
      }
      if (locale) {
        contextOptions.locale = locale;
      }
      if (timezone) {
        contextOptions.timezoneId = timezone;
      }
      if (storageState) {
        contextOptions.storageState = storageState;
      }

      if (userDataDir) {
        // Persistent context mode - use launchPersistentContext
        // This returns a BrowserContext directly (no separate Browser instance)
        context = await chromium.launchPersistentContext(userDataDir, {
          headless,
          ...contextOptions,
        });
        this.context = context;
        this.browser = null; // No separate browser for persistent context
        this.isPersistentContext = true;
        this.isExternalBrowser = false;
      } else {
        // Regular mode - launch browser then create context
        browser = await chromium.launch({
          headless,
        });

        this.context = await browser.newContext(contextOptions);
        this.browser = browser;
        this.isPersistentContext = false;
        this.isExternalBrowser = false;
      }

      // Setup disconnect listener (only for non-persistent contexts with browser)
      if (this.browser) {
        this.setupBrowserListeners();
      }

      this.transitionTo('connected');
      this.logger.info('Browser launched successfully');
    } catch (error) {
      // Cleanup on failure - ignore close errors as browser may be in bad state
      if (browser) {
        await browser.close().catch(() => {
          /* Intentionally empty - cleanup is best-effort */
        });
      }
      if (context && this.isPersistentContext) {
        await context.close().catch(() => {
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
   * @param options - Connection options (host/port or endpointUrl)
   * @throws BrowserSessionError if browser is already running, connection in progress, or URL is invalid
   *
   * @example
   * ```typescript
   * // Connect to Athena Browser on default port
   * await session.connect();
   *
   * // Connect to custom endpoint
   * await session.connect({ port: 9222 });
   * await session.connect({ endpointUrl: 'http://localhost:9223' });
   * ```
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this._connectionState !== 'idle' && this._connectionState !== 'failed') {
      throw BrowserSessionError.invalidState(this._connectionState, 'connect');
    }

    const host = options.host ?? process.env.CEF_BRIDGE_HOST ?? DEFAULT_CDP_HOST;
    const port = options.port ?? Number(process.env.CEF_BRIDGE_PORT ?? DEFAULT_CDP_PORT);
    const endpointUrl = options.endpointUrl ?? `http://${host}:${port}`;
    const timeout = options.timeout ?? DEFAULT_CONNECTION_TIMEOUT;

    // Validate endpoint URL
    if (!isValidHttpUrl(endpointUrl)) {
      throw BrowserSessionError.invalidUrl(endpointUrl);
    }

    this.transitionTo('connecting');
    this.logger.info('Connecting to browser via CDP', { endpointUrl, timeout });

    let browser: Browser | null = null;
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Connect with timeout
      const connectionPromise = chromium.connectOverCDP(endpointUrl);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(BrowserSessionError.connectionTimeout(endpointUrl, timeout));
        }, timeout);
      });

      browser = await Promise.race([connectionPromise, timeoutPromise]);

      // Get the default context (existing browser's context)
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        // If no context exists, create one (shouldn't happen with Athena)
        this.context = await browser.newContext();
      }

      this.browser = browser;
      this.isExternalBrowser = true;

      // Setup disconnect listener
      this.setupBrowserListeners();

      this.transitionTo('connected');
      this.logger.info('Connected to browser successfully', {
        contexts: contexts.length,
        pages: this.context.pages().length,
      });
    } catch (error) {
      // Cleanup on failure - ignore close errors as browser may be in bad state
      if (browser) {
        await browser.close().catch(() => {
          /* Intentionally empty - cleanup is best-effort */
        });
      }
      this.transitionTo('failed');
      this.logger.error('Failed to connect', error instanceof Error ? error : undefined, {
        endpointUrl,
      });

      // Re-throw BrowserSessionError as-is, wrap others
      if (BrowserSessionError.isBrowserSessionError(error)) {
        throw error;
      }
      throw BrowserSessionError.connectionFailed(
        error instanceof Error ? error : new Error(String(error)),
        { endpointUrl }
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
  getPageCount(): number {
    if (!this.context) {
      return 0;
    }
    return this.context.pages().length;
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

    const pages = this.context.pages();
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

    // Create CDP session for this page
    const cdpSession = await this.context.newCDPSession(page);
    const cdpClient = new PlaywrightCdpClient(cdpSession);

    // Register page
    const handle = this.registry.register(page, cdpClient);

    this.registry.updateMetadata(handle.page_id, {
      url: page.url(),
    });

    // Inject observation accumulator for DOM mutation tracking
    await observationAccumulator.inject(page);

    // Attach network tracker for this page
    const tracker = getOrCreateTracker(page);
    tracker.attach(page);

    // Cleanup tracker on unexpected page close
    page.on('close', () => removeTracker(page));

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

    // Create new page
    const page = await this.context.newPage();

    // Create CDP session for this page
    const cdpSession = await this.context.newCDPSession(page);
    const cdpClient = new PlaywrightCdpClient(cdpSession);

    // Register page
    const handle = this.registry.register(page, cdpClient);

    this.logger.debug('Created page', { page_id: handle.page_id });

    // Navigate if URL provided
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      this.registry.updateMetadata(handle.page_id, {
        url: page.url(),
      });
    }

    // Inject observation accumulator for DOM mutation tracking
    await observationAccumulator.inject(page);

    // Attach network tracker for this page
    const tracker = getOrCreateTracker(page);
    tracker.attach(page);

    // Cleanup tracker on unexpected page close
    page.on('close', () => removeTracker(page));

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

    // Try to get MRU page, or create one if no pages exist
    const handle = this.registry.getMostRecent() ?? (await this.createPage());
    return handle;
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
   * For connected browsers: detaches CDP sessions but does NOT close the browser.
   * For persistent contexts: closes context (which closes pages and browser).
   */
  async shutdown(): Promise<void> {
    // Check if there's anything to shut down (browser or persistent context)
    if ((!this.browser && !this.isPersistentContext) || this._connectionState === 'disconnecting') {
      return;
    }

    this.transitionTo('disconnecting');
    this.logger.info('Shutting down browser session', {
      isExternalBrowser: this.isExternalBrowser,
      isPersistentContext: this.isPersistentContext,
    });

    // Remove browser disconnect listener to prevent duplicate handling
    this.removeBrowserListeners();

    // Close/detach all CDP sessions
    const pages = this.registry.list();
    for (const page of pages) {
      try {
        await page.cdp.close();
      } catch {
        // CDP session may already be closed
      }
    }

    if (this.isExternalBrowser) {
      // For external browser: just disconnect, don't close pages or browser
      this.logger.info('Disconnecting from external browser (not closing it)');
    } else if (this.isPersistentContext) {
      // For persistent context: closing context is sufficient
      // (it handles pages and browser internally)
      if (this.context) {
        try {
          await this.context.close();
        } catch {
          // Context may already be closed
        }
      }
      this.logger.info('Persistent context closed');
    } else {
      // For launched browser: close everything
      for (const page of pages) {
        try {
          await page.page.close();
        } catch {
          // Page may already be closed
        }
      }

      // Close context
      if (this.context) {
        try {
          await this.context.close();
        } catch {
          // Context may already be closed
        }
      }

      // Close browser
      if (this.browser) {
        try {
          await this.browser.close();
        } catch {
          // Browser may already be closed
        }
      }
    }

    this.browser = null;
    this.context = null;
    this.isExternalBrowser = false;
    this.isPersistentContext = false;
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
    // For persistent contexts, we don't have a browser object
    if (this.isPersistentContext) {
      return this.context !== null && this._connectionState === 'connected';
    }
    return this.browser?.isConnected() ?? false;
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
      pages.map(async (page) => {
        if (page.page.isClosed()) {
          return false;
        }
        if (!page.cdp.isActive()) {
          return false;
        }

        try {
          await page.cdp.send('Page.getFrameTree', undefined);
          return true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warning('CDP probe failed', { page_id: page.page_id, error: message });
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

    if (handle.page.isClosed()) {
      throw new Error(`Page is closed: ${page_id}`);
    }

    if (!this.context) {
      throw new Error('Browser context not available');
    }

    // Close old CDP session (best effort)
    try {
      await handle.cdp.close();
    } catch {
      // Ignore - may already be closed
    }

    // Create new CDP session
    const cdpSession = await this.context.newCDPSession(handle.page);
    const newCdp = new PlaywrightCdpClient(cdpSession);

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
   * @param path - Optional file path to save state to. If not provided, returns the state object.
   * @returns The storage state object
   * @throws Error if browser not running
   */
  async saveStorageState(path?: string): Promise<StorageState> {
    if (!this.context) {
      throw new Error('Browser not running');
    }

    if (path) {
      return await this.context.storageState({ path });
    }
    return await this.context.storageState();
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
}
