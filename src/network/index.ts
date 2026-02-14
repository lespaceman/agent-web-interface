/**
 * Network Watcher module.
 *
 * Captures HTTP request/response pairs during browser automation,
 * filtered by resource type. Accumulated entries are retrieved
 * and cleared on demand.
 */

// Types
export type { CapturedNetworkEntry, NetworkResourceType } from './network-watcher.types.js';

// Constants
export {
  DEFAULT_RESOURCE_TYPES,
  ALL_RESOURCE_TYPES,
  MAX_BODY_SIZE,
  SENSITIVE_HEADERS,
} from './network-watcher.types.js';

// Watcher
export {
  NetworkWatcher,
  getOrCreateWatcher,
  getWatcher,
  removeWatcher,
} from './network-watcher.js';

// Renderer
export { renderNetworkRequestsXml } from './network-renderer.js';
