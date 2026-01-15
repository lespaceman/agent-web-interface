/**
 * Types and interfaces for DOM observation capture.
 *
 * DOM Observations capture significant mutations (toasts, dialogs, banners, overlays)
 * that appear during or between actions. These are integrated as "observations" in
 * the snapshot response.
 */

/**
 * Signals used to compute significance of a DOM mutation.
 * All signals are derived from universal web standards - no hardcoded patterns.
 */
export interface SignificanceSignals {
  // Semantic signals (from ARIA/HTML attributes)
  hasAlertRole: boolean; // role="alert|status|log|alertdialog"
  hasAriaLive: boolean; // aria-live="polite|assertive"
  isDialog: boolean; // role="dialog", <dialog>, aria-modal="true"

  // Visual signals (from computed styles)
  isFixedOrSticky: boolean; // position: fixed|sticky
  hasHighZIndex: boolean; // z-index > 1000
  coversSignificantViewport: boolean; // width > 50vw OR height > 30vh

  // Structural signals
  isBodyDirectChild: boolean; // parent === document.body
  containsInteractiveElements: boolean; // has button, a, input, select, textarea

  // Temporal signals (computed by accumulator)
  appearedAfterDelay: boolean; // appeared > 100ms after page load/action
  wasShortLived: boolean; // existed < 3000ms before removal
}

/**
 * Significance scoring weights.
 * Total score >= SIGNIFICANCE_THRESHOLD to be included in observations.
 */
export const SIGNIFICANCE_WEIGHTS: Record<keyof SignificanceSignals, number> = {
  // Semantic (strongest signals)
  hasAlertRole: 3,
  hasAriaLive: 3,
  isDialog: 3,

  // Visual signals
  isFixedOrSticky: 2,
  hasHighZIndex: 1,
  coversSignificantViewport: 2,

  // Structural signals
  isBodyDirectChild: 1,
  containsInteractiveElements: 1,

  // Temporal signals
  appearedAfterDelay: 2,
  wasShortLived: 2,
};

export const SIGNIFICANCE_THRESHOLD = 3;

/**
 * Compute significance score from signals.
 */
export function computeSignificance(signals: SignificanceSignals): number {
  let score = 0;
  for (const [key, weight] of Object.entries(SIGNIFICANCE_WEIGHTS)) {
    if (signals[key as keyof SignificanceSignals]) {
      score += weight;
    }
  }
  return score;
}

/**
 * Content captured from an observed element.
 */
export interface ObservedContent {
  tag: string; // Always present (div, dialog, etc.)
  role?: string; // ARIA role if present
  ariaLabel?: string; // Accessible name if present
  text: string; // Truncated to 200 chars
  hasInteractives: boolean; // Contains actionable elements?
}

/**
 * A single DOM observation - an element that appeared or disappeared.
 */
export interface DOMObservation {
  type: 'appeared' | 'disappeared';

  /** Computed significance score */
  significance: number;

  /** Signals that contributed to the score */
  signals: SignificanceSignals;

  /** Element content */
  content: ObservedContent;

  /** If element still exists in snapshot, its eid for targeting */
  eid?: string;

  /** When the mutation occurred (epoch ms) */
  timestamp: number;

  /** For 'disappeared': how long element was visible (ms) */
  durationMs?: number;

  /** For unreported observations: time since observation (ms) */
  ageMs?: number;

  /** Has this observation been included in a response? */
  reported: boolean;
}

/**
 * Raw mutation entry captured by the persistent observer.
 * Lives in browser context (window.__observationAccumulator).
 */
export interface RawMutationEntry {
  type: 'added' | 'removed';
  timestamp: number;

  // Element identification
  tag: string;
  id?: string;

  // Semantic attributes (for signal computation)
  role?: string;
  ariaLive?: string;
  ariaLabel?: string;
  ariaModal?: string;

  // Content
  text: string; // Already truncated to 200 chars
  hasInteractives: boolean;

  // Visual signals (captured at mutation time)
  isFixedOrSticky: boolean;
  zIndex: number;
  viewportCoverage: { widthPct: number; heightPct: number };

  // Structural signals
  isBodyDirectChild: boolean;

  // Temporal signals
  appearedAfterDelay?: boolean;

  // Computed significance
  significance: number;
}

/**
 * Observations grouped by when they occurred.
 */
export interface ObservationGroups {
  /** Observations from the current action's time window */
  duringAction: DOMObservation[];
  /** Accumulated observations since previous tool call */
  sincePrevious: DOMObservation[];
}
