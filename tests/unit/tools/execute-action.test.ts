/**
 * Execute Action Tests
 *
 * Tests for action execution with StateManager integration,
 * retry logic, and navigation-aware outcomes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getStateManager,
  removeStateManager,
  clearAllStateManagers,
  executeAction,
  executeActionWithRetry,
  executeActionWithOutcome,
  type CaptureSnapshotFn,
} from '../../../src/tools/execute-action.js';
import type { PageHandle } from '../../../src/browser/page-registry.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';
import type { RuntimeHealth } from '../../../src/state/health.types.js';
import { createHealthyRuntime } from '../../../src/state/health.types.js';
import { createMockPage } from '../../mocks/playwright.mock.js';

// Mock the stabilizeDom function
vi.mock('../../../src/delta/dom-stabilizer.js', () => ({
  stabilizeDom: vi.fn().mockResolvedValue({ status: 'stable', waitTimeMs: 10 }),
}));

// Mock the compileSnapshot function
vi.mock('../../../src/snapshot/index.js', () => ({
  compileSnapshot: vi.fn().mockResolvedValue(createMockSnapshot()),
}));

// Mock the observationAccumulator
vi.mock('../../../src/observation/index.js', () => ({
  observationAccumulator: {
    ensureInjected: vi.fn().mockResolvedValue(undefined),
    getObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    getAccumulatedObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    inject: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

/**
 * Create a mock ReadableNode.
 */
function createMockNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
  return {
    node_id: 'n1',
    backend_node_id: 100,
    frame_id: 'frame-main',
    loader_id: 'loader-1',
    kind: 'button',
    label: 'Submit',
    where: { region: 'main', group_path: [] },
    layout: { bbox: { x: 100, y: 100, w: 80, h: 40 }, screen_zone: 'above-fold' },
    state: { visible: true, enabled: true },
    ...overrides,
  };
}

/**
 * Create a mock BaseSnapshot.
 */
function createMockSnapshot(nodes: ReadableNode[] = []): BaseSnapshot {
  return {
    snapshot_id: `snap-${Math.random().toString(36).slice(2, 8)}`,
    url: 'https://example.com/page',
    title: 'Test Page',
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    nodes: nodes.length > 0 ? nodes : [createMockNode()],
    meta: {
      node_count: nodes.length || 1,
      interactive_count: nodes.length || 1,
    },
  };
}

/**
 * Create a mock PageHandle.
 */
function createMockPageHandle(overrides: Partial<PageHandle> = {}): PageHandle {
  return {
    page_id: 'page-test-123',
    page: createMockPage({ url: 'https://example.com/page' }) as unknown as PageHandle['page'],
    cdp: {
      send: vi.fn().mockResolvedValue({
        frameTree: { frame: { loaderId: 'loader-1' } },
      }),
      isActive: vi.fn().mockReturnValue(true),
    } as unknown as PageHandle['cdp'],
    created_at: new Date(),
    last_accessed: new Date(),
    ...overrides,
  } as PageHandle;
}

/**
 * Create a mock capture function.
 */
function createMockCapture(snapshot?: BaseSnapshot): CaptureSnapshotFn {
  return vi.fn().mockResolvedValue({
    snapshot: snapshot ?? createMockSnapshot(),
    runtime_health: createHealthyRuntime(),
  });
}

