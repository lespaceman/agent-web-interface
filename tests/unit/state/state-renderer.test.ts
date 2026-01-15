/**
 * State Renderer Tests
 *
 * Tests for observation rendering functions in state-renderer.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  renderObservations,
  renderSingleObservation,
  summarizeSignals,
} from '../../../src/state/state-renderer.js';
import type {
  DOMObservation,
  ObservationGroups,
  SignificanceSignals,
} from '../../../src/observation/observation.types.js';

/**
 * Create default SignificanceSignals with all false.
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
    appearedAfterDelay: false,
    wasShortLived: false,
    ...overrides,
  };
}

/**
 * Create a mock DOMObservation.
 */
function createObservation(overrides: Partial<DOMObservation> = {}): DOMObservation {
  return {
    type: 'appeared',
    significance: 3,
    signals: createSignals(),
    content: {
      tag: 'div',
      text: 'Test content',
      hasInteractives: false,
    },
    timestamp: Date.now(),
    reported: false,
    ...overrides,
  };
}

/**
 * Create mock ObservationGroups.
 */
function createObservationGroups(overrides: Partial<ObservationGroups> = {}): ObservationGroups {
  return {
    duringAction: [],
    sincePrevious: [],
    ...overrides,
  };
}

// ============================================================================
// summarizeSignals Tests
// ============================================================================

describe('summarizeSignals', () => {
  it('should return empty string when all signals are false', () => {
    const signals = createSignals();
    const result = summarizeSignals(signals);
    expect(result).toBe('');
  });

  it('should render single semantic signal', () => {
    const signals = createSignals({ hasAlertRole: true });
    const result = summarizeSignals(signals);
    expect(result).toBe('semantic="alert-role"');
  });

  it('should render multiple semantic signals comma-separated', () => {
    const signals = createSignals({
      hasAlertRole: true,
      hasAriaLive: true,
      isDialog: true,
    });
    const result = summarizeSignals(signals);
    expect(result).toBe('semantic="alert-role,aria-live,dialog"');
  });

  it('should render single visual signal', () => {
    const signals = createSignals({ isFixedOrSticky: true });
    const result = summarizeSignals(signals);
    expect(result).toBe('visual="fixed"');
  });

  it('should render multiple visual signals comma-separated', () => {
    const signals = createSignals({
      isFixedOrSticky: true,
      hasHighZIndex: true,
      coversSignificantViewport: true,
    });
    const result = summarizeSignals(signals);
    expect(result).toBe('visual="fixed,high-z,viewport"');
  });

  it('should render structural signals as boolean attributes', () => {
    const signals = createSignals({
      isBodyDirectChild: true,
      containsInteractiveElements: true,
    });
    const result = summarizeSignals(signals);
    expect(result).toBe('body-child="true" has-interactives="true"');
  });

  it('should render temporal signals as boolean attributes', () => {
    const signals = createSignals({
      appearedAfterDelay: true,
      wasShortLived: true,
    });
    const result = summarizeSignals(signals);
    expect(result).toBe('delayed="true" ephemeral="true"');
  });

  it('should render all signal types in correct order', () => {
    const signals = createSignals({
      hasAlertRole: true,
      isFixedOrSticky: true,
      isBodyDirectChild: true,
      appearedAfterDelay: true,
    });
    const result = summarizeSignals(signals);
    expect(result).toBe('semantic="alert-role" visual="fixed" body-child="true" delayed="true"');
  });

  it('should render all signals when everything is true', () => {
    const signals: SignificanceSignals = {
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
    };
    const result = summarizeSignals(signals);
    expect(result).toContain('semantic="alert-role,aria-live,dialog"');
    expect(result).toContain('visual="fixed,high-z,viewport"');
    expect(result).toContain('body-child="true"');
    expect(result).toContain('has-interactives="true"');
    expect(result).toContain('delayed="true"');
    expect(result).toContain('ephemeral="true"');
  });
});

// ============================================================================
// renderSingleObservation Tests
// ============================================================================

