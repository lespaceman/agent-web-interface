/**
 * PageNetworkTracker Unit Tests
 *
 * Tests for request tracking and network idle detection.
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PageNetworkTracker,
  getOrCreateTracker,
  removeTracker,
  hasTracker,
} from '../../../src/browser/page-network-tracker.js';
import type { Page, Request } from 'playwright';

// Mock request factory
function createMockRequest(resourceType = 'fetch', url = 'https://example.com/api'): Request {
  return {
    resourceType: () => resourceType,
    url: () => url,
  } as unknown as Request;
}

// Mock page factory
function createMockPage(): Page & {
  emitRequest: (req: Request) => void;
  emitRequestFinished: (req: Request) => void;
  emitRequestFailed: (req: Request) => void;
} {
  const listeners: Record<string, Set<(arg: unknown) => void>> = {
    request: new Set(),
    requestfinished: new Set(),
    requestfailed: new Set(),
    close: new Set(),
  };

  const page = {
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      listeners[event]?.add(handler);
    }),
    off: vi.fn((event: string, handler: (arg: unknown) => void) => {
      listeners[event]?.delete(handler);
    }),
    // Helper methods for testing
    emitRequest: (req: Request) => {
      listeners.request?.forEach((handler) => handler(req));
    },
    emitRequestFinished: (req: Request) => {
      listeners.requestfinished?.forEach((handler) => handler(req));
    },
    emitRequestFailed: (req: Request) => {
      listeners.requestfailed?.forEach((handler) => handler(req));
    },
  };

  return page as unknown as Page & {
    emitRequest: (req: Request) => void;
    emitRequestFinished: (req: Request) => void;
    emitRequestFailed: (req: Request) => void;
  };
}

describe('PageNetworkTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('attach()', () => {
    it('should add event listeners to the page', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();

      tracker.attach(page);

      expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should set isAttached to true', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();

      expect(tracker.isAttached()).toBe(false);
      tracker.attach(page);
      expect(tracker.isAttached()).toBe(true);
    });

    it('should detach from previous page when attaching to a new one', () => {
      const page1 = createMockPage();
      const page2 = createMockPage();
      const tracker = new PageNetworkTracker();

      tracker.attach(page1);
      tracker.attach(page2);

      expect(page1.off).toHaveBeenCalled();
      expect(page2.on).toHaveBeenCalledWith('request', expect.any(Function));
    });
  });

  describe('detach()', () => {
    it('should remove event listeners from the page', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();

      tracker.attach(page);
      tracker.detach();

      expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.off).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(page.off).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should set isAttached to false', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();

      tracker.attach(page);
      expect(tracker.isAttached()).toBe(true);

      tracker.detach();
      expect(tracker.isAttached()).toBe(false);
    });
  });

  describe('request tracking', () => {
    it('should increment inflight count on request', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      expect(tracker.getInflightCount()).toBe(0);

      page.emitRequest(createMockRequest());
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequest(createMockRequest());
      expect(tracker.getInflightCount()).toBe(2);
    });

    it('should decrement inflight count on requestfinished', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const req = createMockRequest();
      page.emitRequest(req);
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFinished(req);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should decrement inflight count on requestfailed', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const req = createMockRequest();
      page.emitRequest(req);
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFailed(req);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should not decrement below 0', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      // Finish without starting
      page.emitRequestFinished(createMockRequest());
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should ignore websocket requests', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const wsRequest = createMockRequest('websocket');
      page.emitRequest(wsRequest);
      expect(tracker.getInflightCount()).toBe(0);
    });
  });

  describe('waitForQuiet()', () => {
    it('should resolve true immediately if already idle (with quiet window)', async () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const promise = tracker.waitForQuiet(5000, 500);

      // Advance past quiet window
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toBe(true);
    });

    it('should wait for inflight to reach 0 then quiet window', async () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const req = createMockRequest();
      page.emitRequest(req);

      const promise = tracker.waitForQuiet(5000, 500);

      // Still inflight - should not resolve
      await vi.advanceTimersByTimeAsync(100);

      // Finish request
      page.emitRequestFinished(req);

      // Wait for quiet window
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toBe(true);
    });

    it('should reset quiet timer if new request starts', async () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const promise = tracker.waitForQuiet(5000, 500);

      // Advance 400ms (not yet at quiet window)
      await vi.advanceTimersByTimeAsync(400);

      // New request starts - resets the timer
      const req = createMockRequest();
      page.emitRequest(req);

      // Advance another 400ms - would have resolved if timer wasn't reset
      await vi.advanceTimersByTimeAsync(400);

      // Still waiting because request is inflight
      expect(tracker.getInflightCount()).toBe(1);

      // Finish request
      page.emitRequestFinished(req);

      // Wait for quiet window again
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toBe(true);
    });

    it('should resolve false on timeout (never throws)', async () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      // Start a request that never finishes
      page.emitRequest(createMockRequest());

      const promise = tracker.waitForQuiet(1000, 500);

      // Advance to timeout
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(false);
    });

    it('should handle multiple concurrent waiters', async () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      const req = createMockRequest();
      page.emitRequest(req);

      const promise1 = tracker.waitForQuiet(5000, 500);
      const promise2 = tracker.waitForQuiet(5000, 500);

      // Finish request
      page.emitRequestFinished(req);

      // Wait for quiet window
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise1).resolves.toBe(true);
      await expect(promise2).resolves.toBe(true);
    });
  });

  describe('markNavigation()', () => {
    it('should reset inflight count to 0', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      page.emitRequest(createMockRequest());
      page.emitRequest(createMockRequest());
      expect(tracker.getInflightCount()).toBe(2);

      tracker.markNavigation();
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should ignore late events from previous generation', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      // Start a request in old generation
      const oldReq = createMockRequest();
      page.emitRequest(oldReq);
      expect(tracker.getInflightCount()).toBe(1);

      // Navigate (bumps generation)
      tracker.markNavigation();
      expect(tracker.getInflightCount()).toBe(0);

      // Old request finishes - should NOT decrement below 0
      page.emitRequestFinished(oldReq);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should track new requests after navigation', () => {
      const page = createMockPage();
      const tracker = new PageNetworkTracker();
      tracker.attach(page);

      // Old request
      page.emitRequest(createMockRequest());

      // Navigate
      tracker.markNavigation();

      // New request after navigation
      const newReq = createMockRequest();
      page.emitRequest(newReq);
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFinished(newReq);
      expect(tracker.getInflightCount()).toBe(0);
    });
  });
});

describe('Registry functions', () => {
  it('getOrCreateTracker should return same tracker for same page', () => {
    const page = createMockPage() as unknown as Page;

    const tracker1 = getOrCreateTracker(page);
    const tracker2 = getOrCreateTracker(page);

    expect(tracker1).toBe(tracker2);
  });

  it('getOrCreateTracker should return different trackers for different pages', () => {
    const page1 = createMockPage() as unknown as Page;
    const page2 = createMockPage() as unknown as Page;

    const tracker1 = getOrCreateTracker(page1);
    const tracker2 = getOrCreateTracker(page2);

    expect(tracker1).not.toBe(tracker2);
  });

  it('hasTracker should return true if tracker exists', () => {
    const page = createMockPage() as unknown as Page;

    expect(hasTracker(page)).toBe(false);

    getOrCreateTracker(page);

    expect(hasTracker(page)).toBe(true);
  });

  it('removeTracker should detach and remove tracker', () => {
    const page = createMockPage() as unknown as Page;

    const tracker = getOrCreateTracker(page);
    tracker.attach(page);

    expect(hasTracker(page)).toBe(true);
    expect(tracker.isAttached()).toBe(true);

    removeTracker(page);

    expect(hasTracker(page)).toBe(false);
    expect(tracker.isAttached()).toBe(false);
  });
});
