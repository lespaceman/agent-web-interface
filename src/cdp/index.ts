/**
 * CDP Module
 *
 * Exports CDP client interfaces and implementations.
 */

// Interface
export type {
  CdpClient,
  CdpEventHandler,
  CdpClientOptions,
  CdpMethodMap,
  CdpEventMap,
} from './cdp-client.interface.js';

// Implementations
export { PlaywrightCdpClient } from './playwright-cdp-client.js';

// Re-export devtools-protocol types for convenience
export type { Protocol } from 'devtools-protocol';
