/**
 * Playwright CDP Client
 *
 * CdpClient implementation wrapping Playwright's CDPSession.
 * Provides a consistent interface for CDP communication regardless
 * of the underlying browser automation framework.
 */

import type { CDPSession } from 'playwright';
import type { CdpClient, CdpEventHandler, CdpClientOptions } from './cdp-client.interface.js';
import type { CdpHealthDiagnostics } from '../state/health.types.js';
import { getLogger } from '../shared/services/logging.service.js';

/**
 * CdpClient implementation wrapping Playwright's CDPSession.
 *
 * @example
 * ```typescript
 * import { chromium } from 'playwright';
 *
 * const browser = await chromium.launch();
 * const context = await browser.newContext();
 * const page = await context.newPage();
 *
 * // Create CDP session from Playwright page
 * const cdpSession = await context.newCDPSession(page);
 * const cdp = new PlaywrightCdpClient(cdpSession);
 *
 * // Use CDP commands
 * const doc = await cdp.send('DOM.getDocument', { depth: -1 });
 * ```
 */
export class PlaywrightCdpClient implements CdpClient {
  /** Default CDP domains that don't have .enable() methods */
  private static readonly DEFAULT_DOMAINS_WITHOUT_ENABLE = new Set([
    'Browser',
    'Target',
    'SystemInfo',
    'Input',
    'IO',
    'DeviceAccess',
    'Tethering',
    'HeapProfiler',
    'Schema',
  ]);

  private active = true;
  private readonly logger = getLogger();
  private readonly timeout: number;
  private readonly enabledDomains = new Set<string>();
  private readonly eventHandlers = new Map<string, Set<CdpEventHandler>>();
  private readonly domainsWithoutEnable: Set<string>;
  /** Last error message from CDP operations */
  private lastError?: string;
  /** Timestamp of last error */
  private lastErrorTime?: Date;

  constructor(
    private readonly session: CDPSession,
    options: CdpClientOptions = {}
  ) {
    this.timeout = options.timeout ?? 30000;
    this.domainsWithoutEnable = options.domainsWithoutEnable
      ? new Set(options.domainsWithoutEnable)
      : PlaywrightCdpClient.DEFAULT_DOMAINS_WITHOUT_ENABLE;
    // Note: CDPSession doesn't expose lifecycle events.
    // State is tracked via close() and error handling in send().
  }

