/**
 * CDP Event Logger
 *
 * Captures CDP events for post-mortem analysis of snapshot failures.
 * Tracks navigation lifecycle, execution contexts, and errors.
 */

import type { CdpClient } from '../cdp/cdp-client.interface.js';

/** Single captured CDP event */
export interface CdpEventEntry {
  event: string;
  params: unknown;
  localTimestamp: number;
}

/** Events we want to capture for diagnostics */
const DIAGNOSTIC_EVENTS = [
  // Navigation lifecycle
  'Page.frameNavigated',
  'Page.frameStartedLoading',
  'Page.frameStoppedLoading',
  'Page.loadEventFired',
  'Page.domContentEventFired',
  'Page.navigatedWithinDocument',
  // Execution contexts
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  // Errors
  'Page.javascriptDialogOpening',
  'Inspector.detached',
] as const;

/**
 * Captures and stores CDP events for diagnostic analysis.
 *
 * Usage:
 * 1. Create logger and attach to CDP client before navigation
 * 2. Perform navigation/action
 * 3. If snapshot fails, retrieve events for analysis
 * 4. Clear events before next operation
 */
export class CdpEventLogger {
  private events: CdpEventEntry[] = [];
  private cdp: CdpClient | null = null;
  private handlers = new Map<string, (params: unknown) => void>();
  private maxEvents = 100; // Prevent memory issues

  /**
   * Attach to CDP client and start capturing events.
   */
  attach(cdp: CdpClient): void {
    this.cdp = cdp;

    for (const eventName of DIAGNOSTIC_EVENTS) {
      const handler = (params: unknown) => {
        this.captureEvent(eventName, params);
      };
      this.handlers.set(eventName, handler);
      cdp.on(eventName, handler);
    }
  }

  /**
   * Detach from CDP client and stop capturing.
   */
  detach(): void {
    if (!this.cdp) return;

    for (const [eventName, handler] of this.handlers) {
      this.cdp.off(eventName, handler);
    }
    this.handlers.clear();
    this.cdp = null;
  }

  /**
   * Get all captured events.
   */
  getEvents(): CdpEventEntry[] {
    return [...this.events];
  }

  /**
   * Clear captured events.
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get events as formatted diagnostic string.
   */
  formatForDiagnostics(): string {
    if (this.events.length === 0) {
      return 'No CDP events captured';
    }

    return this.events
      .map((e) => `[${e.localTimestamp}] ${e.event}: ${JSON.stringify(e.params)}`)
      .join('\n');
  }

  private captureEvent(event: string, params: unknown): void {
    // Trim old events if at capacity
    if (this.events.length >= this.maxEvents) {
      this.events.shift();
    }

    this.events.push({
      event,
      params,
      localTimestamp: Date.now(),
    });
  }
}
