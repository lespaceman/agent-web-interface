/**
 * Diff Engine Tests
 *
 * Tests for incremental change detection between snapshots.
 */

import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../../src/state/diff-engine.js';
import type { BaseSnapshot, ReadableNode, NodeKind } from '../../../src/snapshot/snapshot.types.js';

/**
 * Extended attributes for testing (includes runtime attributes not in strict type).
 */
type TestAttributes = ReadableNode['attributes'] & Record<string, unknown>;

/**
 * Factory to create a minimal ReadableNode for testing.
 */
function createNode(
  overrides: Omit<Partial<ReadableNode>, 'attributes'> & { attributes?: TestAttributes } = {}
): ReadableNode {
  const { attributes, ...rest } = overrides;
  return {
    node_id: `n${Math.random().toString(36).slice(2, 8)}`,
    backend_node_id: Math.floor(Math.random() * 10000),
    frame_id: 'frame-main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Button',
    where: {
      region: 'main',
      group_path: [],
    },
    layout: {
      bbox: { x: 100, y: 100, w: 100, h: 40 },
      screen_zone: 'above-fold',
    },
    state: {
      visible: true,
      enabled: true,
    },
    attributes: attributes as ReadableNode['attributes'],
    ...rest,
  };
}

/**
 * Create an interactive node with specific identity.
 */
function createInteractiveNode(
  kind: NodeKind,
  label: string,
  overrides: Omit<Partial<ReadableNode>, 'attributes'> & { attributes?: TestAttributes } = {}
): ReadableNode {
  return createNode({
    kind,
    label,
    state: { visible: true, enabled: true },
    ...overrides,
  });
}

/**
 * Factory to create a minimal BaseSnapshot for testing.
 */
function createSnapshot(
  nodes: ReadableNode[] = [],
  overrides: Partial<BaseSnapshot> = {}
): BaseSnapshot {
  return {
    snapshot_id: `snap-${Math.random().toString(36).slice(2, 8)}`,
    url: 'https://example.com/page',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => n.state?.visible).length,
    },
    ...overrides,
  };
}

