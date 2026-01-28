/**
 * Diagnostics Module
 *
 * Tools for debugging snapshot failures and page state issues.
 */

export { CdpEventLogger, type CdpEventEntry } from './cdp-event-logger.js';
export {
  checkPageHealth,
  formatHealthReport,
  type PageHealthReport,
} from './page-health.js';
