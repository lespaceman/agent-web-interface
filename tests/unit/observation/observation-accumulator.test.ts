/**
 * Observation Accumulator Tests
 *
 * Tests for the observation accumulator class that manages DOM observation capture.
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationAccumulator } from '../../../src/observation/observation-accumulator.js';
import type { RawMutationEntry } from '../../../src/observation/observation.types.js';
import { createMockPage } from '../../mocks/playwright.mock.js';

/**
 * Create a mock Page object with custom evaluate implementation.
 */
function createMockPageWithEvaluate(
  evaluateImpl?: () => Promise<unknown>
): Parameters<ObservationAccumulator['inject']>[0] {
  const page = createMockPage();
  if (evaluateImpl) {
    page.evaluate.mockImplementation(evaluateImpl);
  }
  return page as unknown as Parameters<ObservationAccumulator['inject']>[0];
}

/**
 * Create a mock raw mutation entry.
 */
function createMockRawEntry(overrides: Partial<RawMutationEntry> = {}): RawMutationEntry {
  return {
    type: 'added',
    timestamp: Date.now(),
    tag: 'div',
    role: 'alert',
    ariaLive: undefined,
    ariaLabel: undefined,
    ariaModal: undefined,
    text: 'Test alert message',
    hasInteractives: false,
    isFixedOrSticky: false,
    zIndex: 0,
    viewportCoverage: { widthPct: 0, heightPct: 0 },
    isBodyDirectChild: false,
    appearedAfterDelay: false,
    significance: 3,
    ...overrides,
  };
}

