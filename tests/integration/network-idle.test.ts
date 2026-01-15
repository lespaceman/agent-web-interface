/**
 * Network Idle Stabilization Integration Test
 *
 * This is the "gold standard" test that validates network-idle detection
 * works correctly for in-page actions (not just navigation).
 *
 * The test creates a local HTTP server with:
 * - / : HTML page with a button that triggers a delayed fetch
 * - /delay : Endpoint that responds after 2000ms
 *
 * Key scenario:
 * 1. Navigate to page
 * 2. Click button (triggers 2s fetch)
 * 3. Call waitForQuiet()
 * 4. Assert status shows "Loaded!" (not "Loading...")
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { chromium, type Browser, type Page } from 'playwright';
import { PageNetworkTracker, getOrCreateTracker } from '../../src/browser/page-network-tracker.js';

// Test HTML page with delayed fetch
const DELAYED_FETCH_HTML = `
<!doctype html>
<html>
<head><title>Network Idle Test</title></head>
<body>
  <h1>Network Idle Stabilization Test</h1>
  <button id="load">Load Data</button>
  <div id="status">Idle</div>

  <script>
    document.getElementById('load').onclick = async () => {
      document.getElementById('status').textContent = 'Loading...';
      await fetch('/delay');
      document.getElementById('status').textContent = 'Loaded!';
    };
  </script>
</body>
</html>
`;

// Skip in CI - Playwright browsers not installed in CI environment
const isCI = process.env.CI === 'true';

describe.skipIf(isCI)('Network Idle Stabilization (Integration)', () => {
  let server: Server;
  let port: number;
  let browser: Browser;
  let page: Page;
  let tracker: PageNetworkTracker;

  beforeAll(async () => {
    // Start local test server
    server = createServer((req, res) => {
      if (req.url === '/delay') {
        // Respond after 2000ms delay
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('done');
        }, 2000);
      } else {
        // Serve the test HTML page
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(DELAYED_FETCH_HTML);
      }
    });

    // Listen on random available port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          port = addr.port;
        }
        resolve();
      });
    });

    // Launch browser
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      server.close();
    }
  });

  beforeAll(async () => {
    // Create fresh page for each test
    page = await browser.newPage();
    tracker = getOrCreateTracker(page);
    tracker.attach(page);
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  it('should wait for fetch to complete after click', async () => {
    // Navigate to test page
    await page.goto(`http://localhost:${port}/`);

    // Mark navigation to reset tracker state
    tracker.markNavigation();

    // Verify initial state
    const initialStatus = await page.textContent('#status');
    expect(initialStatus).toBe('Idle');

    // Click the button (triggers 2s fetch)
    await page.click('#load');

    // The click handler sets status to "Loading..." synchronously,
    // then starts the fetch. Without proper network idle waiting,
    // we would see "Loading..." immediately.

    // Wait for network to become quiet (should wait for the 2s fetch)
    const idle = await tracker.waitForQuiet(5000, 500);
    expect(idle).toBe(true);

    // After waitForQuiet returns, status should be "Loaded!"
    // This is the critical assertion - if network idle detection
    // isn't working, we'd see "Loading..." here.
    const finalStatus = await page.textContent('#status');
    expect(finalStatus).toBe('Loaded!');
  }, 10000); // 10s timeout for the test

  it('should timeout gracefully if fetch takes too long', async () => {
    // Navigate fresh
    await page.goto(`http://localhost:${port}/`);
    tracker.markNavigation();

    await page.click('#load');

    // Wait with very short timeout (500ms < 2000ms fetch)
    const idle = await tracker.waitForQuiet(500, 100);

    // Should timeout (return false), not hang or throw
    expect(idle).toBe(false);

    // Status should still be "Loading..." since fetch isn't done
    const status = await page.textContent('#status');
    expect(status).toBe('Loading...');

    // Wait for fetch to actually complete (cleanup)
    await page.waitForTimeout(2500);
  }, 10000);
});

describe('waitForLoadState comparison (demonstrating the old bug)', () => {
  /**
   * NOTE: This test demonstrates that Playwright's waitForLoadState('networkidle')
   * does NOT reliably wait for in-page network activity after initial load.
   *
   * The test is SKIPPED because we now use PageNetworkTracker which fixes this issue.
   * The test is kept for documentation purposes to show what the old buggy behavior
   * looked like.
   */
  it.skip('demonstrates that waitForLoadState(networkidle) returns immediately (historical bug)', async () => {
    // This test used to demonstrate that:
    // - waitForLoadState('networkidle') returns in ~0ms after a click
    // - Even when a 2-second fetch is in flight
    // - The status would show "Loading..." instead of "Loaded!"
    //
    // With PageNetworkTracker, this bug is fixed.
    // The tracker monitors actual request/response events and waits correctly.
  });
});
