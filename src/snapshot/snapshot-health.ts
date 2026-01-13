/**
 * Snapshot Health Validation
 *
 * Validates snapshot quality and handles empty/failed snapshots.
 * Provides stabilize-and-retry logic for recovering from transient failures.
 *
 * Key improvements:
 * - Empty snapshots (0 nodes) are treated as extraction failures
 * - Stabilization + retry for transient loading states
 * - Clear health metrics for debugging
 */

import type { Page } from 'playwright';
import type { CdpClient } from '../cdp/cdp-client.interface.js';
import type { BaseSnapshot } from './snapshot.types.js';
import type { SnapshotHealth, SnapshotHealthMetrics } from '../state/element-ref.types.js';
import type { SnapshotHealthCode } from '../state/health.types.js';
import { stabilizeDom } from '../delta/dom-stabilizer.js';

// ============================================================================
// Snapshot Health Validation
// ============================================================================

/**
 * Validate snapshot health - detect empty, partial, or error states.
 *
 * Rules:
 * - node_count = 0 → invalid (empty)
 * - meta.partial = true → valid but partial
 * - otherwise → valid
 *
 * @param snapshot - Snapshot to validate
 * @returns SnapshotHealth with validity status and metrics
 */
export function validateSnapshotHealth(snapshot: BaseSnapshot): SnapshotHealth {
  const metrics: SnapshotHealthMetrics = {
    node_count: snapshot.meta.node_count,
    interactive_count: snapshot.meta.interactive_count,
    capture_duration_ms: snapshot.meta.capture_duration_ms,
  };

  // Check for empty snapshot (Bug #2: 0 nodes after navigation)
  if (snapshot.nodes.length === 0 || snapshot.meta.node_count === 0) {
    return {
      valid: false,
      reason: 'empty',
      message: 'Snapshot contains no nodes. Page may be loading, navigating, or in error state.',
      metrics,
    };
  }

  // Check for no interactive elements (warning, still valid)
  if (snapshot.meta.interactive_count === 0) {
    return {
      valid: true, // Still usable, just no actionables
      reason: 'partial',
      message: 'Snapshot contains no interactive elements. Page may have only static content.',
      metrics,
    };
  }

  // Check partial flag from compiler (e.g., extraction warnings)
  if (snapshot.meta.partial) {
    return {
      valid: true, // Usable but with caveats
      reason: 'partial',
      message: snapshot.meta.warnings?.join('; ') ?? 'Partial snapshot captured.',
      metrics,
    };
  }

  // Snapshot is healthy
  return {
    valid: true,
    metrics,
  };
}

/**
 * Check if a snapshot health indicates an error that should trigger baseline.
 *
 * @param health - SnapshotHealth to check
 * @returns true if this should be treated as an error baseline
 */
export function isErrorHealth(health: SnapshotHealth): boolean {
  return !health.valid && (health.reason === 'empty' || health.reason === 'error');
}

// ============================================================================
// Stabilize and Capture with Retry
// ============================================================================

/**
 * Options for capture with stabilization.
 */
export interface CaptureWithStabilizationOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Wait time between retries in ms (default: 500) */
  retryDelayMs?: number;
  /** DOM stabilization quiet window in ms (default: 100) */
  quietWindowMs?: number;
  /** DOM stabilization max timeout in ms (default: 2000) */
  maxTimeoutMs?: number;
}

/**
 * Result of capture with stabilization.
 */
export interface CaptureWithStabilizationResult {
  snapshot: BaseSnapshot;
  health: SnapshotHealth;
  attempts: number;
  stabilizationStatus: 'stable' | 'timeout' | 'error';
}

/**
 * Capture snapshot with DOM stabilization and retry on empty results.
 *
 * Flow:
 * 1. Wait for DOM to stabilize
 * 2. Capture snapshot
 * 3. Validate health
 * 4. If empty, wait and retry (up to maxRetries)
 * 5. Return best result (or last attempt if all failed)
 *
 * @param cdp - CDP client
 * @param page - Playwright Page
 * @param pageId - Page identifier
 * @param options - Capture options
 * @returns Snapshot with health status and attempt count
 */
