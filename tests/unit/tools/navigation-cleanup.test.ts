/**
 * Navigation Cleanup Tests
 *
 * Verifies that navigation tools properly clear the dependency tracker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Create mock tracker instance at module level for reference in tests
const mockClearPage = vi.fn();
const mockClearAll = vi.fn();
const mockTracker = {
  clearPage: mockClearPage,
  clearAll: mockClearAll,
};

// Mock modules before importing the module under test
vi.mock('../../../src/form/index.js', () => ({
  getDependencyTracker: vi.fn(() => mockTracker),
}));

const mockNavigateTo = vi.fn().mockResolvedValue(undefined);
const mockClosePage = vi.fn().mockResolvedValue(undefined);
const mockShutdown = vi.fn().mockResolvedValue(undefined);
const mockTouchPage = vi.fn();
const mockResolvePageOrCreate = vi.fn().mockResolvedValue({
  page_id: 'test-page',
  page: {
    url: vi.fn().mockReturnValue('https://example.com'),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
    reload: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  },
  cdp: {
    send: vi.fn().mockResolvedValue({
      frameTree: { frame: { loaderId: 'loader-1' } },
    }),
    isActive: vi.fn().mockReturnValue(true),
  },
  created_at: new Date(),
  last_accessed: new Date(),
});

const mockSessionManager = {
  resolvePageOrCreate: mockResolvePageOrCreate,
  navigateTo: mockNavigateTo,
  touchPage: mockTouchPage,
  closePage: mockClosePage,
  shutdown: mockShutdown,
};

vi.mock('../../../src/browser/session-manager.js', () => ({
  SessionManager: vi.fn(() => mockSessionManager),
}));

vi.mock('../../../src/snapshot/index.js', () => {
  // Create a proper class mock for SnapshotStore
  class MockSnapshotStore {
    store = vi.fn();
    getByPageId = vi.fn().mockReturnValue(null);
    removeByPageId = vi.fn();
    clear = vi.fn();
  }
  return {
    SnapshotStore: MockSnapshotStore,
    compileSnapshot: vi.fn().mockResolvedValue({
      snapshot_id: 'snap-test',
      url: 'https://example.com',
      title: 'Test',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes: [],
      meta: { node_count: 0, interactive_count: 0 },
    }),
    clickByBackendNodeId: vi.fn(),
    typeByBackendNodeId: vi.fn(),
    pressKey: vi.fn(),
    selectOption: vi.fn(),
    hoverByBackendNodeId: vi.fn(),
    scrollIntoView: vi.fn(),
    scrollPage: vi.fn(),
  };
});

vi.mock('../../../src/tools/execute-action.js', () => ({
  getStateManager: vi.fn(() => ({
    generateResponse: vi.fn().mockReturnValue('<state>test</state>'),
    getElementRegistry: vi.fn(() => ({
      getByEid: vi.fn(),
      getEidBySnapshotAndBackendNodeId: vi.fn(),
    })),
    getActiveLayer: vi.fn().mockReturnValue(null),
  })),
  removeStateManager: vi.fn(),
  clearAllStateManagers: vi.fn(),
  stabilizeAfterNavigation: vi.fn().mockResolvedValue(undefined),
  executeAction: vi.fn(),
  executeActionWithRetry: vi.fn(),
  executeActionWithOutcome: vi.fn(),
}));

vi.mock('../../../src/observation/index.js', () => ({
  observationAccumulator: {
    inject: vi.fn().mockResolvedValue(undefined),
    ensureInjected: vi.fn().mockResolvedValue(undefined),
    getObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    getAccumulatedObservations: vi.fn().mockResolvedValue({ duringAction: [], sincePrevious: [] }),
    reset: vi.fn().mockResolvedValue(undefined),
    filterBySignificance: vi.fn().mockImplementation(<T>(obs: T): T => obs),
  },
  ATTACHMENT_SIGNIFICANCE_THRESHOLD: 5,
}));

vi.mock('../../../src/snapshot/snapshot-health.js', () => ({
  captureWithStabilization: vi.fn().mockResolvedValue({
    snapshot: {
      snapshot_id: 'snap-test',
      url: 'https://example.com',
      title: 'Test',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes: [],
      meta: { node_count: 0, interactive_count: 0 },
    },
    attempts: 1,
    health: { valid: true, message: 'OK' },
  }),
  determineHealthCode: vi.fn().mockReturnValue('HEALTHY'),
}));

vi.mock('../../../src/state/health.types.js', () => ({
  createHealthyRuntime: vi.fn().mockReturnValue({
    cdp: { ok: true, recovered: false },
    snapshot: { ok: true, code: 'HEALTHY', attempts: 1 },
  }),
  createRecoveredCdpRuntime: vi.fn().mockReturnValue({
    cdp: { ok: true, recovered: true, recovery_method: 'rebind' },
    snapshot: { ok: true, code: 'HEALTHY', attempts: 1 },
  }),
}));

vi.mock('../../../src/tools/response-builder.js', () => ({
  buildClosePageResponse: vi.fn().mockReturnValue({ success: true }),
  buildCloseSessionResponse: vi.fn().mockReturnValue({ success: true }),
  buildFindElementsResponse: vi.fn(),
  buildGetNodeDetailsResponse: vi.fn(),
}));

// Import module under test AFTER mocks are set up
import {
  navigate,
  goBack,
  goForward,
  reload,
  closePage,
  closeSession,
  initializeTools,
} from '../../../src/tools/browser-tools.js';
import { getDependencyTracker } from '../../../src/form/index.js';

describe('Navigation tools dependency tracker cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize tools with our mock session manager
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    initializeTools(mockSessionManager as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('navigate()', () => {
    it('should clear dependency tracker for the page before navigation', async () => {
      await navigate({ url: 'https://example.com', page_id: 'test-page' });

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });

    it('should clear dependency tracker before navigateTo is called', async () => {
      const callOrder: string[] = [];

      mockClearPage.mockImplementation(() => {
        callOrder.push('clearPage');
      });
      mockNavigateTo.mockImplementation(() => {
        callOrder.push('navigateTo');
        return Promise.resolve(undefined);
      });

      await navigate({ url: 'https://example.com', page_id: 'test-page' });

      expect(callOrder).toEqual(['clearPage', 'navigateTo']);
    });
  });

  describe('goBack()', () => {
    it('should clear dependency tracker for the page', async () => {
      await goBack({ page_id: 'test-page' });

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('goForward()', () => {
    it('should clear dependency tracker for the page', async () => {
      await goForward({ page_id: 'test-page' });

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('reload()', () => {
    it('should clear dependency tracker for the page', async () => {
      await reload({ page_id: 'test-page' });

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('closePage()', () => {
    it('should clear dependency tracker for the closed page', async () => {
      await closePage({ page_id: 'test-page' });

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('closeSession()', () => {
    it('should clear all dependency data', async () => {
      await closeSession({});

      expect(getDependencyTracker).toHaveBeenCalled();
      expect(mockClearAll).toHaveBeenCalled();
    });
  });
});
