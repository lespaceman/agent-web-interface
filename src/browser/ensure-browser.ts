/**
 * Lazy Browser Initialization
 *
 * Ensures a browser is ready before tool execution.
 * If no browser is running, launches or connects based on session configuration.
 *
 * CDP endpoint can be set via AWI_CDP_URL env var (http or ws) to connect
 * to an existing browser instead of launching.
 */

import type { SessionManager } from './session-manager.js';
import type { BrowserSessionConfig } from './browser-session-config.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/**
 * Ensure browser is ready for tool execution.
 *
 * If browser is already running, returns immediately.
 * Otherwise, launches or connects based on provided config.
 * Set AWI_CDP_URL env var to connect to an existing CDP endpoint.
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

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must be falsy
  const cdpUrl = process.env.AWI_CDP_URL?.trim() || undefined;
  const mode = (cdpUrl ?? config.autoConnect) ? 'connect' : 'launch';

  logger.info('Lazy browser initialization triggered', { mode });

  try {
    if (mode === 'connect') {
      await session.connect({
        endpointUrl: cdpUrl,
        autoConnect: config.autoConnect,
      });
    } else {
      await session.launch({
        headless: config.headless ?? false,
        isolated: config.isolated ?? false,
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
