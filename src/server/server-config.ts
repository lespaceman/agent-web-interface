/**
 * Server Configuration
 *
 * Global server configuration from CLI args and environment variables.
 * Contains only transport-level settings (transport mode, port).
 *
 * Browser configuration is per-session and managed by SessionController.
 */

import { parseArgs, type ServerArgs } from '../cli/args.js';

// Singleton config
let serverConfig: ServerArgs | null = null;

/**
 * Initialize server configuration from CLI arguments and environment variables.
 *
 * @param argv - Command line arguments (process.argv.slice(2))
 */
export function initServerConfig(argv: string[]): void {
  serverConfig = parseArgs(argv);
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
 * Reset server state (for testing).
 */
export function resetServerState(): void {
  serverConfig = null;
}
