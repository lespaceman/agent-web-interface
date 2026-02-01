/**
 * State Renderer Tests
 *
 * Tests for observation rendering functions in state-renderer.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderObservations,
  renderSingleObservation,
  renderStateXml,
  trimRegionElements,
} from '../../../src/state/state-renderer.js';
import type {
  StateResponseObject,
  ActionableInfo,
  DiffResponse,
  BaselineResponse,
  Atoms,
} from '../../../src/state/types.js';
import type {
  DOMObservation,
  ObservationGroups,
  SignificanceSignals,
  ObservationChild,
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
// renderSingleObservation Tests
// ============================================================================

describe('renderSingleObservation', () => {
  it('should render observation with when="action" for duringAction', () => {
    const obs = createObservation({
      type: 'appeared',
      content: { tag: 'div', text: 'Alert!', hasInteractives: false },
    });

    const result = renderSingleObservation(obs, 'action', 4);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('when="action"');
    expect(result[0]).toContain('Alert!');
  });

  it('should render observation with when="prior" for sincePrevious', () => {
    const obs = createObservation({
      type: 'appeared',
      content: { tag: 'div', text: 'Previous toast', hasInteractives: false },
    });

    const result = renderSingleObservation(obs, 'prior', 4);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('when="prior"');
  });

  it('should include eid when present', () => {
    const obs = createObservation({ eid: 'btn-submit' });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('eid="btn-submit"');
  });

  it('should not include eid when undefined', () => {
    const obs = createObservation({ eid: undefined });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).not.toContain('eid=');
  });

  it('should include role when present in content', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'alert', text: 'Error', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('role="alert"');
  });

  it('should include delay_ms when present', () => {
    const obs = createObservation({ delayMs: 200 });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('delay_ms="200"');
  });

  it('should include age_ms when present', () => {
    const obs = createObservation({ ageMs: 1500 });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('age_ms="1500"');
  });

  it('should include transient="true" when wasShortLived is true', () => {
    const obs = createObservation({
      signals: createSignals({ wasShortLived: true }),
    });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('transient="true"');
  });

  it('should not include transient when wasShortLived is false', () => {
    const obs = createObservation({
      signals: createSignals({ wasShortLived: false }),
    });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).not.toContain('transient');
  });

  it('should escape XML special characters in text', () => {
    const obs = createObservation({
      content: { tag: 'div', text: '<script>alert("xss")</script>', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(result[0]).not.toContain('<script>');
  });

  it('should escape ampersand in text', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Save & Continue', hasInteractives: false },
    });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('Save &amp; Continue');
  });

  it('should render disappeared type correctly', () => {
    const obs = createObservation({ type: 'disappeared' });
    const result = renderSingleObservation(obs, 'action', 0);
    expect(result[0]).toContain('<disappeared');
    expect(result[0]).toContain('</disappeared>');
    expect(result[0]).not.toContain('<appeared');
  });

  it('should apply correct indentation', () => {
    const obs = createObservation();
    const result = renderSingleObservation(obs, 'action', 4);
    expect(result[0]).toMatch(/^ {4}</); // 4 spaces
  });

  it('should render children when present', () => {
    const children: ObservationChild[] = [
      { tag: 'heading', eid: 'dlg-title', text: 'My Cart' },
      { tag: 'text', text: 'Your cart is empty.' },
      { tag: 'button', eid: 'btn-shop', text: 'Continue Shopping' },
    ];
    const obs = createObservation({
      eid: 'dialog-001',
      content: {
        tag: 'div',
        role: 'dialog',
        text: 'My Cart Your cart is empty.',
        hasInteractives: true,
      },
      children,
    });

    const result = renderSingleObservation(obs, 'action', 4);

    expect(result.length).toBe(5); // Opening tag + 3 children + closing tag
    expect(result[0]).toContain('<appeared');
    expect(result[0]).toContain('eid="dialog-001"');
    expect(result[0]).toContain('role="dialog"');
    expect(result[1]).toContain('<heading eid="dlg-title">My Cart</heading>');
    expect(result[2]).toContain('<text>Your cart is empty.</text>');
    expect(result[3]).toContain('<button eid="btn-shop">Continue Shopping</button>');
    expect(result[4]).toContain('</appeared>');
  });

  it('should render children without eid when not present', () => {
    const children: ObservationChild[] = [{ tag: 'text', text: 'Static message' }];
    const obs = createObservation({ children });

    const result = renderSingleObservation(obs, 'action', 0);

    // Children get +2 spaces relative to parent (parent is 0, child is 2)
    expect(result[1]).toBe('  <text>Static message</text>');
    expect(result[1]).not.toContain('eid=');
  });

  it('should escape XML in child text', () => {
    const children: ObservationChild[] = [{ tag: 'button', eid: 'btn-1', text: 'Save & Continue' }];
    const obs = createObservation({ children });

    const result = renderSingleObservation(obs, 'action', 0);

    expect(result[1]).toContain('Save &amp; Continue');
  });

  it('should apply indentation to children', () => {
    const children: ObservationChild[] = [{ tag: 'button', eid: 'btn-1', text: 'Click' }];
    const obs = createObservation({ children });

    const result = renderSingleObservation(obs, 'action', 4);

    expect(result[0]).toMatch(/^ {4}</); // Parent: 4 spaces
    expect(result[1]).toMatch(/^ {6}</); // Child: 6 spaces (4 + 2)
    expect(result[2]).toMatch(/^ {4}</); // Closing: 4 spaces
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

  it('should render duringAction observations with when="action"', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Alert!', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [obs] });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('<observations>');
    expect(xml).toContain('when="action"');
    expect(xml).toContain('</observations>');
    // Should NOT have wrapper elements
    expect(xml).not.toContain('<during_action>');
    expect(xml).not.toContain('<since_previous>');
  });

  it('should render sincePrevious observations with when="prior"', () => {
    const obs = createObservation({
      ageMs: 1000,
      content: { tag: 'dialog', text: 'Modal', hasInteractives: true },
    });
    const groups = createObservationGroups({ sincePrevious: [obs] });

    const result = renderObservations(groups);
    const xml = result.join('\n');

    expect(xml).toContain('<observations>');
    expect(xml).toContain('when="prior"');
    expect(xml).toContain('</observations>');
    // Should NOT have wrapper elements
    expect(xml).not.toContain('<during_action>');
    expect(xml).not.toContain('<since_previous>');
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

    expect(xml).toContain('when="action"');
    expect(xml).toContain('During action');
    expect(xml).toContain('when="prior"');
    expect(xml).toContain('Since previous');
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

    expect(result[0]).toBe('  <observations>');
    expect(result[1]).toContain('<appeared');
    expect(result[result.length - 1]).toBe('  </observations>');
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

  it('should render self-closing diff when no mutations', () => {
    const response = createStateResponse({
      mutations: { textChanged: [], statusAppeared: [] },
      isEmpty: true,
    });

    const xml = renderStateXml(response);

    // Should have self-closing diff tag with flattened attributes
    expect(xml).toMatch(/<diff type="mutation"[^>]*\/>/);
    // Should NOT have <mutations> wrapper
    expect(xml).not.toContain('<mutations>');
  });

  it('should render text-changed elements inline in diff', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [{ eid: 'rd-abc123', from: 'Loading...', to: 'Loaded!' }],
        statusAppeared: [],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    // Flattened format - no <mutations> wrapper
    expect(xml).toContain('<diff type="mutation"');
    expect(xml).toContain('<text-changed id="rd-abc123">Loading... → Loaded!</text-changed>');
    expect(xml).toContain('</diff>');
    // Should NOT have <mutations> wrapper
    expect(xml).not.toContain('<mutations>');
  });

  it('should render status elements inline in diff', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [],
        statusAppeared: [{ eid: 'rd-def456', role: 'status', text: 'Success!' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('<diff type="mutation"');
    expect(xml).toContain('<status id="rd-def456" role="status">Success!</status>');
    expect(xml).toContain('</diff>');
    expect(xml).not.toContain('<mutations>');
  });

  it('should render alert elements inline in diff', () => {
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

  it('should render both text changes and status appearances inline', () => {
    const response = createStateResponse({
      mutations: {
        textChanged: [{ eid: 'rd-progress', from: '50%', to: '100%' }],
        statusAppeared: [{ eid: 'rd-done', role: 'status', text: 'Complete!' }],
      },
      isEmpty: false,
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('<diff type="mutation"');
    expect(xml).toContain('<text-changed id="rd-progress">50% → 100%</text-changed>');
    expect(xml).toContain('<status id="rd-done" role="status">Complete!</status>');
    expect(xml).toContain('</diff>');
    expect(xml).not.toContain('<mutations>');
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
    expect(xml).not.toContain('<diff');
    expect(xml).not.toContain('<mutations>');
  });

  it('should include nav attribute in flattened diff', () => {
    const response = createStateResponse({
      doc: {
        from: { url: 'https://example.com', title: 'Old Page' },
        to: { url: 'https://example.com/new', title: 'New Page' },
        nav_type: 'soft',
      },
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('nav="soft"');
  });

  it('should include added/removed counts in flattened diff', () => {
    const response = createStateResponse({
      actionables: {
        added: ['btn-1', 'btn-2'],
        removed: ['btn-old'],
        changed: [],
      },
    });

    const xml = renderStateXml(response);

    expect(xml).toContain('added="2"');
    expect(xml).toContain('removed="1"');
  });

  it('should not include empty="true" in new format', () => {
    const response = createStateResponse({
      isEmpty: true,
    });

    const xml = renderStateXml(response);

    // Old format had empty="true", new format doesn't need it
    expect(xml).not.toContain('empty=');
  });
});

// ============================================================================
// Region Trimming Tests
// ============================================================================

/**
 * Create a mock ActionableInfo for trimming tests.
 */
