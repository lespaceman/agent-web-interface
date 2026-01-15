/**
 * Observation Types Tests
 *
 * Tests for significance scoring and observation type validation.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSignificance,
  SIGNIFICANCE_THRESHOLD,
  SIGNIFICANCE_WEIGHTS,
  type SignificanceSignals,
} from '../../../src/observation/observation.types.js';

describe('Significance Scoring', () => {
  /**
   * Helper to create signals with defaults.
   */
  function createSignals(overrides: Partial<SignificanceSignals> = {}): SignificanceSignals {
    return {
      hasAlertRole: false,
      hasAriaLive: false,
      isDialog: false,
      isFixedOrSticky: false,
      hasHighZIndex: false,
      coversSignificantViewport: false,
      isBodyDirectChild: false,
      containsInteractiveElements: false,
      isVisibleInViewport: false,
      hasNonTrivialText: false,
      appearedAfterDelay: false,
      wasShortLived: false,
      ...overrides,
    };
  }

  describe('computeSignificance', () => {
    it('should return 0 for no signals', () => {
      const signals = createSignals();
      expect(computeSignificance(signals)).toBe(0);
    });

    it('should return 3 for single semantic signal (alert role)', () => {
      const signals = createSignals({ hasAlertRole: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.hasAlertRole);
      expect(computeSignificance(signals)).toBe(3);
    });

    it('should return 3 for aria-live assertive', () => {
      const signals = createSignals({ hasAriaLive: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.hasAriaLive);
      expect(computeSignificance(signals)).toBe(3);
    });

    it('should return 3 for dialog', () => {
      const signals = createSignals({ isDialog: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.isDialog);
      expect(computeSignificance(signals)).toBe(3);
    });

    it('should return 2 for fixed/sticky position', () => {
      const signals = createSignals({ isFixedOrSticky: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.isFixedOrSticky);
      expect(computeSignificance(signals)).toBe(2);
    });

    it('should return 1 for high z-index', () => {
      const signals = createSignals({ hasHighZIndex: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.hasHighZIndex);
      expect(computeSignificance(signals)).toBe(1);
    });

    it('should return 2 for significant viewport coverage', () => {
      const signals = createSignals({ coversSignificantViewport: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.coversSignificantViewport);
      expect(computeSignificance(signals)).toBe(2);
    });

    it('should return 1 for body direct child', () => {
      const signals = createSignals({ isBodyDirectChild: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.isBodyDirectChild);
      expect(computeSignificance(signals)).toBe(1);
    });

    it('should return 1 for containing interactive elements', () => {
      const signals = createSignals({ containsInteractiveElements: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.containsInteractiveElements);
      expect(computeSignificance(signals)).toBe(1);
    });

    it('should return 2 for appearing after delay', () => {
      const signals = createSignals({ appearedAfterDelay: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.appearedAfterDelay);
      expect(computeSignificance(signals)).toBe(2);
    });

    it('should return 2 for short-lived element', () => {
      const signals = createSignals({ wasShortLived: true });
      expect(computeSignificance(signals)).toBe(SIGNIFICANCE_WEIGHTS.wasShortLived);
      expect(computeSignificance(signals)).toBe(2);
    });

    it('should sum multiple signals correctly', () => {
      const signals = createSignals({
        isFixedOrSticky: true, // 2
        hasHighZIndex: true, // 1
        isBodyDirectChild: true, // 1
      });
      expect(computeSignificance(signals)).toBe(4);
    });

    it('should return 5 for fixed + viewport coverage (2 + 2 + 1 body-child)', () => {
      const signals = createSignals({
        isFixedOrSticky: true, // 2
        coversSignificantViewport: true, // 2
        isBodyDirectChild: true, // 1
      });
      expect(computeSignificance(signals)).toBe(5);
    });

    it('should return 6 for dialog + fixed + high-z', () => {
      const signals = createSignals({
        isDialog: true, // 3
        isFixedOrSticky: true, // 2
        hasHighZIndex: true, // 1
      });
      expect(computeSignificance(signals)).toBe(6);
    });

    it('should return max score when all signals are true', () => {
      const signals = createSignals({
        hasAlertRole: true,
        hasAriaLive: true,
        isDialog: true,
        isFixedOrSticky: true,
        hasHighZIndex: true,
        coversSignificantViewport: true,
        isBodyDirectChild: true,
        containsInteractiveElements: true,
        appearedAfterDelay: true,
        wasShortLived: true,
      });
      // 3 + 3 + 3 + 2 + 1 + 2 + 1 + 1 + 2 + 2 = 20
      expect(computeSignificance(signals)).toBe(20);
    });
  });

  describe('SIGNIFICANCE_THRESHOLD', () => {
    it('should be 3', () => {
      expect(SIGNIFICANCE_THRESHOLD).toBe(3);
    });

    it('should mean single semantic signal meets threshold', () => {
      const signals = createSignals({ hasAlertRole: true });
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });

    it('should mean single visual signal does not meet threshold', () => {
      const signals = createSignals({ isFixedOrSticky: true });
      expect(computeSignificance(signals)).toBeLessThan(SIGNIFICANCE_THRESHOLD);
    });

    it('should mean two visual signals meet threshold', () => {
      const signals = createSignals({
        isFixedOrSticky: true, // 2
        hasHighZIndex: true, // 1
      });
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });
  });

  describe('Typical Use Cases', () => {
    it('should score error toast (role=alert) >= threshold', () => {
      const signals = createSignals({
        hasAlertRole: true,
        appearedAfterDelay: true,
      });
      // 3 + 2 = 5
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });

    it('should score cookie banner (dialog + fixed + viewport) >= threshold', () => {
      const signals = createSignals({
        isDialog: true,
        isFixedOrSticky: true,
        coversSignificantViewport: true,
        containsInteractiveElements: true,
      });
      // 3 + 2 + 2 + 1 = 8
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });

    it('should score modal overlay >= threshold', () => {
      const signals = createSignals({
        isDialog: true,
        isFixedOrSticky: true,
        hasHighZIndex: true,
        coversSignificantViewport: true,
      });
      // 3 + 2 + 1 + 2 = 8
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });

    it('should score form validation message (role=alert, aria-live) >= threshold', () => {
      const signals = createSignals({
        hasAlertRole: true,
        hasAriaLive: true,
      });
      // 3 + 3 = 6
      expect(computeSignificance(signals)).toBeGreaterThanOrEqual(SIGNIFICANCE_THRESHOLD);
    });

    it('should NOT score regular div element', () => {
      const signals = createSignals();
      expect(computeSignificance(signals)).toBeLessThan(SIGNIFICANCE_THRESHOLD);
    });

    it('should NOT score element with only body-direct-child', () => {
      const signals = createSignals({
        isBodyDirectChild: true,
      });
      // 1 < 3
      expect(computeSignificance(signals)).toBeLessThan(SIGNIFICANCE_THRESHOLD);
    });
  });
});