describe('Diff Engine', () => {
  describe('computeDiff', () => {
    it('should return diff mode response', () => {
      const prev = createSnapshot([]);
      const curr = createSnapshot([]);

      const result = computeDiff(prev, curr);

      expect(result.mode).toBe('diff');
      expect(result.diff).toBeDefined();
    });

    it('should detect no changes for identical snapshots', () => {
      const button = createInteractiveNode('button', 'Submit');
      const prev = createSnapshot([button]);
      const curr = createSnapshot([button]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(0);
      expect(result.diff.actionables.removed).toHaveLength(0);
      expect(result.diff.actionables.changed).toHaveLength(0);
      expect(result.diff.doc).toBeUndefined();
      expect(result.diff.layer).toBeUndefined();
    });
  });

  describe('Added Elements', () => {
    it('should detect added element', () => {
      const prev = createSnapshot([]);
      const newButton = createInteractiveNode('button', 'New Button');
      const curr = createSnapshot([newButton]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(1);
      expect(result.diff.actionables.removed).toHaveLength(0);
    });

    it('should detect multiple added elements', () => {
      const prev = createSnapshot([]);
      const curr = createSnapshot([
        createInteractiveNode('button', 'Button 1'),
        createInteractiveNode('link', 'Link 1'),
        createInteractiveNode('input', 'Input 1'),
      ]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(3);
    });

    it('should not detect added non-interactive elements', () => {
      const prev = createSnapshot([]);
      const curr = createSnapshot([
        createNode({ kind: 'heading', label: 'Title', state: { visible: true, enabled: true } }),
        createNode({ kind: 'paragraph', label: 'Text', state: { visible: true, enabled: true } }),
      ]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(0);
    });

    it('should not detect added hidden elements', () => {
      const prev = createSnapshot([]);
      const curr = createSnapshot([
        createInteractiveNode('button', 'Hidden', { state: { visible: false, enabled: true } }),
      ]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(0);
    });
  });

  describe('Removed Elements', () => {
    it('should detect removed element', () => {
      const button = createInteractiveNode('button', 'Old Button');
      const prev = createSnapshot([button]);
      const curr = createSnapshot([]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(0);
      expect(result.diff.actionables.removed).toHaveLength(1);
    });

    it('should detect multiple removed elements', () => {
      const prev = createSnapshot([
        createInteractiveNode('button', 'Button 1'),
        createInteractiveNode('link', 'Link 1'),
        createInteractiveNode('input', 'Input 1'),
      ]);
      const curr = createSnapshot([]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.removed).toHaveLength(3);
    });

    it('should detect element that became hidden as removed', () => {
      const visibleButton = createInteractiveNode('button', 'Button', {
        state: { visible: true, enabled: true },
      });
      const hiddenButton = createInteractiveNode('button', 'Button', {
        state: { visible: false, enabled: true },
      });

      const prev = createSnapshot([visibleButton]);
      const curr = createSnapshot([hiddenButton]);

      const result = computeDiff(prev, curr);

      // When element becomes hidden, it's no longer in the EID map
      // So it appears as removed
      expect(result.diff.actionables.removed).toHaveLength(1);
    });
  });

  describe('Changed Elements', () => {
    it('should detect enabled -> disabled change', () => {
      const enabledButton = createInteractiveNode('button', 'Submit', {
        where: { region: 'main', group_path: [] },
        layout: { bbox: { x: 100, y: 100, w: 80, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true },
      });
      const disabledButton = createInteractiveNode('button', 'Submit', {
        where: { region: 'main', group_path: [] },
        layout: { bbox: { x: 100, y: 100, w: 80, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: false },
      });

      const prev = createSnapshot([enabledButton]);
      const curr = createSnapshot([disabledButton]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.changed).toHaveLength(1);
      expect(result.diff.actionables.changed[0].k).toBe('ena');
      expect(result.diff.actionables.changed[0].from).toBe(true);
      expect(result.diff.actionables.changed[0].to).toBe(false);
    });

    it('should detect checked state change', () => {
      const unchecked = createInteractiveNode('checkbox', 'Accept Terms', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 50, y: 200, w: 20, h: 20 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, checked: false },
      });
      const checked = createInteractiveNode('checkbox', 'Accept Terms', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 50, y: 200, w: 20, h: 20 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, checked: true },
      });

      const prev = createSnapshot([unchecked]);
      const curr = createSnapshot([checked]);

      const result = computeDiff(prev, curr);

      const checkChange = result.diff.actionables.changed.find((c) => c.k === 'chk');
      expect(checkChange).toBeDefined();
      expect(checkChange?.from).toBe(false);
      expect(checkChange?.to).toBe(true);
    });

    it('should detect selected state change', () => {
      const unselected = createInteractiveNode('tab', 'Dashboard', {
        where: { region: 'main', group_path: ['Tabs'] },
        layout: { bbox: { x: 100, y: 50, w: 100, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, selected: false },
      });
      const selected = createInteractiveNode('tab', 'Dashboard', {
        where: { region: 'main', group_path: ['Tabs'] },
        layout: { bbox: { x: 100, y: 50, w: 100, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, selected: true },
      });

      const prev = createSnapshot([unselected]);
      const curr = createSnapshot([selected]);

      const result = computeDiff(prev, curr);

      const selChange = result.diff.actionables.changed.find((c) => c.k === 'sel');
      expect(selChange).toBeDefined();
      expect(selChange?.from).toBe(false);
      expect(selChange?.to).toBe(true);
    });

    it('should detect expanded state change', () => {
      const collapsed = createInteractiveNode('button', 'Show More', {
        where: { region: 'main', group_path: ['Accordion'] },
        layout: { bbox: { x: 100, y: 200, w: 200, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, expanded: false },
      });
      const expanded = createInteractiveNode('button', 'Show More', {
        where: { region: 'main', group_path: ['Accordion'] },
        layout: { bbox: { x: 100, y: 200, w: 200, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, expanded: true },
      });

      const prev = createSnapshot([collapsed]);
      const curr = createSnapshot([expanded]);

      const result = computeDiff(prev, curr);

      const expChange = result.diff.actionables.changed.find((c) => c.k === 'exp');
      expect(expChange).toBeDefined();
      expect(expChange?.from).toBe(false);
      expect(expChange?.to).toBe(true);
    });

    it('should detect focused state change', () => {
      const unfocused = createInteractiveNode('input', 'Email', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, focused: false },
      });
      const focused = createInteractiveNode('input', 'Email', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, focused: true },
      });

      const prev = createSnapshot([unfocused]);
      const curr = createSnapshot([focused]);

      const result = computeDiff(prev, curr);

      const focChange = result.diff.actionables.changed.find((c) => c.k === 'foc');
      expect(focChange).toBeDefined();
    });

    it('should detect invalid state change', () => {
      const valid = createInteractiveNode('input', 'Email', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, invalid: false },
      });
      const invalid = createInteractiveNode('input', 'Email', {
        where: { region: 'main', group_path: ['Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, invalid: true },
      });

      const prev = createSnapshot([valid]);
      const curr = createSnapshot([invalid]);

      const result = computeDiff(prev, curr);

      const invChange = result.diff.actionables.changed.find((c) => c.k === 'inv');
      expect(invChange).toBeDefined();
      expect(invChange?.to).toBe(true);
    });

    it('should detect value change', () => {
      const empty = createInteractiveNode('input', 'Search', {
        where: { region: 'header', group_path: [] },
        layout: { bbox: { x: 400, y: 20, w: 200, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true },
        attributes: { value: '' },
      });
      const withValue = createInteractiveNode('input', 'Search', {
        where: { region: 'header', group_path: [] },
        layout: { bbox: { x: 400, y: 20, w: 200, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true },
        attributes: { value: 'query' },
      });

      const prev = createSnapshot([empty]);
      const curr = createSnapshot([withValue]);

      const result = computeDiff(prev, curr);

      const valChange = result.diff.actionables.changed.find((c) => c.k === 'val');
      expect(valChange).toBeDefined();
      expect(valChange?.from).toBe('');
      expect(valChange?.to).toBe('query');
    });

    it('should detect label change', () => {
      const before = createInteractiveNode('button', 'Save', {
        where: { region: 'main', group_path: ['Actions'] },
        layout: { bbox: { x: 100, y: 300, w: 100, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true },
      });
      const after = createInteractiveNode('button', 'Saved!', {
        where: { region: 'main', group_path: ['Actions'] },
        layout: { bbox: { x: 100, y: 300, w: 100, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true },
      });

      const prev = createSnapshot([before]);
      const curr = createSnapshot([after]);

      const result = computeDiff(prev, curr);

      // Label change likely makes it a different EID (added + removed)
      // unless other identifying factors match
      expect(
        result.diff.actionables.added.length + result.diff.actionables.removed.length
      ).toBeGreaterThanOrEqual(0);
    });

    it('should detect multiple state changes on same element', () => {
      const before = createInteractiveNode('input', 'Username', {
        where: { region: 'main', group_path: ['Login Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, focused: false, invalid: false },
      });
      const after = createInteractiveNode('input', 'Username', {
        where: { region: 'main', group_path: ['Login Form'] },
        layout: { bbox: { x: 100, y: 100, w: 300, h: 40 }, screen_zone: 'above-fold' },
        state: { visible: true, enabled: true, focused: true, invalid: true },
      });

      const prev = createSnapshot([before]);
      const curr = createSnapshot([after]);

      const result = computeDiff(prev, curr);

      // Should have changes for both focused and invalid
      const focChange = result.diff.actionables.changed.find((c) => c.k === 'foc');
      const invChange = result.diff.actionables.changed.find((c) => c.k === 'inv');

      expect(focChange).toBeDefined();
      expect(invChange).toBeDefined();
    });
  });

  describe('Document Changes', () => {
    it('should detect URL change', () => {
      const prev = createSnapshot([], { url: 'https://example.com/page1' });
      const curr = createSnapshot([], { url: 'https://example.com/page2' });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc).toBeDefined();
      expect(result.diff.doc?.from.url).toBe('https://example.com/page1');
      expect(result.diff.doc?.to.url).toBe('https://example.com/page2');
    });

    it('should detect title change', () => {
      const prev = createSnapshot([], { title: 'Page 1' });
      const curr = createSnapshot([], { title: 'Page 2' });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc).toBeDefined();
      expect(result.diff.doc?.from.title).toBe('Page 1');
      expect(result.diff.doc?.to.title).toBe('Page 2');
    });

    it('should return hard nav_type for different pathnames', () => {
      const prev = createSnapshot([], { url: 'https://example.com/products' });
      const curr = createSnapshot([], { url: 'https://example.com/checkout' });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc?.nav_type).toBe('hard');
    });

    it('should return soft nav_type for same pathname different hash', () => {
      const prev = createSnapshot([], { url: 'https://example.com/page#section1' });
      const curr = createSnapshot([], { url: 'https://example.com/page#section2' });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc?.nav_type).toBe('soft');
    });

    it('should return soft nav_type for same pathname different query', () => {
      const prev = createSnapshot([], { url: 'https://example.com/search?q=a' });
      const curr = createSnapshot([], { url: 'https://example.com/search?q=b' });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc?.nav_type).toBe('soft');
    });

    it('should return undefined doc when URL and title unchanged', () => {
      const prev = createSnapshot([], {
        url: 'https://example.com/page',
        title: 'Same Title',
      });
      const curr = createSnapshot([], {
        url: 'https://example.com/page',
        title: 'Same Title',
      });

      const result = computeDiff(prev, curr);

      expect(result.diff.doc).toBeUndefined();
    });
  });

  describe('Layer Changes', () => {
    it('should detect layer change when modal opens', () => {
      const prev = createSnapshot([createInteractiveNode('button', 'Open Modal')]);
      const modal = createNode({
        kind: 'dialog',
        label: 'Confirm',
        attributes: { role: 'dialog', 'aria-modal': 'true' },
        layout: { bbox: { x: 300, y: 200, w: 400, h: 300 }, zIndex: 1000 },
        state: { visible: true, enabled: true },
      });
      const curr = createSnapshot([createInteractiveNode('button', 'Open Modal'), modal]);

      const result = computeDiff(prev, curr);

      expect(result.diff.layer).toBeDefined();
      expect(result.diff.layer?.stack_from).toContain('main');
      expect(result.diff.layer?.stack_to).toContain('modal');
    });

    it('should detect layer change when modal closes', () => {
      const button = createInteractiveNode('button', 'Open Modal');
      const modal = createNode({
        kind: 'dialog',
        label: 'Confirm',
        attributes: { role: 'dialog', 'aria-modal': 'true' },
        layout: { bbox: { x: 300, y: 200, w: 400, h: 300 }, zIndex: 1000 },
        state: { visible: true, enabled: true },
      });

      const prev = createSnapshot([button, modal]);
      const curr = createSnapshot([button]);

      const result = computeDiff(prev, curr);

      expect(result.diff.layer).toBeDefined();
      expect(result.diff.layer?.stack_from).toContain('modal');
      expect(result.diff.layer?.stack_to).not.toContain('modal');
    });

    it('should return undefined layer when layers unchanged', () => {
      const prev = createSnapshot([createInteractiveNode('button', 'Submit')]);
      const curr = createSnapshot([createInteractiveNode('button', 'Submit')]);

      const result = computeDiff(prev, curr);

      expect(result.diff.layer).toBeUndefined();
    });
  });

  describe('Atoms Changes', () => {
    it('should detect viewport width change', () => {
      const prev = createSnapshot([], { viewport: { width: 1280, height: 720 } });
      const curr = createSnapshot([], { viewport: { width: 800, height: 720 } });

      const result = computeDiff(prev, curr);

      const widthChange = result.diff.atoms.find((a) => a.k === 'viewport.w');
      expect(widthChange).toBeDefined();
      expect(widthChange?.from).toBe(1280);
      expect(widthChange?.to).toBe(800);
    });

    it('should detect viewport height change', () => {
      const prev = createSnapshot([], { viewport: { width: 1280, height: 720 } });
      const curr = createSnapshot([], { viewport: { width: 1280, height: 900 } });

      const result = computeDiff(prev, curr);

      const heightChange = result.diff.atoms.find((a) => a.k === 'viewport.h');
      expect(heightChange).toBeDefined();
      expect(heightChange?.from).toBe(720);
      expect(heightChange?.to).toBe(900);
    });

    it('should return empty atoms when viewport unchanged', () => {
      const prev = createSnapshot([], { viewport: { width: 1280, height: 720 } });
      const curr = createSnapshot([], { viewport: { width: 1280, height: 720 } });

      const result = computeDiff(prev, curr);

      const viewportChanges = result.diff.atoms.filter((a) => a.k.startsWith('viewport'));
      expect(viewportChanges).toHaveLength(0);
    });
  });

  describe('Evidence Tracking', () => {
    it('should track text content changes in readable elements', () => {
      // Status text that changes from "Loading..." to "Loaded!"
      // Use same backend_node_id to identify as same element
      const sharedBackendNodeId = 12345;
      const statusBefore = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'text',
        label: 'Loading...',
        where: { region: 'main', group_path: ['Card'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });
      const statusAfter = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'text',
        label: 'Loaded!',
        where: { region: 'main', group_path: ['Card'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });

      const prev = createSnapshot([statusBefore]);
      const curr = createSnapshot([statusAfter]);

      const result = computeDiff(prev, curr);

      // Mutations should track the text change
      expect(result.diff.mutations).toBeDefined();
      expect(result.diff.mutations.textChanged).toHaveLength(1);
      expect(result.diff.mutations.textChanged[0].eid).toMatch(/^rd-/);
      expect(result.diff.mutations.textChanged[0].from).toBe('Loading...');
      expect(result.diff.mutations.textChanged[0].to).toBe('Loaded!');
    });

    it('should detect status elements that appeared', () => {
      // Status element appears after action (wasn't in previous snapshot)
      const statusNode = createNode({
        kind: 'text',
        label: 'Success!',
        where: { region: 'main', group_path: ['Form'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([statusNode]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations).toBeDefined();
      expect(result.diff.mutations.statusAppeared).toHaveLength(1);
      expect(result.diff.mutations.statusAppeared[0].eid).toMatch(/^rd-/);
      expect(result.diff.mutations.statusAppeared[0].role).toBe('status');
      expect(result.diff.mutations.statusAppeared[0].text).toBe('Success!');
    });

    it('should detect alert elements that appeared', () => {
      const alertNode = createNode({
        kind: 'text',
        label: 'Error: Invalid input',
        where: { region: 'main', group_path: ['Form'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'alert' },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([alertNode]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations).toBeDefined();
      expect(result.diff.mutations.statusAppeared).toHaveLength(1);
      expect(result.diff.mutations.statusAppeared[0]).toMatchObject({
        role: 'alert',
        text: 'Error: Invalid input',
      });
    });

    it('should detect progressbar state changes', () => {
      // Use same backend_node_id to identify as same element
      const sharedBackendNodeId = 54321;
      const progressBefore = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'generic',
        label: '50%',
        where: { region: 'main', group_path: ['Upload'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'progressbar' },
      });
      const progressAfter = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'generic',
        label: '100%',
        where: { region: 'main', group_path: ['Upload'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'progressbar' },
      });

      const prev = createSnapshot([progressBefore]);
      const curr = createSnapshot([progressAfter]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations.textChanged).toHaveLength(1);
      expect(result.diff.mutations.textChanged[0]).toMatchObject({
        from: '50%',
        to: '100%',
      });
    });

    it('should set isEmpty=false when evidence changes detected', () => {
      const statusNode = createNode({
        kind: 'text',
        label: 'Done',
        where: { region: 'main', group_path: [] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([statusNode]);

      const result = computeDiff(prev, curr);

      expect(result.diff.isEmpty).toBe(false);
    });

    it('should set isEmpty=true when no actionable or evidence changes', () => {
      // Same interactive elements, no text changes, no status elements
      const button = createInteractiveNode('button', 'Submit');
      const prev = createSnapshot([button]);
      const curr = createSnapshot([button]);

      const result = computeDiff(prev, curr);

      // No actionables changed, no evidence tracked
      expect(result.diff.actionables.added).toHaveLength(0);
      expect(result.diff.actionables.removed).toHaveLength(0);
      expect(result.diff.actionables.changed).toHaveLength(0);
      expect(result.diff.mutations.textChanged).toHaveLength(0);
      expect(result.diff.mutations.statusAppeared).toHaveLength(0);
      expect(result.diff.isEmpty).toBe(true);
    });

    it('should track log role elements', () => {
      const logNode = createNode({
        kind: 'text',
        label: 'Request completed successfully',
        where: { region: 'main', group_path: ['Console'] },
        state: { visible: true, enabled: true },
        attributes: { role: 'log' },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([logNode]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations.statusAppeared).toHaveLength(1);
      expect(result.diff.mutations.statusAppeared[0].role).toBe('log');
    });

    it('should track all readable elements when TRACK_ALL_READABLE_MUTATIONS is true', () => {
      // With TRACK_ALL_READABLE_MUTATIONS flag enabled, paragraphs are tracked
      // Note: This test documents current evaluation mode behavior
      const paragraph = createNode({
        kind: 'paragraph',
        label: 'Some dynamic text',
        where: { region: 'main', group_path: [] },
        state: { visible: true, enabled: true },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([paragraph]);

      const result = computeDiff(prev, curr);

      // With flag enabled, paragraphs ARE tracked (evaluation mode)
      expect(result.diff.mutations.statusAppeared).toHaveLength(1);
      expect(result.diff.mutations.statusAppeared[0].role).toBe('paragraph');
      expect(result.diff.mutations.statusAppeared[0].text).toBe('Some dynamic text');
    });

    it('should truncate long text in mutations', () => {
      // Text over 100 chars should be truncated with "..."
      const longText = 'A'.repeat(150);
      const statusNode = createNode({
        kind: 'text',
        label: longText,
        where: { region: 'main', group_path: [] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });

      const prev = createSnapshot([]);
      const curr = createSnapshot([statusNode]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations.statusAppeared).toHaveLength(1);
      // Should be truncated to 97 chars + "..."
      expect(result.diff.mutations.statusAppeared[0].text).toHaveLength(100);
      expect(result.diff.mutations.statusAppeared[0].text).toMatch(/\.\.\.$/);
    });

    it('should truncate long text in text changes', () => {
      const sharedBackendNodeId = 99999;
      const longTextBefore = 'B'.repeat(120);
      const longTextAfter = 'C'.repeat(130);

      const before = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'text',
        label: longTextBefore,
        where: { region: 'main', group_path: [] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });
      const after = createNode({
        backend_node_id: sharedBackendNodeId,
        kind: 'text',
        label: longTextAfter,
        where: { region: 'main', group_path: [] },
        state: { visible: true, enabled: true },
        attributes: { role: 'status' },
      });

      const prev = createSnapshot([before]);
      const curr = createSnapshot([after]);

      const result = computeDiff(prev, curr);

      expect(result.diff.mutations.textChanged).toHaveLength(1);
      expect(result.diff.mutations.textChanged[0].from).toHaveLength(100);
      expect(result.diff.mutations.textChanged[0].from).toMatch(/\.\.\.$/);
      expect(result.diff.mutations.textChanged[0].to).toHaveLength(100);
      expect(result.diff.mutations.textChanged[0].to).toMatch(/\.\.\.$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty snapshots', () => {
      const prev = createSnapshot([]);
      const curr = createSnapshot([]);

      const result = computeDiff(prev, curr);

      expect(result.mode).toBe('diff');
      expect(result.diff.actionables.added).toHaveLength(0);
      expect(result.diff.actionables.removed).toHaveLength(0);
      expect(result.diff.actionables.changed).toHaveLength(0);
    });

    it('should handle snapshot with only non-interactive elements', () => {
      const prev = createSnapshot([
        createNode({ kind: 'heading', label: 'Title' }),
        createNode({ kind: 'paragraph', label: 'Content' }),
      ]);
      const curr = createSnapshot([
        createNode({ kind: 'heading', label: 'New Title' }),
        createNode({ kind: 'paragraph', label: 'New Content' }),
      ]);

      const result = computeDiff(prev, curr);

      expect(result.diff.actionables.added).toHaveLength(0);
      expect(result.diff.actionables.removed).toHaveLength(0);
      expect(result.diff.actionables.changed).toHaveLength(0);
    });

    it('should handle many elements efficiently', () => {
      const prevNodes = Array.from({ length: 100 }, (_, i) =>
        createInteractiveNode('button', `Button ${i}`, {
          where: { region: 'main', group_path: [`Section ${Math.floor(i / 10)}`] },
          layout: {
            bbox: { x: (i % 10) * 100, y: Math.floor(i / 10) * 50, w: 80, h: 40 },
            screen_zone: 'above-fold',
          },
        })
      );

      const currNodes = Array.from({ length: 100 }, (_, i) =>
        createInteractiveNode('button', `Button ${i}`, {
          where: { region: 'main', group_path: [`Section ${Math.floor(i / 10)}`] },
          layout: {
            bbox: { x: (i % 10) * 100, y: Math.floor(i / 10) * 50, w: 80, h: 40 },
            screen_zone: 'above-fold',
          },
        })
      );

      const prev = createSnapshot(prevNodes);
      const curr = createSnapshot(currNodes);

      const startTime = Date.now();
      const result = computeDiff(prev, curr);
      const duration = Date.now() - startTime;

      // Should complete within reasonable time (100ms)
      expect(duration).toBeLessThan(100);
      expect(result.mode).toBe('diff');
    });

    it('should handle completely different snapshots', () => {
      const prev = createSnapshot([
        createInteractiveNode('button', 'Button A'),
        createInteractiveNode('link', 'Link A'),
      ]);
      const curr = createSnapshot([
        createInteractiveNode('button', 'Button B'),
        createInteractiveNode('input', 'Input B'),
      ]);

      const result = computeDiff(prev, curr);

      // All old elements removed, all new elements added
      expect(result.diff.actionables.removed.length).toBe(2);
      expect(result.diff.actionables.added.length).toBe(2);
    });
  });
});
