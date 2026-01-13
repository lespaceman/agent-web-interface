/**
 * Atoms Extractor
 *
 * Extract universal UI state atoms from snapshot.
 * Domain-agnostic - works on any website.
 */

import type { BaseSnapshot, NodeKind } from '../snapshot/snapshot.types.js';
import type { Atoms } from './types.js';
import { computeEid } from './element-identity.js';

// Interactive element kinds (for filtering)
const INTERACTIVE_KINDS: NodeKind[] = [
  'link',
  'button',
  'input',
  'textarea',
  'select',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'tab',
  'menuitem',
];

/**
 * Check if node kind is interactive.
 */
function isInteractiveKind(kind: NodeKind): boolean {
  return INTERACTIVE_KINDS.includes(kind);
}

// ============================================================================
// Atoms Extraction
// ============================================================================

/**
 * Extract universal UI state atoms from snapshot.
 *
 * Includes:
 * - Viewport dimensions (always)
 * - Scroll position (always)
 * - Loading indicators (optional)
 * - Form state (optional)
 * - Notifications (optional)
 *
 * @param snapshot - Compiled snapshot
 * @returns Atoms object
 */
export function extractAtoms(snapshot: BaseSnapshot): Atoms {
  const atoms: Atoms = {
    viewport: {
      w: snapshot.viewport.width,
      h: snapshot.viewport.height,
      dpr: 1.0, // TODO: get from CDP or page context
    },
    scroll: {
      x: 0, // TODO: extract from page.evaluate(() => window.scrollX)
      y: 0, // TODO: extract from page.evaluate(() => window.scrollY)
    },
  };

  // Extract loading indicators
  const loading = extractLoading(snapshot);
  if (loading) {
    atoms.loading = loading;
  }

  // Extract form state
  const forms = extractForms(snapshot);
  if (forms) {
    atoms.forms = forms;
  }

  // Extract notifications
  const notifications = extractNotifications(snapshot);
  if (notifications) {
    atoms.notifications = notifications;
  }

  return atoms;
}

// ============================================================================
// Loading Indicators
// ============================================================================

/**
 * Extract loading indicators from snapshot.
 *
 * @param snapshot - Compiled snapshot
 * @returns Loading state or undefined
 */
function extractLoading(
  snapshot: BaseSnapshot
): Atoms['loading'] | undefined {
  // Count spinner elements
  const spinners = snapshot.nodes.filter((n) => {
    if (n.attributes?.role === 'progressbar') return true;
    // Safely check aria-busy using index access
    const attrs = n.attributes as Record<string, unknown> | undefined;
    return attrs?.['aria-busy'] === 'true';
  }).length;

  if (spinners > 0) {
    return {
      network_busy: false, // TODO: track from CDP Network domain
      spinners,
      progress: undefined, // TODO: extract from progressbar value
    };
  }

  return undefined;
}

// ============================================================================
// Form State
// ============================================================================

/**
 * Extract form state from snapshot.
 *
 * @param snapshot - Compiled snapshot
 * @returns Form state or undefined
 */
function extractForms(snapshot: BaseSnapshot): Atoms['forms'] | undefined {
  // Check if any forms exist
  const hasForms = snapshot.nodes.some((n) => n.kind === 'form');
  if (!hasForms) {
    return undefined;
  }

  // Find focused input
  const focusedInput = snapshot.nodes.find(
    (n) => isInteractiveKind(n.kind) && n.state?.focused
  );

  // Count validation errors
  const validationErrors = snapshot.nodes.filter(
    (n) => isInteractiveKind(n.kind) && n.state?.invalid
  ).length;

  // Only return forms object if there's meaningful state
  if (focusedInput || validationErrors > 0) {
    return {
      dirty: false, // TODO: track value changes across snapshots
      focused_field: focusedInput ? computeEid(focusedInput) : undefined,
      validation_errors: validationErrors,
    };
  }

  return undefined;
}

// ============================================================================
// Notifications
// ============================================================================

/**
 * Maximum notifications to report (prevent bloat).
 */
const MAX_TOASTS = 5;
const MAX_BANNERS = 3;

/**
 * Extract notifications from snapshot.
 * Capped to prevent response bloat.
 *
 * @param snapshot - Compiled snapshot
 * @returns Notifications state or undefined
 */
function extractNotifications(
  snapshot: BaseSnapshot
): Atoms['notifications'] | undefined {
  // Count toasts (alerts, status messages) - capped
  const toastNodes = snapshot.nodes.filter(
    (n) =>
      n.attributes?.role === 'alert' || n.attributes?.role === 'status'
  );
  const toasts = Math.min(toastNodes.length, MAX_TOASTS);

  // Count banners (non-header banners) - capped
  const bannerNodes = snapshot.nodes.filter(
    (n) =>
      n.attributes?.role === 'banner' && n.where.region !== 'header'
  );
  const banners = Math.min(bannerNodes.length, MAX_BANNERS);

  if (toasts > 0 || banners > 0) {
    return {
      toasts,
      banners,
    };
  }

  return undefined;
}
