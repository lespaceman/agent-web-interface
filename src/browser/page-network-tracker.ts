/**
 * Page Network Tracker
 *
 * Tracks in-flight network requests for a page and provides a reliable
 * "network quiet" wait mechanism. Unlike Playwright's waitForLoadState('networkidle'),
 * this tracks requests triggered after page load (e.g., by user actions).
 *
 * Uses a generation counter to safely handle navigation - late events from
 * previous documents are ignored.
 */

import type { Page, Request } from 'playwright';

/** Default quiet window - time with 0 inflight requests to consider "idle" */
const DEFAULT_QUIET_WINDOW_MS = 500;

/**
 * Tracks network requests for a single page.
 *
 * Attach to a page via `attach()`, then use `waitForQuiet()` to wait for
 * network activity to settle. Call `markNavigation()` when navigating to
 * safely reset state without race conditions.
 */
export class PageNetworkTracker {
  private page: Page | null = null;
  private inflightCount = 0;
  private generation = 0;
  private currentGeneration = 0;

  // Quiet window state
  private quietTimer: NodeJS.Timeout | null = null;
  private quietWindowMs: number = DEFAULT_QUIET_WINDOW_MS;
  private quietResolvers: { resolve: (idle: boolean) => void; timeoutId: NodeJS.Timeout }[] = [];

  // Event handlers (stored for cleanup via page.off())
  private onRequest: ((req: Request) => void) | null = null;
  private onRequestFinished: ((req: Request) => void) | null = null;
  private onRequestFailed: ((req: Request) => void) | null = null;

