/**
 * Page Network Recorder
 *
 * Records network request/response details per page for the
 * list_network_calls and search_network_calls tools.
 *
 * Uses Puppeteer page events (request, requestfinished, requestfailed)
 * to capture entries. Memory-bounded via a circular buffer with
 * configurable max entries.
 *
 * Follows the same lifecycle pattern as PageNetworkTracker:
 * attach() → markNavigation() → detach()
 */

import type { Page, HTTPRequest } from 'puppeteer-core';

/** Maximum post data size to store (bytes) */
const MAX_POST_DATA_SIZE = 2048;

/** Default maximum number of entries to retain */
const DEFAULT_MAX_ENTRIES = 1000;

/** Headers worth keeping on requests */
const KEPT_REQUEST_HEADERS = new Set([
  'content-type',
  'accept',
  'content-length',
  'x-requested-with',
]);

/** Headers worth keeping on responses */
const KEPT_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'location',
]);

export interface NetworkEntry {
  id: number;
  url: string;
  method: string;
  resource_type: string;
  is_navigation: boolean;
  request_headers: Record<string, string>;
  post_data: string | null;
  started_at: number;
  status: number | null;
  status_text: string | null;
  response_headers: Record<string, string> | null;
  mime_type: string | null;
  duration_ms: number | null;
  failed: boolean;
  failure_text: string | null;
  navigation_id: number;
}

export interface NetworkFilter {
  url_pattern?: string;
  url_regex?: boolean;
  method?: string;
  resource_type?: string;
  status_min?: number;
  status_max?: number;
  failed_only?: boolean;
}

export interface NetworkQueryResult {
  entries: NetworkEntry[];
  total: number;
}

/**
 * Records network request/response details for a single page.
 */
export class PageNetworkRecorder {
  private entries: NetworkEntry[] = [];
  private nextId = 1;
  private navigationId = 0;
  private maxEntries: number;
  private page: Page | null = null;
  private generation = 0;
  private currentGeneration = 0;

  /** Map from HTTPRequest to NetworkEntry for response correlation */
  private pending = new Map<HTTPRequest, NetworkEntry>();

  private onRequest: ((req: HTTPRequest) => void) | null = null;
  private onRequestFinished: ((req: HTTPRequest) => void) | null = null;
  private onRequestFailed: ((req: HTTPRequest) => void) | null = null;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  attach(page: Page): void {
    if (this.page) {
      this.detach();
    }

    this.page = page;
    this.generation++;
    this.currentGeneration = this.generation;

    this.createAndAttachHandlers(page);
  }

  detach(): void {
    if (this.page) {
      this.removeHandlers(this.page);
    }

    this.onRequest = null;
    this.onRequestFinished = null;
    this.onRequestFailed = null;
    this.page = null;
    this.pending.clear();
  }

  markNavigation(): void {
    this.navigationId++;
    this.generation++;
    this.currentGeneration = this.generation;
    this.pending.clear();

    if (this.page) {
      this.removeHandlers(this.page);
      this.createAndAttachHandlers(this.page);
    }
  }

  getEntries(
    filter?: NetworkFilter,
    offset = 0,
    limit = 25
  ): NetworkQueryResult {
    const filtered = this.applyFilter(this.entries, filter);
    return {
      total: filtered.length,
      entries: filtered.slice(offset, offset + limit),
    };
  }

  search(
    urlPattern: string,
    isRegex = false,
    filter?: NetworkFilter
  ): NetworkQueryResult {
    const combinedFilter: NetworkFilter = {
      ...filter,
      url_pattern: urlPattern,
      url_regex: isRegex,
    };
    return this.applyFilterResult(this.entries, combinedFilter);
  }

  clear(): void {
    this.entries = [];
    this.pending.clear();
    this.nextId = 1;
  }

  getStats(): {
    total: number;
    pending: number;
    failed: number;
    by_resource_type: Record<string, number>;
  } {
    let pendingCount = 0;
    let failedCount = 0;
    const byType: Record<string, number> = {};

    for (const entry of this.entries) {
      if (entry.status === null && !entry.failed) pendingCount++;
      if (entry.failed) failedCount++;
      byType[entry.resource_type] = (byType[entry.resource_type] ?? 0) + 1;
    }

    return {
      total: this.entries.length,
      pending: pendingCount,
      failed: failedCount,
      by_resource_type: byType,
    };
  }

  isAttached(): boolean {
    return this.page !== null;
  }

  // --- Private methods ---

