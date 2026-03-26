/**
 * PageNetworkRecorder Unit Tests
 *
 * Tests for network request/response recording and filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PageNetworkRecorder,
  getOrCreateRecorder,
  removeRecorder,
  hasRecorder,
} from '../../../src/browser/page-network-recorder.js';
import type { Page } from 'puppeteer-core';

// --- Extended mock for recorder (needs method, headers, postData, etc.) ---

interface FullMockHTTPRequest {
  url: ReturnType<typeof vi.fn>;
  method: ReturnType<typeof vi.fn>;
  resourceType: ReturnType<typeof vi.fn>;
  isNavigationRequest: ReturnType<typeof vi.fn>;
  headers: ReturnType<typeof vi.fn>;
  postData: ReturnType<typeof vi.fn>;
  response: ReturnType<typeof vi.fn>;
  failure: ReturnType<typeof vi.fn>;
}

function createFullMockRequest(opts: {
  url?: string;
  method?: string;
  resourceType?: string;
  isNavigation?: boolean;
  headers?: Record<string, string>;
  postData?: string | null;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  failureText?: string | null;
} = {}): FullMockHTTPRequest {
  const response = opts.status != null
    ? {
        status: vi.fn().mockReturnValue(opts.status),
        statusText: vi.fn().mockReturnValue(opts.statusText ?? 'OK'),
        headers: vi.fn().mockReturnValue(opts.responseHeaders ?? {}),
      }
    : null;

  return {
    url: vi.fn().mockReturnValue(opts.url ?? 'https://example.com/api'),
    method: vi.fn().mockReturnValue(opts.method ?? 'GET'),
    resourceType: vi.fn().mockReturnValue(opts.resourceType ?? 'fetch'),
    isNavigationRequest: vi.fn().mockReturnValue(opts.isNavigation ?? false),
    headers: vi.fn().mockReturnValue(opts.headers ?? {}),
    postData: vi.fn().mockReturnValue(opts.postData ?? null),
    response: vi.fn().mockReturnValue(response),
    failure: vi.fn().mockReturnValue(opts.failureText ? { errorText: opts.failureText } : null),
  };
}

// --- Mock page with event emission ---

interface TestPage {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emitEvent: (event: string, data: unknown) => void;
  emitRequest: (opts?: Parameters<typeof createFullMockRequest>[0]) => FullMockHTTPRequest;
  emitRequestFinished: (req: FullMockHTTPRequest) => void;
  emitRequestFailed: (req: FullMockHTTPRequest) => void;
}

function createTestPage(): TestPage {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();

  const getSet = (event: string) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    return listeners.get(event)!;
  };

  const page: TestPage = {
    on: vi.fn((event: string, handler: (arg: unknown) => void) => {
      getSet(event).add(handler);
    }),
    off: vi.fn((event: string, handler: (arg: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emitEvent: (event, data) => {
      listeners.get(event)?.forEach((h) => h(data));
    },
    emitRequest: (opts) => {
      const req = createFullMockRequest(opts);
      page.emitEvent('request', req);
      return req;
    },
    emitRequestFinished: (req) => page.emitEvent('requestfinished', req),
    emitRequestFailed: (req) => page.emitEvent('requestfailed', req),
  };

  return page;
}

describe('PageNetworkRecorder', () => {
  let page: TestPage;

  beforeEach(() => {
    page = createTestPage();
  });

  describe('attach / detach lifecycle', () => {
    it('should add event listeners on attach', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      expect(page.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfinished', expect.any(Function));
      expect(page.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });

    it('should set isAttached correctly', () => {
      const recorder = new PageNetworkRecorder();
      expect(recorder.isAttached()).toBe(false);

      recorder.attach(page as unknown as Page);
      expect(recorder.isAttached()).toBe(true);

      recorder.detach();
      expect(recorder.isAttached()).toBe(false);
    });

    it('should detach from previous page when re-attaching', () => {
      const page2 = createTestPage();
      const recorder = new PageNetworkRecorder();

      recorder.attach(page as unknown as Page);
      recorder.attach(page2 as unknown as Page);

      expect(page.off).toHaveBeenCalled();
    });
  });

  describe('request recording', () => {
    it('should record a request', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      page.emitRequest({ url: 'https://example.com/users', method: 'GET', resourceType: 'fetch' });

      const result = recorder.getEntries();
      expect(result.total).toBe(1);
      expect(result.entries[0].url).toBe('https://example.com/users');
      expect(result.entries[0].method).toBe('GET');
      expect(result.entries[0].resource_type).toBe('fetch');
      expect(result.entries[0].status).toBeNull();
    });

    it('should populate response on requestfinished', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const req = page.emitRequest({ url: 'https://example.com/api', status: 200, statusText: 'OK' });
      page.emitRequestFinished(req);

      const entry = recorder.getEntries().entries[0];
      expect(entry.status).toBe(200);
      expect(entry.status_text).toBe('OK');
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
      expect(entry.failed).toBe(false);
    });

    it('should mark failed requests', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const req = page.emitRequest({ failureText: 'net::ERR_CONNECTION_REFUSED' });
      page.emitRequestFailed(req);

      const entry = recorder.getEntries().entries[0];
      expect(entry.failed).toBe(true);
      expect(entry.failure_text).toBe('net::ERR_CONNECTION_REFUSED');
    });

    it('should ignore websocket requests', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      page.emitRequest({ resourceType: 'websocket' });

      expect(recorder.getEntries().total).toBe(0);
    });

    it('should truncate large post data', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const largeBody = 'x'.repeat(5000);
      page.emitRequest({ postData: largeBody, method: 'POST' });

      const entry = recorder.getEntries().entries[0];
      expect(entry.post_data!.length).toBeLessThan(5000);
      expect(entry.post_data!).toContain('…[truncated]');
    });

    it('should store selected request headers', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      page.emitRequest({
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer secret',
          'Accept': 'application/json',
          'X-Custom': 'ignored',
        },
      });

      const entry = recorder.getEntries().entries[0];
      expect(entry.request_headers['content-type']).toBe('application/json');
      expect(entry.request_headers.accept).toBe('application/json');
      expect(entry.request_headers.authorization).toBeUndefined();
      expect(entry.request_headers['x-custom']).toBeUndefined();
    });
  });

  describe('max entries eviction', () => {
    it('should evict oldest entries when max is reached', () => {
      const recorder = new PageNetworkRecorder(5);
      recorder.attach(page as unknown as Page);

      for (let i = 0; i < 7; i++) {
        page.emitRequest({ url: `https://example.com/${i}` });
      }

      const result = recorder.getEntries();
      expect(result.total).toBe(5);
      // Oldest (0, 1) should be evicted
      expect(result.entries[0].url).toBe('https://example.com/2');
      expect(result.entries[4].url).toBe('https://example.com/6');
    });
  });

  describe('filtering', () => {
    let recorder: PageNetworkRecorder;

    beforeEach(() => {
      recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      // Create varied entries
      const r1 = page.emitRequest({ url: 'https://api.example.com/users', method: 'GET', resourceType: 'fetch', status: 200 });
      page.emitRequestFinished(r1);

      const r2 = page.emitRequest({ url: 'https://api.example.com/login', method: 'POST', resourceType: 'xhr', status: 401 });
      page.emitRequestFinished(r2);

      const r3 = page.emitRequest({ url: 'https://cdn.example.com/style.css', method: 'GET', resourceType: 'stylesheet', status: 200 });
      page.emitRequestFinished(r3);

      const r4 = page.emitRequest({ url: 'https://api.example.com/data', method: 'GET', resourceType: 'fetch', failureText: 'net::ERR_FAILED' });
      page.emitRequestFailed(r4);
    });

    it('should filter by method', () => {
      const result = recorder.getEntries({ method: 'POST' });
      expect(result.total).toBe(1);
      expect(result.entries[0].url).toContain('/login');
    });

    it('should filter by resource_type', () => {
      const result = recorder.getEntries({ resource_type: 'fetch' });
      expect(result.total).toBe(2);
    });

    it('should filter by status range', () => {
      const result = recorder.getEntries({ status_min: 400, status_max: 499 });
      expect(result.total).toBe(1);
      expect(result.entries[0].status).toBe(401);
    });

    it('should filter by failed_only', () => {
      const result = recorder.getEntries({ failed_only: true });
      expect(result.total).toBe(1);
      expect(result.entries[0].failed).toBe(true);
    });

    it('should filter by url_pattern substring', () => {
      const result = recorder.getEntries({ url_pattern: 'cdn.example' });
      expect(result.total).toBe(1);
      expect(result.entries[0].url).toContain('cdn.example');
    });

    it('should filter by url_pattern regex', () => {
      const result = recorder.getEntries({ url_pattern: '/users|/login', url_regex: true });
      expect(result.total).toBe(2);
    });

    it('should handle invalid regex gracefully (fallback to substring)', () => {
      const result = recorder.getEntries({ url_pattern: '[invalid', url_regex: true });
      // Should not throw, falls back to substring match
      expect(result.total).toBe(0);
    });
  });

  describe('pagination', () => {
    it('should support offset and limit', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      for (let i = 0; i < 10; i++) {
        page.emitRequest({ url: `https://example.com/${i}` });
      }

      const result = recorder.getEntries(undefined, 3, 2);
      expect(result.total).toBe(10);
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].url).toBe('https://example.com/3');
      expect(result.entries[1].url).toBe('https://example.com/4');
    });
  });

  describe('search', () => {
    it('should search by URL pattern with additional filters', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const r1 = page.emitRequest({ url: 'https://api.example.com/v1/users', method: 'GET', status: 200 });
      page.emitRequestFinished(r1);
      const r2 = page.emitRequest({ url: 'https://api.example.com/v1/users', method: 'POST', status: 201 });
      page.emitRequestFinished(r2);
      const r3 = page.emitRequest({ url: 'https://cdn.example.com/image.png', resourceType: 'image', status: 200 });
      page.emitRequestFinished(r3);

      const result = recorder.search('/v1/users', false, { method: 'POST' });
      expect(result.total).toBe(1);
      expect(result.entries[0].method).toBe('POST');
    });
  });

  describe('markNavigation', () => {
    it('should bump navigation_id for new entries', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      page.emitRequest();
      recorder.markNavigation();
      page.emitRequest();

      const entries = recorder.getEntries().entries;
      expect(entries[0].navigation_id).toBe(0);
      expect(entries[1].navigation_id).toBe(1);
    });

    it('should ignore late events from previous generation', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const oldReq = page.emitRequest();
      recorder.markNavigation();

      // Late finish from old generation — should not crash or corrupt
      page.emitRequestFinished(oldReq);

      const entry = recorder.getEntries().entries[0];
      // Entry exists but response was not populated (pending map cleared)
      expect(entry.status).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      page.emitRequest();
      page.emitRequest();
      expect(recorder.getEntries().total).toBe(2);

      recorder.clear();
      expect(recorder.getEntries().total).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const recorder = new PageNetworkRecorder();
      recorder.attach(page as unknown as Page);

      const r1 = page.emitRequest({ resourceType: 'fetch', status: 200 });
      page.emitRequestFinished(r1);
      page.emitRequest({ resourceType: 'fetch' }); // pending
      const r3 = page.emitRequest({ resourceType: 'script', failureText: 'error' });
      page.emitRequestFailed(r3);

      const stats = recorder.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.by_resource_type).toEqual({ fetch: 2, script: 1 });
    });
  });
});

describe('Registry functions', () => {
  it('getOrCreateRecorder should return same recorder for same page', () => {
    const page = createTestPage() as unknown as Page;
    expect(getOrCreateRecorder(page)).toBe(getOrCreateRecorder(page));
  });

  it('getOrCreateRecorder should return different recorders for different pages', () => {
    const p1 = createTestPage() as unknown as Page;
    const p2 = createTestPage() as unknown as Page;
    expect(getOrCreateRecorder(p1)).not.toBe(getOrCreateRecorder(p2));
  });

  it('hasRecorder should reflect registry state', () => {
    const page = createTestPage() as unknown as Page;
    expect(hasRecorder(page)).toBe(false);
    getOrCreateRecorder(page);
    expect(hasRecorder(page)).toBe(true);
  });

  it('removeRecorder should detach and remove', () => {
    const page = createTestPage() as unknown as Page;
    const recorder = getOrCreateRecorder(page);
    recorder.attach(page);

    expect(recorder.isAttached()).toBe(true);
    removeRecorder(page);
    expect(hasRecorder(page)).toBe(false);
    expect(recorder.isAttached()).toBe(false);
  });
});
