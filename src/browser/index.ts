/**
 * Browser Module
 *
 * Exports for browser lifecycle management.
 */

export { PageRegistry, type PageHandle } from './page-registry.js';
export {
  SessionManager,
  type LaunchOptions,
  type ConnectOptions,
  type SessionManagerOptions,
  type ConnectionState,
  type ConnectionStateChangeEvent,
} from './session-manager.js';
