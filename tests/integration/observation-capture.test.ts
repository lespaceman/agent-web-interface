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
import { chromium, Browser, Page } from 'playwright';
import { observationAccumulator } from '../../src/observation/index.js';

const isCI = !!process.env.CI;

describe.skipIf(isCI)('Observation Capture Integration', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser.close();
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
    await page.waitForTimeout(100);

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

    await page.waitForTimeout(100);

    const observations = await observationAccumulator.getObservations(page, actionStartTime);

    expect(observations.duringAction.length).toBeGreaterThan(0);
    expect(observations.duringAction[0].signals.hasAriaLive).toBe(true);
  });

  it('should NOT capture element below significance threshold', async () => {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await observationAccumulator.ensureInjected(page);

    const actionStartTime = Date.now();

    // Add a small div inside a container (not body-direct-child, low viewport coverage)
    // This should score 0 points - truly below threshold
    await page.evaluate(() => {
      const container = document.getElementById('root');
      const div = document.createElement('span');
      div.textContent = 'tiny';
      div.style.display = 'inline';
      container?.appendChild(div);
    });

    await page.waitForTimeout(100);

    const observations = await observationAccumulator.getObservations(page, actionStartTime);

    // Small span should NOT be captured (below threshold)
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
    await page.waitForTimeout(100);

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
    await page.waitForTimeout(100);

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

  it('should test with fresh context per test', async () => {
    // Create a fresh page to avoid state leaking from previous tests
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

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

      await freshPage.waitForTimeout(100);

      const observations = await observationAccumulator.getObservations(freshPage, actionStartTime);

      expect(observations.duringAction.length).toBeGreaterThan(0);
    } finally {
      await freshContext.close();
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

    await page.waitForTimeout(100);

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
});
