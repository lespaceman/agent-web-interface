/**
 * Lazy Browser Initialization
 *
 * Ensures a browser is ready before tool execution.
 * If no browser is running, launches or connects based on session configuration.
 */

import type { SessionManager } from './session-manager.js';
import type { BrowserSessionConfig } from './browser-session-config.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/**
 * Determine if we should connect to an existing browser vs launch new one.
 */
function shouldConnect(config: BrowserSessionConfig): boolean {
  return !!(config.browserUrl ?? config.wsEndpoint ?? config.autoConnect);
}

/**
 * Ensure browser is ready for tool execution.
 *
 * If browser is already running, returns immediately.
 * Otherwise, launches or connects based on provided config.
 */
export async function ensureBrowserReady(
  session: SessionManager,
  config: BrowserSessionConfig
): Promise<void> {
  // Fast path: browser already running
  if (session.isRunning()) {
    return;
  }

  // Connection in progress: wait for it instead of starting another
  const inFlightPromise = session.connectionPromise;
  if (session.connectionState === 'connecting' && inFlightPromise) {
    logger.info('Awaiting in-flight browser connection');
    await inFlightPromise;
    return;
  }

  const mode = config.mode ?? (shouldConnect(config) ? 'connect' : 'launch');
  logger.info('Lazy browser initialization triggered', { mode });

  try {
    if (mode === 'connect') {
      await session.connect({
        browserURL: config.browserUrl,
        browserWSEndpoint: config.wsEndpoint,
        autoConnect: config.autoConnect,
        userDataDir: config.userDataDir,
      });
    } else {
      await session.launch({
        headless: config.headless ?? false,
        isolated: config.isolated ?? false,
        userDataDir: config.userDataDir,
        channel: config.channel,
        executablePath: config.executablePath,
      });
    }
    logger.info('Browser initialized successfully', { mode });
  } catch (error) {
    logger.error('Browser initialization failed', error instanceof Error ? error : undefined, {
      mode,
      headless: config.headless,
    });
    throw error;
  }
}