function createActionable(id: string, region: string): ActionableInfo {
  return {
    eid: id,
    kind: 'button',
    name: `Button ${id}`,
    role: 'button',
    vis: true,
    ena: true,
    ref: { snapshot_id: 'snap-1', backend_node_id: parseInt(id.replace(/\D/g, '') || '0') },
    loc: { preferred: { ax: `button "${id}"` } },
    ctx: { layer: 'main', region },
  };
}

/**
 * Create a baseline StateResponseObject with given actionables.
 */
function createBaselineResponse(actionables: ActionableInfo[]): StateResponseObject {
  return {
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
      layer: { active: 'main', stack: ['main'], pointer_lock: false },
      timing: { ts: '2024-01-01T00:00:00Z', dom_ready: true, network_busy: false },
      hash: { ui: 'abc123', layer: 'def456' },
    },
    diff: { mode: 'baseline', reason: 'first' } as BaselineResponse,
    actionables,
    counts: { shown: actionables.length, total_in_layer: actionables.length },
    limits: { max_actionables: 1000, actionables_capped: false },
    atoms: { viewport: { w: 1280, h: 720, dpr: 1 }, scroll: { x: 0, y: 0 } },
    tokens: 0,
  };
}

describe('trimRegionElements', () => {
  it('should not trim when element count is less than head+tail', () => {
    const elements = [1, 2, 3].map((i) => createActionable(`btn-${i}`, 'main'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 5, tail: 5 });

    expect(trimmedCount).toBe(0);
    expect(kept).toEqual(elements);
  });

  it('should not trim when element count equals head+tail (boundary)', () => {
    const elements = [1, 2, 3, 4, 5].map((i) => createActionable(`btn-${i}`, 'header'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 3, tail: 2 });

    expect(trimmedCount).toBe(0);
    expect(kept).toEqual(elements);
  });

  it('should trim 1 element when count is head+tail+1', () => {
    const elements = [1, 2, 3, 4, 5, 6].map((i) => createActionable(`btn-${i}`, 'header'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 3, tail: 2 });

    expect(trimmedCount).toBe(1);
    expect(kept).toHaveLength(5);
    expect(kept.map((e) => e.eid)).toEqual(['btn-1', 'btn-2', 'btn-3', 'btn-5', 'btn-6']);
  });

  it('should keep correct head and tail for many elements', () => {
    const elements = Array.from({ length: 20 }, (_, i) => createActionable(`btn-${i + 1}`, 'main'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 5, tail: 5 });

    expect(trimmedCount).toBe(10);
    expect(kept).toHaveLength(10);
    expect(kept.map((e) => e.eid)).toEqual([
      'btn-1',
      'btn-2',
      'btn-3',
      'btn-4',
      'btn-5',
      'btn-16',
      'btn-17',
      'btn-18',
      'btn-19',
      'btn-20',
    ]);
  });

  it('should handle tail overlapping head (7 elements with head=5, tail=5)', () => {
    const elements = [1, 2, 3, 4, 5, 6, 7].map((i) => createActionable(`btn-${i}`, 'main'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 5, tail: 5 });

    expect(trimmedCount).toBe(0);
    expect(kept).toEqual(elements);
  });

  it('should handle single element', () => {
    const elements = [createActionable('btn-1', 'footer')];
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 2, tail: 2 });

    expect(trimmedCount).toBe(0);
    expect(kept).toEqual(elements);
  });

  it('should handle empty element list', () => {
    const { kept, trimmedCount } = trimRegionElements([], { head: 5, tail: 5 });

    expect(trimmedCount).toBe(0);
    expect(kept).toEqual([]);
  });

  it('should handle tail=0 without duplicating elements', () => {
    const elements = Array.from({ length: 10 }, (_, i) => createActionable(`btn-${i + 1}`, 'main'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 5, tail: 0 });

    expect(trimmedCount).toBe(5);
    expect(kept).toHaveLength(5);
    expect(kept.map((e) => e.eid)).toEqual(['btn-1', 'btn-2', 'btn-3', 'btn-4', 'btn-5']);
  });

  it('should handle head=0 without duplicating elements', () => {
    const elements = Array.from({ length: 10 }, (_, i) => createActionable(`btn-${i + 1}`, 'main'));
    const { kept, trimmedCount } = trimRegionElements(elements, { head: 0, tail: 3 });

    expect(trimmedCount).toBe(7);
    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.eid)).toEqual(['btn-8', 'btn-9', 'btn-10']);
  });
});

