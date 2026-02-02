/**
 * take_screenshot Tool Handler Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionManager } from '../../../src/browser/session-manager.js';

// ============================================================================
// Hoisted mocks (accessible inside vi.mock factories)
// ============================================================================

const {
  mockResolvePage,
  mockTouchPage,
  mockStoreGetByPageId,
  mockGetStateManager,
  mockCaptureScreenshot,
  mockGetElementBoundingBox,
} = vi.hoisted(() => ({
  mockResolvePage: vi.fn(),
  mockTouchPage: vi.fn(),
  mockStoreGetByPageId: vi.fn(),
  mockGetStateManager: vi.fn(),
  mockCaptureScreenshot: vi.fn(),
  mockGetElementBoundingBox: vi.fn(),
}));

const mockSessionManager = {
  resolvePage: mockResolvePage,
  touchPage: mockTouchPage,
} as unknown as SessionManager;

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
  stabilizeAfterNavigation: vi.fn(),
  getStateManager: mockGetStateManager,
  removeStateManager: vi.fn(),
  clearAllStateManagers: vi.fn(),
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

import { initializeTools, takeScreenshot } from '../../../src/tools/browser-tools.js';
import { TakeScreenshotInputSchema } from '../../../src/tools/tool-schemas.js';

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

  beforeEach(() => {
    vi.clearAllMocks();
    initializeTools(mockSessionManager);
    mockResolvePage.mockReturnValue({
      page_id: 'page-1',
      page: {},
      cdp: mockCdp,
      created_at: new Date(),
    });
  });

  it('should capture viewport screenshot with default options', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });

    const result = await takeScreenshot({});

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

    await takeScreenshot({ fullPage: true });

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

    await takeScreenshot({ format: 'jpeg', quality: 60 });

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

    await takeScreenshot({ eid: 'btn-submit' });

    expect(mockGetElementBoundingBox).toHaveBeenCalledWith(mockCdp, 42);
    expect(mockCaptureScreenshot).toHaveBeenCalledWith(mockCdp, expect.objectContaining({ clip }));
  });

  it('should reject when both eid and fullPage are provided', async () => {
    await expect(takeScreenshot({ eid: 'btn-1', fullPage: true })).rejects.toThrow(
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

    const result = await takeScreenshot({});

    expect(result.type).toBe('file');
    if (result.type === 'file') {
      expect(result.path).toContain('screenshot-');
    }
  });

  it('should throw when page not found', async () => {
    mockResolvePage.mockReturnValue(null);

    await expect(takeScreenshot({ page_id: 'nonexistent' })).rejects.toThrow('Page not found');
  });

  it('should throw when eid provided but no snapshot exists', async () => {
    mockStoreGetByPageId.mockReturnValue(null);

    await expect(takeScreenshot({ eid: 'btn-1' })).rejects.toThrow();
  });

  it('should resolve page_id correctly', async () => {
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'abc',
      mimeType: 'image/png',
      sizeBytes: 3,
    });

    await takeScreenshot({ page_id: 'page-1' });

    expect(mockResolvePage).toHaveBeenCalledWith('page-1');
    expect(mockTouchPage).toHaveBeenCalledWith('page-1');
  });
});
