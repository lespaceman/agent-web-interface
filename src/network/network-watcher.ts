/**
 * Network Watcher
 *
 * Accumulates HTTP request/response entries for a page, filtered by resource type.
 * Follows the same lifecycle pattern as PageNetworkTracker:
 *   - attach() to start watching
 *   - detach() to stop
 *   - markNavigation() on page navigation
 *
 * Accumulated entries are retrieved (and cleared) via getAndClear().
 */

import type { Page, HTTPRequest, HTTPResponse } from 'puppeteer-core';
import type { CapturedNetworkEntry } from './network-watcher.types.js';
import {
  DEFAULT_RESOURCE_TYPES,
  MAX_BODY_SIZE,
  SENSITIVE_HEADERS,
  isTextContentType,
} from './network-watcher.types.js';
import type { NetworkResourceType } from './network-watcher.types.js';

/**
 * Tracks a request that hasn't completed yet.
 */
interface PendingRequest {
  seq: number;
  method: string;
  url: string;
  resourceType: string;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
}

/**
 * Mask sensitive header values.
 */
function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    masked[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '***' : value;
  }
  return masked;
}

/**
 * Watches network requests on a single page and accumulates entries.
 */
export class NetworkWatcher {
  private page: Page | null = null;
  private entries: CapturedNetworkEntry[] = [];
  private pending = new Map<string, PendingRequest>();
  private resourceTypeFilter: Set<string>;
  private sequenceCounter = 0;
  private generation = 0;
  private currentGeneration = 0;

  // Event handlers (stored for cleanup via page.off())
  private onRequest: ((req: HTTPRequest) => void) | null = null;
  private onRequestFinished: ((req: HTTPRequest) => void) | null = null;
  private onRequestFailed: ((req: HTTPRequest) => void) | null = null;

  constructor() {
    this.resourceTypeFilter = new Set(DEFAULT_RESOURCE_TYPES);
  }

  /**
   * Attach network event listeners to a page and start accumulating.
   *
   * If already attached, detaches first (reconfigures).
   * Clears any previously accumulated entries.
   *
   * @param page - Puppeteer page to watch
   * @param resourceTypes - Resource types to capture (defaults to ['xhr'])
   */
  attach(page: Page, resourceTypes?: NetworkResourceType[]): void {
    if (this.page) {
      this.detach();
    }

    this.page = page;
    this.resourceTypeFilter = new Set(resourceTypes ?? DEFAULT_RESOURCE_TYPES);
    this.entries = [];
    this.pending.clear();
    this.sequenceCounter = 0;
    this.generation++;
    this.currentGeneration = this.generation;

    this.createAndAttachHandlers(page);
  }

  /**
   * Detach all event listeners and cleanup.
   */
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

  /**
   * Mark that a navigation occurred.
   *
   * Bumps the generation counter so late events from the previous document
   * are ignored. Pending requests from the old page are dropped.
   */
  markNavigation(): void {
    this.generation++;
    this.currentGeneration = this.generation;
    this.pending.clear();

    if (this.page) {
      this.removeHandlers(this.page);
      this.createAndAttachHandlers(this.page);
    }
  }

  /**
   * Retrieve all accumulated entries and clear the buffer.
   *
   * @returns Array of captured network entries (may be empty)
   */
  getAndClear(): CapturedNetworkEntry[] {
    // Finalize any still-pending requests as entries with state='pending'
    for (const [reqId, req] of this.pending) {
      this.entries.push({
        seq: req.seq,
        method: req.method,
        url: req.url,
        resourceType: req.resourceType,
        timestamp: req.timestamp,
        requestHeaders: req.requestHeaders,
        requestBody: req.requestBody,
        state: 'pending',
      });
      this.pending.delete(reqId);
    }

    const result = this.entries;
    this.entries = [];
    return result;
  }

  /**
   * Check if the watcher is currently attached and active.
   */
  isActive(): boolean {
    return this.page !== null;
  }

  /**
   * Get the current resource type filter.
   */
  getResourceTypes(): string[] {
    return [...this.resourceTypeFilter];
  }

  // --- Private methods ---

  private createAndAttachHandlers(page: Page): void {
    const gen = this.currentGeneration;

    this.onRequest = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;

      const resourceType = req.resourceType();
      if (!this.resourceTypeFilter.has(resourceType)) return;

      this.sequenceCounter++;
      const reqId = req.url() + '|' + this.sequenceCounter;

      const headers = req.headers();
      const postData = req.postData();

      const pendingReq: PendingRequest = {
        seq: this.sequenceCounter,
        method: req.method(),
        url: req.url(),
        resourceType,
        timestamp: Date.now(),
        requestHeaders: maskHeaders(headers),
        requestBody: postData
          ? postData.length > MAX_BODY_SIZE
            ? postData.slice(0, MAX_BODY_SIZE)
            : postData
          : undefined,
      };

      // Store the pending request keyed by a unique identifier
      // We use the HTTPRequest object itself as a key via a side-channel map
      this.pending.set(reqId, pendingReq);
      // Also store the reqId on the HTTPRequest for later correlation
      requestIdMap.set(req, reqId);
    };