  private applyFilter(
    entries: NetworkEntry[],
    filter?: NetworkFilter
  ): NetworkEntry[] {
    if (!filter) return entries;

    return entries.filter((e) => {
      if (filter.method && e.method.toUpperCase() !== filter.method.toUpperCase()) return false;
      if (filter.resource_type && e.resource_type !== filter.resource_type) return false;
      if (filter.status_min != null && (e.status === null || e.status < filter.status_min))
        return false;
      if (filter.status_max != null && (e.status === null || e.status > filter.status_max))
        return false;
      if (filter.failed_only && !e.failed) return false;
      if (filter.url_pattern) {
        if (filter.url_regex) {
          try {
            if (!new RegExp(filter.url_pattern).test(e.url)) return false;
          } catch {
            // Invalid regex — treat as substring
            if (!e.url.includes(filter.url_pattern)) return false;
          }
        } else {
          if (!e.url.includes(filter.url_pattern)) return false;
        }
      }
      return true;
    });
  }

  private applyFilterResult(
    entries: NetworkEntry[],
    filter?: NetworkFilter
  ): NetworkQueryResult {
    const filtered = this.applyFilter(entries, filter);
    return { total: filtered.length, entries: filtered };
  }

  private evictIfNeeded(): void {
    while (this.entries.length >= this.maxEntries) {
      const removed = this.entries.shift();
      // Clean up pending map if the evicted entry was still pending
      if (removed?.status === null && !removed.failed) {
        for (const [req, entry] of this.pending) {
          if (entry === removed) {
            this.pending.delete(req);
            break;
          }
        }
      }
    }
  }

  private pickHeaders(
    headers: Record<string, string>,
    kept: Set<string>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(headers)) {
      if (kept.has(key.toLowerCase())) {
        result[key.toLowerCase()] = headers[key];
      }
    }
    return result;
  }

  private createAndAttachHandlers(page: Page): void {
    const gen = this.currentGeneration;

    this.onRequest = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;
      if (req.resourceType() === 'websocket') return;

      this.evictIfNeeded();

      let postData = req.postData() ?? null;
      if (postData && postData.length > MAX_POST_DATA_SIZE) {
        postData = postData.slice(0, MAX_POST_DATA_SIZE) + '…[truncated]';
      }

      const entry: NetworkEntry = {
        id: this.nextId++,
        url: req.url(),
        method: req.method(),
        resource_type: req.resourceType(),
        is_navigation: req.isNavigationRequest(),
        request_headers: this.pickHeaders(req.headers(), KEPT_REQUEST_HEADERS),
        post_data: postData,
        started_at: Date.now(),
        status: null,
        status_text: null,
        response_headers: null,
        mime_type: null,
        duration_ms: null,
        failed: false,
        failure_text: null,
        navigation_id: this.navigationId,
      };

      this.entries.push(entry);
      this.pending.set(req, entry);
    };

    this.onRequestFinished = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;

      const entry = this.pending.get(req);
      if (!entry) return;
      this.pending.delete(req);

      const response = req.response();
      if (response) {
        entry.status = response.status();
        entry.status_text = response.statusText();
        entry.response_headers = this.pickHeaders(
          response.headers(),
          KEPT_RESPONSE_HEADERS
        );
        const ct = response.headers()['content-type'];
        entry.mime_type = ct ? ct.split(';')[0].trim() : null;
      }
      entry.duration_ms = Date.now() - entry.started_at;
    };

    this.onRequestFailed = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;

      const entry = this.pending.get(req);
      if (!entry) return;
      this.pending.delete(req);

      entry.failed = true;
      entry.failure_text = req.failure()?.errorText ?? null;
      entry.duration_ms = Date.now() - entry.started_at;
    };

    page.on('request', this.onRequest);
    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);
  }

  private removeHandlers(page: Page): void {
    if (this.onRequest) page.off('request', this.onRequest);
    if (this.onRequestFinished) page.off('requestfinished', this.onRequestFinished);
    if (this.onRequestFailed) page.off('requestfailed', this.onRequestFailed);
  }
}

// --- Global Registry ---

const recorders = new WeakMap<Page, PageNetworkRecorder>();

export function getOrCreateRecorder(
  page: Page,
  maxEntries?: number
): PageNetworkRecorder {
  let recorder = recorders.get(page);
  if (!recorder) {
    recorder = new PageNetworkRecorder(maxEntries);
    recorders.set(page, recorder);
  }
  return recorder;
}

export function removeRecorder(page: Page): void {
  const recorder = recorders.get(page);
  if (recorder) {
    recorder.detach();
    recorders.delete(page);
  }
}

export function hasRecorder(page: Page): boolean {
  return recorders.has(page);
}