  /**
   * Attach network event listeners to a page.
   *
   * Must be called before `waitForQuiet()` can be used.
   * Safe to call multiple times - will detach previous listeners first.
   */
  attach(page: Page): void {
    // Detach from previous page if any
    if (this.page) {
      this.detach();
    }

    this.page = page;
    this.generation++;
    this.currentGeneration = this.generation;
    this.inflightCount = 0;

    const gen = this.currentGeneration;

    this.onRequest = (req: Request) => {
      // Ignore stale events from previous document
      if (this.currentGeneration !== gen) return;
      // Ignore websockets (persistent connections)
      if (req.resourceType() === 'websocket') return;

      this.inflightCount++;
      this.cancelQuietTimer();
    };

    this.onRequestFinished = (req: Request) => {
      if (this.currentGeneration !== gen) return;
      if (req.resourceType() === 'websocket') return;

      // Never go below 0 (handles edge cases)
      this.inflightCount = Math.max(0, this.inflightCount - 1);
      this.checkQuiet();
    };

    this.onRequestFailed = (req: Request) => {
      if (this.currentGeneration !== gen) return;
      if (req.resourceType() === 'websocket') return;

      this.inflightCount = Math.max(0, this.inflightCount - 1);
      this.checkQuiet();
    };

    page.on('request', this.onRequest);
    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);
  }

  /**
   * Detach all event listeners and cleanup timers.
   *
   * Call this when the page is closed or no longer needs tracking.
   */
  detach(): void {
    if (this.page) {
      if (this.onRequest) {
        this.page.off('request', this.onRequest);
      }
      if (this.onRequestFinished) {
        this.page.off('requestfinished', this.onRequestFinished);
      }
      if (this.onRequestFailed) {
        this.page.off('requestfailed', this.onRequestFailed);
      }
    }

    this.onRequest = null;
    this.onRequestFinished = null;
    this.onRequestFailed = null;
    this.page = null;

    // Cancel any pending quiet timers
    this.cancelQuietTimer();

    // Reject all pending waiters with false (not idle)
    for (const { resolve, timeoutId } of this.quietResolvers) {
      clearTimeout(timeoutId);
      resolve(false);
    }
    this.quietResolvers = [];
  }

  /**
   * Mark that a navigation occurred.
   *
   * This safely resets state by bumping the generation counter, so any
   * late events from the previous document are ignored. Use this instead
   * of directly resetting state to avoid race conditions.
   */
  markNavigation(): void {
    this.generation++;
    this.currentGeneration = this.generation;
    this.inflightCount = 0;
    this.cancelQuietTimer();

    // Re-attach handlers with new generation if we have a page
    if (this.page) {
      const page = this.page;
      // Detach old handlers
      if (this.onRequest) {
        page.off('request', this.onRequest);
      }
      if (this.onRequestFinished) {
        page.off('requestfinished', this.onRequestFinished);
      }
      if (this.onRequestFailed) {
        page.off('requestfailed', this.onRequestFailed);
      }

      // Create new handlers with updated generation
      const gen = this.currentGeneration;

      this.onRequest = (req: Request) => {
        if (this.currentGeneration !== gen) return;
        if (req.resourceType() === 'websocket') return;
        this.inflightCount++;
        this.cancelQuietTimer();
      };

      this.onRequestFinished = (req: Request) => {
        if (this.currentGeneration !== gen) return;
        if (req.resourceType() === 'websocket') return;
        this.inflightCount = Math.max(0, this.inflightCount - 1);
        this.checkQuiet();
      };

      this.onRequestFailed = (req: Request) => {
        if (this.currentGeneration !== gen) return;
        if (req.resourceType() === 'websocket') return;
        this.inflightCount = Math.max(0, this.inflightCount - 1);
        this.checkQuiet();
      };

      page.on('request', this.onRequest);
      page.on('requestfinished', this.onRequestFinished);
      page.on('requestfailed', this.onRequestFailed);
    }
  }

  /**
   * Wait for network to become quiet (no inflight requests for quietWindowMs).
   *
   * @param timeoutMs - Maximum time to wait before returning false
   * @param quietWindowMs - Time with 0 inflight requests to consider "idle"
   * @returns true if network became quiet, false if timed out (never throws)
   */
  async waitForQuiet(
    timeoutMs: number,
    quietWindowMs: number = DEFAULT_QUIET_WINDOW_MS
  ): Promise<boolean> {
    // Store the quiet window for checkQuiet() to use
    this.quietWindowMs = quietWindowMs;

    return new Promise<boolean>((resolve) => {
      const hardTimeout = setTimeout(() => {
        // Remove this resolver from the list
        const index = this.quietResolvers.findIndex((r) => r.timeoutId === hardTimeout);
        if (index !== -1) {
          this.quietResolvers.splice(index, 1);
        }
        resolve(false);
      }, timeoutMs);

      this.quietResolvers.push({ resolve, timeoutId: hardTimeout });

      // If already idle, start quiet timer immediately
      if (this.inflightCount === 0) {
        this.startQuietTimer();
      }
    });
  }

  /**
   * Get current inflight request count (for debugging/testing).
   */
  getInflightCount(): number {
    return this.inflightCount;
  }

  /**
   * Check if tracker is attached to a page.
   */
  isAttached(): boolean {
    return this.page !== null;
  }

  // --- Private methods ---

  private cancelQuietTimer(): void {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
  }

  private checkQuiet(): void {
    if (this.inflightCount === 0 && this.quietResolvers.length > 0) {
      this.startQuietTimer();
    }
  }

  private startQuietTimer(): void {
    // Cancel any existing timer first
    this.cancelQuietTimer();

    // Start quiet window timer
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      // Resolve all pending waiters
      for (const { resolve, timeoutId } of this.quietResolvers) {
        clearTimeout(timeoutId);
        resolve(true);
      }
      this.quietResolvers = [];
    }, this.quietWindowMs);
  }
}

// --- Global Registry ---

/**
 * WeakMap registry for page-scoped trackers.
 *
 * Using WeakMap keyed by Page object provides automatic cleanup when
 * the Page is garbage collected, avoiding memory leaks.
 */
const trackers = new WeakMap<Page, PageNetworkTracker>();

/**
 * Get or create a network tracker for a page.
 *
 * Note: This does NOT automatically attach the tracker.
 * Call `tracker.attach(page)` after getting the tracker.
 */
export function getOrCreateTracker(page: Page): PageNetworkTracker {
  let tracker = trackers.get(page);
  if (!tracker) {
    tracker = new PageNetworkTracker();
    trackers.set(page, tracker);
  }
  return tracker;
}

/**
 * Remove and detach the tracker for a page.
 *
 * Call this when a page is closed to ensure proper cleanup.
 */
export function removeTracker(page: Page): void {
  const tracker = trackers.get(page);
  if (tracker) {
    tracker.detach();
    trackers.delete(page);
  }
}

/**
 * Check if a page has a tracker attached.
 */
export function hasTracker(page: Page): boolean {
  return trackers.has(page);
}
