/**
 * Session Handler
 *
 * Handles session-related tools:
 * - session_cookies_get: Get cookies
 * - session_cookies_set: Set cookies
 * - session_state_get: Get session state
 * - session_state_set: Restore session state
 * - session_close: Close session
 */

import type {
  SessionCookiesGetParams,
  SessionCookiesGetResponse,
  SessionCookiesSetParams,
  SessionCookiesSetResponse,
  SessionStateGetParams,
  SessionStateGetResponse,
  SessionStateSetParams,
  SessionStateSetResponse,
  SessionCloseParams,
  SessionCloseResponse,
} from '../session.types.js';
import type { BrowserCookie, SessionState } from '../../../shared/types/index.js';
import type { NavGetUrlParams } from '../../navigation/navigation.types.js';

interface CdpBridge {
  executeDevToolsMethod<T>(method: string, params?: unknown): Promise<T>;
}

interface NavigationHandler {
  getUrl(params: NavGetUrlParams): Promise<{ url: string; title?: string }>;
}

/**
 * Session Handler
 *
 * Manages browser session state, cookies, and lifecycle
 */
export class SessionHandler {
  private sessionState: SessionState | null = null;

  constructor(
    private readonly cdpBridge: CdpBridge,
    private readonly navigationHandler: NavigationHandler
  ) {}

  /**
   * Handle session_cookies_get tool
   *
   * Get all cookies or cookies for specific URLs
   */
  async getCookies(params: SessionCookiesGetParams): Promise<SessionCookiesGetResponse> {
    try {
      const result = await this.cdpBridge.executeDevToolsMethod<{
        cookies: BrowserCookie[];
      }>('Network.getCookies', {
        urls: params.urls,
      });

      return {
        cookies: result.cookies ?? [],
      };
    } catch (error) {
      console.error('Failed to get cookies:', error);
      return {
        cookies: [],
      };
    }
  }

  /**
   * Handle session_cookies_set tool
   *
   * Set one or more cookies
   */
  async setCookies(params: SessionCookiesSetParams): Promise<SessionCookiesSetResponse> {
    try {
      // Set each cookie
      for (const cookie of params.cookies) {
        await this.cdpBridge.executeDevToolsMethod('Network.setCookie', {
          name: cookie.name,
          value: cookie.value,
          url: cookie.url,
          domain: cookie.domain,
          path: cookie.path ?? '/',
          secure: cookie.secure ?? false,
          httpOnly: cookie.httpOnly ?? false,
          sameSite: cookie.sameSite ?? 'Lax',
          expires: cookie.expires,
        });
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle session_state_get tool
   *
   * Get current session state (URL, cookies, localStorage)
   */
  async getState(_params: SessionStateGetParams): Promise<SessionStateGetResponse> {
    try {
      // Get current URL
      const urlInfo = await this.navigationHandler.getUrl({});

      // Get cookies
      const cookiesResult = await this.getCookies({});

      // Get localStorage (if available)
      let localStorage: Record<string, string> = {};
      try {
        const localStorageResult = await this.cdpBridge.executeDevToolsMethod<{
          result: { value: Record<string, string> };
        }>('Runtime.evaluate', {
          expression: `
            (function() {
              const storage = {};
              for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key) {
                  storage[key] = window.localStorage.getItem(key);
                }
              }
              return storage;
            })()
          `,
          returnByValue: true,
        });
        localStorage = localStorageResult.result.value;
      } catch {
        // localStorage might not be available
      }

      const state: SessionState = {
        url: urlInfo.url,
        title: urlInfo.title,
        cookies: cookiesResult.cookies,
        localStorage,
        timestamp: Date.now(),
      };

      this.sessionState = state;

      return {
        state,
      };
    } catch {
      // Return minimal state
      return {
        state: {
          url: '',
          cookies: [],
          localStorage: {},
          timestamp: Date.now(),
        },
      };
    }
  }

  /**
   * Handle session_state_set tool
   *
   * Restore session state (navigate to URL, set cookies, localStorage)
   */
  async setState(params: SessionStateSetParams): Promise<SessionStateSetResponse> {
    try {
      const state = params.state;

      // Step 1: Set cookies first
      if (state.cookies && state.cookies.length > 0) {
        await this.setCookies({
          cookies: state.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expires: c.expires,
          })),
        });
      }

      // Step 2: Navigate to URL if provided
      if (state.url) {
        await this.cdpBridge.executeDevToolsMethod('Page.navigate', {
          url: state.url,
        });

        // Wait for page load
        await this.sleep(2000);
      }

      // Step 3: Restore localStorage
      if (state.localStorage && Object.keys(state.localStorage).length > 0) {
        await this.cdpBridge.executeDevToolsMethod('Runtime.evaluate', {
          expression: `
            (function() {
              const storage = ${JSON.stringify(state.localStorage)};
              for (const [key, value] of Object.entries(storage)) {
                window.localStorage.setItem(key, value);
              }
            })()
          `,
        });
      }

      this.sessionState = state;

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle session_close tool
   *
   * Close the browser session, optionally saving state
   */
  async close(params: SessionCloseParams): Promise<SessionCloseResponse> {
    try {
      let state: SessionState | undefined;

      // Save state if requested
      if (params.saveState) {
        const stateResult = await this.getState({});
        state = stateResult.state;
      }

      // Close browser (using CDP)
      await this.cdpBridge.executeDevToolsMethod('Browser.close', {});

      return {
        success: true,
        state,
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