    this.onRequestFinished = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;

      const resourceType = req.resourceType();
      if (!this.resourceTypeFilter.has(resourceType)) return;

      const reqId = requestIdMap.get(req);
      if (!reqId) return;
      requestIdMap.delete(req);

      const pendingReq = this.pending.get(reqId);
      if (!pendingReq) return;
      this.pending.delete(reqId);

      const response = req.response();
      const entry: CapturedNetworkEntry = {
        seq: pendingReq.seq,
        method: pendingReq.method,
        url: pendingReq.url,
        resourceType: pendingReq.resourceType,
        timestamp: pendingReq.timestamp,
        requestHeaders: pendingReq.requestHeaders,
        requestBody: pendingReq.requestBody,
        status: response?.status(),
        statusText: response?.statusText(),
        durationMs: Date.now() - pendingReq.timestamp,
        responseHeaders: response ? maskHeaders(response.headers()) : undefined,
        state: 'completed',
      };

      // Always push entry synchronously so it's available immediately
      this.entries.push(entry);

      // Capture response body asynchronously for text content types
      if (response) {
        const contentType = response.headers()['content-type'];
        if (isTextContentType(contentType)) {
          void this.captureResponseBody(response, entry);
        }
      }
    };

    this.onRequestFailed = (req: HTTPRequest) => {
      if (this.currentGeneration !== gen) return;

      const resourceType = req.resourceType();
      if (!this.resourceTypeFilter.has(resourceType)) return;

      const reqId = requestIdMap.get(req);
      if (!reqId) return;
      requestIdMap.delete(req);

      const pendingReq = this.pending.get(reqId);
      if (!pendingReq) return;
      this.pending.delete(reqId);

      const entry: CapturedNetworkEntry = {
        seq: pendingReq.seq,
        method: pendingReq.method,
        url: pendingReq.url,
        resourceType: pendingReq.resourceType,
        timestamp: pendingReq.timestamp,
        requestHeaders: pendingReq.requestHeaders,
        requestBody: pendingReq.requestBody,
        durationMs: Date.now() - pendingReq.timestamp,
        failureReason: req.failure()?.errorText ?? 'Unknown error',
        state: 'failed',
      };

      this.entries.push(entry);
    };

    page.on('request', this.onRequest);
    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);
  }

  private removeHandlers(page: Page): void {
    if (this.onRequest) {
      page.off('request', this.onRequest);
    }
    if (this.onRequestFinished) {
      page.off('requestfinished', this.onRequestFinished);
    }
    if (this.onRequestFailed) {
      page.off('requestfailed', this.onRequestFailed);
    }
  }

  /**
   * Capture response body text asynchronously and mutate the entry in-place.
   * The entry is already in `this.entries` — this just enriches it with body data.
   */
  private async captureResponseBody(
    response: HTTPResponse,
    entry: CapturedNetworkEntry
  ): Promise<void> {
    try {
      const body = await response.text();
      if (body.length > MAX_BODY_SIZE) {
        entry.responseBody = body.slice(0, MAX_BODY_SIZE);
        entry.bodyTruncated = true;
      } else {
        entry.responseBody = body;
        entry.bodyTruncated = false;
      }
    } catch {
      // Body not available (e.g., redirect, opaque response)
    }
  }
}

// --- Correlation side-channel ---

/**
 * WeakMap to correlate HTTPRequest objects with our internal request IDs.
 * This avoids modifying the HTTPRequest object itself.
 */
const requestIdMap = new WeakMap<HTTPRequest, string>();

// --- Global Registry ---

/**
 * WeakMap registry for page-scoped watchers.
 * Automatic cleanup when Page is garbage collected.
 */
const watchers = new WeakMap<Page, NetworkWatcher>();

/**
 * Get an existing watcher for a page, or create a new (inactive) one.
 */
export function getOrCreateWatcher(page: Page): NetworkWatcher {
  let watcher = watchers.get(page);
  if (!watcher) {
    watcher = new NetworkWatcher();
    watchers.set(page, watcher);
  }
  return watcher;
}

/**
 * Get a watcher for a page if one exists.
 */
export function getWatcher(page: Page): NetworkWatcher | undefined {
  return watchers.get(page);
}

/**
 * Remove and detach the watcher for a page.
 */
export function removeWatcher(page: Page): void {
  const watcher = watchers.get(page);
  if (watcher) {
    watcher.detach();
    watchers.delete(page);
  }
}
