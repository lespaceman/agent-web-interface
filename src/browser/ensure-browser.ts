/**
 * Lazy Browser Initialization
 *
 * Ensures a browser is ready before tool execution.
 * Supports three modes: user (connect to existing Chrome), persistent
 * (launch with dedicated profile), and isolated (launch with temp profile).
 *
 * Mode is determined by AWI_BROWSER_MODE env var:
 *   - Set explicitly → try that mode only, fail on error
 *   - Unset (auto)   → fallback chain: user → persistent → isolated
 *
 * AWI_CDP_URL overrides everything — connect to explicit endpoint, no fallback.
 */

import type { SessionManager } from './session-manager.js';
import type { BrowserMode, BrowserSessionConfig } from './browser-session-config.js';
import { extractErrorMessage } from './connection-utils.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/** Auto-mode fallback order when AWI_BROWSER_MODE is unset */
const AUTO_FALLBACK_CHAIN: BrowserMode[] = ['user', 'persistent', 'isolated'];

/**
 * Ensure browser is ready for tool execution.
 *
 * If browser is already running, returns immediately.
 * Otherwise, launches or connects based on the session config.
 */
export async function ensureBrowserReady(
  session: SessionManager,
  config: BrowserSessionConfig
): Promise<void> {
  if (session.isRunning()) {
    return;
  }

  const inFlightPromise = session.connectionPromise;
  if (session.connectionState === 'connecting' && inFlightPromise) {
    logger.info('Awaiting in-flight browser connection');
    await inFlightPromise;
    return;
  }

  // Explicit CDP URL — connect only, no fallback
  if (config.cdpUrl) {
    logger.info('Connecting to explicit CDP endpoint', { cdpUrl: config.cdpUrl });
    try {
      await session.connect({ endpointUrl: config.cdpUrl });
      logger.info('Connected to CDP endpoint');
    } catch (error) {
      const msg = extractErrorMessage(error);
      throw new Error(
        `Failed to connect to CDP endpoint (${config.cdpUrl}): ${msg}. ` +
          'Check that the browser is running and the endpoint is correct.'
      );
    }
    return;
  }

  // Explicit mode — try it only, no fallback
  if (config.browserMode) {
    logger.info('Browser mode (explicit)', { mode: config.browserMode });
    await attemptMode(session, config.browserMode, config.headless);
    return;
  }

  // Auto mode — fallback chain: user → persistent → isolated
  let lastError: Error | undefined;

  for (const mode of AUTO_FALLBACK_CHAIN) {
    try {
      logger.info('Browser mode (auto)', { attempting: mode });
      await attemptMode(session, mode, config.headless);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(extractErrorMessage(error));
      logger.info('Browser mode failed, trying next', {
        mode,
        error: lastError.message,
      });
    }
  }

  throw new Error(`All browser modes exhausted. Last error: ${lastError?.message ?? 'unknown'}`);
}

/**
 * Attempt a specific browser mode.
 */
async function attemptMode(
  session: SessionManager,
  mode: BrowserMode,
  headless: boolean
): Promise<void> {
  if (mode === 'user') {
    // Puppeteer's channel:'chrome' reads DevToolsActivePort from Chrome's well-known user data dir
    try {
      await session.connect({ autoConnect: true });
      logger.info('Connected to user Chrome');
    } catch (error) {
      const msg = extractErrorMessage(error);
      throw new Error(
        `Could not connect to Chrome: ${msg}. ` +
          'Ensure Chrome is running with remote debugging enabled.'
      );
    }
  } else {
    const isolated = mode === 'isolated';
    try {
      await session.launch({ headless, isolated });
      logger.info(`Launched browser (${mode} profile)`);
    } catch (error) {
      const msg = extractErrorMessage(error);
      throw new Error(`Failed to launch browser (${mode}): ${msg}.`);
    }
  }
}
