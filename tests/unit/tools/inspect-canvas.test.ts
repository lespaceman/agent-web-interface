/**
 * inspect_canvas Tool Handler Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionManager } from '../../../src/browser/session-manager.js';

// ============================================================================
// Hoisted mocks (accessible inside vi.mock factories)
// ============================================================================

const { mockResolvePage, mockTouchPage } = vi.hoisted(() => ({
  mockResolvePage: vi.fn(),
  mockTouchPage: vi.fn(),
}));

const mockSessionManager = {
  resolvePage: mockResolvePage,
  touchPage: mockTouchPage,
} as unknown as SessionManager;

const { mockGetElementBoundingBox, mockCaptureScreenshot } = vi.hoisted(() => ({
  mockGetElementBoundingBox: vi.fn(),
  mockCaptureScreenshot: vi.fn(),
}));

const { mockGetStateManager } = vi.hoisted(() => ({
  mockGetStateManager: vi.fn(),
}));

const { mockGetByPageId } = vi.hoisted(() => ({
  mockGetByPageId: vi.fn(),
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
    getByPageId = mockGetByPageId;
    removeByPageId = vi.fn();
    clear = vi.fn();
  };
  return {
    SnapshotStore,
    clickByBackendNodeId: vi.fn(),
    clickAtCoordinates: vi.fn(),
    clickAtElementOffset: vi.fn(),
    getElementTopLeft: vi.fn(),
    dragBetweenCoordinates: vi.fn(),
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
  createHealthyRuntime: vi.fn(() => ({ cdp: { ok: true }, snapshot: { ok: true, code: 'HEALTHY' } })),
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

vi.mock('../../../src/tools/response-builder.js', () => ({
  buildClosePageResponse: vi.fn(),
  buildCloseSessionResponse: vi.fn(),
  buildListPagesResponse: vi.fn(),
  buildFindElementsResponse: vi.fn(),
  buildGetElementDetailsResponse: vi.fn(),
}));

import { initializeToolContext } from '../../../src/tools/tool-context.js';
import { inspectCanvas } from '../../../src/tools/canvas-tools.js';
import { isCompositeResult } from '../../../src/tools/tool-result.types.js';

// ============================================================================
// Tests
// ============================================================================

describe('inspectCanvas', () => {
  const mockCdp = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    isActive: vi.fn().mockReturnValue(true),
  };

  const mockRegistry = {
    getByEid: vi.fn(),
    getEidBySnapshotAndBackendNodeId: vi.fn(),
    isStale: vi.fn().mockReturnValue(false),
  };

  const mockSnapshot = {
    snapshot_id: 'snap-1',
    nodes: [
      {
        backend_node_id: 100,
        kind: 'canvas',
        label: 'game-canvas',
        where: { region: 'main' },
        layout: { bbox: { x: 0, y: 0, w: 800, h: 600 } },
      },
    ],
  };

  /** Set up default CDP mock that handles all expected methods for inspectCanvas. */
  function setupDefaultCdpMock(): void {
    mockCdp.send.mockImplementation((method: string) => {
      if (method === 'Page.getFrameTree') return Promise.resolve({});
      if (method === 'DOM.scrollIntoViewIfNeeded') return Promise.resolve({});
      if (method === 'DOM.resolveNode')
        return Promise.resolve({ object: { objectId: 'obj-1' } });
      if (method === 'Runtime.callFunctionOn')
        return Promise.resolve({
          result: {
            value: {
              library: 'none',
              objects: [],
              canvas_size: { w: 800, h: 600 },
            },
          },
        });
      if (method === 'Runtime.evaluate') return Promise.resolve({});
      if (method === 'Runtime.releaseObject') return Promise.resolve({});
      return Promise.resolve({});
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    initializeToolContext(mockSessionManager);

    mockResolvePage.mockReturnValue({
      page_id: 'page-1',
      page: {},
      cdp: mockCdp,
      created_at: new Date(),
    });

    // CDP probe succeeds
    mockCdp.send.mockResolvedValue({});

    // Snapshot store returns snapshot
    mockGetByPageId.mockReturnValue(mockSnapshot);

    // Element registry returns ref
    mockRegistry.getByEid.mockReturnValue({
      ref: { backend_node_id: 100, snapshot_id: 'snap-1' },
    });
    mockGetStateManager.mockReturnValue({
      getElementRegistry: () => mockRegistry,
      getActiveLayer: () => 'main',
    });

    // Element bounding box
    mockGetElementBoundingBox.mockResolvedValue({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      scale: 1,
    });

    // Screenshot result
    mockCaptureScreenshot.mockResolvedValue({
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      sizeBytes: 1000,
    });
  });

  it('throws when eid is missing', async () => {
    await expect(inspectCanvas({})).rejects.toThrow();
  });

  it('returns CompositeResult with type composite', async () => {
    setupDefaultCdpMock();

    const result = await inspectCanvas({ eid: 'cv-1' });

    expect(result.type).toBe('composite');
    expect(typeof result.text).toBe('string');
    expect(result.image).toBeDefined();
    expect(result.image.type).toBe('image');
  });

  it('uses Runtime.callFunctionOn for detection (not Runtime.evaluate)', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1' });

    const callFunctionOnCalls = mockCdp.send.mock.calls.filter(
      (c: string[]) => c[0] === 'Runtime.callFunctionOn'
    );
    expect(callFunctionOnCalls.length).toBe(2); // detect + overlay
    expect(callFunctionOnCalls[0][1]).toMatchObject({ objectId: 'obj-1' });
    expect(callFunctionOnCalls[1][1]).toMatchObject({ objectId: 'obj-1' });
  });

  it('removes overlay after screenshot (cleanup)', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1' });

    const evalCalls = mockCdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Runtime.evaluate'
    );
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
    expect((evalCalls[0][1] as { expression: string }).expression).toContain('__inspect_canvas_overlay__');
  });

  it('uses canvas bounding box as screenshot clip', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1' });

    expect(mockCaptureScreenshot).toHaveBeenCalledWith(
      mockCdp,
      expect.objectContaining({
        clip: { x: 10, y: 20, width: 800, height: 600, scale: 1 },
      })
    );
  });

  it('forwards grid_spacing to overlay script', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1', grid_spacing: 100 });

    const overlayCalls = mockCdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Runtime.callFunctionOn'
    );
    const overlayCall = overlayCalls[1]; // second call is the overlay
    expect((overlayCall[1] as { arguments: { value: unknown }[] }).arguments[0].value).toBe(100);
  });

  it('cleans up overlay even if screenshot fails', async () => {
    setupDefaultCdpMock();
    mockCaptureScreenshot.mockRejectedValueOnce(new Error('Screenshot failed'));

    await expect(inspectCanvas({ eid: 'cv-1' })).rejects.toThrow('Screenshot failed');

    const evalCalls = mockCdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Runtime.evaluate'
    );
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
    expect((evalCalls[0][1] as { expression: string }).expression).toContain('__inspect_canvas_overlay__');
  });

  it('releases CDP object reference in cleanup', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1' });

    const releaseCalls = mockCdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'Runtime.releaseObject'
    );
    expect(releaseCalls.length).toBe(1);
    expect((releaseCalls[0][1] as { objectId: string }).objectId).toBe('obj-1');
  });

  it('scrolls canvas into view before screenshot', async () => {
    setupDefaultCdpMock();

    await inspectCanvas({ eid: 'cv-1' });

    const scrollCalls = mockCdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'DOM.scrollIntoViewIfNeeded'
    );
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('isCompositeResult', () => {
  it('returns true for valid CompositeResult', () => {
    const result = {
      type: 'composite',
      text: '{}',
      image: { type: 'image', data: 'base64', mimeType: 'image/png', sizeBytes: 100 },
    };
    expect(isCompositeResult(result)).toBe(true);
  });

  it('returns false for ImageResult', () => {
    const result = { type: 'image', data: 'base64', mimeType: 'image/png', sizeBytes: 100 };
    expect(isCompositeResult(result)).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isCompositeResult(null)).toBe(false);
    expect(isCompositeResult(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isCompositeResult('composite')).toBe(false);
  });
});
