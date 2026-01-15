/**
 * Manages persistent DOM observation for a page.
 *
 * Lifecycle:
 * - inject() on page creation
 * - ensureInjected() after navigation (document context changes)
 * - getObservations() to retrieve significant mutations
 */

import type { Page } from 'playwright';
import type {
  DOMObservation,
  RawMutationEntry,
  SignificanceSignals,
  ObservationGroups,
} from './observation.types.js';
import { OBSERVATION_OBSERVER_SCRIPT } from './observer-script.js';
import { SIGNIFICANCE_THRESHOLD } from './observation.types.js';

/**
 * Manages persistent DOM observation for a page.
 */
export class ObservationAccumulator {
  /**
   * Inject the persistent observer into the page.
   * Safe to call multiple times - checks for existing injection.
   */
  async inject(page: Page): Promise<void> {
    try {
      await page.evaluate(OBSERVATION_OBSERVER_SCRIPT);
    } catch (err) {
      // Page may be navigating or closed - log but don't throw
      console.warn('[ObservationAccumulator] Injection failed:', err);
    }
  }

  /**
   * Ensure observer is injected and valid (re-inject if needed after navigation).
   *
   * After navigation or page content changes, the observer might be stale
   * (observing a detached body). We check if the observer's body reference
   * matches the current document.body and only re-inject if stale.
   *
   * This preserves accumulated observations when the observer is still valid.
   */
  async ensureInjected(page: Page): Promise<void> {
    const needsReinjection = await page
      .evaluate(() => {
        // Browser context code - globalThis access is intentional
        /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
        const acc = (globalThis as any).__observationAccumulator;

        // No accumulator - need to inject
        if (!acc) return true;

        // Check if observer is stale (observing a different/detached body)
        // This happens after setContent() or navigation that replaces the body
        const currentBody = (globalThis as any).document?.body;
        if (acc.observedBody !== currentBody) {
          // Observer is stale - disconnect and remove so we can re-inject
          acc.observer?.disconnect();
          delete (globalThis as any).__observationAccumulator;
          return true;
        }

        // Observer is still valid - no need to re-inject
        return false;
      })
      .catch(() => {
        // Error checking - assume we need to inject
        return true;
      });

    if (needsReinjection) {
      await this.inject(page);
    }
  }

  /**
   * Get observations for an action.
   * Returns both action-scoped and unreported accumulated observations.
   */
  async getObservations(page: Page, actionStartTime: number): Promise<ObservationGroups> {
    try {
      // Browser context code - uses injected __observationAccumulator
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
      const result = await page.evaluate((since: number) => {
        const acc = (globalThis as any).__observationAccumulator;
        if (!acc)
          return {
            duringAction: [] as RawMutationEntry[],
            sincePrevious: [] as RawMutationEntry[],
          };

        // Get observations during this action
        const duringAction = acc.getSignificant(since, undefined) as RawMutationEntry[];

        // Get unreported observations from before this action
        const allUnreported = acc.getUnreported() as RawMutationEntry[];
        const sincePrevious = allUnreported.filter((e: RawMutationEntry) => e.timestamp < since);

        // Mark all as reported
        acc.markReported();

        return { duringAction, sincePrevious };
      }, actionStartTime);

      // Convert raw entries to DOMObservation format
      return {
        duringAction: result.duringAction.map((e: RawMutationEntry) => this.rawToObservation(e)),
        sincePrevious: result.sincePrevious.map((e: RawMutationEntry) => ({
          ...this.rawToObservation(e),
          ageMs: Date.now() - e.timestamp,
        })),
      };
    } catch {
      return { duringAction: [], sincePrevious: [] };
    }
  }

  /**
   * Get accumulated observations without action context.
   * Used by capture_snapshot to report accumulated changes.
   */
  async getAccumulatedObservations(page: Page): Promise<ObservationGroups> {
    try {
      // Browser context code - uses injected __observationAccumulator
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
      const result = await page.evaluate(() => {
        const acc = (globalThis as any).__observationAccumulator;
        if (!acc) return { sincePrevious: [] as RawMutationEntry[] };

        // Get all unreported observations
        const sincePrevious = acc.getUnreported() as RawMutationEntry[];

        // Mark all as reported
        acc.markReported();

        return { sincePrevious };
      });

      return {
        duringAction: [],
        sincePrevious: result.sincePrevious.map((e: RawMutationEntry) => ({
          ...this.rawToObservation(e),
          ageMs: Date.now() - e.timestamp,
        })),
      };
    } catch {
      return { duringAction: [], sincePrevious: [] };
    }
  }

  /**
   * Convert raw mutation entry to DOMObservation.
   */
  private rawToObservation(entry: RawMutationEntry): DOMObservation {
    const signals: SignificanceSignals = {
      hasAlertRole: ['alert', 'status', 'log', 'alertdialog'].includes(entry.role ?? ''),
      hasAriaLive: entry.ariaLive === 'polite' || entry.ariaLive === 'assertive',
      isDialog: entry.role === 'dialog' || entry.tag === 'dialog' || entry.ariaModal === 'true',
      isFixedOrSticky: entry.isFixedOrSticky,
      hasHighZIndex: entry.zIndex > 1000,
      coversSignificantViewport:
        entry.viewportCoverage.widthPct > 50 || entry.viewportCoverage.heightPct > 30,
      isBodyDirectChild: entry.isBodyDirectChild,
      containsInteractiveElements: entry.hasInteractives,
      appearedAfterDelay: entry.appearedAfterDelay ?? false,
      wasShortLived: false, // Computed when we see removal
    };

    return {
      type: entry.type === 'added' ? 'appeared' : 'disappeared',
      significance: entry.significance,
      signals,
      content: {
        tag: entry.tag,
        role: entry.role,
        ariaLabel: entry.ariaLabel,
        text: entry.text,
        hasInteractives: entry.hasInteractives,
      },
      timestamp: entry.timestamp,
      reported: false,
    };
  }

  /**
   * Reset observation log (call after navigation).
   */
  async reset(page: Page): Promise<void> {
    try {
      // Browser context code - uses injected __observationAccumulator
      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
      await page.evaluate(() => {
        (globalThis as any).__observationAccumulator?.reset();
      });
    } catch {
      // Ignore - page may be navigating
    }
  }

  /**
   * Check if there are any unreported observations.
   */
  async hasUnreported(page: Page): Promise<boolean> {
    try {
      // Browser context code - uses injected __observationAccumulator
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
      return await page.evaluate(() => {
        const acc = (globalThis as any).__observationAccumulator;
        if (!acc) return false;
        return acc.getUnreported().length > 0;
      });
    } catch {
      return false;
    }
  }

  /**
   * Filter observations by significance threshold.
   */
  filterBySignificance(
    observations: ObservationGroups,
    threshold: number = SIGNIFICANCE_THRESHOLD
  ): ObservationGroups {
    return {
      duringAction: observations.duringAction.filter((o) => o.significance >= threshold),
      sincePrevious: observations.sincePrevious.filter((o) => o.significance >= threshold),
    };
  }
}

// Singleton instance
export const observationAccumulator = new ObservationAccumulator();
