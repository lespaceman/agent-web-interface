/**
 * Navigation Cleanup Tests
 *
 * Verifies that navigation tools properly clear the dependency tracker
 * via the ToolContext interface.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestToolContext } from '../../helpers/test-tool-context.js';
import type { ToolContext } from '../../../src/tools/tool-context.types.js';

// Create mock tracker instance at module level for reference in tests
const mockClearPage = vi.fn();
const mockClearAll = vi.fn();
const mockTracker = {
  clearPage: mockClearPage,
  clearAll: mockClearAll,
  recordEffect: vi.fn(),
  getDependenciesFor: vi.fn().mockReturnValue([]),
  getDependentsOf: vi.fn().mockReturnValue([]),
  getAllDependencies: vi.fn().mockReturnValue(new Map()),
};

const mockNavigateTo = vi.fn().mockResolvedValue(undefined);
const mockClosePage = vi.fn().mockResolvedValue(undefined);
const mockShutdown = vi.fn().mockResolvedValue(undefined);
const mockTouchPage = vi.fn();
const mockSetBrowserConfig = vi.fn();
const mockGetBrowserConfig = vi.fn().mockReturnValue({
  headless: false,
  isolated: false,
  autoConnect: false,
});
const mockCanReconfigure = vi.fn().mockReturnValue(true);
const mockResetBrowser = vi.fn().mockResolvedValue(undefined);
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
  isRunning: vi.fn().mockReturnValue(true),
  resolvePageOrCreate: mockResolvePageOrCreate,
  navigateTo: mockNavigateTo,
  touchPage: mockTouchPage,
  closePage: mockClosePage,
  shutdown: mockShutdown,
  listPages: vi.fn().mockReturnValue([]),
  syncPages: vi.fn().mockResolvedValue([]),
  createPage: vi.fn(),
  resolvePage: vi.fn(),
  rebindCdpSession: vi.fn(),
};

// Mock only the modules that are still directly imported by navigation-tools
vi.mock('../../../src/tools/action-stabilization.js', () => ({
  stabilizeAfterNavigation: vi.fn().mockResolvedValue(undefined),
  captureSnapshotFallback: vi.fn(),
}));

vi.mock('../../../src/tools/response-builder.js', () => ({
  buildClosePageResponse: vi.fn().mockReturnValue({ success: true }),
  buildFindElementsResponse: vi.fn(),
  buildGetElementDetailsResponse: vi.fn(),
  buildListPagesResponse: vi.fn(),
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

// Import module under test AFTER mocks are set up
import {
  navigate,
  goBack,
  goForward,
  reload,
  closePage,
} from '../../../src/tools/navigation-tools.js';

describe('Navigation tools dependency tracker cleanup', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Wire mock session manager, page methods, and dependency tracker through ctx
    ctx = createTestToolContext({
      resolvePageOrCreate: mockResolvePageOrCreate as ToolContext['resolvePageOrCreate'],
      touchPage: mockTouchPage as ToolContext['touchPage'],
      closePage: mockClosePage as ToolContext['closePage'],
      navigateTo: mockNavigateTo as ToolContext['navigateTo'],
      getSessionManager: vi
        .fn()
        .mockReturnValue(mockSessionManager) as ToolContext['getSessionManager'],
      getDependencyTracker: vi
        .fn()
        .mockReturnValue(mockTracker) as ToolContext['getDependencyTracker'],
      setBrowserConfig: mockSetBrowserConfig as ToolContext['setBrowserConfig'],
      getBrowserConfig: mockGetBrowserConfig as ToolContext['getBrowserConfig'],
      canReconfigure: mockCanReconfigure as ToolContext['canReconfigure'],
      resetBrowser: mockResetBrowser as ToolContext['resetBrowser'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('navigate()', () => {
    it('should clear dependency tracker for the page before navigation', async () => {
      await navigate({ url: 'https://example.com', page_id: 'test-page' }, ctx);

      expect(ctx.getDependencyTracker).toHaveBeenCalled();
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

      await navigate({ url: 'https://example.com', page_id: 'test-page' }, ctx);

      expect(callOrder).toEqual(['clearPage', 'navigateTo']);
    });

    it('resets the browser when requested mode differs from the running session', async () => {
      mockCanReconfigure.mockReturnValueOnce(false).mockReturnValue(true);
      mockGetBrowserConfig.mockReturnValue({
        headless: false,
        isolated: false,
        autoConnect: false,
      });

      await navigate({ url: 'https://example.com', headless: true, isolated: true }, ctx);

      expect(mockResetBrowser).toHaveBeenCalledTimes(1);
      expect(mockSetBrowserConfig).toHaveBeenCalledWith({
        headless: true,
        isolated: true,
        autoConnect: undefined,
      });
    });

    it('does not reset the browser when requested mode matches the running session', async () => {
      mockCanReconfigure.mockReturnValue(false);
      mockGetBrowserConfig.mockReturnValue({
        headless: true,
        isolated: true,
        autoConnect: false,
      });
      mockCanReconfigure
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false);

      await navigate({ url: 'https://example.com', headless: true, isolated: true }, ctx);

      expect(mockResetBrowser).not.toHaveBeenCalled();
      expect(mockSetBrowserConfig).not.toHaveBeenCalled();
    });
  });

  describe('goBack()', () => {
    it('should clear dependency tracker for the page', async () => {
      await goBack({ page_id: 'test-page' }, ctx);

      expect(ctx.getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('goForward()', () => {
    it('should clear dependency tracker for the page', async () => {
      await goForward({ page_id: 'test-page' }, ctx);

      expect(ctx.getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('reload()', () => {
    it('should clear dependency tracker for the page', async () => {
      await reload({ page_id: 'test-page' }, ctx);

      expect(ctx.getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });

  describe('closePage()', () => {
    it('should clear dependency tracker for the closed page', async () => {
      await closePage({ page_id: 'test-page' }, ctx);

      expect(ctx.getDependencyTracker).toHaveBeenCalled();
      expect(mockClearPage).toHaveBeenCalledWith('test-page');
    });
  });
});
