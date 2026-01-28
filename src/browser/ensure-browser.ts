/**
 * Lazy Browser Initialization
 *
 * Ensures a browser is ready before tool execution.
 * If no browser is running, launches or connects based on CLI configuration.
 */

import type { SessionManager } from './session-manager.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/**
 * Options for lazy browser initialization.
 */
export interface EnsureBrowserOptions {
  /** Run browser in headless mode (default: false) */
  headless?: boolean;

  /** Use isolated temp profile (default: false) */
  isolated?: boolean;

  /** HTTP endpoint URL for connecting to existing browser */
  browserUrl?: string;

  /** WebSocket endpoint URL for connecting to existing browser */
  wsEndpoint?: string;

  /** Auto-connect to Chrome 144+ via DevToolsActivePort */
  autoConnect?: boolean;

  /** Chrome user data directory */
  userDataDir?: string;

  /** Chrome channel */
  channel?: 'chrome' | 'chrome-canary' | 'chrome-beta' | 'chrome-dev';

  /** Path to Chrome executable */
  executablePath?: string;
}

/**
 * Determine if we should connect to an existing browser vs launch new one.
 */
function shouldConnect(options: EnsureBrowserOptions): boolean {
  return !!(options.browserUrl ?? options.wsEndpoint ?? options.autoConnect);
}

/**
 * Ensure browser is ready for tool execution.
 *
 * If browser is already running, returns immediately.
 * Otherwise, launches or connects based on provided options.
 *
 * @param session - SessionManager instance
 * @param options - Configuration options from CLI
 */
export async function ensureBrowserReady(
  session: SessionManager,
  options: EnsureBrowserOptions
): Promise<void> {
  // Fast path: browser already running
  if (session.isRunning()) {
    return;
  }

  const mode = shouldConnect(options) ? 'connect' : 'launch';
  logger.info('Lazy browser initialization triggered', { mode });

  try {
    if (shouldConnect(options)) {
      // Connect to existing browser
      await session.connect({
        browserURL: options.browserUrl,
        browserWSEndpoint: options.wsEndpoint,
        autoConnect: options.autoConnect,
        userDataDir: options.userDataDir,
      });
    } else {
      // Launch new browser
      await session.launch({
        headless: options.headless ?? false,
        isolated: options.isolated ?? false,
        userDataDir: options.userDataDir,
        channel: options.channel,
        executablePath: options.executablePath,
      });
    }
    logger.info('Browser initialized successfully', { mode });
  } catch (error) {
    logger.error('Browser initialization failed', error instanceof Error ? error : undefined, {
      mode,
      browserUrl: options.browserUrl,
      wsEndpoint: options.wsEndpoint,
      autoConnect: options.autoConnect,
      headless: options.headless,
      userDataDir: options.userDataDir,
    });
    throw error;
  }
}
