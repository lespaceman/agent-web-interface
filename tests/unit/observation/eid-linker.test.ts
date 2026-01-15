/**
 * EID Linker Tests
 *
 * Tests for the observation-to-snapshot linking functionality.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  linkObservationsToSnapshot,
  buildNodeIndex,
  findBestMatch,
  getCandidateKinds,
  computeMatchScore,
} from '../../../src/observation/eid-linker.js';
import type {
  DOMObservation,
  ObservationGroups,
  SignificanceSignals,
} from '../../../src/observation/observation.types.js';
import type { BaseSnapshot, ReadableNode, NodeKind } from '../../../src/snapshot/snapshot.types.js';
import type { ElementRegistry } from '../../../src/state/element-registry.js';

// ============================================================================
// Test Helpers
// ============================================================================

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

function createReadableNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: 'n1',
    backend_node_id: 123,
    frame_id: 'frame1',
    loader_id: 'loader1',
    kind: 'generic' as NodeKind,
    label: 'Test node',
    where: { region: 'main' },
    layout: { bounds: { x: 0, y: 0, width: 100, height: 50 }, visible: true },
    ...overrides,
  } as ReadableNode;
}

function createSnapshot(nodes: ReadableNode[]): BaseSnapshot {
  return {
    snapshot_id: 'snap1',
    url: 'http://test.com',
    title: 'Test',
    captured_at: new Date().toISOString(),
    viewport: { width: 1024, height: 768 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: 0,
    },
  };
}

function createMockRegistry(eidMap: Record<number, string> = {}): ElementRegistry {
  return {
    getEidByBackendNodeId: vi.fn((backendNodeId: number) => eidMap[backendNodeId]),
  } as unknown as ElementRegistry;
}

function createObservationGroups(overrides: Partial<ObservationGroups> = {}): ObservationGroups {
  return {
    duringAction: [],
    sincePrevious: [],
    ...overrides,
  };
}

// ============================================================================
// getCandidateKinds Tests
// ============================================================================

describe('getCandidateKinds', () => {
  it('should return link kind for anchor tag', () => {
    const obs = createObservation({
      content: { tag: 'a', text: 'Click me', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('link');
  });

  it('should return button kind for button tag', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('button');
  });

  it('should return multiple kinds for div tag', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Content', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('generic');
    expect(kinds).toContain('dialog');
    expect(kinds).toContain('section');
  });

  it('should include kind from role when present', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'dialog', text: 'Modal', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('dialog');
  });

  it('should fallback to generic for unknown tag', () => {
    const obs = createObservation({
      content: { tag: 'custom-element', text: 'Custom', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('generic');
  });

  it('should handle input tag with multiple kind mappings', () => {
    const obs = createObservation({
      content: { tag: 'input', text: '', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('input');
    expect(kinds).toContain('checkbox');
    expect(kinds).toContain('radio');
  });

  it('should map alert role to generic', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'alert', text: 'Error!', hasInteractives: false },
    });
    const kinds = getCandidateKinds(obs);
    expect(kinds).toContain('generic');
  });
});

// ============================================================================
// buildNodeIndex Tests
// ============================================================================

describe('buildNodeIndex', () => {
  it('should index nodes by kind', () => {
    const nodes = [
      createReadableNode({ kind: 'button', backend_node_id: 1 }),
      createReadableNode({ kind: 'link', backend_node_id: 2 }),
      createReadableNode({ kind: 'button', backend_node_id: 3 }),
    ];
    const snapshot = createSnapshot(nodes);

    const index = buildNodeIndex(snapshot);

    expect(index.get('button')).toHaveLength(2);
    expect(index.get('link')).toHaveLength(1);
  });

  it('should handle empty snapshot', () => {
    const snapshot = createSnapshot([]);
    const index = buildNodeIndex(snapshot);
    expect(index.size).toBe(0);
  });

  it('should handle single node', () => {
    const nodes = [createReadableNode({ kind: 'dialog' })];
    const snapshot = createSnapshot(nodes);

    const index = buildNodeIndex(snapshot);

    expect(index.get('dialog')).toHaveLength(1);
  });
});

// ============================================================================
// computeMatchScore Tests
// ============================================================================

describe('computeMatchScore', () => {
  it('should return 0 when kinds do not match', () => {
    const obs = createObservation({
      content: { tag: 'a', text: 'Link', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Link' });

    const score = computeMatchScore(obs, node);
    expect(score).toBe(0);
  });

  it('should return 0.3 for kind match alone', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Different text', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Button label' });

    const score = computeMatchScore(obs, node);
    expect(score).toBeCloseTo(0.3, 1);
  });

  it('should return 0.55 for kind + role match', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'dialog', text: 'Different', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'dialog', label: 'Modal title' });

    const score = computeMatchScore(obs, node);
    expect(score).toBeCloseTo(0.55, 1);
  });

  it('should return 0.6 for kind + exact text match', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit' });

    const score = computeMatchScore(obs, node);
    expect(score).toBeCloseTo(0.6, 1);
  });

  it('should return 0.85 for kind + role + exact text match', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'dialog', text: 'Login', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'dialog', label: 'Login' });

    const score = computeMatchScore(obs, node);
    expect(score).toBeCloseTo(0.85, 1);
  });

  it('should cap score at 1.0', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'dialog', text: 'Login', hasInteractives: false },
      signals: createSignals({ isDialog: true }),
    });
    const node = createReadableNode({
      kind: 'dialog',
      label: 'Login',
      where: { region: 'dialog' },
    });

    const score = computeMatchScore(obs, node);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('should add dialog context bonus', () => {
    const obs = createObservation({
      content: { tag: 'div', text: 'Content', hasInteractives: false },
      signals: createSignals({ isDialog: true }),
    });
    const nodeInDialog = createReadableNode({
      kind: 'generic',
      label: 'Different',
      where: { region: 'dialog' },
    });
    const nodeNotInDialog = createReadableNode({
      kind: 'generic',
      label: 'Different',
      where: { region: 'main' },
    });

    const scoreInDialog = computeMatchScore(obs, nodeInDialog);
    const scoreNotInDialog = computeMatchScore(obs, nodeNotInDialog);

    expect(scoreInDialog).toBeGreaterThan(scoreNotInDialog);
  });

  it('should use fuzzy matching for similar text', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit Form', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Form Submit' });

    const score = computeMatchScore(obs, node);
    expect(score).toBeGreaterThan(0.3); // More than just kind match
  });

  it('should return partial score with fuzzy text match disabled', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit Form', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Form Submit' });

    const score = computeMatchScore(obs, node, { fuzzyTextMatch: false });
    expect(score).toBe(0.3); // Only kind match
  });
});

// ============================================================================
// findBestMatch Tests
// ============================================================================

describe('findBestMatch', () => {
  it('should return undefined when no candidates exist', () => {
    const obs = createObservation({
      content: { tag: 'a', text: 'Link', hasInteractives: false },
    });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>();

    const match = findBestMatch(obs, nodeIndex);
    expect(match).toBeUndefined();
  });

  it('should return undefined when best score below threshold', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Completely different' });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>([['button', [node]]]);

    // With high threshold, should not match
    const match = findBestMatch(obs, nodeIndex, { minMatchScore: 0.9 });
    expect(match).toBeUndefined();
  });

  it('should return highest scoring match', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const lowMatch = createReadableNode({
      kind: 'button',
      label: 'Cancel',
      backend_node_id: 1,
    });
    const highMatch = createReadableNode({
      kind: 'button',
      label: 'Submit',
      backend_node_id: 2,
    });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>([['button', [lowMatch, highMatch]]]);

    const match = findBestMatch(obs, nodeIndex);
    expect(match?.backend_node_id).toBe(2);
  });

  it('should check multiple kinds for observation', () => {
    const obs = createObservation({
      content: { tag: 'div', role: 'button', text: 'Click', hasInteractives: false },
    });
    const buttonNode = createReadableNode({
      kind: 'button',
      label: 'Click',
      backend_node_id: 1,
    });
    const genericNode = createReadableNode({
      kind: 'generic',
      label: 'Other',
      backend_node_id: 2,
    });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>([
      ['button', [buttonNode]],
      ['generic', [genericNode]],
    ]);

    const match = findBestMatch(obs, nodeIndex);
    // Button should match better due to role alignment
    expect(match?.backend_node_id).toBe(1);
  });
});

// ============================================================================
// linkObservationsToSnapshot Tests
// ============================================================================

describe('linkObservationsToSnapshot', () => {
  it('should only process appeared observations', () => {
    const appearedObs = createObservation({
      type: 'appeared',
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const disappearedObs = createObservation({
      type: 'disappeared',
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const groups = createObservationGroups({
      duringAction: [appearedObs, disappearedObs],
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit', backend_node_id: 123 });
    const snapshot = createSnapshot([node]);
    const registry = createMockRegistry({ 123: 'btn-submit' });

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(result.total).toBe(1); // Only appeared processed
    expect(result.linked).toBe(1);
    expect(appearedObs.eid).toBe('btn-submit');
    expect(disappearedObs.eid).toBeUndefined();
  });

  it('should skip disappeared observations', () => {
    const disappearedObs = createObservation({
      type: 'disappeared',
      content: { tag: 'div', text: 'Toast', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [disappearedObs] });
    const node = createReadableNode({ kind: 'generic', label: 'Toast', backend_node_id: 1 });
    const snapshot = createSnapshot([node]);
    const registry = createMockRegistry({ 1: 'toast' });

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(result.total).toBe(0);
    expect(result.linked).toBe(0);
  });

  it('should set eid on matched observations', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [obs] });
    const node = createReadableNode({ kind: 'button', label: 'Submit', backend_node_id: 456 });
    const snapshot = createSnapshot([node]);
    const registry = createMockRegistry({ 456: 'btn-456' });

    linkObservationsToSnapshot(groups, snapshot, registry);

    expect(obs.eid).toBe('btn-456');
  });

  it('should leave eid undefined for unmatched observations', () => {
    const obs = createObservation({
      content: { tag: 'a', text: 'Link', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [obs] });
    // No matching nodes in snapshot
    const snapshot = createSnapshot([]);
    const registry = createMockRegistry({});

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(obs.eid).toBeUndefined();
    expect(result.unlinked).toBe(1);
  });

  it('should return accurate statistics', () => {
    const matchableObs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const unmatchableObs = createObservation({
      content: { tag: 'custom-tag', text: 'Custom', hasInteractives: false },
    });
    const groups = createObservationGroups({
      duringAction: [matchableObs],
      sincePrevious: [unmatchableObs],
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit', backend_node_id: 1 });
    const snapshot = createSnapshot([node]);
    const registry = createMockRegistry({ 1: 'btn-1' });

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(result.total).toBe(2);
    expect(result.linked).toBe(1);
    expect(result.unlinked).toBe(1);
  });

  it('should handle empty observations', () => {
    const groups = createObservationGroups();
    const snapshot = createSnapshot([]);
    const registry = createMockRegistry({});

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(result.total).toBe(0);
    expect(result.linked).toBe(0);
    expect(result.unlinked).toBe(0);
  });

  it('should process observations from both groups', () => {
    const duringObs = createObservation({
      content: { tag: 'button', text: 'During', hasInteractives: false },
    });
    const previousObs = createObservation({
      content: { tag: 'button', text: 'Previous', hasInteractives: false },
    });
    const groups = createObservationGroups({
      duringAction: [duringObs],
      sincePrevious: [previousObs],
    });
    const node1 = createReadableNode({ kind: 'button', label: 'During', backend_node_id: 1 });
    const node2 = createReadableNode({ kind: 'button', label: 'Previous', backend_node_id: 2 });
    const snapshot = createSnapshot([node1, node2]);
    const registry = createMockRegistry({ 1: 'btn-during', 2: 'btn-previous' });

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(result.total).toBe(2);
    expect(result.linked).toBe(2);
    expect(duringObs.eid).toBe('btn-during');
    expect(previousObs.eid).toBe('btn-previous');
  });

  it('should not set eid when registry returns undefined', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const groups = createObservationGroups({ duringAction: [obs] });
    const node = createReadableNode({ kind: 'button', label: 'Submit', backend_node_id: 1 });
    const snapshot = createSnapshot([node]);
    // Registry returns undefined for this backend_node_id
    const registry = createMockRegistry({});

    const result = linkObservationsToSnapshot(groups, snapshot, registry);

    expect(obs.eid).toBeUndefined();
    expect(result.unlinked).toBe(1);
  });
});

// ============================================================================
// Boundary and Edge Case Tests
// ============================================================================

describe('findBestMatch boundary cases', () => {
  it('should not match when score equals minMatchScore exactly (must exceed)', () => {
    // With tag match only (0.3), if minMatchScore is 0.3, it should NOT match
    const obs = createObservation({
      content: { tag: 'button', text: 'Completely unrelated', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Totally different' });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>([['button', [node]]]);

    // Score will be exactly 0.3 (tag match only, no text overlap)
    const match = findBestMatch(obs, nodeIndex, { minMatchScore: 0.3 });
    expect(match).toBeUndefined();
  });

  it('should match when score exceeds minMatchScore', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit', backend_node_id: 1 });
    const nodeIndex = new Map<NodeKind, ReadableNode[]>([['button', [node]]]);

    // Score will be 0.6 (tag match + exact text match)
    const match = findBestMatch(obs, nodeIndex, { minMatchScore: 0.3 });
    expect(match).toBeDefined();
    expect(match?.backend_node_id).toBe(1);
  });
});

describe('computeMatchScore empty text/label scenarios', () => {
  it('should only score tag match when observation text is empty', () => {
    const obs = createObservation({
      content: { tag: 'button', text: '', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit' });

    const score = computeMatchScore(obs, node);
    expect(score).toBe(0.3); // Only tag match, no text scoring
  });

  it('should only score tag match when node label is empty', () => {
    const obs = createObservation({
      content: { tag: 'button', text: 'Submit', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: '' });

    const score = computeMatchScore(obs, node);
    expect(score).toBe(0.3); // Only tag match, no text scoring
  });

  it('should only score tag match when both text and label are empty', () => {
    const obs = createObservation({
      content: { tag: 'button', text: '', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: '' });

    const score = computeMatchScore(obs, node);
    expect(score).toBe(0.3); // Only tag match
  });

  it('should handle whitespace-only text gracefully', () => {
    const obs = createObservation({
      content: { tag: 'button', text: '   ', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: 'Submit' });

    const score = computeMatchScore(obs, node);
    // Whitespace gets trimmed, so no text match
    expect(score).toBe(0.3);
  });

  it('should match when both have same whitespace-only text (both become empty)', () => {
    const obs = createObservation({
      content: { tag: 'button', text: '   ', hasInteractives: false },
    });
    const node = createReadableNode({ kind: 'button', label: '   ' });

    const score = computeMatchScore(obs, node);
    // Both trim to empty, so exact match on empty string = 0.3 + 0.3
    expect(score).toBeCloseTo(0.6, 1);
  });
});
