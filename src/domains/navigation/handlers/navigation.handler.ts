/**
 * Navigation Handler
 *
 * Handles all navigation-related tools:
 * - nav_goto: Navigate to URL
 * - nav_back: Go back in history
 * - nav_forward: Go forward in history
 * - nav_reload: Reload page
 * - nav_get_url: Get current URL
 * - nav_wait_for_navigation: Wait for navigation
 */

import type {
  NavGotoParams,
  NavGotoResponse,
  NavBackParams,
  NavBackResponse,
  NavForwardParams,
  NavForwardResponse,
  NavReloadParams,
  NavReloadResponse,
  NavGetUrlParams,
  NavGetUrlResponse,
  NavWaitForNavigationParams,
  NavWaitForNavigationResponse,
} from '../navigation.types.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

/**
 * Navigation Handler
 *
 * Uses CDP Page domain to control navigation
 */
export class NavigationHandler {
  private currentUrl = '';
  private currentTitle = '';

  constructor(private readonly cdpBridge: CdpBridge) {}

  /**
   * Handle nav_goto tool
   *
   * Navigate to a URL
   */
  async goto(params: NavGotoParams): Promise<NavGotoResponse> {
    try {
      // Navigate to URL
      await this.cdpBridge.executeDevToolsMethod('Page.navigate', {
        url: params.url,
      });

      // Wait for navigation if requested
      const waitUntil = params.waitUntil ?? 'load';
      await this.waitForNavigation({
        waitUntil,
        timeout: params.timeout ?? 30000,
      });

      // Update current URL
      this.currentUrl = params.url;

      return {
        success: true,
        url: params.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle nav_back tool
   *
   * Go back in browser history
   */
  async back(_params: NavBackParams): Promise<NavBackResponse> {
    try {
      // Get navigation history
      const history = await this.cdpBridge.executeDevToolsMethod<{
        currentIndex: number;
        entries: { id: number; url: string; title: string }[];
      }>('Page.getNavigationHistory', {});

      if (history.currentIndex <= 0) {
        return {
          success: false,
          error: 'Already at the first page in history',
        };
      }

      // Navigate back
      const previousEntry = history.entries[history.currentIndex - 1];
      await this.cdpBridge.executeDevToolsMethod('Page.navigateToHistoryEntry', {
        entryId: previousEntry.id,
      });

      // Wait for navigation
      await this.sleep(1000);

      this.currentUrl = previousEntry.url;

      return {
        success: true,
        currentUrl: previousEntry.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle nav_forward tool
   *
   * Go forward in browser history
   */
  async forward(_params: NavForwardParams): Promise<NavForwardResponse> {
    try {
      // Get navigation history
      const history = await this.cdpBridge.executeDevToolsMethod<{
        currentIndex: number;
        entries: { id: number; url: string; title: string }[];
      }>('Page.getNavigationHistory', {});

      if (history.currentIndex >= history.entries.length - 1) {
        return {
          success: false,
          error: 'Already at the last page in history',
        };
      }

      // Navigate forward
      const nextEntry = history.entries[history.currentIndex + 1];
      await this.cdpBridge.executeDevToolsMethod('Page.navigateToHistoryEntry', {
        entryId: nextEntry.id,
      });

      // Wait for navigation
      await this.sleep(1000);

      this.currentUrl = nextEntry.url;

      return {
        success: true,
        currentUrl: nextEntry.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle nav_reload tool
   *
   * Reload the current page
   */
  async reload(params: NavReloadParams): Promise<NavReloadResponse> {
    try {
      await this.cdpBridge.executeDevToolsMethod('Page.reload', {
        ignoreCache: params.ignoreCache ?? false,
      });

      // Wait for reload
      await this.sleep(1000);

      return {
        success: true,
        url: this.currentUrl,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle nav_get_url tool
   *
   * Get current URL and title
   */
  async getUrl(_params: NavGetUrlParams): Promise<NavGetUrlResponse> {
    // Try to get URL from Runtime.evaluate
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        result: { value: { url: string; title: string } };
      }>('Runtime.evaluate', {
        expression: '({ url: window.location.href, title: document.title })',
        returnByValue: true,
      });

      this.currentUrl = result.result.value.url;
      this.currentTitle = result.result.value.title;

      return {
        url: this.currentUrl,
        title: this.currentTitle,
      };
    } catch {
      // Fallback to cached values
      return {
        url: this.currentUrl,
        title: this.currentTitle,
      };
    }
  }

  /**
   * Handle nav_wait_for_navigation tool
   *
   * Wait for navigation to complete
   */
  async waitForNavigation(
    params: NavWaitForNavigationParams
  ): Promise<NavWaitForNavigationResponse> {
    try {
      const waitUntil = params.waitUntil ?? 'load';
      const timeout = params.timeout ?? 30000;

      // Enable page lifecycle events
      await this.cdpBridge.executeDevToolsMethod('Page.enable', {});

      // Wait for the appropriate event
      const startTime = Date.now();
      let eventFired = false;

      // Poll for page lifecycle
      while (!eventFired && Date.now() - startTime < timeout) {
        try {
          // Check if page is loaded
          const result = await this.cdpBridge.executeDevToolsMethod<{
            result: { value: string };
          }>('Runtime.evaluate', {
            expression: 'document.readyState',
            returnByValue: true,
          });

          const readyState = result.result.value;

          if (waitUntil === 'domcontentloaded' && readyState !== 'loading') {
            eventFired = true;
          } else if (waitUntil === 'load' && readyState === 'complete') {
            eventFired = true;
          } else if (waitUntil === 'networkidle') {
            // For network idle, just wait a bit longer
            await this.sleep(500);
            eventFired = true;
          }

          if (!eventFired) {
            await this.sleep(100);
          }
        } catch {
          // Ignore errors and retry
          await this.sleep(100);
        }
      }

      if (!eventFired) {
        return {
          success: false,
          error: `Navigation timeout after ${timeout}ms`,
        };
      }

      // Get current URL
      const urlInfo = await this.getUrl({});

      return {
        success: true,
        url: urlInfo.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