describe('Execute Action', () => {
  beforeEach(() => {
    // Clear state managers before each test
    clearAllStateManagers();
  });

  afterEach(() => {
    // Clean up state managers after each test
    clearAllStateManagers();
  });

  describe('StateManager Registry', () => {
    it('should create new state manager for unknown page', () => {
      const manager = getStateManager('page-new');
      expect(manager).toBeDefined();
    });

    it('should return same state manager for same page', () => {
      const manager1 = getStateManager('page-1');
      const manager2 = getStateManager('page-1');
      expect(manager1).toBe(manager2);
    });

    it('should return different managers for different pages', () => {
      const manager1 = getStateManager('page-1');
      const manager2 = getStateManager('page-2');
      expect(manager1).not.toBe(manager2);
    });

    it('should remove state manager', () => {
      const manager1 = getStateManager('page-remove');
      removeStateManager('page-remove');
      const manager2 = getStateManager('page-remove');
      expect(manager1).not.toBe(manager2);
    });

    it('should clear all state managers', () => {
      const manager1 = getStateManager('page-a');
      const manager2 = getStateManager('page-b');
      clearAllStateManagers();
      const manager1After = getStateManager('page-a');
      const manager2After = getStateManager('page-b');
      expect(manager1).not.toBe(manager1After);
      expect(manager2).not.toBe(manager2After);
    });

    it('should handle removing non-existent manager', () => {
      // Should not throw
      expect(() => removeStateManager('non-existent')).not.toThrow();
    });
  });

  describe('executeAction', () => {
    it('should execute successful action', async () => {
      const handle = createMockPageHandle();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeAction(handle, action, capture);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should capture snapshot after action', async () => {
      const handle = createMockPageHandle();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeAction(handle, action, capture);

      expect(capture).toHaveBeenCalledTimes(1);
      expect(result.snapshot_id).toBeDefined();
      expect(result.node_count).toBeGreaterThan(0);
    });

    it('should generate state response', async () => {
      const handle = createMockPageHandle();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeAction(handle, action, capture);

      expect(result.state_response).toBeDefined();
      expect(typeof result.state_response).toBe('string');
    });

    it('should handle action failure', async () => {
      const handle = createMockPageHandle();
      const action = vi.fn().mockRejectedValue(new Error('Click failed'));
      const capture = createMockCapture();

      const result = await executeAction(handle, action, capture);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Click failed');
    });

    it('should include runtime health', async () => {
      const handle = createMockPageHandle();
      const action = vi.fn().mockResolvedValue(undefined);
      const healthyRuntime: RuntimeHealth = createHealthyRuntime();
      const capture = vi.fn().mockResolvedValue({
        snapshot: createMockSnapshot(),
        runtime_health: healthyRuntime,
      });

      const result = await executeAction(handle, action, capture);

      expect(result.runtime_health).toBeDefined();
    });
  });

  describe('executeActionWithRetry', () => {
    it('should execute action without retry on success', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenCalledWith(node.backend_node_id);
    });

    it('should retry on stale element error', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode({ backend_node_id: 100, label: 'Submit', kind: 'button' });
      const freshNode = createMockNode({ backend_node_id: 200, label: 'Submit', kind: 'button' });
      const freshSnapshot = createMockSnapshot([freshNode]);

      // First call fails with stale element, second succeeds
      const action = vi
        .fn()
        .mockRejectedValueOnce(new Error('No node found for given backend id'))
        .mockResolvedValueOnce(undefined);

      const capture = createMockCapture(freshSnapshot);

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
      expect(action).toHaveBeenCalledTimes(2);
      // First call with original backend_node_id
      expect(action).toHaveBeenNthCalledWith(1, 100);
      // Second call with fresh backend_node_id
      expect(action).toHaveBeenNthCalledWith(2, 200);
    });

    it('should update snapshot store on retry', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const freshSnapshot = createMockSnapshot([createMockNode({ backend_node_id: 200 })]);
      const snapshotStore = { store: vi.fn() };

      const action = vi
        .fn()
        .mockRejectedValueOnce(new Error('No node found for given backend id'))
        .mockResolvedValueOnce(undefined);

      const capture = createMockCapture(freshSnapshot);

      await executeActionWithRetry(handle, node, action, snapshotStore, capture);

      expect(snapshotStore.store).toHaveBeenCalledWith(handle.page_id, freshSnapshot);
    });

    it('should fail if element not found after refresh', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode({ label: 'Disappeared Button' });
      const emptySnapshot = createMockSnapshot([
        createMockNode({ label: 'Other Button' }), // Different label
      ]);

      const action = vi.fn().mockRejectedValueOnce(new Error('No node found for given backend id'));

      const capture = createMockCapture(emptySnapshot);

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Retry failed');
      expect(result.error).toContain('Element no longer found');
    });

    it('should fail if retry also fails', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const freshSnapshot = createMockSnapshot([createMockNode({ backend_node_id: 200 })]);

      const action = vi
        .fn()
        .mockRejectedValueOnce(new Error('No node found for given backend id'))
        .mockRejectedValueOnce(new Error('Still failing'));

      const capture = createMockCapture(freshSnapshot);

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Retry failed');
    });

    it('should not retry on non-stale errors', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const action = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const capture = createMockCapture();

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
      expect(action).toHaveBeenCalledTimes(1); // No retry
    });

    it('should detect various stale element error messages', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const freshSnapshot = createMockSnapshot([createMockNode({ backend_node_id: 200 })]);
      const capture = createMockCapture(freshSnapshot);

      const staleErrors = [
        'No node found for given backend id',
        'Protocol error (DOM.scrollIntoViewIfNeeded)',
        'Node is detached from document',
        'Node has been deleted',
      ];

      for (const errorMsg of staleErrors) {
        const action = vi
          .fn()
          .mockRejectedValueOnce(new Error(errorMsg))
          .mockResolvedValueOnce(undefined);

        const result = await executeActionWithRetry(handle, node, action, undefined, capture);

        expect(result.success).toBe(true);
        expect(action).toHaveBeenCalledTimes(2);
        action.mockClear();
      }
    });
  });

  describe('executeActionWithOutcome', () => {
    it('should return success outcome without navigation', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
      expect(result.outcome.status).toBe('success');
      if (result.outcome.status === 'success') {
        expect(result.outcome.navigated).toBe(false);
      }
    });

    it('should detect navigation via URL change', async () => {
      // Before click: page1, after click: page2
      let callCount = 0;
      const mockPage = {
        url: vi.fn(() => {
          callCount++;
          return callCount === 1 ? 'https://example.com/page1' : 'https://example.com/page2';
        }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };

      const handle = createMockPageHandle({
        page: mockPage as unknown as PageHandle['page'],
      });
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.outcome.status).toBe('success');
      if (result.outcome.status === 'success') {
        expect(result.outcome.navigated).toBe(true);
      }
    });

    it('should detect navigation via loaderId change', async () => {
      let sendCallCount = 0;
      const mockCdp = {
        send: vi.fn(() => {
          sendCallCount++;
          return Promise.resolve({
            frameTree: {
              frame: {
                loaderId: sendCallCount <= 1 ? 'loader-1' : 'loader-2',
              },
            },
          });
        }),
        isActive: vi.fn().mockReturnValue(true),
      };

      const handle = createMockPageHandle({
        cdp: mockCdp as unknown as PageHandle['cdp'],
      });
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.outcome.status).toBe('success');
      if (result.outcome.status === 'success') {
        expect(result.outcome.navigated).toBe(true);
      }
    });

    it('should classify stale element from navigation as success', async () => {
      let callCount = 0;
      const mockPage = {
        url: vi.fn(() => {
          callCount++;
          // First call (pre-click) returns page1
          // Subsequent calls (during/after error) return page2
          return callCount === 1 ? 'https://example.com/page1' : 'https://example.com/page2';
        }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };

      const handle = createMockPageHandle({
        page: mockPage as unknown as PageHandle['page'],
      });
      const node = createMockNode();

      // Action fails with stale element error
      const action = vi.fn().mockRejectedValueOnce(new Error('No node found for given backend id'));

      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      // Should be classified as successful navigation, not as error
      expect(result.outcome.status).toBe('success');
      if (result.outcome.status === 'success') {
        expect(result.outcome.navigated).toBe(true);
      }
    });

    it('should retry stale element from DOM mutation', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://example.com/page'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };
      const mockCdp = {
        send: vi.fn().mockResolvedValue({
          frameTree: { frame: { loaderId: 'loader-1' } },
        }),
        isActive: vi.fn().mockReturnValue(true),
      };

      const handle = createMockPageHandle({
        page: mockPage as unknown as PageHandle['page'],
        cdp: mockCdp as unknown as PageHandle['cdp'],
      });
      const node = createMockNode({ backend_node_id: 100 });
      const freshNode = createMockNode({ backend_node_id: 200 });
      const freshSnapshot = createMockSnapshot([freshNode]);

      const action = vi
        .fn()
        .mockRejectedValueOnce(new Error('No node found for given backend id'))
        .mockResolvedValueOnce(undefined);

      const capture = createMockCapture(freshSnapshot);

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
      expect(result.outcome.status).toBe('stale_element');
      if (result.outcome.status === 'stale_element') {
        expect(result.outcome.reason).toBe('dom_mutation');
        expect(result.outcome.retried).toBe(true);
      }
    });

    it('should return element_not_found when element disappears', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://example.com/page'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };
      const mockCdp = {
        send: vi.fn().mockResolvedValue({
          frameTree: { frame: { loaderId: 'loader-1' } },
        }),
        isActive: vi.fn().mockReturnValue(true),
      };

      const handle = createMockPageHandle({
        page: mockPage as unknown as PageHandle['page'],
        cdp: mockCdp as unknown as PageHandle['cdp'],
      });
      const node = createMockNode({ label: 'Disappearing Button' });
      const emptySnapshot = createMockSnapshot([createMockNode({ label: 'Different Button' })]);

      const action = vi.fn().mockRejectedValueOnce(new Error('No node found for given backend id'));

      const capture = createMockCapture(emptySnapshot);

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(result.outcome.status).toBe('element_not_found');
      if (result.outcome.status === 'element_not_found') {
        expect(result.outcome.last_known_label).toBe('Disappearing Button');
      }
    });

    it('should return error outcome for non-stale errors', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const action = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(result.outcome.status).toBe('error');
      if (result.outcome.status === 'error') {
        expect(result.outcome.message).toBe('Network timeout');
      }
    });

    it('should handle CDP getFrameTree failure gracefully', async () => {
      const mockCdp = {
        send: vi.fn().mockRejectedValue(new Error('CDP connection lost')),
        isActive: vi.fn().mockReturnValue(true),
      };

      const handle = createMockPageHandle({
        cdp: mockCdp as unknown as PageHandle['cdp'],
      });
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const capture = createMockCapture();

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      // Should still work - falls back to URL-only navigation detection
      expect(result.success).toBe(true);
      expect(result.outcome.status).toBe('success');
    });

    it('should include snapshot in result', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const action = vi.fn().mockResolvedValue(undefined);
      const mockSnapshot = createMockSnapshot([createMockNode(), createMockNode()]);
      const capture = createMockCapture(mockSnapshot);

      const result = await executeActionWithOutcome(handle, node, action, undefined, capture);

      expect(result.snapshot).toBeDefined();
      expect(result.snapshot.nodes).toHaveLength(2);
    });
  });

  describe('Error Classification', () => {
    it('should recognize "no node found" as stale element', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const freshSnapshot = createMockSnapshot([createMockNode({ backend_node_id: 200 })]);

      const action = vi
        .fn()
        .mockRejectedValueOnce(new Error('no node found for given backend id'))
        .mockResolvedValueOnce(undefined);

      const capture = createMockCapture(freshSnapshot);
      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
      expect(action).toHaveBeenCalledTimes(2);
    });

    it('should recognize DOM.scrollIntoViewIfNeeded protocol error as stale', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();
      const freshSnapshot = createMockSnapshot([createMockNode({ backend_node_id: 200 })]);

      const action = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'Protocol error (DOM.scrollIntoViewIfNeeded): Node with given id does not belong to the document'
          )
        )
        .mockResolvedValueOnce(undefined);

      const capture = createMockCapture(freshSnapshot);
      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(true);
    });

    it('should not treat timeout errors as stale element', async () => {
      const handle = createMockPageHandle();
      const node = createMockNode();

      const action = vi.fn().mockRejectedValue(new Error('Timeout 30000ms exceeded'));
      const capture = createMockCapture();

      const result = await executeActionWithRetry(handle, node, action, undefined, capture);

      expect(result.success).toBe(false);
      expect(action).toHaveBeenCalledTimes(1); // No retry
      expect(result.error).toContain('Timeout');
    });
  });
});
