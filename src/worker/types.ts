/**
 * Worker Module Types
 *
 * Type definitions for the Browser Worker Manager system.
 * Manages tenant-bound Chrome workers with exclusive lease-based access control.
 */

/**
 * Worker lifecycle states
 */
export type WorkerState = 'idle' | 'starting' | 'running' | 'stopping' | 'crashed' | 'stopped';

/**
 * Lease status values
 */
export type LeaseStatus = 'active' | 'expired' | 'revoked';

/**
 * Describes a Chrome worker instance
 */
export interface WorkerDescriptor {
  /** Unique worker identifier */
  workerId: string;
  /** Tenant this worker is bound to */
  tenantId: string;
  /** Current worker state */
  state: WorkerState;
  /** CDP WebSocket endpoint (e.g., ws://127.0.0.1:9300/devtools/browser/...) */
  cdpEndpoint?: string;
  /** CDP port number */
  port: number;
  /** Chrome user data directory path */
  profileDir: string;
  /** Chrome process ID */
  pid?: number;
  /** When the worker was created */
  createdAt: number;
  /** When the worker was last used */
  lastUsedAt: number;
  /** When the worker started (state became 'running') */
  startedAt?: number;
}

/**
 * Describes an active lease on a worker
 */
export interface LeaseDescriptor {
  /** Unique lease identifier */
  leaseId: string;
  /** Tenant holding the lease */
  tenantId: string;
  /** Worker being leased */
  workerId: string;
  /** When the lease was acquired */
  acquiredAt: number;
  /** When the lease expires (absolute timestamp) */
  expiresAt: number;
  /** Current lease status */
  status: LeaseStatus;
  /** Controller/session that holds the lease */
  controllerId: string;
}

/**
 * Result of attempting to acquire a lease
 */
export interface LeaseAcquisitionResult {
  /** Whether the lease was acquired */
  success: boolean;
  /** The lease descriptor if successful */
  lease?: LeaseDescriptor;
  /** CDP endpoint if successful */
  cdpEndpoint?: string;
  /** Worker ID if successful */
  workerId?: string;
  /** Error message if unsuccessful */
  error?: string;
  /** Error code if unsuccessful */
  errorCode?: string;
}

/**
 * Configuration for the WorkerManager
 */
export interface WorkerManagerConfig {
  /** Base directory for Chrome user data profiles */
  profileBaseDir: string;
  /** Time (ms) after which an idle worker is stopped */
  idleTimeoutMs: number;
  /** Maximum time (ms) a worker can run before forced restart */
  hardTtlMs: number;
  /** Default lease TTL (ms) */
  leaseTtlMs: number;
  /** Interval (ms) between health checks */
  healthCheckIntervalMs: number;
  /** Port range for CDP endpoints */
  portRange: PortRange;
  /** Maximum number of concurrent workers */
  maxWorkers: number;
  /** Path to Chrome executable (optional, auto-detected if not set) */
  chromePath?: string;
}

/**
 * Port range configuration
 */
export interface PortRange {
  /** Minimum port number (inclusive) */
  min: number;
  /** Maximum port number (inclusive) */
  max: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Whether the worker is healthy */
  healthy: boolean;
  /** Response time in ms (if healthy) */
  responseTimeMs?: number;
  /** Error message (if unhealthy) */
  error?: string;
  /** CDP version info (if healthy) */
  versionInfo?: CdpVersionInfo;
}

/**
 * CDP /json/version response
 */
export interface CdpVersionInfo {
  Browser: string;
  'Protocol-Version': string;
  'User-Agent': string;
  'V8-Version': string;
  'WebKit-Version': string;
  webSocketDebuggerUrl: string;
}

/**
 * Events emitted by ChromeWorkerProcess
 */
export interface WorkerProcessEvents {
  /** Emitted when the process starts successfully */
  started: { pid: number; cdpEndpoint: string };
  /** Emitted when the process exits */
  exit: { code: number | null; signal: string | null };
  /** Emitted on process error */
  error: { error: Error };
}

/**
 * Events emitted by HealthMonitor
 */
export interface HealthMonitorEvents {
  /** Emitted when health state changes */
  healthChange: { workerId: string; healthy: boolean; result: HealthCheckResult };
}

/**
 * Events emitted by WorkerManager
 */
export interface WorkerManagerEvents {
  /** Emitted when a worker is created */
  workerCreated: { workerId: string; tenantId: string };
  /** Emitted when a worker starts */
  workerStarted: { workerId: string; tenantId: string; cdpEndpoint: string };
  /** Emitted when a worker stops */
  workerStopped: { workerId: string; tenantId: string; reason: string };
  /** Emitted when a worker crashes */
  workerCrashed: { workerId: string; tenantId: string; exitCode: number | null };
  /** Emitted when a lease is acquired */
  leaseAcquired: { leaseId: string; tenantId: string; controllerId: string };
  /** Emitted when a lease is released */
  leaseReleased: { leaseId: string; tenantId: string };
  /** Emitted when a lease expires */
  leaseExpired: { leaseId: string; tenantId: string };
  /** Emitted when a lease is revoked */
  leaseRevoked: { leaseId: string; tenantId: string; reason: string };
}

/**
 * Default configuration values
 */
export const DEFAULT_WORKER_CONFIG: Omit<WorkerManagerConfig, 'profileBaseDir'> = {
  idleTimeoutMs: 300_000, // 5 minutes
  hardTtlMs: 7_200_000, // 2 hours
  leaseTtlMs: 300_000, // 5 minutes
  healthCheckIntervalMs: 30_000, // 30 seconds
  portRange: {
    min: 9300,
    max: 9399,
  },
  maxWorkers: 100,
};

/**
 * Chrome launch arguments for worker processes
 */
export const CHROME_WORKER_ARGS = [
  '--disable-background-networking',
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
] as const;
