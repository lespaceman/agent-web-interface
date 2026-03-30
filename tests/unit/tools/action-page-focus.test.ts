/**
 * Action tool page focus tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBringToFront,
  mockExecuteActionWithOutcome,
  mockRequireSnapshot,
  mockResolveElementByEid,
  mockSnapshotStore,
  mockHandle,
} = vi.hoisted(() => {
  const mockBringToFront = vi.fn().mockResolvedValue(undefined);
  const mockExecuteActionWithOutcome = vi.fn();
  const mockRequireSnapshot = vi.fn();
  const mockResolveElementByEid = vi.fn();
  const mockSnapshotStore = {
    store: vi.fn(),
    getByPageId: vi.fn(),
    removeByPageId: vi.fn(),
    clear: vi.fn(),
  };
  const mockHandle = {
    page_id: 'page-focus',
    page: {
      bringToFront: mockBringToFront,
    },
    cdp: {},
    created_at: new Date(),
  };

  return {
    mockBringToFront,
    mockExecuteActionWithOutcome,
    mockRequireSnapshot,
    mockResolveElementByEid,
    mockSnapshotStore,
    mockHandle,
  };
});

const mockSessionManager = {
  syncPages: vi.fn(),
};

vi.mock('../../../src/form/index.js', () => ({
  getDependencyTracker: vi.fn(() => ({
    clearPage: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

vi.mock('../../../src/snapshot/index.js', () => ({
  SnapshotStore: class {
    store = mockSnapshotStore.store;
    getByPageId = mockSnapshotStore.getByPageId;
    removeByPageId = mockSnapshotStore.removeByPageId;
    clear = mockSnapshotStore.clear;
  },
  clickByBackendNodeId: vi.fn(),
  clickAtCoordinates: vi.fn(),
  clickAtElementOffset: vi.fn(),
  dragBetweenCoordinates: vi.fn(),
  dispatchWheelEvent: vi.fn(),
  typeByBackendNodeId: vi.fn(),
  pressKey: vi.fn(),
  selectOption: vi.fn(),
  hoverByBackendNodeId: vi.fn(),
  scrollIntoView: vi.fn(),
  scrollPage: vi.fn(),
}));

vi.mock('../../../src/snapshot/snapshot-health.js', () => ({
  captureWithStabilization: vi.fn(),
  determineHealthCode: vi.fn(),
}));

vi.mock('../../../src/observation/index.js', () => ({
  observationAccumulator: {
    inject: vi.fn(),
    getAccumulatedObservations: vi.fn(),
    filterBySignificance: vi.fn(),
  },
}));

vi.mock('../../../src/tools/execute-action.js', () => ({
  executeAction: vi.fn(),
  executeActionWithRetry: vi.fn(),
  executeActionWithOutcome: mockExecuteActionWithOutcome,
}));

vi.mock('../../../src/tools/action-stabilization.js', () => ({
  stabilizeAfterNavigation: vi.fn(),
  captureSnapshotFallback: vi.fn(),
}));

vi.mock('../../../src/state/element-identity.js', () => ({
  computeEid: vi.fn(),
}));

vi.mock('../../../src/state/health.types.js', () => ({
  createHealthyRuntime: vi.fn(),
  createRecoveredCdpRuntime: vi.fn(),
}));

vi.mock('../../../src/query/query-engine.js', () => ({
  QueryEngine: vi.fn(),
}));

vi.mock('../../../src/screenshot/index.js', () => ({
  captureScreenshot: vi.fn(),
  getElementBoundingBox: vi.fn(),
}));

vi.mock('../../../src/lib/temp-file.js', () => ({
  cleanupTempFiles: vi.fn().mockResolvedValue(undefined),
}));

import { click } from '../../../src/tools/browser-tools.js';
import { createTestToolContext } from '../../helpers/test-tool-context.js';
import type { ToolContext } from '../../../src/tools/tool-context.types.js';

describe('click page focus', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSnapshot.mockReturnValue({
      nodes: [],
    });
    mockResolveElementByEid.mockReturnValue({
      node_id: 'n1',
      backend_node_id: 123,
      kind: 'link',
      label: 'Learn more',
    });
    mockExecuteActionWithOutcome.mockResolvedValue({
      snapshot: { snapshot_id: 'snap-1', meta: {} },
      state_response: '<state />',
    });
    ctx = createTestToolContext({
      getSessionManager: vi
        .fn()
        .mockReturnValue(mockSessionManager) as ToolContext['getSessionManager'],
      getSnapshotStore: vi
        .fn()
        .mockReturnValue(mockSnapshotStore) as ToolContext['getSnapshotStore'],
      resolveExistingPage: vi
        .fn()
        .mockReturnValue(mockHandle) as ToolContext['resolveExistingPage'],
      ensureCdpSession: vi.fn().mockResolvedValue({
        handle: mockHandle,
        recovered: false,
        runtime_health: {},
      }) as ToolContext['ensureCdpSession'],
      requireSnapshot: mockRequireSnapshot as ToolContext['requireSnapshot'],
      resolveElementByEid: mockResolveElementByEid as ToolContext['resolveElementByEid'],
    });
  });

  it('does not bring page to front by default', async () => {
    await click({ page_id: 'page-focus', eid: 'eid-1' }, ctx);

    expect(mockBringToFront).not.toHaveBeenCalled();
    expect(mockExecuteActionWithOutcome).toHaveBeenCalledTimes(1);
  });

  it('brings the target page to the front when BRING_TO_FRONT is true', async () => {
    process.env.BRING_TO_FRONT = 'true';
    try {
      await click({ page_id: 'page-focus', eid: 'eid-1' }, ctx);

      expect(mockBringToFront).toHaveBeenCalledTimes(1);
      expect(mockExecuteActionWithOutcome).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.BRING_TO_FRONT;
    }
  });
});
