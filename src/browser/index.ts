/**
 * Browser Module
 *
 * Exports for browser lifecycle management.
 */

export { PageRegistry, type PageHandle } from './page-registry.js';
export { SessionManager } from './session-manager.js';
export type {
  ChromeChannel,
  LaunchOptions,
  ConnectOptions,
  ConnectionState,
  ConnectionStateChangeEvent,
} from './session-manager.types.js';
export { CHROME_CHANNELS } from './session-manager.types.js';
export { extractErrorMessage } from './connection-utils.js';
