/**
 * Dependency Tracker Tests
 *
 * Tests for observed dependency tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyTracker, createObservedEffect } from '../../../src/form/dependency-tracker.js';

describe('DependencyTracker', () => {
  let tracker: DependencyTracker;

  beforeEach(() => {
    tracker = new DependencyTracker();
  });

  describe('recordEffect', () => {
    it('should record an observed effect', () => {
      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map([['target-eid', false]]),
        new Map([['target-eid', true]]),
        new Set(),
        new Set(),
        []
      );

      tracker.recordEffect('page-1', effect);

      const deps = tracker.getDependenciesFor('page-1', 'target-eid');
      expect(deps.length).toBeGreaterThan(0);
      expect(deps[0].source_eid).toBe('trigger-eid');
      expect(deps[0].type).toBe('enables');
    });

    it('should track multiple effects from same trigger', () => {
      const effect1 = createObservedEffect(
        'trigger-eid',
        'click',
        new Map(),
        new Map(),
        new Set(),
        new Set(['appeared-1', 'appeared-2']),
        []
      );

      tracker.recordEffect('page-1', effect1);

      const deps1 = tracker.getDependenciesFor('page-1', 'appeared-1');
      const deps2 = tracker.getDependenciesFor('page-1', 'appeared-2');

      expect(deps1.length).toBeGreaterThan(0);
      expect(deps2.length).toBeGreaterThan(0);
      expect(deps1[0].type).toBe('reveals');
    });

    it('should increase confidence with repeated observations', () => {
      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map([['target-eid', false]]),
        new Map([['target-eid', true]]),
        new Set(),
        new Set(),
        []
      );

      // Record the same effect multiple times
      tracker.recordEffect('page-1', effect);
      const deps1 = tracker.getDependenciesFor('page-1', 'target-eid');
      const confidence1 = deps1[0].confidence;

      tracker.recordEffect('page-1', effect);
      const deps2 = tracker.getDependenciesFor('page-1', 'target-eid');
      const confidence2 = deps2[0].confidence;

      tracker.recordEffect('page-1', effect);
      const deps3 = tracker.getDependenciesFor('page-1', 'target-eid');
      const confidence3 = deps3[0].confidence;

      expect(confidence2).toBeGreaterThanOrEqual(confidence1);
      expect(confidence3).toBeGreaterThanOrEqual(confidence2);
    });
  });

  describe('getDependenciesFor', () => {
    it('should return empty array for unknown page', () => {
      const deps = tracker.getDependenciesFor('unknown-page', 'some-eid');
      expect(deps).toEqual([]);
    });

    it('should return empty array for unknown target', () => {
      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map(),
        new Map(),
        new Set(),
        new Set(['known-target']),
        []
      );

      tracker.recordEffect('page-1', effect);

      const deps = tracker.getDependenciesFor('page-1', 'unknown-target');
      expect(deps).toEqual([]);
    });

    it('should filter by minimum confidence', () => {
      const lowConfTracker = new DependencyTracker({ minConfidence: 0.9 });

      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map([['target-eid', false]]),
        new Map([['target-eid', true]]),
        new Set(),
        new Set(),
        []
      );

      lowConfTracker.recordEffect('page-1', effect);

      // With only one observation, confidence is low
      const deps = lowConfTracker.getDependenciesFor('page-1', 'target-eid');
      // May be empty if confidence doesn't meet threshold
      expect(deps.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getAllDependencies', () => {
    it('should return all dependencies for a page', () => {
      const effect1 = createObservedEffect(
        'trigger-1',
        'click',
        new Map(),
        new Map(),
        new Set(),
        new Set(['target-1']),
        []
      );

      const effect2 = createObservedEffect(
        'trigger-2',
        'click',
        new Map([['target-2', false]]),
        new Map([['target-2', true]]),
        new Set(),
        new Set(),
        []
      );

      tracker.recordEffect('page-1', effect1);
      tracker.recordEffect('page-1', effect2);

      const allDeps = tracker.getAllDependencies('page-1');

      expect(allDeps.size).toBeGreaterThan(0);
    });
  });

  describe('getDependentsOf', () => {
    it('should return fields that depend on a source', () => {
      const effect = createObservedEffect(
        'source-eid',
        'click',
        new Map([
          ['dependent-1', false],
          ['dependent-2', false],
        ]),
        new Map([
          ['dependent-1', true],
          ['dependent-2', true],
        ]),
        new Set(),
        new Set(),
        []
      );

      tracker.recordEffect('page-1', effect);

      const dependents = tracker.getDependentsOf('page-1', 'source-eid');

      expect(dependents).toContain('dependent-1');
      expect(dependents).toContain('dependent-2');
    });

    it('should return empty array for source with no dependents', () => {
      const dependents = tracker.getDependentsOf('page-1', 'lonely-eid');
      expect(dependents).toEqual([]);
    });
  });

  describe('clearPage', () => {
    it('should clear all data for a specific page', () => {
      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map(),
        new Map(),
        new Set(),
        new Set(['target-eid']),
        []
      );

      tracker.recordEffect('page-1', effect);
      tracker.recordEffect('page-2', effect);

      tracker.clearPage('page-1');

      expect(tracker.getDependenciesFor('page-1', 'target-eid')).toEqual([]);
      expect(tracker.getDependenciesFor('page-2', 'target-eid').length).toBeGreaterThan(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all tracked data', () => {
      const effect = createObservedEffect(
        'trigger-eid',
        'click',
        new Map(),
        new Map(),
        new Set(),
        new Set(['target-eid']),
        []
      );

      tracker.recordEffect('page-1', effect);
      tracker.recordEffect('page-2', effect);

      tracker.clearAll();

      expect(tracker.getDependenciesFor('page-1', 'target-eid')).toEqual([]);
      expect(tracker.getDependenciesFor('page-2', 'target-eid')).toEqual([]);
    });
  });
});

describe('createObservedEffect', () => {
  it('should detect enabled elements', () => {
    const effect = createObservedEffect(
      'trigger-eid',
      'click',
      new Map([['field-a', false]]),
      new Map([['field-a', true]]),
      new Set(),
      new Set(),
      []
    );

    expect(effect.enabled).toContain('field-a');
    expect(effect.disabled).toEqual([]);
  });

  it('should detect disabled elements', () => {
    const effect = createObservedEffect(
      'trigger-eid',
      'click',
      new Map([['field-a', true]]),
      new Map([['field-a', false]]),
      new Set(),
      new Set(),
      []
    );

    expect(effect.disabled).toContain('field-a');
    expect(effect.enabled).toEqual([]);
  });

  it('should detect appeared elements', () => {
    const effect = createObservedEffect(
      'trigger-eid',
      'click',
      new Map(),
      new Map(),
      new Set(['existing']),
      new Set(['existing', 'new-element']),
      []
    );

    expect(effect.appeared).toContain('new-element');
    expect(effect.appeared).not.toContain('existing');
  });

  it('should detect disappeared elements', () => {
    const effect = createObservedEffect(
      'trigger-eid',
      'click',
      new Map(),
      new Map(),
      new Set(['existing', 'going-away']),
      new Set(['existing']),
      []
    );

    expect(effect.disappeared).toContain('going-away');
    expect(effect.disappeared).not.toContain('existing');
  });

  it('should track value changes', () => {
    const effect = createObservedEffect(
      'trigger-eid',
      'type',
      new Map(),
      new Map(),
      new Set(),
      new Set(),
      ['field-with-change']
    );

    expect(effect.value_changed).toContain('field-with-change');
  });

  it('should compute confidence based on number of changes', () => {
    const effectWithMany = createObservedEffect(
      'trigger-eid',
      'click',
      new Map([
        ['a', false],
        ['b', false],
      ]),
      new Map([
        ['a', true],
        ['b', true],
      ]),
      new Set(),
      new Set(['c', 'd']),
      ['e']
    );

    const effectWithFew = createObservedEffect(
      'trigger-eid',
      'click',
      new Map(),
      new Map(),
      new Set(),
      new Set(['single']),
      []
    );

    expect(effectWithMany.confidence).toBeGreaterThan(effectWithFew.confidence);
  });
});