export async function captureWithStabilization(
  cdp: CdpClient,
  page: Page,
  pageId: string,
  options: CaptureWithStabilizationOptions = {}
): Promise<CaptureWithStabilizationResult> {
  const {
    maxRetries = 3,
    retryDelayMs = 500,
    quietWindowMs = 100,
    maxTimeoutMs = 2000,
  } = options;

  // Import compileSnapshot dynamically to avoid circular dependency
  const { compileSnapshot } = await import('./index.js');

  let lastSnapshot: BaseSnapshot | null = null;
  let lastHealth: SnapshotHealth | null = null;
  let stabilizationStatus: 'stable' | 'timeout' | 'error' = 'stable';
  let attempts = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    attempts = attempt + 1;

    // Wait for DOM to stabilize
    const stabResult = await stabilizeDom(page, { quietWindowMs, maxTimeoutMs });
    stabilizationStatus = stabResult.status;

    // Capture snapshot
    const snapshot = await compileSnapshot(cdp, page, pageId);
    const health = validateSnapshotHealth(snapshot);

    lastSnapshot = snapshot;
    lastHealth = health;

    // If snapshot is valid and not empty, we're done
    if (health.valid && health.reason !== 'empty') {
      return {
        snapshot,
        health,
        attempts,
        stabilizationStatus,
      };
    }

    // If this isn't the last attempt, wait before retry
    if (attempt < maxRetries - 1) {
      await sleep(retryDelayMs);
    }
  }

  // Return last attempt even if unhealthy
  return {
    snapshot: lastSnapshot!,
    health: lastHealth!,
    attempts,
    stabilizationStatus,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format snapshot health for logging/debugging.
 *
 * @param health - SnapshotHealth to format
 * @returns Human-readable string
 */
export function formatSnapshotHealth(health: SnapshotHealth): string {
  const parts: string[] = [];

  parts.push(health.valid ? 'VALID' : 'INVALID');

  if (health.reason) {
    parts.push(`(${health.reason})`);
  }

  if (health.metrics) {
    parts.push(`nodes=${health.metrics.node_count}`);
    parts.push(`interactive=${health.metrics.interactive_count}`);
  }

  if (health.message) {
    parts.push(`- ${health.message}`);
  }

  return parts.join(' ');
}

// ============================================================================
// Health Code Determination
// ============================================================================

/**
 * Determine the specific health code from a capture result.
 *
 * Maps capture result to specific failure codes:
 * - HEALTHY: Valid snapshot
 * - PENDING_DOM: DOM not ready (empty without specific failure)
 * - AX_EMPTY: Accessibility tree extraction failed
 * - DOM_EMPTY: DOM tree extraction failed
 * - CDP_SESSION_DEAD: CDP session closed or detached
 * - UNKNOWN: Other failure
 *
 * @param result - Capture with stabilization result
 * @returns Specific health code
 */
export function determineHealthCode(result: CaptureWithStabilizationResult): SnapshotHealthCode {
  const { health, snapshot } = result;

  // Valid snapshot = healthy
  if (health.valid && health.reason !== 'empty') {
    return 'HEALTHY';
  }

  // Check for specific error patterns
  if (!health.valid) {
    // Check message for CDP session errors
    if (health.reason === 'error' && health.message) {
      const msg = health.message.toLowerCase();
      if (
        msg.includes('session') ||
        msg.includes('target closed') ||
        msg.includes('detached')
      ) {
        return 'CDP_SESSION_DEAD';
      }
    }

    // Check snapshot warnings for extraction failures
    if (health.reason === 'empty' && snapshot.meta.warnings) {
      const warnings = snapshot.meta.warnings.join(' ').toLowerCase();
      if (warnings.includes('ax')) {
        return 'AX_EMPTY';
      }
      if (warnings.includes('dom')) {
        return 'DOM_EMPTY';
      }
    }

    // Empty without specific cause = pending DOM
    if (health.reason === 'empty') {
      return 'PENDING_DOM';
    }

    // Other errors
    if (health.reason === 'error') {
      return 'UNKNOWN';
    }
  }

  return 'UNKNOWN';
}