describe('ObservationAccumulator', () => {
  let accumulator: ObservationAccumulator;

  beforeEach(() => {
    accumulator = new ObservationAccumulator();
  });

  describe('inject', () => {
    it('should call page.evaluate with script', async () => {
      const page = createMockPageWithEvaluate();
      await accumulator.inject(page);
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should not throw on injection failure', async () => {
      const page = createMockPageWithEvaluate(() => Promise.reject(new Error('Navigation')));
      await expect(accumulator.inject(page)).resolves.not.toThrow();
    });
  });

  describe('ensureInjected', () => {
    it('should inject when no accumulator exists', async () => {
      // When evaluate returns true (needs reinjection), inject should be called
      const page = createMockPageWithEvaluate(() => Promise.resolve(true));
      await accumulator.ensureInjected(page);
      // Should be called twice: once to check staleness, once to inject
      expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('should not inject when observer is still valid', async () => {
      // When evaluate returns false (observer valid), no re-injection needed
      const page = createMockPageWithEvaluate(() => Promise.resolve(false));
      await accumulator.ensureInjected(page);
      // Should only be called once (just the staleness check)
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('should inject when observer is stale', async () => {
      // When evaluate returns true (stale observer detected), inject should be called
      const page = createMockPageWithEvaluate(() => Promise.resolve(true));
      await accumulator.ensureInjected(page);
      // Should be called twice: once to check/cleanup stale, once to inject
      expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('should inject on staleness check error', async () => {
      // When staleness check fails, assume we need to inject
      const page = createMockPageWithEvaluate(() => Promise.reject(new Error('Page navigating')));
      await expect(accumulator.ensureInjected(page)).resolves.not.toThrow();
      // Should be called twice: failed check returns true, then inject
      expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe('getObservations', () => {
    it('should return empty arrays when accumulator not present', async () => {
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [], sincePrevious: [] })
      );
      const result = await accumulator.getObservations(page, Date.now());
      expect(result.duringAction).toEqual([]);
      expect(result.sincePrevious).toEqual([]);
    });

    it('should convert raw entries to DOMObservation format', async () => {
      const timestamp = Date.now();
      const rawEntry = createMockRawEntry({
        type: 'added',
        timestamp,
        tag: 'div',
        role: 'alert',
        text: 'Error message',
        significance: 3,
      });

      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, timestamp - 1000);

      expect(result.duringAction).toHaveLength(1);
      expect(result.duringAction[0].type).toBe('appeared');
      expect(result.duringAction[0].content.tag).toBe('div');
      expect(result.duringAction[0].content.role).toBe('alert');
      expect(result.duringAction[0].content.text).toBe('Error message');
      expect(result.duringAction[0].significance).toBe(3);
    });

    it('should compute signals from raw entry', async () => {
      const rawEntry = createMockRawEntry({
        role: 'alert',
        ariaLive: 'assertive',
        isFixedOrSticky: true,
        zIndex: 1500,
        viewportCoverage: { widthPct: 60, heightPct: 40 },
        isBodyDirectChild: true,
        hasInteractives: true,
        appearedAfterDelay: true,
      });

      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      const signals = result.duringAction[0].signals;

      expect(signals.hasAlertRole).toBe(true);
      expect(signals.hasAriaLive).toBe(true);
      expect(signals.isFixedOrSticky).toBe(true);
      expect(signals.hasHighZIndex).toBe(true);
      expect(signals.coversSignificantViewport).toBe(true);
      expect(signals.isBodyDirectChild).toBe(true);
      expect(signals.containsInteractiveElements).toBe(true);
      expect(signals.appearedAfterDelay).toBe(true);
    });

    it('should add ageMs to sincePrevious observations', async () => {
      const oldTimestamp = Date.now() - 2000; // 2 seconds ago
      const rawEntry = createMockRawEntry({ timestamp: oldTimestamp });

      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [], sincePrevious: [rawEntry] })
      );

      const result = await accumulator.getObservations(page, Date.now());

      expect(result.sincePrevious).toHaveLength(1);
      expect(result.sincePrevious[0].ageMs).toBeDefined();
      expect(result.sincePrevious[0].ageMs).toBeGreaterThanOrEqual(1900);
    });

    it('should return empty arrays on error', async () => {
      const page = createMockPageWithEvaluate(() =>
        Promise.reject(new Error('Navigation occurred'))
      );

      const result = await accumulator.getObservations(page, Date.now());
      expect(result.duringAction).toEqual([]);
      expect(result.sincePrevious).toEqual([]);
    });
  });

  describe('getAccumulatedObservations', () => {
    it('should only return sincePrevious observations', async () => {
      const rawEntry = createMockRawEntry();

      const page = createMockPageWithEvaluate(() => Promise.resolve({ sincePrevious: [rawEntry] }));

      const result = await accumulator.getAccumulatedObservations(page);

      expect(result.duringAction).toEqual([]);
      expect(result.sincePrevious).toHaveLength(1);
    });

    it('should return empty arrays on error', async () => {
      const page = createMockPageWithEvaluate(() => Promise.reject(new Error('Page closed')));

      const result = await accumulator.getAccumulatedObservations(page);
      expect(result.duringAction).toEqual([]);
      expect(result.sincePrevious).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should call reset on accumulator', async () => {
      const page = createMockPageWithEvaluate();
      await accumulator.reset(page);
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('should not throw on error', async () => {
      const page = createMockPageWithEvaluate(() => Promise.reject(new Error('Navigation')));
      await expect(accumulator.reset(page)).resolves.not.toThrow();
    });
  });

  describe('hasUnreported', () => {
    it('should return true when there are unreported observations', async () => {
      const page = createMockPageWithEvaluate(() => Promise.resolve(true));
      const result = await accumulator.hasUnreported(page);
      expect(result).toBe(true);
    });

    it('should return false when no unreported observations', async () => {
      const page = createMockPageWithEvaluate(() => Promise.resolve(false));
      const result = await accumulator.hasUnreported(page);
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const page = createMockPageWithEvaluate(() => Promise.reject(new Error('Error')));
      const result = await accumulator.hasUnreported(page);
      expect(result).toBe(false);
    });
  });

  describe('filterBySignificance', () => {
    it('should filter observations below threshold', () => {
      const observations = {
        duringAction: [
          {
            type: 'appeared' as const,
            significance: 2,
            signals: {} as never,
            content: { tag: 'div', text: '', hasInteractives: false },
            timestamp: 0,
            reported: false,
          },
          {
            type: 'appeared' as const,
            significance: 5,
            signals: {} as never,
            content: { tag: 'div', text: '', hasInteractives: false },
            timestamp: 0,
            reported: false,
          },
        ],
        sincePrevious: [],
      };

      const filtered = accumulator.filterBySignificance(observations, 3);

      expect(filtered.duringAction).toHaveLength(1);
      expect(filtered.duringAction[0].significance).toBe(5);
    });

    it('should use default threshold of 3', () => {
      const observations = {
        duringAction: [
          {
            type: 'appeared' as const,
            significance: 2,
            signals: {} as never,
            content: { tag: 'div', text: '', hasInteractives: false },
            timestamp: 0,
            reported: false,
          },
          {
            type: 'appeared' as const,
            significance: 3,
            signals: {} as never,
            content: { tag: 'div', text: '', hasInteractives: false },
            timestamp: 0,
            reported: false,
          },
        ],
        sincePrevious: [],
      };

      const filtered = accumulator.filterBySignificance(observations);

      expect(filtered.duringAction).toHaveLength(1);
      expect(filtered.duringAction[0].significance).toBe(3);
    });
  });

  describe('rawToObservation conversion', () => {
    it('should convert added type to appeared', async () => {
      const rawEntry = createMockRawEntry({ type: 'added' });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].type).toBe('appeared');
    });

    it('should convert removed type to disappeared', async () => {
      const rawEntry = createMockRawEntry({ type: 'removed' });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].type).toBe('disappeared');
    });

    it('should detect dialog from role', async () => {
      const rawEntry = createMockRawEntry({ role: 'dialog' });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.isDialog).toBe(true);
    });

    it('should detect dialog from tag', async () => {
      const rawEntry = createMockRawEntry({ tag: 'dialog', role: undefined });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.isDialog).toBe(true);
    });

    it('should detect dialog from aria-modal', async () => {
      const rawEntry = createMockRawEntry({ ariaModal: 'true', role: undefined });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.isDialog).toBe(true);
    });

    it('should detect high z-index (> 1000)', async () => {
      const rawEntry = createMockRawEntry({ zIndex: 1001 });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.hasHighZIndex).toBe(true);
    });

    it('should not detect high z-index (== 1000)', async () => {
      const rawEntry = createMockRawEntry({ zIndex: 1000 });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.hasHighZIndex).toBe(false);
    });

    it('should detect significant viewport coverage (width > 50%)', async () => {
      const rawEntry = createMockRawEntry({
        viewportCoverage: { widthPct: 51, heightPct: 0 },
      });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.coversSignificantViewport).toBe(true);
    });

    it('should detect significant viewport coverage (height > 30%)', async () => {
      const rawEntry = createMockRawEntry({
        viewportCoverage: { widthPct: 0, heightPct: 31 },
      });
      const page = createMockPageWithEvaluate(() =>
        Promise.resolve({ duringAction: [rawEntry], sincePrevious: [] })
      );

      const result = await accumulator.getObservations(page, 0);
      expect(result.duringAction[0].signals.coversSignificantViewport).toBe(true);
    });
  });
});
