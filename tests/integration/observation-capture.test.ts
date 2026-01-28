/**
 * Integration test for DOM Observation capture.
 *
 * This test verifies that the observation system correctly captures
 * significant DOM mutations during actions.
 */

/// <reference lib="dom" />

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { observationAccumulator } from '../../src/observation/index.js';

// Skip in CI unless RUN_INTEGRATION is set (for dedicated integration workflow)
const skipIntegration = process.env.CI === 'true' && process.env.RUN_INTEGRATION !== 'true';

describe.skipIf(skipIntegration)('Observation Capture Integration', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('should inject observer successfully', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    // Verify observer is present
    const hasObserver = await page.evaluate(() => {
      return typeof (window as any).__observationAccumulator !== 'undefined';
    });

    expect(hasObserver).toBe(true);
  });

  it('should verify observer is actually observing', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    // Check observer internals
    const observerState = await page.evaluate(() => {
      const acc = (window as any).__observationAccumulator;
      if (!acc) return { error: 'Observer not found' };
      return {
        hasLog: Array.isArray(acc.log),
        hasObserver: !!acc.observer,
        pageLoadTime: acc.pageLoadTime,
        lastReportedIndex: acc.lastReportedIndex,
        bodyExists: !!document.body,
      };
    });

    expect(observerState.hasLog).toBe(true);
    expect(observerState.hasObserver).toBe(true);
    expect(observerState.bodyExists).toBe(true);
  });

  it('should capture element with role=alert', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    const actionStartTime = Date.now();

    // Add an element with role="alert" (should score 3 points)
    await page.evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Test alert message';
      document.body.appendChild(alert);
    });

    // Small delay to ensure mutation is processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get observations
    const observations = await observationAccumulator.getObservations(page, actionStartTime);

    expect(observations.duringAction.length).toBeGreaterThan(0);
    expect(observations.duringAction[0].content.role).toBe('alert');
    expect(observations.duringAction[0].significance).toBeGreaterThanOrEqual(3);
  });

  it('should capture element with aria-live=assertive', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    const actionStartTime = Date.now();

    // Add an element with aria-live="assertive" (should score 3 points)
    await page.evaluate(() => {
      const liveRegion = document.createElement('div');
      liveRegion.setAttribute('aria-live', 'assertive');
      liveRegion.textContent = 'Live region update';
      document.body.appendChild(liveRegion);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const observations = await observationAccumulator.getObservations(page, actionStartTime);

    expect(observations.duringAction.length).toBeGreaterThan(0);
    expect(observations.duringAction[0].signals.hasAriaLive).toBe(true);
  });

  it('should NOT capture element below significance threshold', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    const actionStartTime = Date.now();

    // Add a hidden element - should score 0 points (not visible in viewport)
    // isVisibleInViewport: false (hidden), hasNonTrivialText: true but doesn't matter
    // Total: 0 points - truly below threshold
    await page.evaluate(() => {
      const container = document.getElementById('root');
      const div = document.createElement('span');
      div.textContent = 'hidden text';
      div.style.display = 'none'; // Hidden - won't score isVisibleInViewport
      container?.appendChild(div);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const observations = await observationAccumulator.getObservations(page, actionStartTime);

    // Hidden element should NOT be captured (below threshold)
    expect(observations.duringAction.length).toBe(0);
  });

  it('should capture element with combined signals', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    // Add an element
    await page.evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.setAttribute('aria-live', 'assertive');
      alert.textContent = 'Debug test';
      document.body.appendChild(alert);
    });

    // Wait for mutation to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now check the log in a separate evaluate
    const signals = await page.evaluate(() => {
      const acc = (window as any).__observationAccumulator;
      if (!acc) return { error: 'Observer not found', logLength: 0 };

      const lastEntry = acc.log[acc.log.length - 1];
      return {
        logLength: acc.log.length,
        lastEntry: lastEntry,
      };
    });

    expect(signals.logLength).toBeGreaterThan(0);
    if (signals.lastEntry) {
      expect(signals.lastEntry.significance).toBeGreaterThanOrEqual(3);
    }
  });

  it('should capture mutations across separate evaluate calls', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');

    // Inject our actual observer
    await observationAccumulator.ensureInjected(page);

    // Verify injection
    const beforeAdd = await page.evaluate(() => {
      const acc = (window as any).__observationAccumulator;
      return {
        exists: !!acc,
        logLength: acc?.log?.length || 0,
      };
    });

    // Add element in separate call
    await page.evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Test alert';
      document.body.appendChild(alert);
    });

    // Wait
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check log
    const afterAdd = await page.evaluate(() => {
      const acc = (window as any).__observationAccumulator;
      return {
        exists: !!acc,
        logLength: acc?.log?.length || 0,
        log: acc?.log || [],
      };
    });

    expect(beforeAdd.exists).toBe(true);
    expect(afterAdd.logLength).toBeGreaterThan(0);
  });

  it('should test with fresh page per test', async () => {
    // Create a fresh page to avoid state leaking from previous tests
    const freshPage = await browser.newPage();

    try {
      await freshPage.setContent('<html><body><div id="root"></div></body></html>');
      await observationAccumulator.inject(freshPage);

      const actionStartTime = Date.now();

      await freshPage.evaluate(() => {
        const alert = document.createElement('div');
        alert.setAttribute('role', 'alert');
        alert.textContent = 'Fresh context test';
        document.body.appendChild(alert);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const observations = await observationAccumulator.getObservations(freshPage, actionStartTime);

      expect(observations.duringAction.length).toBeGreaterThan(0);
    } finally {
      await freshPage.close();
    }
  });

  it('should handle timestamp filtering correctly', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    // Record Node.js timestamp BEFORE adding element
    const nodeJsTimestamp = Date.now();

    // Add element
    await page.evaluate(() => {
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Timestamp test';
      document.body.appendChild(alert);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check timestamps directly
    const debug = await page.evaluate((since: number) => {
      const acc = (window as any).__observationAccumulator;
      if (!acc) return { error: 'No accumulator' };

      const log = acc.log;
      const browserNow = Date.now();

      return {
        browserNow,
        sinceFromNodeJs: since,
        timeDiff: browserNow - since,
        logLength: log.length,
        entries: log.map((e: any) => ({
          timestamp: e.timestamp,
          role: e.role,
          significance: e.significance,
          passesFilter: e.timestamp >= since && e.significance >= 3,
        })),
      };
    }, nodeJsTimestamp);

    // Verify observations are filtered correctly by timestamp
    const observations = await observationAccumulator.getObservations(page, nodeJsTimestamp);

    expect(debug.logLength).toBeGreaterThan(0);
    expect(observations.duringAction.length).toBeGreaterThan(0);
  });

  describe('Shadow DOM observations', () => {
    it('should NOT capture existing shadow DOM content as mutations', async () => {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await observationAccumulator.ensureInjected(page);

      // Add a custom element with shadow DOM that contains existing content
      // The shadow host should be captured, but NOT its internal shadow DOM children
      await page.evaluate(() => {
        // Create a custom element with shadow DOM
        const shadowHost = document.createElement('div');
        shadowHost.id = 'shadow-host';
        shadowHost.setAttribute('role', 'alert'); // Make it significant

        // Attach shadow DOM with existing content
        const shadow = shadowHost.attachShadow({ mode: 'open' });

        // Add significant content inside the shadow DOM
        const alertDiv = document.createElement('div');
        alertDiv.setAttribute('role', 'status');
        alertDiv.setAttribute('aria-live', 'polite');
        alertDiv.textContent = 'Shadow DOM content';
        shadow.appendChild(alertDiv);

        const dialogDiv = document.createElement('div');
        dialogDiv.setAttribute('role', 'dialog');
        dialogDiv.textContent = 'Dialog inside shadow';
        shadow.appendChild(dialogDiv);

        // Add to DOM - this is the only mutation that should be captured
        document.body.appendChild(shadowHost);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get all raw log entries from the browser
      const logInfo = await page.evaluate(() => {
        const acc = (window as any).__observationAccumulator;
        if (!acc) return { error: 'No accumulator', entries: [] };
        return {
          entries: acc.log.map((e: any) => ({
            tag: e.tag,
            id: e.id,
            role: e.role,
            text: e.text?.substring(0, 50),
            shadowPath: e.shadowPath,
            significance: e.significance,
          })),
        };
      });

      // The shadow host should be captured (it has role="alert")
      // But the internal shadow DOM elements (role="status", role="dialog") should NOT be
      // captured because they are existing content, not mutations
      const entries = logInfo.entries;

      // Should have exactly 1 entry: the shadow host itself
      // NOT 3 entries (shadow host + 2 shadow DOM children)
      expect(entries.length).toBe(1);
      expect(entries[0].id).toBe('shadow-host');
      expect(entries[0].role).toBe('alert');
    });

    it('should capture mutations INSIDE shadow DOM after observer is attached', async () => {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await observationAccumulator.ensureInjected(page);

      // First, add a shadow host to the DOM
      await page.evaluate(() => {
        const shadowHost = document.createElement('div');
        shadowHost.id = 'shadow-host';
        shadowHost.setAttribute('role', 'alert');
        const shadow = shadowHost.attachShadow({ mode: 'open' });
        // Add non-significant placeholder
        const placeholder = document.createElement('div');
        placeholder.textContent = 'Placeholder';
        shadow.appendChild(placeholder);
        document.body.appendChild(shadowHost);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear the log and record new start time
      await page.evaluate(() => {
        const acc = (window as any).__observationAccumulator;
        acc.log.length = 0;
        acc.lastReportedIndex = 0;
      });

      const afterClearTime = Date.now();

      // Now add a NEW element inside the shadow DOM - this IS a mutation
      await page.evaluate(() => {
        const shadowHost = document.getElementById('shadow-host');
        const shadow = shadowHost?.shadowRoot;
        if (shadow) {
          const newAlert = document.createElement('div');
          newAlert.setAttribute('role', 'status');
          newAlert.setAttribute('aria-live', 'assertive');
          newAlert.textContent = 'New mutation inside shadow';
          shadow.appendChild(newAlert);
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const observations = await observationAccumulator.getObservations(page, afterClearTime);

      // The new element added AFTER observation started should be captured
      expect(observations.duringAction.length).toBeGreaterThan(0);

      // Verify it has the shadow path context
      const alertObs = observations.duringAction.find((o) => o.signals.hasAriaLive === true);
      expect(alertObs).toBeDefined();
      expect(alertObs?.shadowPath).toBeDefined();
      expect(alertObs?.shadowPath?.length).toBeGreaterThan(0);
    });

    it('should attach observer to nested shadow roots but not process their content', async () => {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await observationAccumulator.ensureInjected(page);

      // Create nested shadow DOM structure
      await page.evaluate(() => {
        // Outer shadow host
        const outer = document.createElement('div');
        outer.id = 'outer-host';
        outer.setAttribute('role', 'alert');
        const outerShadow = outer.attachShadow({ mode: 'open' });

        // Inner shadow host (nested)
        const inner = document.createElement('div');
        inner.id = 'inner-host';
        inner.setAttribute('role', 'status');
        const innerShadow = inner.attachShadow({ mode: 'open' });

        // Content in inner shadow DOM
        const content = document.createElement('div');
        content.setAttribute('role', 'dialog');
        content.textContent = 'Deeply nested content';
        innerShadow.appendChild(content);

        outerShadow.appendChild(inner);
        document.body.appendChild(outer);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const logInfo = await page.evaluate(() => {
        const acc = (window as any).__observationAccumulator;
        if (!acc) return { entries: [], shadowObserverCount: 0 };
        return {
          entries: acc.log.map((e: any) => ({
            id: e.id,
            role: e.role,
            shadowPath: e.shadowPath,
          })),
          shadowObserverCount: acc.shadowObservers.size,
        };
      });

      // Should only capture the outer host (the actual DOM mutation)
      // NOT the inner hosts or nested content
      expect(logInfo.entries.length).toBe(1);
      expect(logInfo.entries[0].id).toBe('outer-host');
      expect(logInfo.entries[0].role).toBe('alert');

      // But observers should be attached to both shadow roots for future mutations
      expect(logInfo.shadowObserverCount).toBeGreaterThanOrEqual(1);
    });

    it('should cleanup shadow observers when shadow host is removed', async () => {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await observationAccumulator.ensureInjected(page);

      // Add a shadow host to the DOM
      await page.evaluate(() => {
        const shadowHost = document.createElement('div');
        shadowHost.id = 'removable-host';
        shadowHost.setAttribute('role', 'alert');
        const shadow = shadowHost.attachShadow({ mode: 'open' });
        const content = document.createElement('div');
        content.textContent = 'Shadow content';
        shadow.appendChild(content);
        document.body.appendChild(shadowHost);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify shadow observer was created
      const beforeRemoval = await page.evaluate(() => {
        const acc = (window as any).__observationAccumulator;
        return {
          shadowObserverCount: acc.shadowObservers.size,
        };
      });

      expect(beforeRemoval.shadowObserverCount).toBeGreaterThanOrEqual(1);

      // Remove the shadow host
      await page.evaluate(() => {
        const host = document.getElementById('removable-host');
        host?.remove();
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify shadow observer was cleaned up
      const afterRemoval = await page.evaluate(() => {
        const acc = (window as any).__observationAccumulator;
        return {
          shadowObserverCount: acc.shadowObservers.size,
        };
      });

      // Shadow observer should be removed when host is removed
      expect(afterRemoval.shadowObserverCount).toBe(0);
    });
  });
});