describe('renderSingleObservation', () => {
  it('should render minimal observation with required fields only', () => {
    const obs = createObservation({
      type: 'appeared',
      significance: 5,
      signals: createSignals({ hasAlertRole: true }),
      content: { tag: 'div', text: 'Alert!', hasInteractives: false },
    });

    const result = renderSingleObservation(obs, 6);

    expect(result).toContain('<appeared significance="5">');
    expect(result).toContain('<signals semantic="alert-role" />');
    expect(result).toContain('<content tag="div">Alert!</content>');
    expect(result).toContain('</appeared>');
  });

  it('should include eid when present', () => {
    const obs = createObservation({ eid: 'btn-submit' });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('eid="btn-submit"');
  });

  it('should not include eid when undefined', () => {
    const obs = createObservation({ eid: undefined });
    const result = renderSingleObservation(obs, 0);
    expect(result).not.toContain('eid=');
  });

  it('should include ageMs when present', () => {
    const obs = createObservation({ ageMs: 1500 });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('age_ms="1500"');
  });

  it('should include durationMs when present', () => {
    const obs = createObservation({ durationMs: 2500 });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('duration_ms="2500"');
  });

  it('should render role when present in content', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'alert', text: 'Error', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('role="alert"');
  });

  it('should render interactive="true" when hasInteractives is true', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Dialog', hasInteractives: true },
    });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('interactive="true"');
  });

  it('should not include interactive when hasInteractives is false', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Toast', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 0);
    expect(result).not.toContain('interactive=');
  });

  it('should escape XML special characters in text', () => {
    const obs = createObservation({
      content: { tag: 'div', text: '<script>alert("xss")</script>', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('should escape ampersand in text', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Save & Continue', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('Save &amp; Continue');
  });

  it('should render disappeared type correctly', () => {
    const obs = createObservation({ type: 'disappeared' });
    const result = renderSingleObservation(obs, 0);
    expect(result).toContain('<disappeared');
    expect(result).toContain('</disappeared>');
    expect(result).not.toContain('<appeared');
  });

  it('should apply correct indentation', () => {
    const obs = createObservation();
    const result = renderSingleObservation(obs, 4);
    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^ {4}</); // 4 spaces
    expect(lines[1]).toMatch(/^ {6}</); // 6 spaces (4 + 2)
  });
});

// ============================================================================
// renderObservations Tests
// ============================================================================

describe('renderObservations', () => {
  it('should return empty array when both groups are empty', () => {
    const groups = createObservationGroups();
    const result = renderObservations(groups);
    expect(result).toEqual([]);
  });

  it('should render only duringAction when sincePrevious is empty', () => {
    const obs = createObservation({
      significance: 4,
      signals: createSignals({ hasAlertRole: true }),
    });
    const groups = createObservationGroups({ duringAction: [obs] });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('<observations>');
    expect(xml).toContain('<during_action>');
    expect(xml).toContain('</during_action>');
    expect(xml).toContain('</observations>');
    expect(xml).not.toContain('<since_previous>');
  });

  it('should render only sincePrevious when duringAction is empty', () => {
    const obs = createObservation({
      ageMs: 1000,
      signals: createSignals({ isDialog: true }),
    });
    const groups = createObservationGroups({ sincePrevious: [obs] });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('<observations>');
    expect(xml).toContain('<since_previous>');
    expect(xml).toContain('</since_previous>');
    expect(xml).toContain('</observations>');
    expect(xml).not.toContain('<during_action>');
  });

  it('should render both groups when both have observations', () => {
    const duringObs = createObservation({
      content: { tag: 'div', text: 'During action', hasInteractives: false },
    });
    const previousObs = createObservation({
      ageMs: 500,
      content: { tag: 'dialog', text: 'Since previous', hasInteractives: true },
    });
    const groups = createObservationGroups({
      duringAction: [duringObs],
      sincePrevious: [previousObs],
    });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('<during_action>');
    expect(xml).toContain('During action');
    expect(xml).toContain('</during_action>');
    expect(xml).toContain('<since_previous>');
    expect(xml).toContain('Since previous');
    expect(xml).toContain('</since_previous>');
  });

  it('should render multiple observations in each group', () => {
    const obs1 = createObservation({
      content: { tag: 'div', text: 'First', hasInteractives: false },
    });
    const obs2 = createObservation({
      content: { tag: 'div', text: 'Second', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [obs1, obs2] });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('First');
    expect(xml).toContain('Second');
  });

  it('should have proper XML structure with correct nesting', () => {
    const obs = createObservation();
    const groups = createObservationGroups({ duringAction: [obs] });

    const result = renderObservations(groups);

    // Check structure - note: observation is a single multi-line string element
    expect(result[0]).toBe('  <observations>');
    expect(result[1]).toBe('    <during_action>');
    // Observation is at index 2 as a multi-line string
    expect(result[2]).toContain('<appeared');
    expect(result[3]).toBe('    </during_action>');
    expect(result[4]).toBe('  </observations>');
  });

  it('should render duringAction before sincePrevious', () => {
    const duringObs = createObservation({
      content: { tag: 'div', text: 'During', hasInteractives: false },
    });
    const previousObs = createObservation({
      content: { tag: 'div', text: 'Previous', hasInteractives: false },
    });
    const groups = createObservationGroups({
      duringAction: [duringObs],
      sincePrevious: [previousObs],
    });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    const duringIndex = xml.indexOf('During');
    const previousIndex = xml.indexOf('Previous');
    expect(duringIndex).toBeLessThan(previousIndex);
  });
});