describe('renderStateXml region trimming', () => {
  it('should not include trim comment when trimRegions is false', () => {
    const actionables = Array.from({ length: 20 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: false });

    expect(xml).not.toContain('<!-- trimmed');
    expect(xml).toContain('btn-10'); // middle element present
  });

  it('should not include trim comment when options are omitted', () => {
    const actionables = Array.from({ length: 20 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response);

    expect(xml).not.toContain('<!-- trimmed');
  });

  it('should insert trim comment when region exceeds limits', () => {
    // main region has limits { head: 5, tail: 5 }, so 20 elements triggers trimming
    const actionables = Array.from({ length: 20 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: true });

    expect(xml).toContain(
      '<!-- trimmed 10 items. Use find_elements with region=main to see all -->'
    );
  });

  it('should keep correct head and tail elements in trimmed output', () => {
    const actionables = Array.from({ length: 20 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: true });

    // Head: btn-1 through btn-5 should be present
    for (let i = 1; i <= 5; i++) {
      expect(xml).toContain(`id="btn-${i}"`);
    }
    // Tail: btn-16 through btn-20 should be present
    for (let i = 16; i <= 20; i++) {
      expect(xml).toContain(`id="btn-${i}"`);
    }
    // Middle: btn-6 through btn-15 should NOT be present
    for (let i = 6; i <= 15; i++) {
      expect(xml).not.toContain(`id="btn-${i}"`);
    }
  });

  it('should not trim region with fewer elements than limits', () => {
    // header has limits { head: 3, tail: 2 } = 5, so 4 elements should not be trimmed
    const actionables = [1, 2, 3, 4].map((i) => createActionable(`hdr-${i}`, 'header'));
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: true });

    expect(xml).not.toContain('<!-- trimmed');
    for (let i = 1; i <= 4; i++) {
      expect(xml).toContain(`id="hdr-${i}"`);
    }
  });

  it('should use default limits for unknown region', () => {
    // Default limits are { head: 5, tail: 3 } = 8, so 12 elements should trim 4
    const actionables = Array.from({ length: 12 }, (_, i) =>
      createActionable(`cst-${i + 1}`, 'custom-region')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: true });

    expect(xml).toContain(
      '<!-- trimmed 4 items. Use find_elements with region=custom-region to see all -->'
    );
    // Head: cst-1 through cst-5
    for (let i = 1; i <= 5; i++) {
      expect(xml).toContain(`id="cst-${i}"`);
    }
    // Tail: cst-10, cst-11, cst-12
    for (let i = 10; i <= 12; i++) {
      expect(xml).toContain(`id="cst-${i}"`);
    }
  });

  it('should trim multiple regions independently', () => {
    const headerItems = Array.from({ length: 10 }, (_, i) =>
      createActionable(`hdr-${i + 1}`, 'header')
    );
    const mainItems = Array.from({ length: 15 }, (_, i) =>
      createActionable(`main-${i + 1}`, 'main')
    );
    const response = createBaselineResponse([...headerItems, ...mainItems]);

    const xml = renderStateXml(response, { trimRegions: true });

    // header { head: 3, tail: 2 }: 10 elements, trims 5
    expect(xml).toContain(
      '<!-- trimmed 5 items. Use find_elements with region=header to see all -->'
    );
    // main { head: 5, tail: 5 }: 15 elements, trims 5
    expect(xml).toContain(
      '<!-- trimmed 5 items. Use find_elements with region=main to see all -->'
    );
  });

  it('should place trim comment after all elements, before </region>', () => {
    const actionables = Array.from({ length: 12 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    const response = createBaselineResponse(actionables);

    const xml = renderStateXml(response, { trimRegions: true });
    const lines = xml.split('\n');

    // Find the trim comment and verify placement
    const commentIdx = lines.findIndex((l) => l.includes('<!-- trimmed'));
    expect(commentIdx).toBeGreaterThan(-1);

    // Line before comment should be the last kept element
    // main limits: head=5, tail=5. 12 elements → keeps btn-1..5 + btn-8..12
    // Last kept element is btn-12
    expect(lines[commentIdx - 1]).toContain('id="btn-12"');
    // Line after comment should be closing </region>
    expect(lines[commentIdx + 1].trim()).toBe('</region>');
  });
});

