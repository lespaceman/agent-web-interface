/**
 * Manual test to verify waitForLoadState('networkidle') behavior
 *
 * This test demonstrates that waitForLoadState('networkidle') returns
 * immediately for already-loaded pages, even when fetch requests are in flight.
 */

import { chromium } from 'playwright';

async function test() {
  console.log('Starting network idle test...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to test page
  await page.goto('http://localhost:8765/delayed-fetch.html');
  console.log('Page loaded. Initial networkidle reached.\n');

  // Wait a moment for page to stabilize
  await page.waitForTimeout(1000);

  // Test 1: Call waitForLoadState on already-loaded page
  console.log('Test 1: Calling waitForLoadState(networkidle) on loaded page...');
  const start1 = Date.now();
  await page.waitForLoadState('networkidle', { timeout: 5000 });
  console.log(`  Returned in ${Date.now() - start1}ms (should be ~0ms)\n`);

  // Test 2: Click button (triggers 2s fetch) then immediately call waitForLoadState
  console.log('Test 2: Clicking button (triggers 2s fetch) then calling waitForLoadState...');
  const button = page.locator('#load');
  const status = page.locator('#status');

  console.log(`  Status before click: "${await status.textContent()}"`);

  await button.click();
  console.log('  Click dispatched, calling waitForLoadState(networkidle)...');

  const start2 = Date.now();
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    console.log(`  Timed out after ${Date.now() - start2}ms`);
  }
  const elapsed = Date.now() - start2;
  console.log(`  waitForLoadState returned in ${elapsed}ms`);
  console.log(`  Status after waitForLoadState: "${await status.textContent()}"`);

  if (elapsed < 1500) {
    console.log('\n❌ BUG CONFIRMED: waitForLoadState returned too early!');
    console.log('   The 2s fetch was NOT awaited.\n');
  } else {
    console.log('\n✅ waitForLoadState waited for the fetch.');
  }

  // Wait for fetch to actually complete to verify
  await page.waitForTimeout(3000);
  console.log(`  Status after 3s wait: "${await status.textContent()}"`);

  await browser.close();
}

test().catch(console.error);
