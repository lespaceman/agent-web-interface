/**
 * State Manager Tests
 *
 * Tests for state tracking, diff computation, and baseline decisions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../../../src/state/state-manager.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';

/**
 * Create a minimal BaseSnapshot for testing.
 */
function createTestSnapshot(options: {
  url?: string;
  title?: string;
  nodes?: Partial<ReadableNode>[];
  snapshotId?: string;
}): BaseSnapshot {
  const defaultNodes: Partial<ReadableNode>[] = [
    {
      node_id: 'node-1',
      backend_node_id: 100,
      kind: 'input',
      label: 'Search',
      where: { region: 'search' },
      layout: { bbox: { x: 0, y: 0, w: 100, h: 30 }, display: 'block', screen_zone: 'top-center' },
      state: { visible: true, enabled: true },
      find: { primary: 'input[type="search"]', alternates: [] },
    },
    {
      node_id: 'node-2',
      backend_node_id: 101,
      kind: 'button',
      label: 'Submit',
      where: { region: 'search' },
      layout: { bbox: { x: 110, y: 0, w: 80, h: 30 }, display: 'block', screen_zone: 'top-center' },
      state: { visible: true, enabled: true },
      find: { primary: 'button[type="submit"]', alternates: [] },
    },
  ];

  const nodes = (options.nodes ?? defaultNodes).map((partial, idx) => ({
    node_id: partial.node_id ?? `node-${idx}`,
    backend_node_id: partial.backend_node_id ?? 100 + idx,
    frame_id: 'main-frame',
    loader_id: 'loader-1',
    kind: partial.kind ?? 'button',
    label: partial.label ?? `Element ${idx}`,
    where: partial.where ?? { region: 'main' },
    layout: partial.layout ?? {
      bbox: { x: 0, y: idx * 50, w: 100, h: 40 },
      display: 'block',
      screen_zone: 'top-center' as const,
    },
    state: partial.state ?? { visible: true, enabled: true },
    find: partial.find ?? { primary: `#el-${idx}`, alternates: [] },
    attributes: partial.attributes,
  })) as ReadableNode[];

  return {
    snapshot_id: options.snapshotId ?? `snap-${Date.now()}`,
    url: options.url ?? 'https://example.com/',
    title: options.title ?? 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes,
    meta: {
      node_count: nodes.length,
      interactive_count: nodes.filter((n) => n.state?.visible).length,
    },
  };
}

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager({ pageId: 'test-page' });
  });

  describe('baseline vs diff decision', () => {
    it('should return baseline with reason "first" on first snapshot', () => {
      const snapshot = createTestSnapshot({});
      const response = stateManager.generateResponse(snapshot);

      expect(response).toContain('<baseline reason="first"');
    });

    it('should return baseline with reason "navigation" when URL changes', () => {
      // First snapshot
      const snapshot1 = createTestSnapshot({ url: 'https://example.com/page1' });
      stateManager.generateResponse(snapshot1);

      // Second snapshot with different URL (navigation)
      const snapshot2 = createTestSnapshot({ url: 'https://example.com/page2' });
      const response = stateManager.generateResponse(snapshot2);

      expect(response).toContain('<baseline reason="navigation"');
    });

    it('should return diff when only DOM mutations occur without navigation', () => {
      // First snapshot - base state with enough elements that adding a few won't exceed threshold
      // We need 10+ elements so adding 3 stays below 30% change threshold
      const snapshot1 = createTestSnapshot({
        url: 'https://www.google.com/',
        nodes: [
          {
            node_id: 'search-box',
            backend_node_id: 100,
            kind: 'input',
            label: 'Search',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'search-btn',
            backend_node_id: 101,
            kind: 'button',
            label: 'Google Search',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'lucky-btn',
            backend_node_id: 102,
            kind: 'button',
            label: "I'm Feeling Lucky",
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'gmail-link',
            backend_node_id: 103,
            kind: 'link',
            label: 'Gmail',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'images-link',
            backend_node_id: 104,
            kind: 'link',
            label: 'Images',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'apps-btn',
            backend_node_id: 105,
            kind: 'button',
            label: 'Google apps',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'signin-link',
            backend_node_id: 106,
            kind: 'link',
            label: 'Sign in',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'about-link',
            backend_node_id: 107,
            kind: 'link',
            label: 'About',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'store-link',
            backend_node_id: 108,
            kind: 'link',
            label: 'Store',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'privacy-link',
            backend_node_id: 109,
            kind: 'link',
            label: 'Privacy',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
        ],
      });
      stateManager.generateResponse(snapshot1);

      // Second snapshot - autocomplete suggestions added (typing scenario)
      // URL stays the same, but new interactive elements appear
      // Adding 3 suggestions to 10 elements = 3/13 = 23% change (below 30% threshold)
      const snapshot2 = createTestSnapshot({
        url: 'https://www.google.com/',
        nodes: [
          {
            node_id: 'search-box',
            backend_node_id: 100,
            kind: 'input',
            label: 'Search',
            where: { region: 'search' },
            state: { visible: true, enabled: true, focused: true },
          },
          {
            node_id: 'search-btn',
            backend_node_id: 101,
            kind: 'button',
            label: 'Google Search',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'lucky-btn',
            backend_node_id: 102,
            kind: 'button',
            label: "I'm Feeling Lucky",
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'gmail-link',
            backend_node_id: 103,
            kind: 'link',
            label: 'Gmail',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'images-link',
            backend_node_id: 104,
            kind: 'link',
            label: 'Images',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'apps-btn',
            backend_node_id: 105,
            kind: 'button',
            label: 'Google apps',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'signin-link',
            backend_node_id: 106,
            kind: 'link',
            label: 'Sign in',
            where: { region: 'header' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'about-link',
            backend_node_id: 107,
            kind: 'link',
            label: 'About',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'store-link',
            backend_node_id: 108,
            kind: 'link',
            label: 'Store',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'privacy-link',
            backend_node_id: 109,
            kind: 'link',
            label: 'Privacy',
            where: { region: 'footer' },
            state: { visible: true, enabled: true },
          },
          // New autocomplete suggestions
          {
            node_id: 'suggestion-1',
            backend_node_id: 200,
            kind: 'link',
            label: 'anthropic claude',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'suggestion-2',
            backend_node_id: 201,
            kind: 'link',
            label: 'anthropic claude code',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
          {
            node_id: 'suggestion-3',
            backend_node_id: 202,
            kind: 'link',
            label: 'anthropic claude api',
            where: { region: 'search' },
            state: { visible: true, enabled: true },
          },
        ],
      });
      const response = stateManager.generateResponse(snapshot2);

      // Should return diff since URL didn't change and change is below threshold
      expect(response).toContain('<diff type="mutation"');
      expect(response).not.toContain('<baseline reason="navigation"');
    });

    it('should detect navigation when origin changes', () => {
      const snapshot1 = createTestSnapshot({ url: 'https://example.com/' });
      stateManager.generateResponse(snapshot1);

      const snapshot2 = createTestSnapshot({ url: 'https://different.com/' });
      const response = stateManager.generateResponse(snapshot2);

      expect(response).toContain('<baseline reason="navigation"');
    });

    it('should detect navigation when pathname changes', () => {
      const snapshot1 = createTestSnapshot({ url: 'https://example.com/home' });
      stateManager.generateResponse(snapshot1);

      const snapshot2 = createTestSnapshot({ url: 'https://example.com/about' });
      const response = stateManager.generateResponse(snapshot2);

      expect(response).toContain('<baseline reason="navigation"');
    });

    it('should NOT detect navigation when only query params change', () => {
      const snapshot1 = createTestSnapshot({ url: 'https://example.com/search' });
      stateManager.generateResponse(snapshot1);

      // Same page, different query (e.g., filter applied)
      const snapshot2 = createTestSnapshot({ url: 'https://example.com/search?q=test' });
      const response = stateManager.generateResponse(snapshot2);

      // Query param changes within same page should NOT be navigation
      expect(response).toContain('<diff type="mutation"');
    });
  });

  describe('large mutations always use diff', () => {
    it('should return diff even when many elements change (no threshold)', () => {
      // First snapshot with many elements
      const snapshot1 = createTestSnapshot({
        nodes: Array.from({ length: 20 }, (_, i) => ({
          node_id: `node-${i}`,
          backend_node_id: 100 + i,
          kind: 'button' as const,
          label: `Button ${i}`,
          where: { region: 'main' as const },
          state: { visible: true, enabled: true },
        })),
      });
      stateManager.generateResponse(snapshot1);

      // Second snapshot with mostly different elements
      // Previously this would trigger threshold baseline, now it's always diff
      const snapshot2 = createTestSnapshot({
        nodes: Array.from({ length: 20 }, (_, i) => ({
          node_id: `new-node-${i}`,
          backend_node_id: 200 + i,
          kind: 'link' as const,
          label: `Link ${i}`,
          where: { region: 'main' as const },
          state: { visible: true, enabled: true },
        })),
      });
      const response = stateManager.generateResponse(snapshot2);

      // Should be diff, not baseline - we always diff for same-page mutations
      expect(response).toContain('<diff type="mutation"');
      // Should show the added/removed counts
      expect(response).toContain('added="20"');
      expect(response).toContain('removed="20"');
    });

    it('should use diff for multiple consecutive steps (no periodic baseline)', () => {
      const sm = new StateManager({
        pageId: 'test-page-no-periodic',
        config: { maxActionables: 1000 },
      });

      const snapshot = createTestSnapshot({});

      // Step 1: first (baseline)
      const r1 = sm.generateResponse(snapshot);
      expect(r1).toContain('<baseline reason="first"');

      // Steps 2-10: all should be diffs (no periodic baseline)
      for (let i = 2; i <= 10; i++) {
        const r = sm.generateResponse(snapshot);
        expect(r).toContain('<diff type="mutation"');
      }
    });
  });
});