// ============================================================================
// ATHENA_TRIM_REGIONS env var tests
// ============================================================================

describe('ATHENA_TRIM_REGIONS env var', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ATHENA_TRIM_REGIONS;
  });

  /** Re-import the module so the module-level TRIM_ENABLED const is re-evaluated. */
  async function renderWithEnv(envValue?: string): Promise<string> {
    if (envValue !== undefined) {
      process.env.ATHENA_TRIM_REGIONS = envValue;
    } else {
      delete process.env.ATHENA_TRIM_REGIONS;
    }

    const mod = await import('../../../src/state/state-renderer.js');
    const actionables = Array.from({ length: 20 }, (_, i) =>
      createActionable(`btn-${i + 1}`, 'main')
    );
    return mod.renderStateXml(createBaselineResponse(actionables), { trimRegions: true });
  }

  it('should disable trimming when ATHENA_TRIM_REGIONS=false', async () => {
    const xml = await renderWithEnv('false');

    expect(xml).not.toContain('<!-- trimmed');
    for (let i = 1; i <= 20; i++) {
      expect(xml).toContain(`id="btn-${i}"`);
    }
  });

  it('should enable trimming when ATHENA_TRIM_REGIONS is unset (default)', async () => {
    const xml = await renderWithEnv(undefined);

    expect(xml).toContain(
      '<!-- trimmed 10 items. Use find_elements with region=main to see all -->'
    );
  });
});
