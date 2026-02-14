/**
 * Tests for NetworkWatcher - request accumulation and lifecycle.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Page } from 'puppeteer-core';
import {
  NetworkWatcher,
  getOrCreateWatcher,
  getWatcher,
  removeWatcher,
} from '../../../src/network/network-watcher.js';

// --- Mock helpers ---

interface MockNetworkRequest {
  method: Mock;
  url: Mock;
  resourceType: Mock;
  headers: Mock;
  postData: Mock;
  response: Mock;
  failure: Mock;
}

interface MockResponse {
  status: Mock;
  statusText: Mock;
  headers: Mock;
  text: Mock;
}

function createMockResponse(
  options: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): MockResponse {
  return {
    status: vi.fn().mockReturnValue(options.status ?? 200),
    statusText: vi.fn().mockReturnValue(options.statusText ?? 'OK'),
    headers: vi.fn().mockReturnValue(options.headers ?? { 'content-type': 'application/json' }),
    text: vi.fn().mockResolvedValue(options.body ?? '{}'),
  };
}

function createMockNetworkRequest(
  options: {
    method?: string;
    url?: string;
    resourceType?: string;
    headers?: Record<string, string>;
    postData?: string | null;
    response?: MockResponse | null;
    failure?: { errorText: string } | null;
  } = {}
): MockNetworkRequest {
  return {
    method: vi.fn().mockReturnValue(options.method ?? 'GET'),
    url: vi.fn().mockReturnValue(options.url ?? 'https://api.example.com/data'),
    resourceType: vi.fn().mockReturnValue(options.resourceType ?? 'xhr'),
    headers: vi.fn().mockReturnValue(options.headers ?? {}),
    postData: vi.fn().mockReturnValue(options.postData ?? null),
    response: vi.fn().mockReturnValue(options.response ?? null),
    failure: vi.fn().mockReturnValue(options.failure ?? null),
  };
}

/**
 * Mock page with event emission support.
 */
interface MockNetworkPage {
  on: Mock;
  off: Mock;
  emit: (event: string, data: unknown) => void;
}

