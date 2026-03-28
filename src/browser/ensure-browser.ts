/**
 * Lazy Browser Initialization
 *
 * Ensures a browser is ready before tool execution.
 * If no browser is running, launches or connects based on session configuration.
 *
 * When a persistent profile is in use and Chrome is already running (from a
 * previous session or another agent), reconnects via DevToolsActivePort instead
 * of failing on the profile lock.
 *
 * CDP endpoint can be set via AWI_CDP_URL env var (http or ws) to connect
 * to an existing browser instead of launching.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionManager } from './session-manager.js';
import { DEFAULT_USER_DATA_DIR } from './session-manager.js';
import type { BrowserSessionConfig } from './browser-session-config.js';
import { extractErrorMessage } from './connection-utils.js';
import { getLogger } from '../shared/services/logging.service.js';

const logger = getLogger();

/** Short timeout for reconnect attempts — these are fast pre-checks, not full connections */
const RECONNECT_TIMEOUT_MS = 5000;

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
  const shouldConnect = !!(cdpUrl ?? config.autoConnect);

  if (shouldConnect) {
    logger.info('Lazy browser initialization triggered', { mode: 'connect' });
    try {
      await session.connect({
        endpointUrl: cdpUrl,
        autoConnect: config.autoConnect,
      });
      logger.info('Browser initialized successfully', { mode: 'connect' });
    } catch (error) {
      logger.error('Browser initialization failed', error instanceof Error ? error : undefined, {
        mode: 'connect',
      });
      throw error;
    }
    return;
  }

  // Launch mode — try reconnecting to an existing browser first (persistent profiles only)
  const profileDir = config.isolated ? undefined : DEFAULT_USER_DATA_DIR;

  if (profileDir && (await hasPortFile(profileDir)) && (await tryReconnect(session, profileDir))) {
    return;
  }

  // Launch a new browser
  logger.info('Lazy browser initialization triggered', { mode: 'launch' });
  try {
    await session.launch({
      headless: config.headless ?? false,
      isolated: config.isolated ?? false,
    });
    logger.info('Browser initialized successfully', { mode: 'launch' });
  } catch (error) {
    // Another process may have grabbed the profile between our reconnect attempt
    // and launch (race condition). Try reconnecting one more time.
    if (profileDir && isProfileLockError(error) && (await tryReconnect(session, profileDir))) {
      return;
    }

    logger.error('Browser initialization failed', error instanceof Error ? error : undefined, {
      mode: 'launch',
      headless: config.headless,
    });
    throw error;
  }
}

/**
 * Check if DevToolsActivePort file exists in the profile directory.
 * Used to skip the reconnect attempt entirely on cold starts where
 * Chrome has never run, avoiding wasted I/O.
 */
async function hasPortFile(profileDir: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(profileDir, 'DevToolsActivePort'), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to reconnect to an existing Chrome via its DevToolsActivePort file.
 * Returns true on success. On failure, returns false.
 * Uses a short timeout since this is a fast pre-check, not a full connection attempt.
 */
async function tryReconnect(session: SessionManager, profileDir: string): Promise<boolean> {
  try {
    await session.connect({
      autoConnect: true,
      userDataDir: profileDir,
      ownedReconnect: true,
      timeout: RECONNECT_TIMEOUT_MS,
    });
    logger.info('Reconnected to existing browser');
    return true;
  } catch (error) {
    logger.warning('Reconnect to existing browser failed', {
      error: extractErrorMessage(error),
    });
    return false;
  }
}

/**
 * Detect Chrome profile-lock errors from Puppeteer.
 * Matches against Puppeteer's error text which includes "already running for <path>"
 * when the SingletonLock file prevents a second Chrome instance.
 */
function isProfileLockError(error: unknown): boolean {
  const msg = extractErrorMessage(error);
  return /already running for|already in use|SingletonLock/i.test(msg);
}
