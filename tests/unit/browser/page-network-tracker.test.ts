/**
 * PageNetworkTracker Unit Tests
 *
 * Tests for request tracking and network idle detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PageNetworkTracker,
  getOrCreateTracker,
  removeTracker,
  hasTracker,
} from '../../../src/browser/page-network-tracker.js';
import type { Page } from 'playwright';
import {
  createMockPageWithEvents,
  createMockRequest,
  type MockPageWithEvents,
} from '../../mocks/playwright.mock.js';

describe('PageNetworkTracker', () => {
  let page: MockPageWithEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    page = createMockPageWithEvents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('attach()', () => {
    it('should add event listeners to the page', () => {
      const tracker = new PageNetworkTracker();

      tracker.attach(page as unknown as Page);

      expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should set isAttached to true', () => {
      const tracker = new PageNetworkTracker();

      expect(tracker.isAttached()).toBe(false);
      tracker.attach(page as unknown as Page);
      expect(tracker.isAttached()).toBe(true);
    });

    it('should detach from previous page when attaching to a new one', () => {
      const page1 = createMockPageWithEvents();
      const page2 = createMockPageWithEvents();
      const tracker = new PageNetworkTracker();

      tracker.attach(page1 as unknown as Page);
      tracker.attach(page2 as unknown as Page);

      expect(page1.off).toHaveBeenCalled();
      expect(page2.on).toHaveBeenCalledWith('request', expect.any(Function));
    });
  });

  describe('detach()', () => {
    it('should remove event listeners from the page', () => {
      const tracker = new PageNetworkTracker();

      tracker.attach(page as unknown as Page);
      tracker.detach();

      expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.off).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(page.off).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should set isAttached to false', () => {
      const tracker = new PageNetworkTracker();

      tracker.attach(page as unknown as Page);
      expect(tracker.isAttached()).toBe(true);

      tracker.detach();
      expect(tracker.isAttached()).toBe(false);
    });
  });

  describe('request tracking', () => {
    it('should increment inflight count on request', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      expect(tracker.getInflightCount()).toBe(0);

      page.emitRequest();
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequest();
      expect(tracker.getInflightCount()).toBe(2);
    });

    it('should decrement inflight count on requestfinished', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const req = page.emitRequest();
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFinished(req);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should decrement inflight count on requestfailed', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const req = page.emitRequest();
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFailed(req);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should not decrement below 0', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      // Finish without starting
      page.emitRequestFinished(createMockRequest());
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should ignore websocket requests', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      page.emitRequest({ resourceType: 'websocket' });
      expect(tracker.getInflightCount()).toBe(0);
    });
  });

  describe('waitForQuiet()', () => {
    it('should resolve true immediately if already idle (with quiet window)', async () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const promise = tracker.waitForQuiet(5000, 500);

      // Advance past quiet window
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toBe(true);
    });

    it('should wait for inflight to reach 0 then quiet window', async () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const req = page.emitRequest();

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
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const promise = tracker.waitForQuiet(5000, 500);

      // Advance 400ms (not yet at quiet window)
      await vi.advanceTimersByTimeAsync(400);

      // New request starts - resets the timer
      const req = page.emitRequest();

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
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      // Start a request that never finishes
      page.emitRequest();

      const promise = tracker.waitForQuiet(1000, 500);

      // Advance to timeout
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe(false);
    });

    it('should handle multiple concurrent waiters', async () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      const req = page.emitRequest();

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
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      page.emitRequest();
      page.emitRequest();
      expect(tracker.getInflightCount()).toBe(2);

      tracker.markNavigation();
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should ignore late events from previous generation', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      // Start a request in old generation
      const oldReq = page.emitRequest();
      expect(tracker.getInflightCount()).toBe(1);

      // Navigate (bumps generation)
      tracker.markNavigation();
      expect(tracker.getInflightCount()).toBe(0);

      // Old request finishes - should NOT decrement below 0
      page.emitRequestFinished(oldReq);
      expect(tracker.getInflightCount()).toBe(0);
    });

    it('should track new requests after navigation', () => {
      const tracker = new PageNetworkTracker();
      tracker.attach(page as unknown as Page);

      // Old request
      page.emitRequest();

      // Navigate
      tracker.markNavigation();

      // New request after navigation
      const newReq = page.emitRequest();
      expect(tracker.getInflightCount()).toBe(1);

      page.emitRequestFinished(newReq);
      expect(tracker.getInflightCount()).toBe(0);
    });
  });
});

describe('Registry functions', () => {
  it('getOrCreateTracker should return same tracker for same page', () => {
    const page = createMockPageWithEvents() as unknown as Page;

    const tracker1 = getOrCreateTracker(page);
    const tracker2 = getOrCreateTracker(page);

    expect(tracker1).toBe(tracker2);
  });

  it('getOrCreateTracker should return different trackers for different pages', () => {
    const page1 = createMockPageWithEvents() as unknown as Page;
    const page2 = createMockPageWithEvents() as unknown as Page;

    const tracker1 = getOrCreateTracker(page1);
    const tracker2 = getOrCreateTracker(page2);

    expect(tracker1).not.toBe(tracker2);
  });

  it('hasTracker should return true if tracker exists', () => {
    const page = createMockPageWithEvents() as unknown as Page;

    expect(hasTracker(page)).toBe(false);

    getOrCreateTracker(page);

    expect(hasTracker(page)).toBe(true);
  });

  it('removeTracker should detach and remove tracker', () => {
    const page = createMockPageWithEvents() as unknown as Page;

    const tracker = getOrCreateTracker(page);
    tracker.attach(page);

    expect(hasTracker(page)).toBe(true);
    expect(tracker.isAttached()).toBe(true);

    removeTracker(page);

    expect(hasTracker(page)).toBe(false);
    expect(tracker.isAttached()).toBe(false);
  });
});
