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
  renderStateXml,
} from '../../../src/state/state-renderer.js';
import type {
  StateResponseObject,
  DiffResponse,
  BaselineResponse,
  Atoms,
} from '../../../src/state/types.js';
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
    isVisibleInViewport: false,
    hasNonTrivialText: false,
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
      isVisibleInViewport: true,
      hasNonTrivialText: true,
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

  it('should deduplicate observations with same tag and text content', () => {
    // Simulate duplicate observations from nested elements (e.g., toast with wrapper divs)
    const obs1 = createObservation({
      significance: 10,
      signals: createSignals({
        isFixedOrSticky: true,
        hasHighZIndex: true,
        isBodyDirectChild: true,
        containsInteractiveElements: true,
        appearedAfterDelay: true,
      }),
      content: { tag: 'div', text: 'Error message', hasInteractives: true },
    });
    const obs2 = createObservation({
      significance: 4,
      signals: createSignals({
        containsInteractiveElements: true,
        appearedAfterDelay: true,
      }),
      content: { tag: 'div', text: 'Error message', hasInteractives: true },
    });
    const obs3 = createObservation({
      significance: 4,
      signals: createSignals({
        containsInteractiveElements: true,
        appearedAfterDelay: true,
      }),
      content: { tag: 'div', text: 'Error message', hasInteractives: true },
    });

    const groups = createObservationGroups({ sincePrevious: [obs1, obs2, obs3] });
    const result = renderObservations(groups);
    const xml = result.join('\n');

    // Count occurrences of "Error message" - should only appear once after deduplication
    const matches = xml.match(/Error message/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ============================================================================
// Mutations Rendering Tests (via renderStateXml)
// ============================================================================

describe('renderStateXml mutations', () => {
  /**
   * Create a minimal StateResponseObject for testing.
   */
  function createStateResponse(
    diffOverrides: Partial<DiffResponse['diff']> = {}
  ): StateResponseObject {
    const atoms: Atoms = {
      viewport: { w: 1280, h: 720, dpr: 1 },
      scroll: { x: 0, y: 0 },
    };

    const diff: DiffResponse = {
      mode: 'diff',
      diff: {
        actionables: { added: [], removed: [], changed: [] },
        mutations: { textChanged: [], statusAppeared: [] },
        isEmpty: true,
        atoms: [],
        ...diffOverrides,
      },
    };

    return {
      state: {
        sid: 'test-session',
        step: 1,
        doc: {
          url: 'https://example.com/',
          origin: 'https://example.com',
          title: 'Test Page',
          doc_id: 'test-doc',
          nav_type: 'soft',
          history_idx: 0,
        },
        layer: {
          active: 'main',
          stack: ['main'],
          pointer_lock: false,
        },
        timing: {
          ts: '2024-01-01T00:00:00Z',
          dom_ready: true,
          network_busy: false,
        },
        hash: {
          ui: 'abc123',
          layer: 'def456',
        },
      },
      diff,
      actionables: [],
      counts: { shown: 0, total_in_layer: 0 },
      limits: { max_actionables: 1000, actionables_capped: false },
      atoms,
      tokens: 0,
    };
  }

  it('should render empty mutations section when no mutations', () => {
    const response = createStateResponse({
      mutations: { textChanged: [], statusAppeared: [] },
      isEmpty: true,
    });

    const xml = renderStateXml(response);

    // Should have empty="true" but no <mutations> section
    expect(xml).toContain('empty="true"');
    expect(xml).not.toContain('<mutations>');
  });

  it('should render text-changed elements in mutations', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [{ eid: 'rd-abc123', from: 'Loading...', to: 'Loaded!' }],
        statusAppeared: [],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('empty="false"');
    expect(xml).toContain('<mutations>');
    expect(xml).toContain('<text-changed id="rd-abc123">Loading... → Loaded!</text-changed>');
    expect(xml).toContain('</mutations>');
  });

  it('should render status elements in mutations', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [],
        statusAppeared: [{ eid: 'rd-def456', role: 'status', text: 'Success!' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('<mutations>');
    expect(xml).toContain('<status id="rd-def456" role="status">Success!</status>');
    expect(xml).toContain('</mutations>');
  });

  it('should render alert elements in mutations', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [],
        statusAppeared: [{ eid: 'rd-alert1', role: 'alert', text: 'Error occurred!' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('<status id="rd-alert1" role="alert">Error occurred!</status>');
  });

  it('should render both text changes and status appearances', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [{ eid: 'rd-progress', from: '50%', to: '100%' }],
        statusAppeared: [{ eid: 'rd-done', role: 'status', text: 'Complete!' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('<mutations>');
    expect(xml).toContain('<text-changed id="rd-progress">50% → 100%</text-changed>');
    expect(xml).toContain('<status id="rd-done" role="status">Complete!</status>');
    expect(xml).toContain('</mutations>');
  });

  it('should escape XML special characters in mutations', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [{ eid: 'rd-special', from: '<script>', to: '</script>' }],
        statusAppeared: [{ eid: 'rd-amp', role: 'status', text: 'Save & Continue' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&lt;/script&gt;');
    expect(xml).toContain('Save &amp; Continue');
  });

  it('should not render mutations section for baseline response', () => {
    const atoms: Atoms = {
      viewport: { w: 1280, h: 720, dpr: 1 },
      scroll: { x: 0, y: 0 },
    };

    const baseline: BaselineResponse = {
      mode: 'baseline',
      reason: 'first',
    };

    const response: StateResponseObject = {
      state: {
        sid: 'test-session',
        step: 1,
        doc: {
          url: 'https://example.com/',
          origin: 'https://example.com',
          title: 'Test Page',
          doc_id: 'test-doc',
          nav_type: 'hard',
          history_idx: 0,
        },
        layer: {
          active: 'main',
          stack: ['main'],
          pointer_lock: false,
        },
        timing: {
          ts: '2024-01-01T00:00:00Z',
          dom_ready: true,
          network_busy: false,
        },
        hash: {
          ui: 'abc123',
          layer: 'def456',
        },
      },
      diff: baseline,
      actionables: [],
      counts: { shown: 0, total_in_layer: 0 },
      limits: { max_actionables: 1000, actionables_capped: false },
      atoms,
      tokens: 0,
    };

    const xml = renderStateXml(response);

    expect(xml).toContain('<baseline reason="first"');
    expect(xml).not.toContain('<mutations>');
  });
});