function createMockNetworkPage(): MockNetworkPage {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();

  return {
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (arg: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: (event: string, data: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
  };
}

/** Cast mock page to Page for API calls */
function asPage(mock: MockNetworkPage): Page {
  return mock as unknown as Page;
}

// --- Tests ---

describe('NetworkWatcher', () => {
  let watcher: NetworkWatcher;
  let mockPage: MockNetworkPage;

  beforeEach(() => {
    vi.clearAllMocks();
    watcher = new NetworkWatcher();
    mockPage = createMockNetworkPage();
  });

  describe('attach/detach lifecycle', () => {
    it('should attach event listeners on attach', () => {
      watcher.attach(asPage(mockPage));

      expect(mockPage.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should report isActive after attach', () => {
      expect(watcher.isActive()).toBe(false);
      watcher.attach(asPage(mockPage));
      expect(watcher.isActive()).toBe(true);
    });

    it('should detach event listeners on detach', () => {
      watcher.attach(asPage(mockPage));
      watcher.detach();

      expect(mockPage.off).toHaveBeenCalledWith('request', expect.any(Function));
      expect(mockPage.off).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(mockPage.off).toHaveBeenCalledWith('requestfailed', expect.any(Function));
      expect(watcher.isActive()).toBe(false);
    });

    it('should detach previous listeners when re-attaching', () => {
      watcher.attach(asPage(mockPage));
      watcher.attach(asPage(mockPage));

      // off should have been called for the first attach's handlers
      expect(mockPage.off).toHaveBeenCalledTimes(3);
    });

    it('should clear accumulated entries on re-attach', () => {
      const page = asPage(mockPage);
      watcher.attach(page);

      const req = createMockNetworkRequest();
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      // Re-attach clears buffer
      watcher.attach(page);
      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(0);
    });
  });

  describe('resource type filtering', () => {
    it('should default to xhr only', () => {
      watcher.attach(asPage(mockPage));
      expect(watcher.getResourceTypes()).toEqual(['xhr']);
    });

    it('should capture xhr requests by default', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({ resourceType: 'xhr' });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].resourceType).toBe('xhr');
    });

    it('should ignore non-matching resource types', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({ resourceType: 'image' });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(0);
    });

    it('should respect custom resource types', () => {
      watcher.attach(asPage(mockPage), ['fetch', 'document']);

      const fetchReq = createMockNetworkRequest({ resourceType: 'fetch', url: 'https://a.com/1' });
      const docReq = createMockNetworkRequest({ resourceType: 'document', url: 'https://a.com/2' });
      const xhrReq = createMockNetworkRequest({ resourceType: 'xhr', url: 'https://a.com/3' });

      mockPage.emit('request', fetchReq);
      mockPage.emit('requestfinished', fetchReq);
      mockPage.emit('request', docReq);
      mockPage.emit('requestfinished', docReq);
      mockPage.emit('request', xhrReq);
      mockPage.emit('requestfinished', xhrReq);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(2);
      expect(entries[0].resourceType).toBe('fetch');
      expect(entries[1].resourceType).toBe('document');
    });
  });

  describe('request accumulation', () => {
    it('should capture request metadata', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({
        method: 'POST',
        url: 'https://api.example.com/submit',
        resourceType: 'xhr',
        headers: { 'content-type': 'application/json' },
        postData: '{"key":"value"}',
      });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].method).toBe('POST');
      expect(entries[0].url).toBe('https://api.example.com/submit');
      expect(entries[0].requestBody).toBe('{"key":"value"}');
    });

    it('should assign incrementing sequence numbers', () => {
      watcher.attach(asPage(mockPage));

      const req1 = createMockNetworkRequest({ url: 'https://a.com/1' });
      const req2 = createMockNetworkRequest({ url: 'https://a.com/2' });

      mockPage.emit('request', req1);
      mockPage.emit('requestfinished', req1);
      mockPage.emit('request', req2);
      mockPage.emit('requestfinished', req2);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(2);
      expect(entries[0].seq).toBe(1);
      expect(entries[1].seq).toBe(2);
    });

    it('should capture response status on requestfinished', () => {
      watcher.attach(asPage(mockPage));

      const mockResp = createMockResponse({ status: 201, statusText: 'Created' });
      const req = createMockNetworkRequest({ response: mockResp });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe(201);
      expect(entries[0].statusText).toBe('Created');
      expect(entries[0].state).toBe('completed');
    });

    it('should capture failure reason on requestfailed', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({
        failure: { errorText: 'net::ERR_CONNECTION_REFUSED' },
      });
      mockPage.emit('request', req);
      mockPage.emit('requestfailed', req);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].failureReason).toBe('net::ERR_CONNECTION_REFUSED');
      expect(entries[0].state).toBe('failed');
    });

    it('should include pending requests in getAndClear', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest();
      mockPage.emit('request', req);
      // Don't emit requestfinished

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].state).toBe('pending');
    });
  });

  describe('getAndClear semantics', () => {
    it('should clear buffer after retrieval', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest();
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const first = watcher.getAndClear();
      expect(first).toHaveLength(1);

      const second = watcher.getAndClear();
      expect(second).toHaveLength(0);
    });

    it('should return empty array when no requests captured', () => {
      watcher.attach(asPage(mockPage));
      const entries = watcher.getAndClear();
      expect(entries).toEqual([]);
    });
  });

  describe('sensitive header masking', () => {
    it('should mask Authorization header', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({
        headers: {
          Authorization: 'Bearer secret-token-123',
          'Content-Type': 'application/json',
        },
      });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      // eslint-disable-next-line @typescript-eslint/dot-notation
      expect(entries[0].requestHeaders?.['Authorization']).toBe('***');
      expect(entries[0].requestHeaders?.['Content-Type']).toBe('application/json');
    });

    it('should mask Cookie header', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest({
        headers: { Cookie: 'session=abc123' },
      });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      // eslint-disable-next-line @typescript-eslint/dot-notation
      expect(entries[0].requestHeaders?.['Cookie']).toBe('***');
    });

    it('should mask response Set-Cookie header', () => {
      watcher.attach(asPage(mockPage));

      const mockResp = createMockResponse({
        headers: { 'set-cookie': 'session=xyz; HttpOnly' },
      });
      const req = createMockNetworkRequest({ response: mockResp });
      mockPage.emit('request', req);
      mockPage.emit('requestfinished', req);

      const entries = watcher.getAndClear();
      expect(entries[0].responseHeaders?.['set-cookie']).toBe('***');
    });
  });

  describe('navigation handling', () => {
    it('should keep watching after markNavigation', () => {
      watcher.attach(asPage(mockPage));
      watcher.markNavigation();

      expect(watcher.isActive()).toBe(true);
    });

    it('should drop pending requests on markNavigation', () => {
      watcher.attach(asPage(mockPage));

      const req = createMockNetworkRequest();
      mockPage.emit('request', req);
      // Request is pending

      watcher.markNavigation();

      // New request after navigation
      const req2 = createMockNetworkRequest({ url: 'https://new.com/api' });
      mockPage.emit('request', req2);
      mockPage.emit('requestfinished', req2);

      const entries = watcher.getAndClear();
      // Only the post-navigation request should be captured
      expect(entries).toHaveLength(1);
      expect(entries[0].url).toBe('https://new.com/api');
    });

    it('should ignore late events from previous generation', () => {
      watcher.attach(asPage(mockPage));

      const oldReq = createMockNetworkRequest({ url: 'https://old.com/api' });
      mockPage.emit('request', oldReq);

      // Navigate - bumps generation
      watcher.markNavigation();

      // Old request won't match since markNavigation re-creates handlers
      const newReq = createMockNetworkRequest({ url: 'https://new.com/api' });
      mockPage.emit('request', newReq);
      mockPage.emit('requestfinished', newReq);

      const entries = watcher.getAndClear();
      expect(entries).toHaveLength(1);
      expect(entries[0].url).toBe('https://new.com/api');
    });
  });
});

describe('NetworkWatcher Registry', () => {
  it('should create a watcher via getOrCreateWatcher', () => {
    const mock = createMockNetworkPage();
    const watcher = getOrCreateWatcher(asPage(mock));
    expect(watcher).toBeInstanceOf(NetworkWatcher);
  });

  it('should return the same watcher for the same page', () => {
    const mock = createMockNetworkPage();
    const page = asPage(mock);
    const w1 = getOrCreateWatcher(page);
    const w2 = getOrCreateWatcher(page);
    expect(w1).toBe(w2);
  });

  it('should return undefined from getWatcher for unknown page', () => {
    const mock = createMockNetworkPage();
    expect(getWatcher(asPage(mock))).toBeUndefined();
  });

  it('should return watcher from getWatcher after creation', () => {
    const mock = createMockNetworkPage();
    const page = asPage(mock);
    const created = getOrCreateWatcher(page);
    expect(getWatcher(page)).toBe(created);
  });

  it('should detach and remove watcher via removeWatcher', () => {
    const mock = createMockNetworkPage();
    const page = asPage(mock);
    const watcher = getOrCreateWatcher(page);
    watcher.attach(page);

    removeWatcher(page);
    expect(watcher.isActive()).toBe(false);
    expect(getWatcher(page)).toBeUndefined();
  });
});
