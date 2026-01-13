/**
 * Health Types
 *
 * Types for tracking CDP session health, snapshot capture health,
 * and runtime health information in tool responses.
 *
 * These types enable:
 * - Specific failure classification (not just success/failure)
 * - Degraded state detection (connected but CDP dead)
 * - Recovery telemetry in responses
 */

// ============================================================================
// Snapshot Health Codes
// ============================================================================

/**
 * Snapshot health codes - specific reasons for snapshot failures.
 * More granular than boolean valid/invalid.
 */
export type SnapshotHealthCode =
  | 'HEALTHY' // Snapshot valid and complete
  | 'PENDING_DOM' // DOM not ready (still loading)
  | 'AX_EMPTY' // Accessibility tree empty (AX extraction failed)
  | 'DOM_EMPTY' // DOM tree empty (DOM extraction failed)
  | 'CDP_SESSION_DEAD' // CDP session closed/detached
  | 'UNKNOWN'; // Other failure

// ============================================================================
// CDP Health
// ============================================================================

/**
 * CDP session health status.
 * Tracks whether the CDP session is operational and if recovery occurred.
 */
export interface CdpHealth {
  /** Whether CDP session is operational */
  ok: boolean;
  /** Whether recovery was attempted and succeeded */
  recovered?: boolean;
  /** Recovery method used if recovery occurred */
  recovery_method?: 'rebind';
  /** Error message if not ok */
  error?: string;
}

/**
 * Detailed CDP health diagnostics from PlaywrightCdpClient.
 */
export interface CdpHealthDiagnostics {
  /** Whether session is active */
  active: boolean;
  /** Last error message if any */
  lastError?: string;
  /** Timestamp of last error */
  lastErrorTime?: Date;
}

// ============================================================================
// Snapshot Capture Health
// ============================================================================

/**
 * Snapshot capture health status.
 * Tracks whether snapshot is usable and recovery details.
 */
export interface SnapshotCaptureHealth {
  /** Whether snapshot is usable */
  ok: boolean;
  /** Whether recovery was attempted */
  recovered?: boolean;
  /** Health code explaining status */
  code: SnapshotHealthCode;
  /** Number of capture attempts */
  attempts?: number;
  /** Human-readable message */
  message?: string;
}

// ============================================================================
// Runtime Health
// ============================================================================

/**
 * Runtime health info included in tool responses.
 * This is additive - existing tool responses continue to work.
 */
export interface RuntimeHealth {
  /** CDP session health */
  cdp: CdpHealth;
  /** Snapshot capture health */
  snapshot: SnapshotCaptureHealth;
}

// ============================================================================
// Connection Health
// ============================================================================

/**
 * Connection health for session-level status.
 *
 * Goes beyond binary connected/not-connected:
 * - 'healthy': Browser connected, all CDP sessions operational
 * - 'degraded': Browser connected, but some CDP sessions dead (recoverable)
 * - 'failed': Browser disconnected
 */
export type ConnectionHealth = 'healthy' | 'degraded' | 'failed';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a healthy runtime health status.
 */
export function createHealthyRuntime(): RuntimeHealth {
  return {
    cdp: { ok: true },
    snapshot: { ok: true, code: 'HEALTHY' },
  };
}

/**
 * Create a runtime health status with CDP recovery.
 */
export function createRecoveredCdpRuntime(snapshotCode: SnapshotHealthCode): RuntimeHealth {
  return {
    cdp: { ok: true, recovered: true, recovery_method: 'rebind' },
    snapshot: { ok: snapshotCode === 'HEALTHY', code: snapshotCode },
  };
}

/**
 * Create a runtime health status for snapshot failure.
 */
export function createSnapshotFailureRuntime(
  code: SnapshotHealthCode,
  message?: string,
  attempts?: number
): RuntimeHealth {
  return {
    cdp: { ok: true },
    snapshot: {
      ok: false,
      code,
      message,
      attempts,
    },
  };
}

/**
 * Create a runtime health status for CDP failure (not recoverable).
 */
export function createCdpFailureRuntime(error: string): RuntimeHealth {
  return {
    cdp: { ok: false, error },
    snapshot: { ok: false, code: 'CDP_SESSION_DEAD' },
  };
}
