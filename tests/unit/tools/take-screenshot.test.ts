/**
 * take_screenshot Tool Handler Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Hoisted mocks (accessible inside vi.mock factories)
// ============================================================================

const {
  mockResolvePage,
  mockStoreGetByPageId,
  mockGetStateManager,
  mockCaptureScreenshot,
  mockGetElementBoundingBox,
} = vi.hoisted(() => ({
  mockResolvePage: vi.fn(),
  mockStoreGetByPageId: vi.fn(),
  mockGetStateManager: vi.fn(),
  mockCaptureScreenshot: vi.fn(),
  mockGetElementBoundingBox: vi.fn(),
}));

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('../../../src/browser/session-manager.js', () => ({}));

vi.mock('../../../src/form/index.js', () => ({
  getDependencyTracker: vi.fn(() => ({
    clearPage: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

vi.mock('../../../src/snapshot/index.js', () => {
  const SnapshotStore = class {
    store = vi.fn();
    getByPageId = mockStoreGetByPageId;
    removeByPageId = vi.fn();
    clear = vi.fn();
  };
  return {
    SnapshotStore,
    clickByBackendNodeId: vi.fn(),
    typeByBackendNodeId: vi.fn(),
    pressKey: vi.fn(),
    selectOption: vi.fn(),
    hoverByBackendNodeId: vi.fn(),
    scrollIntoView: vi.fn(),
    scrollPage: vi.fn(),
  };
});

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
  executeActionWithOutcome: vi.fn(),
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
  captureScreenshot: mockCaptureScreenshot,
  getElementBoundingBox: mockGetElementBoundingBox,
}));

vi.mock('../../../src/lib/temp-file.js', () => ({
  cleanupTempFiles: vi.fn().mockResolvedValue(undefined),
}));

import { takeScreenshot } from '../../../src/tools/viewport-tools.js';
import { TakeScreenshotInputSchema } from '../../../src/tools/tool-schemas.js';
import { createTestToolContext } from '../../helpers/test-tool-context.js';
import type { ToolContext } from '../../../src/tools/tool-context.types.js';

// ============================================================================
// Tests
// ============================================================================

describe('TakeScreenshotInput schema', () => {
  it('should default fullPage to false when omitted', () => {
    const result = TakeScreenshotInputSchema.parse({});
    expect(result).toHaveProperty('fullPage', false);
  });

  it('should default format to png when omitted', () => {
    const result = TakeScreenshotInputSchema.parse({});
    expect(result.format).toBe('png');
  });

  it('should preserve explicit values', () => {
    const result = TakeScreenshotInputSchema.parse({ fullPage: true, format: 'jpeg' });
    expect(result.fullPage).toBe(true);
    expect(result.format).toBe('jpeg');
  });
});

describe('takeScreenshot', () => {
  const mockCdp = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    isActive: vi.fn().mockReturnValue(true),
  };

  let ctx: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePage.mockReturnValue({
      page_id: 'page-1',
      page: {},
      cdp: mockCdp,
      created_at: new Date(),
    });
    ctx = createTestToolContext({
      resolvePage: mockResolvePage as ToolContext['resolvePage'],
      resolveExistingPage: vi.fn().mockImplementation((pageId?: string) => {
        const result = mockResolvePage(pageId) as ReturnType<
          ToolContext['resolveExistingPage']
        > | null;
        if (!result) throw new Error('Page not found');
        return result;
      }) as ToolContext['resolveExistingPage'],
      ensureCdpSession: vi.fn().mockResolvedValue({
        handle: { page_id: 'page-1', page: {}, cdp: mockCdp, created_at: new Date() },
        recovered: false,
        runtime_health: {},
      }) as ToolContext['ensureCdpSession'],
      getStateManager: mockGetStateManager as ToolContext['getStateManager'],
      getSnapshotStore: vi
        .fn()
        .mockReturnValue({ getByPageId: mockStoreGetByPageId }) as ToolContext['getSnapshotStore'],
      requireSnapshot: vi.fn().mockImplementation((pageId: string) => {
        const snap = mockStoreGetByPageId(pageId) as ReturnType<
          ToolContext['requireSnapshot']
        > | null;
        if (!snap) throw new Error('No snapshot available');
        return snap;
      }) as ToolContext['requireSnapshot'],
      resolveElementByEid: vi.fn().mockReturnValue({
        backend_node_id: 42,
        kind: 'button',
        label: 'Submit',
      }) as unknown as ToolContext['resolveElementByEid'],
    });
  });

  it('should capture viewport screenshot with default options', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    const result = await takeScreenshot({}, ctx);

    expect(result.type).toBe('image');
    expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockCdp, {
      format: 'png',
      quality: undefined,
      clip: undefined,
      captureBeyondViewport: false,
    });
  });

  it('should capture full page screenshot', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    await takeScreenshot({ fullPage: true }, ctx);

    expect(mockCaptureScreenshot).toHaveBeenCalledWith(
      mockCdp,
      expect.objectContaining({ captureBeyondViewport: true })
    );
  });

  it('should capture JPEG with quality', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/jpeg',
      sizeBytes: 512,
    });

    await takeScreenshot({ format: 'jpeg', quality: 60 }, ctx);

    expect(mockCaptureScreenshot).toHaveBeenCalledWith(
      mockCdp,
      expect.objectContaining({ format: 'jpeg', quality: 60 })
    );
  });

  it('should capture element screenshot when eid is provided', async () => {
    const mockNode = { backend_node_id: 42, kind: 'button', label: 'Submit' };
    const mockSnapshot = { snapshot_id: 'snap-1', nodes: [mockNode] };
    mockStoreGetByPageId.mockReturnValue(mockSnapshot);

    const mockRegistry = {
      getByEid: vi.fn().mockReturnValue({ ref: { backend_node_id: 42 } }),
      isStale: vi.fn().mockReturnValue(false),
    };
    mockGetStateManager.mockReturnValue({
      getElementRegistry: () => mockRegistry,
    });

    const clip = { x: 10, y: 20, width: 100, height: 50, scale: 1 };
    mockGetElementBoundingBox.mockResolvedValue(clip);

    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      sizeBytes: 512,
    });

    await takeScreenshot({ eid: 'btn-submit' }, ctx);

    expect(mockGetElementBoundingBox).toHaveBeenCalledWith(mockCdp, 42);
    expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockCdp, expect.objectContaining({ clip }));
  });

  it('should reject when both eid and fullPage are provided', async () => {
    await expect(takeScreenshot({ eid: 'btn-1', fullPage: true }, ctx)).rejects.toThrow(
      "Cannot use both 'eid' and 'fullPage'"
    );
  });

  it('should return FileResult for large screenshots', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'file',
      path: '/tmp/screenshot-abc123.png',
      mimeType: 'image/png',
      sizeBytes: 3 * 1024 * 1024,
    });

    const result = await takeScreenshot({}, ctx);

    expect(result.type).toBe('file');
    if (result.type === 'file') {
      expect(result.path).toContain('screenshot-');
    }
  });

  it('should throw when page not found', async () => {
    mockResolvePage.mockReturnValue(null);

    await expect(takeScreenshot({ page_id: 'nonexistent' }, ctx)).rejects.toThrow('Page not found');
  });

  it('should throw when eid provided but no snapshot exists', async () => {
    mockStoreGetByPageId.mockReturnValue(null);

    await expect(takeScreenshot({ eid: 'btn-1' }, ctx)).rejects.toThrow();
  });

  it('should resolve page_id correctly', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'abc',
      mimeType: 'image/png',
      sizeBytes: 3,
    });

    await takeScreenshot({ page_id: 'page-1' }, ctx);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ctx.resolveExistingPage).toHaveBeenCalledWith('page-1');
  });
});