  /**
   * Send a CDP command and wait for response.
   * Automatically enables required domains if not already enabled.
   */
  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.active) {
      throw new Error('CDP session is closed');
    }

    // Validate method format (must be Domain.method)
    if (!method.includes('.')) {
      throw new Error(`Invalid CDP method format: "${method}". Expected "Domain.method" format.`);
    }

    // Extract domain from method (e.g., 'DOM' from 'DOM.getDocument')
    const domain = method.split('.')[0];

    // Auto-enable domain if needed (except for *.enable and *.disable methods)
    if (
      !this.enabledDomains.has(domain) &&
      !method.endsWith('.enable') &&
      !method.endsWith('.disable')
    ) {
      await this.enableDomain(domain);
    }

    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Playwright's CDPSession.send() accepts method as string and params as object
      // The type assertion is needed because Playwright types are more restrictive
      const result = await Promise.race([
        this.session.send(method as Parameters<CDPSession['send']>[0], params),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`CDP command timed out after ${this.timeout}ms: ${method}`));
          }, this.timeout);
        }),
      ]);

      return result as T;
    } catch (error) {
      // Detect session disconnection from error messages
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Track error for health diagnostics
      this.lastError = errorMessage;
      this.lastErrorTime = new Date();

      if (
        errorMessage.includes('Target closed') ||
        errorMessage.includes('Session closed') ||
        errorMessage.includes('detached')
      ) {
        this.active = false;
        this.enabledDomains.clear();
      }

      // Use debug level for expected failures (e.g., box model for hidden elements)
      const isExpectedFailure = this.isExpectedCdpFailure(method, errorMessage);
      if (isExpectedFailure) {
        this.logger.debug(`CDP command expected failure: ${method} - ${errorMessage}`);
      } else {
        this.logger.error(
          `CDP command failed: ${method}`,
          error instanceof Error ? error : undefined
        );
      }
      throw error;
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Subscribe to CDP events.
   */
  on(event: string, handler: CdpEventHandler): void {
    // Track handler for cleanup on close()
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Playwright CDPSession uses typed events, but we need to handle any event name
    this.session.on(event as Parameters<CDPSession['on']>[0], handler as () => void);
  }

  /**
   * Unsubscribe from CDP events.
   */
  off(event: string, handler: CdpEventHandler): void {
    // Remove from tracking and clean up empty Sets
    const handlers = this.eventHandlers.get(event);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this.eventHandlers.delete(event);
    }

    this.session.off(event as Parameters<CDPSession['off']>[0], handler as () => void);
  }

  /**
   * Subscribe to a CDP event once (auto-unsubscribes after first fire).
   */
  once(event: string, handler: CdpEventHandler): void {
    const wrappedHandler = (params: Record<string, unknown>) => {
      this.off(event, wrappedHandler);
      handler(params);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Close/detach the CDP session.
   */
  async close(): Promise<void> {
    if (this.active) {
      try {
        // Remove all tracked event handlers first
        this.removeAllEventHandlers();
        await this.session.detach();
      } catch (error) {
        // Session may already be detached
        this.logger.debug('Error detaching CDP session (may already be detached)', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.active = false;
        this.enabledDomains.clear();
        this.eventHandlers.clear();
      }
    }
  }

  /**
   * Check if a CDP failure is expected (not worth logging as error).
   * Some CDP commands fail for valid reasons (e.g., box model for hidden elements).
   */
  private isExpectedCdpFailure(method: string, errorMessage: string): boolean {
    // DOM.getBoxModel fails for non-rendered elements
    if (method === 'DOM.getBoxModel' && errorMessage.includes('Could not compute box model')) {
      return true;
    }
    // CSS.getComputedStyleForNode may fail for detached nodes
    if (method === 'CSS.getComputedStyleForNode' && errorMessage.includes('not found')) {
      return true;
    }
    return false;
  }

  /**
   * Remove all tracked event handlers from the session.
   */
  private removeAllEventHandlers(): void {
    for (const [event, handlers] of this.eventHandlers) {
      for (const handler of handlers) {
        try {
          this.session.off(event as Parameters<CDPSession['off']>[0], handler as () => void);
        } catch {
          // Handler may already be removed
        }
      }
    }
  }

  /**
   * Check if session is still active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Get detailed health diagnostics for this CDP session.
   *
   * Includes:
   * - active: Whether session is operational
   * - lastError: Last error message if any
   * - lastErrorTime: When the last error occurred
   */
  getHealth(): CdpHealthDiagnostics {
    return {
      active: this.active,
      lastError: this.lastError,
      lastErrorTime: this.lastErrorTime,
    };
  }

  /**
   * Get the set of currently enabled CDP domains.
   */
  getEnabledDomains(): ReadonlySet<string> {
    return this.enabledDomains;
  }

  /**
   * Enable a CDP domain (e.g., 'DOM', 'Page', 'Accessibility').
   * Automatically called by send() when needed.
   */
  private async enableDomain(domain: string): Promise<void> {
    // Check if domain doesn't require enable
    if (this.domainsWithoutEnable.has(domain)) {
      this.enabledDomains.add(domain);
      return;
    }

    try {
      await this.session.send(`${domain}.enable` as Parameters<CDPSession['send']>[0]);
      this.enabledDomains.add(domain);
      this.logger.debug(`Enabled CDP domain: ${domain}`);
    } catch {
      // Some domains may not support enable or may already be enabled
      this.logger.debug(
        `Could not enable domain ${domain} (may not support enable or already enabled)`
      );
      // Still mark as enabled to avoid repeated attempts
      this.enabledDomains.add(domain);
    }
  }
}
