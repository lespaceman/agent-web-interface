/**
 * Element Reference Types
 *
 * Core types for the ElementRef architecture that unifies element identification.
 * ElementRef wires together stable semantic identity (eid) with actionable targeting data.
 *
 * Key principles:
 * - `eid` is the stable semantic identity (survives DOM mutations)
 * - `ref` contains targeting data for actual interactions
 * - Actions resolve via eid → ref, never use eid directly as a click target
 */

// ============================================================================
// ElementRef Types
// ============================================================================

/**
 * ElementRef - Unified element reference with stable identity and actionable locators.
 */
export interface ElementRef {
  /** Stable semantic identity - 12-char hash based on role+name+landmark+position */
  eid: string;

  /** Targeting reference - how to actually find/click this element */
  ref: ElementTargetRef;
}

/**
 * ElementTargetRef - Actual targeting data for an element.
 * Contains multiple strategies for robustness.
 */
export interface ElementTargetRef {
  /** Snapshot that produced this ref - for staleness detection */
  snapshot_id: string;

  /** CDP backend node ID - primary targeting method */
  backend_node_id: number;

  /** CDP frame ID - for cross-frame targeting */
  frame_id: string;

  /** CDP loader ID - changes on navigation, for staleness detection */
  loader_id: string;

  /** Locator strategies for fallback/re-resolution */
  locators: ElementLocators;
}

/**
 * ElementLocators - Multiple strategies for finding an element.
 */
export interface ElementLocators {
  /** Preferred: AX tree locator (most stable) */
  preferred: { ax: string };

  /** Fallback: CSS selector */
  fallback?: { css: string };
}

// ============================================================================
// Snapshot Health Types
// ============================================================================

/**
 * SnapshotHealth - Validation result for a snapshot.
 * Used to detect and handle empty/failed snapshots.
 */
export interface SnapshotHealth {
  /** Whether snapshot is usable for actions */
  valid: boolean;

  /** Reason for invalidity or partial status */
  reason?: 'empty' | 'error' | 'partial';

  /** Human-readable message */
  message?: string;

  /** Metrics for debugging */
  metrics?: SnapshotHealthMetrics;
}

/**
 * Snapshot health metrics for debugging.
 */
export interface SnapshotHealthMetrics {
  node_count: number;
  interactive_count: number;
  capture_duration_ms?: number;
}

// ============================================================================
// Click Outcome Types
// ============================================================================

/**
 * ClickOutcome - Result of a click action with navigation awareness.
 * Differentiates between "element gone due to navigation" vs "element stale due to DOM mutation".
 */
export type ClickOutcome =
  | ClickOutcomeSuccess
  | ClickOutcomeStaleElement
  | ClickOutcomeElementNotFound
  | ClickOutcomeError;

/**
 * Click succeeded, optionally with navigation.
 */
export interface ClickOutcomeSuccess {
  status: 'success';
  /** Whether the click triggered a page navigation */
  navigated: boolean;
}

/**
 * Element was stale (removed from DOM).
 */
export interface ClickOutcomeStaleElement {
  status: 'stale_element';
  /** Why the element became stale */
  reason: 'dom_mutation' | 'navigation';
  /** Whether retry was attempted */
  retried: boolean;
}

/**
 * Element not found by eid.
 */
export interface ClickOutcomeElementNotFound {
  status: 'element_not_found';
  /** The eid that wasn't found */
  eid: string;
  /** Last known label for debugging */
  last_known_label?: string;
}

/**
 * Error during click.
 */
export interface ClickOutcomeError {
  status: 'error';
  /** Error message */
  message: string;
}

// ============================================================================
// Element Registry Types
// ============================================================================

/**
 * EidRegistry - Internal state for tracking eid → ElementRef mappings.
 */
export interface EidRegistry {
  /** Map eid -> current ElementRef (updated on each snapshot) */
  byEid: Map<string, ElementRef>;

  /** Map snapshot_id:backend_node_id -> eid (reverse lookup) */
  backendToEid: Map<string, string>;

  /** Last seen step for each eid (for staleness detection) */
  lastSeenStep: Map<string, number>;
}

/**
 * Result of updating the registry with a new snapshot.
 */
export interface RegistryUpdateResult {
  /** New eids added in this snapshot */
  added: string[];

  /** Eids no longer present (removed from DOM) */
  removed: string[];

  /** Eids that were updated with new targeting data */
  updated: string[];
}
