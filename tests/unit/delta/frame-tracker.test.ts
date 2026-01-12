/**
 * FrameTracker Tests
 *
 * Tests for ref lifecycle, navigation handling, and eviction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrameTracker } from '../../../src/delta/frame-tracker.js';
import type { CdpClient } from '../../../src/cdp/cdp-client.interface.js';

describe('FrameTracker', () => {
  let tracker: FrameTracker;
  let mockCdp: {
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
  };
  let eventHandlers: Map<string, (event: unknown) => void>;

  const MAIN_FRAME_ID = 'main-frame-id';
  const MAIN_LOADER_ID = 'loader-1';
  const IFRAME_ID = 'iframe-id';
  const IFRAME_LOADER_ID = 'iframe-loader-1';

  function createMockCdp() {
    eventHandlers = new Map();

    return {
      send: vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.enable') {
          return Promise.resolve(undefined);
        }
        if (method === 'Page.getFrameTree') {
          return Promise.resolve({
            frameTree: {
              frame: {
                id: MAIN_FRAME_ID,
                loaderId: MAIN_LOADER_ID,
                url: 'https://example.com',
              },
              childFrames: [
                {
                  frame: {
                    id: IFRAME_ID,
                    loaderId: IFRAME_LOADER_ID,
                    url: 'https://example.com/iframe',
                    parentId: MAIN_FRAME_ID,
                  },
                },
              ],
            },
          });
        }
        return Promise.resolve(undefined);
      }),
      on: vi.fn().mockImplementation((event: string, handler: (event: unknown) => void) => {
        eventHandlers.set(event, handler);
      }),
      off: vi.fn(),
      once: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(true),
    };
  }

  function triggerFrameNavigated(frameId: string, loaderId: string, parentId?: string): void {
    const handler = eventHandlers.get('Page.frameNavigated');
    if (handler) {
      handler({
        frame: {
          id: frameId,
          loaderId,
          url: 'https://example.com/new',
          parentId,
        },
      });
    }
  }

  function triggerFrameDetached(frameId: string): void {
    const handler = eventHandlers.get('Page.frameDetached');
    if (handler) {
      handler({ frameId });
    }
  }

  beforeEach(() => {
    mockCdp = createMockCdp();
    tracker = new FrameTracker(mockCdp as unknown as CdpClient);
  });

  describe('initialization', () => {
    it('should initialize and populate frame tree', async () => {
      await tracker.initialize();

      expect(tracker.mainFrameIdValue).toBe(MAIN_FRAME_ID);
      expect(tracker.hasFrame(MAIN_FRAME_ID)).toBe(true);
      expect(tracker.hasFrame(IFRAME_ID)).toBe(true);
    });

    it('should be idempotent - multiple initialize calls complete without error', async () => {
      // Call initialize twice concurrently
      const [result1, result2] = await Promise.all([
        tracker.initialize(),
        tracker.initialize(),
      ]);

      // Both should resolve to undefined (void)
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();

      // Calling again after completion should return immediately
      await tracker.initialize();

      // CDP calls should only happen once (Page.enable + Page.getFrameTree)
      expect(mockCdp.send).toHaveBeenCalledTimes(2);
    });

    it('should throw if CDP call fails', async () => {
      const failingCdp = {
        ...mockCdp,
        send: vi.fn().mockRejectedValue(new Error('CDP error')),
      };
      const failingTracker = new FrameTracker(failingCdp as unknown as CdpClient);

      await expect(failingTracker.initialize()).rejects.toThrow('CDP error');
    });
  });

  describe('createRef', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should create ref with correct structure', () => {
      const ref = tracker.createRef(123, MAIN_FRAME_ID);

      expect(ref).toEqual({
        backend_node_id: 123,
        frame_id: MAIN_FRAME_ID,
        loader_id: MAIN_LOADER_ID,
      });
    });

    it('should return null for non-existent frame', () => {
      const ref = tracker.createRef(123, 'non-existent-frame');

      expect(ref).toBeNull();
    });

    it('should warn and return null if called before initialization', () => {
      const uninitializedTracker = new FrameTracker(mockCdp as unknown as CdpClient);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

      const ref = uninitializedTracker.createRef(123, MAIN_FRAME_ID);

      expect(ref).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('FrameTracker.createRef called before initialization');

      warnSpy.mockRestore();
    });

    it('should create refs for iframes with iframe loaderId', () => {
      const ref = tracker.createRef(456, IFRAME_ID);

      expect(ref).toEqual({
        backend_node_id: 456,
        frame_id: IFRAME_ID,
        loader_id: IFRAME_LOADER_ID,
      });
    });
  });

  describe('serializeRef', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should serialize main frame ref as "loaderId:backendNodeId"', () => {
      const ref = tracker.createRef(123, MAIN_FRAME_ID)!;
      const serialized = tracker.serializeRef(ref);

      expect(serialized).toBe(`${MAIN_LOADER_ID}:123`);
    });

    it('should serialize iframe ref as "frameId:loaderId:backendNodeId"', () => {
      const ref = tracker.createRef(456, IFRAME_ID)!;
      const serialized = tracker.serializeRef(ref);

      expect(serialized).toBe(`${IFRAME_ID}:${IFRAME_LOADER_ID}:456`);
    });
  });

  describe('parseRef', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should parse valid main frame ref', () => {
      const serialized = `${MAIN_LOADER_ID}:123`;
      const ref = tracker.parseRef(serialized);

      expect(ref).toEqual({
        backend_node_id: 123,
        frame_id: MAIN_FRAME_ID,
        loader_id: MAIN_LOADER_ID,
      });
    });

    it('should parse valid iframe ref', () => {
      const serialized = `${IFRAME_ID}:${IFRAME_LOADER_ID}:456`;
      const ref = tracker.parseRef(serialized);

      expect(ref).toEqual({
        backend_node_id: 456,
        frame_id: IFRAME_ID,
        loader_id: IFRAME_LOADER_ID,
      });
    });

    it('should return null for invalid format (too few parts)', () => {
      const ref = tracker.parseRef('123');

      expect(ref).toBeNull();
    });

    it('should return null for invalid format (too many parts)', () => {
      const ref = tracker.parseRef('a:b:c:d');

      expect(ref).toBeNull();
    });

    it('should return null for non-existent frame', () => {
      const ref = tracker.parseRef('non-existent:loader:123');

      expect(ref).toBeNull();
    });

    it('should return null for stale ref (main frame loaderId changed)', () => {
      // Navigate main frame to change loaderId
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      // Try to parse ref with old loaderId
      const ref = tracker.parseRef(`${MAIN_LOADER_ID}:123`);

      expect(ref).toBeNull();
    });

    it('should return null for stale ref (iframe loaderId changed)', () => {
      // Navigate iframe to change loaderId
      triggerFrameNavigated(IFRAME_ID, 'iframe-loader-2', MAIN_FRAME_ID);

      // Try to parse ref with old loaderId
      const ref = tracker.parseRef(`${IFRAME_ID}:${IFRAME_LOADER_ID}:456`);

      expect(ref).toBeNull();
    });
  });

  describe('isValid', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should return true for valid ref', () => {
      const ref = tracker.createRef(123, MAIN_FRAME_ID)!;

      expect(tracker.isValid(ref)).toBe(true);
    });

    it('should return false for ref with non-existent frame', () => {
      const ref = {
        backend_node_id: 123,
        frame_id: 'non-existent',
        loader_id: 'loader',
      };

      expect(tracker.isValid(ref)).toBe(false);
    });

    it('should return false for stale ref (loaderId changed)', () => {
      const ref = tracker.createRef(123, MAIN_FRAME_ID)!;

      // Navigate to change loaderId
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      expect(tracker.isValid(ref)).toBe(false);
    });
  });

  describe('frame navigation handling', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should update frame state on navigation', () => {
      const newLoaderId = 'loader-2';
      triggerFrameNavigated(MAIN_FRAME_ID, newLoaderId);

      const frameState = tracker.getFrameState(MAIN_FRAME_ID);
      expect(frameState?.loaderId).toBe(newLoaderId);
    });

    it('should invalidate refs when loaderId changes', () => {
      // Create ref before navigation
      tracker.createRef(123, MAIN_FRAME_ID);

      // Navigate
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      // Check invalidations were collected
      const invalidations = tracker.drainInvalidations();
      expect(invalidations).toHaveLength(1);
      expect(invalidations[0]).toEqual({
        backend_node_id: 123,
        frame_id: MAIN_FRAME_ID,
        loader_id: MAIN_LOADER_ID,
      });
    });

    it('should not invalidate refs if loaderId unchanged (same-document navigation)', () => {
      // Create ref
      tracker.createRef(123, MAIN_FRAME_ID);

      // Navigate with same loaderId (same-document navigation)
      triggerFrameNavigated(MAIN_FRAME_ID, MAIN_LOADER_ID);

      const invalidations = tracker.drainInvalidations();
      expect(invalidations).toHaveLength(0);
    });
  });

  describe('frame detachment handling', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should remove frame state on detachment', () => {
      expect(tracker.hasFrame(IFRAME_ID)).toBe(true);

      triggerFrameDetached(IFRAME_ID);

      expect(tracker.hasFrame(IFRAME_ID)).toBe(false);
    });

    it('should invalidate refs when frame detaches', () => {
      // Create ref in iframe
      tracker.createRef(456, IFRAME_ID);

      // Detach iframe
      triggerFrameDetached(IFRAME_ID);

      const invalidations = tracker.drainInvalidations();
      expect(invalidations).toHaveLength(1);
      expect(invalidations[0]).toEqual({
        backend_node_id: 456,
        frame_id: IFRAME_ID,
        loader_id: IFRAME_LOADER_ID,
      });
    });

    it('should handle detachment of non-existent frame gracefully', () => {
      triggerFrameDetached('non-existent');

      const invalidations = tracker.drainInvalidations();
      expect(invalidations).toHaveLength(0);
    });
  });

  describe('drainInvalidations', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should return and clear pending invalidations', () => {
      tracker.createRef(123, MAIN_FRAME_ID);
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      const first = tracker.drainInvalidations();
      expect(first).toHaveLength(1);

      const second = tracker.drainInvalidations();
      expect(second).toHaveLength(0);
    });
  });

  describe('pruneRefs', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should remove specified refs from tracking', () => {
      const ref1 = tracker.createRef(123, MAIN_FRAME_ID)!;
      // Create ref2 to verify it's still tracked after ref1 is pruned
      tracker.createRef(456, MAIN_FRAME_ID);

      tracker.pruneRefs([ref1]);

      // Navigate to trigger invalidation check
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      const invalidations = tracker.drainInvalidations();
      // Only ref2 (456) should be invalidated, ref1 was pruned
      expect(invalidations).toHaveLength(1);
      expect(invalidations[0].backend_node_id).toBe(456);
    });
  });

  describe('clearAllRefs', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should clear all issued refs and pending invalidations', () => {
      tracker.createRef(123, MAIN_FRAME_ID);
      tracker.createRef(456, MAIN_FRAME_ID);
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      tracker.clearAllRefs();

      const invalidations = tracker.drainInvalidations();
      expect(invalidations).toHaveLength(0);
    });
  });

  describe('eviction', () => {
    beforeEach(async () => {
      await tracker.initialize();
    });

    it('should evict oldest refs when MAX_ISSUED_REFS exceeded', () => {
      // Create many refs to trigger eviction
      // MAX_ISSUED_REFS is 10000, EVICTION_BATCH_SIZE is 1000
      for (let i = 0; i < 10001; i++) {
        tracker.createRef(i, MAIN_FRAME_ID);
      }

      // Navigate to trigger invalidation of remaining refs
      triggerFrameNavigated(MAIN_FRAME_ID, 'loader-2');

      const invalidations = tracker.drainInvalidations();

      // Should have 10001 - 1000 = 9001 refs remaining after eviction
      // But since we created 10001 refs, eviction happened once
      expect(invalidations.length).toBe(9001);

      // Oldest refs (0-999) should have been evicted
      const invalidatedIds = new Set(invalidations.map((r) => r.backend_node_id));
      expect(invalidatedIds.has(0)).toBe(false);
      expect(invalidatedIds.has(999)).toBe(false);
      expect(invalidatedIds.has(1000)).toBe(true);
      expect(invalidatedIds.has(10000)).toBe(true);
    });
  });

  describe('mainFrame accessor', () => {
    it('should return undefined before initialization', () => {
      expect(tracker.mainFrame).toBeUndefined();
    });

    it('should return main frame state after initialization', async () => {
      await tracker.initialize();

      expect(tracker.mainFrame).toEqual({
        frameId: MAIN_FRAME_ID,
        loaderId: MAIN_LOADER_ID,
        url: 'https://example.com',
        isMainFrame: true,
      });
    });
  });
});
