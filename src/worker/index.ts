/**
 * Worker Module
 *
 * Exports the Browser Worker Manager system for managing tenant-bound
 * Chrome workers with exclusive lease-based access control.
 */

// Main orchestrator
export { WorkerManager } from './worker-manager.js';

// Error handling
export { WorkerError, type WorkerErrorCode } from './errors/index.js';

// Types
export type {
  WorkerState,
  LeaseStatus,
  WorkerDescriptor,
  LeaseDescriptor,
  LeaseAcquisitionResult,
  WorkerManagerConfig,
  PortRange,
  HealthCheckResult,
  CdpVersionInfo,
  WorkerProcessEvents,
  HealthMonitorEvents,
  WorkerManagerEvents,
} from './types.js';

export { DEFAULT_WORKER_CONFIG, CHROME_WORKER_ARGS } from './types.js';

// Component classes (for advanced usage/testing)
export { PortAllocator, type PortAllocatorConfig } from './port-allocator.js';
export { ChromeWorkerProcess, type ChromeWorkerProcessConfig, findChromePath } from './chrome-worker-process.js';
export { HealthMonitor, type HealthCheckConfig } from './health-monitor.js';
export { LeaseManager, type LeaseManagerConfig } from './lease-manager.js';

// Multi-tenant configuration
export {
  getMultiTenantConfig,
  validateMultiTenantConfig,
  type MultiTenantConfig,
} from './multi-tenant-config.js';
