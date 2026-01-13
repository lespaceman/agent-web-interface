/**
 * State System Constants
 *
 * Centralized configuration for magic numbers used across the state system.
 * Each constant includes rationale for its value.
 */

// ============================================================================
// Element Identity Constants (element-identity.ts)
// ============================================================================

/**
 * Viewport thresholds for quadrant computation.
 * Used to compute coarse position hints for element disambiguation.
 */
export const VIEWPORT = {
  /**
   * Horizontal midpoint for quadrant detection.
   * Assumes common viewport width ~1000px (iPad, small desktop).
   * Elements left of this are 'L', right are 'R'.
   */
  MIDPOINT_X: 500,

  /**
   * Vertical midpoint for quadrant detection.
   * Assumes common viewport height ~800px or fold line at 50%.
   * Elements above this are 'T', below are 'B'.
   */
  MIDPOINT_Y: 400,
} as const;

/**
 * Accessible name normalization limits.
 */
export const ACCESSIBLE_NAME = {
  /**
   * Maximum length for normalized accessible names.
   * Truncated to prevent excessively long EID inputs.
   */
  MAX_LENGTH: 100,
} as const;

// ============================================================================
// Layer Detection Constants (layer-detector.ts)
// ============================================================================

/**
 * Layer detection confidence thresholds.
 */
export const LAYER_CONFIDENCE = {
  /**
   * Minimum confidence score to include layer in stack.
   * Candidates below this are filtered out.
   * Value chosen empirically: modal detection is high confidence (0.95+),
   * while class-based detection is lower (0.65-0.75).
   * 0.6 threshold excludes weak class matches while keeping strong patterns.
   */
  MIN_THRESHOLD: 0.6,
} as const;

/**
 * Z-index thresholds for layer type detection.
 * Modern UI libraries typically use z-index ranges:
 * - Base content: 0-50
 * - Fixed headers/footers: 50-100
 * - Drawers/sidebars: 100-500
 * - Modals: 500-1000+
 * - Tooltips/popovers: 100-500
 */
export const Z_INDEX = {
  /**
   * Z-index threshold for high-confidence modal detection.
   * Dialogs with z-index > 1000 are almost certainly modals.
   */
  MODAL_HIGH: 1000,

  /**
   * Minimum z-index for portal container detection.
   * React/Vue portals typically render at z-index >= 100.
   */
  PORTAL_MIN: 100,

  /**
   * Z-index threshold for portal area coverage check.
   * Large elements at this z-index likely cover significant viewport.
   */
  PORTAL_HIGH: 500,

  /**
   * Minimum z-index for drawer overlay detection.
   * Below this, element is likely inline nav, not overlay drawer.
   */
  DRAWER_MIN: 50,

  /**
   * Z-index threshold for confident drawer detection.
   * Drawers with z-index > 100 are likely overlay panels.
   */
  DRAWER_HIGH: 100,

  /**
   * Minimum z-index for popover detection.
   * Standard popovers (menus, tooltips) render above this.
   */
  POPOVER_MIN: 100,
} as const;

/**
 * Size thresholds for element detection.
 */
export const ELEMENT_SIZE = {
  /**
   * Minimum width for portal container detection.
   * Portals typically have meaningful content size.
   */
  PORTAL_MIN_WIDTH: 200,

  /**
   * Minimum height for portal container detection.
   */
  PORTAL_MIN_HEIGHT: 200,
} as const;

/**
 * Edge position detection thresholds.
 * Used to identify drawers positioned at viewport edges.
 */
export const EDGE_DETECTION = {
  /**
   * Maximum x-coordinate for left edge detection.
   * Elements with x < 10 are considered left-edge positioned.
   */
  LEFT_MAX_X: 10,

  /**
   * Minimum right edge position.
   * rightEdge (x + width) must exceed this to be right-edge positioned.
   * Assumes typical viewport width ~1366px (common laptop).
   */
  RIGHT_MIN: 1200,

  /**
   * Minimum x-coordinate for right edge detection.
   * Prevents false positives from wide centered elements.
   */
  RIGHT_MIN_X: 800,
} as const;
