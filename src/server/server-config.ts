/**
 * Server Configuration
 *
 * Global server configuration combining CLI args and environment variables.
 * Provides the ensureBrowserForTools function that tool handlers call.
 */

import { parseArgs, type ServerArgs } from '../cli/args.js';
import { SessionManager } from '../browser/session-manager.js';
import { ensureBrowserReady, type EnsureBrowserOptions } from '../browser/ensure-browser.js';

// Singleton instances
let serverConfig: ServerArgs | null = null;
let sessionManager: SessionManager | null = null;

/**
 * Initialize server configuration from CLI arguments and environment variables.
 *
 * @param argv - Command line arguments (process.argv.slice(2))
 */
export function initServerConfig(argv: string[]): void {
  const args = parseArgs(argv);

  // Apply environment variable overrides
  // Only enable autoConnect from env if no explicit browserUrl/wsEndpoint was provided
  if (process.env.AUTO_CONNECT === 'true' && !args.browserUrl && !args.wsEndpoint) {
    args.autoConnect = true;
  }

  serverConfig = args;
}

/**
 * Get the current server configuration.
 * Throws if not initialized.
 */
export function getServerConfig(): ServerArgs {
  if (!serverConfig) {
    throw new Error('Server config not initialized. Call initServerConfig() first.');
  }
  return serverConfig;
}

/**
 * Get or create the SessionManager singleton.
 */
export function getSessionManager(): SessionManager {
  sessionManager ??= new SessionManager();
  return sessionManager;
}

/**
 * Check if the SessionManager has been initialized.
 * Use this before calling getSessionManager() in cleanup paths
 * to avoid creating a new instance unnecessarily.
 */
export function isSessionManagerInitialized(): boolean {
  return sessionManager !== null;
}

/**
 * Ensure browser is ready for tool execution.
 *
 * This is the main entry point for tools to call before executing.
 * It will lazily launch or connect to a browser based on server configuration.
 */
export async function ensureBrowserForTools(): Promise<void> {
  const config = getServerConfig();
  const session = getSessionManager();

  const options: EnsureBrowserOptions = {
    headless: config.headless,
    isolated: config.isolated,
    browserUrl: config.browserUrl,
    wsEndpoint: config.wsEndpoint,
    autoConnect: config.autoConnect,
    userDataDir: config.userDataDir,
    channel: config.channel,
    executablePath: config.executablePath,
  };

  await ensureBrowserReady(session, options);
}

/**
 * Reset server state (for testing).
 */
export function resetServerState(): void {
  serverConfig = null;
  sessionManager = null;
}
