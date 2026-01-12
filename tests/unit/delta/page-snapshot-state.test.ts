/**
 * PageSnapshotState Tests
 *
 * Tests for overlay transitions and state machine behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageSnapshotState } from '../../../src/delta/page-snapshot-state.js';
import type { FrameTracker } from '../../../src/delta/frame-tracker.js';
import type { SnapshotVersionManager } from '../../../src/delta/snapshot-version-manager.js';
import type { BaseSnapshot, ReadableNode } from '../../../src/snapshot/snapshot.types.js';
import type { VersionedSnapshot, FrameState, ScopedElementRef } from '../../../src/delta/types.js';

describe('PageSnapshotState', () => {
  let pageSnapshotState: PageSnapshotState;
  let mockFrameTracker: {
    ensureInitialized: ReturnType<typeof vi.fn>;
    drainInvalidations: ReturnType<typeof vi.fn>;
    pruneRefs: ReturnType<typeof vi.fn>;
    clearAllRefs: ReturnType<typeof vi.fn>;
    mainFrame: FrameState;
    mainFrameIdValue: string;
    serializeRef: ReturnType<typeof vi.fn>;
    createRef: ReturnType<typeof vi.fn>;
  };
  let mockVersionManager: {
    version: number;
    currentSnapshot: VersionedSnapshot | null;
    validateAgentState: ReturnType<typeof vi.fn>;
    forceCapture: ReturnType<typeof vi.fn>;
    captureIfChanged: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };

  const MAIN_FRAME_ID = 'main-frame';
  const MAIN_LOADER_ID = 'loader-1';

  function createMockNode(overrides: Partial<ReadableNode> = {}): ReadableNode {
    return {
      node_id: overrides.node_id ?? 'node-1',
      backend_node_id: overrides.backend_node_id ?? 1,
      frame_id: overrides.frame_id ?? MAIN_FRAME_ID,
      loader_id: overrides.loader_id ?? MAIN_LOADER_ID,
      kind: overrides.kind ?? 'button',
      label: overrides.label ?? 'Button',
      where: overrides.where ?? { region: 'main' },
      layout: overrides.layout ?? { bbox: { x: 0, y: 0, w: 100, h: 30 } },
      state: overrides.state,
      find: overrides.find,
      attributes: overrides.attributes,
    };
  }

  function createMockSnapshot(nodes: ReadableNode[] = []): BaseSnapshot {
    return {
      snapshot_id: 'snap-1',
      url: 'https://example.com',
      title: 'Test Page',
      captured_at: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      nodes,
      meta: {
        node_count: nodes.length,
        interactive_count: nodes.length,
      },
    };
  }

  function createVersionedSnapshot(version: number, snapshot: BaseSnapshot): VersionedSnapshot {
    return {
      version,
      snapshot,
      hash: `hash-${version}`,
      timestamp: Date.now(),
    };
  }

  function createMockFrameTracker() {
    const mainFrame: FrameState = {
      frameId: MAIN_FRAME_ID,
      loaderId: MAIN_LOADER_ID,
      url: 'https://example.com',
      isMainFrame: true,
    };

    return {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      drainInvalidations: vi.fn().mockReturnValue([]),
      pruneRefs: vi.fn(),
      clearAllRefs: vi.fn(),
      mainFrame,
      mainFrameIdValue: MAIN_FRAME_ID,
      serializeRef: vi
        .fn()
        .mockImplementation(
          (ref: ScopedElementRef) => `${ref.loader_id}:${ref.backend_node_id}`
        ),
      createRef: vi.fn().mockImplementation((backendNodeId: number, frameId: string) => ({
        backend_node_id: backendNodeId,
        frame_id: frameId,
        loader_id: MAIN_LOADER_ID,
      })),
    };
  }

  function createMockVersionManager() {
    let currentVersion = 0;
    let currentSnapshot: VersionedSnapshot | null = null;

    return {
      get version() {
        return currentVersion;
      },
      get currentSnapshot() {
        return currentSnapshot;
      },
      validateAgentState: vi.fn(),
      forceCapture: vi.fn().mockImplementation(() => {
        currentVersion++;
        const snapshot = createMockSnapshot([createMockNode()]);
        currentSnapshot = createVersionedSnapshot(currentVersion, snapshot);
        return Promise.resolve(currentSnapshot);
      }),
      captureIfChanged: vi.fn().mockImplementation(() => {
        currentVersion++;
        const snapshot = createMockSnapshot([createMockNode()]);
        currentSnapshot = createVersionedSnapshot(currentVersion, snapshot);
        return Promise.resolve({ versioned: currentSnapshot, isNew: true });
      }),
      reset: vi.fn(),
    };
  }

  beforeEach(() => {
    mockFrameTracker = createMockFrameTracker();
    mockVersionManager = createMockVersionManager();
    pageSnapshotState = new PageSnapshotState(
      mockFrameTracker as unknown as FrameTracker,
      mockVersionManager as unknown as SnapshotVersionManager
    );
  });

  describe('initialization', () => {
    it('should start in uninitialized mode', () => {
      expect(pageSnapshotState.isInOverlayMode).toBe(false);
    });

    it('should initialize to base mode on first computeResponse', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('full');
      expect(mockVersionManager.forceCapture).toHaveBeenCalled();
    });
  });

  describe('overlay transitions', () => {
    beforeEach(async () => {
      // Initialize state
      const mockPage = {} as never;
      const mockCdp = {} as never;
      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');
    });

    it('should detect overlay opened (base -> overlay)', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      // Create snapshot with dialog node (triggers overlay detection)
      const dialogNode = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const baseNode = createMockNode({
        node_id: 'button-1',
        backend_node_id: 1,
      });

      const snapshotWithOverlay = createMockSnapshot([baseNode, dialogNode]);
      const versioned = createVersionedSnapshot(2, snapshotWithOverlay);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('overlay_opened');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);
    });

    it('should detect overlay closed (overlay -> base)', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      // First open an overlay
      const dialogNode = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const baseNode = createMockNode({
        node_id: 'button-1',
        backend_node_id: 1,
      });

      const snapshotWithOverlay = createMockSnapshot([baseNode, dialogNode]);
      const versionedOpen = createVersionedSnapshot(2, snapshotWithOverlay);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedOpen,
        isNew: true,
      });

      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);

      // Now close the overlay
      const snapshotWithoutOverlay = createMockSnapshot([baseNode]);
      const versionedClose = createVersionedSnapshot(3, snapshotWithoutOverlay);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedClose,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('overlay_closed');
      expect(pageSnapshotState.isInOverlayMode).toBe(false);
    });

    it('should detect overlay replaced (overlay -> different overlay)', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const baseNode = createMockNode({
        node_id: 'button-1',
        backend_node_id: 1,
      });

      // First overlay
      const dialogNode1 = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshotWithOverlay1 = createMockSnapshot([baseNode, dialogNode1]);
      const versionedOpen1 = createVersionedSnapshot(2, snapshotWithOverlay1);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedOpen1,
        isNew: true,
      });

      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);

      // Different overlay (same count but different backend_node_id)
      const dialogNode2 = createMockNode({
        node_id: 'dialog-2',
        backend_node_id: 200, // Different backend_node_id
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshotWithOverlay2 = createMockSnapshot([baseNode, dialogNode2]);
      const versionedOpen2 = createVersionedSnapshot(3, snapshotWithOverlay2);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedOpen2,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      // Replacement is reported as overlay_opened (new overlay is now active)
      expect(response.type).toBe('overlay_opened');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);
      // Content should mention both close and open (case-insensitive)
      expect(response.content.toLowerCase()).toContain('closed');
    });

    it('should keep baseline frozen during overlay mode', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const baseNode = createMockNode({
        node_id: 'button-1',
        backend_node_id: 1,
      });

      // Open overlay
      const dialogNode = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshotWithOverlay = createMockSnapshot([baseNode, dialogNode]);
      const versionedOpen = createVersionedSnapshot(2, snapshotWithOverlay);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedOpen,
        isNew: true,
      });

      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      // Try to advance baseline in overlay mode - should return false
      const advanced = pageSnapshotState.advanceBaselineTo(versionedOpen);
      expect(advanced).toBe(false);
    });
  });

  describe('overlay content change', () => {
    it('should compute delta for overlay content changes', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      // Initialize
      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      const baseNode = createMockNode({
        node_id: 'button-1',
        backend_node_id: 1,
      });

      // Open overlay
      const dialogNode = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshotWithOverlay = createMockSnapshot([baseNode, dialogNode]);
      const versionedOpen = createVersionedSnapshot(2, snapshotWithOverlay);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedOpen,
        isNew: true,
      });

      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);

      // Change overlay content (same overlay, different dialog content)
      const dialogNodeChanged = createMockNode({
        node_id: 'dialog-1',
        backend_node_id: 100,
        kind: 'dialog',
        label: 'Changed Label', // Different label
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshotChanged = createMockSnapshot([baseNode, dialogNodeChanged]);
      const versionedChanged = createVersionedSnapshot(3, snapshotChanged);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedChanged,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('delta');
      expect(pageSnapshotState.isInOverlayMode).toBe(true);
    });
  });

  describe('no change detection', () => {
    it('should return no_change when nothing changed', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      // Initialize
      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      const baseNode = createMockNode();
      const snapshot = createMockSnapshot([baseNode]);
      const versioned = createVersionedSnapshot(1, snapshot);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned,
        isNew: false, // No change
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('no_change');
    });
  });

  describe('overlay classification', () => {
    beforeEach(async () => {
      // Initialize state
      const mockPage = {} as never;
      const mockCdp = {} as never;
      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');
    });

    it('should detect ARIA dialog with modal as overlay', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const dialogNode = createMockNode({
        backend_node_id: 100,
        kind: 'generic',
        where: { region: 'dialog' },
        attributes: { role: 'dialog', 'aria-modal': 'true' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshot = createMockSnapshot([dialogNode]);
      const versioned = createVersionedSnapshot(2, snapshot);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('overlay_opened');
    });

    it('should detect node with kind=dialog as overlay', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const dialogNode = createMockNode({
        backend_node_id: 100,
        kind: 'dialog',
        where: { region: 'dialog' },
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshot = createMockSnapshot([dialogNode]);
      const versioned = createVersionedSnapshot(2, snapshot);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('overlay_opened');
    });

    it('should detect high z-index with overlay class pattern as overlay', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      const modalNode = createMockNode({
        backend_node_id: 100,
        kind: 'generic',
        where: { region: 'dialog' },
        attributes: { class: 'modal-container' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 1000 },
      });

      const snapshot = createMockSnapshot([modalNode]);
      const versioned = createVersionedSnapshot(2, snapshot);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      expect(response.type).toBe('overlay_opened');
    });

    it('should not detect low z-index element as overlay even with class pattern', async () => {
      const mockPage = {} as never;
      const mockCdp = {} as never;

      // Include multiple base nodes to keep change ratio low (<40%)
      // Delta reliability requires: (added+removed+modified)/total < 0.4
      // With 4 base nodes + 1 new node: 1/5 = 20% change ratio
      const baseNodes = [
        createMockNode({ backend_node_id: 1, kind: 'button', where: { region: 'main' } }),
        createMockNode({ backend_node_id: 2, kind: 'link', where: { region: 'main' } }),
        createMockNode({ backend_node_id: 3, kind: 'input', where: { region: 'main' } }),
        createMockNode({ backend_node_id: 4, kind: 'button', where: { region: 'main' } }),
      ];

      const lowZNode = createMockNode({
        backend_node_id: 100,
        kind: 'generic',
        where: { region: 'main' },
        attributes: { class: 'modal-like-but-not' } as Record<string, unknown>,
        layout: { bbox: { x: 0, y: 0, w: 400, h: 300 }, zIndex: 10 }, // Low z-index
      });

      // Setup initial base snapshot with 4 nodes
      const baseSnapshot = createMockSnapshot(baseNodes);
      const baseVersioned = createVersionedSnapshot(2, baseSnapshot);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: baseVersioned,
        isNew: true,
      });

      // First get a delta response to establish the base
      await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      // Now add the low z-index node
      const snapshotWithLowZ = createMockSnapshot([...baseNodes, lowZNode]);
      const versionedWithLowZ = createVersionedSnapshot(3, snapshotWithLowZ);

      mockVersionManager.captureIfChanged.mockResolvedValueOnce({
        versioned: versionedWithLowZ,
        isNew: true,
      });

      const response = await pageSnapshotState.computeResponse(mockPage, mockCdp, 'click');

      // Should be a delta change, not overlay
      expect(response.type).toBe('delta');
    });
  });

  describe('ensureInitialized', () => {
    it('should delegate to frame tracker', async () => {
      await pageSnapshotState.ensureInitialized();

      expect(mockFrameTracker.ensureInitialized).toHaveBeenCalled();
    });
  });

  describe('currentVersion', () => {
    it('should return version from version manager', () => {
      expect(pageSnapshotState.currentVersion).toBe(0);
    });
  });
});
