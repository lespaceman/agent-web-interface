/**
 * Manual test to verify network idle behavior
 *
 * This test demonstrates that Puppeteer's built-in network idle detection
 * may not be sufficient for in-page fetch requests triggered after page load.
 */

import puppeteer from 'puppeteer-core';

async function test() {
  console.log('Starting network idle test...\n');

  const browser = await puppeteer.launch({ headless: false, channel: 'chrome' });
  const page = await browser.newPage();

  // Navigate to test page
  await page.goto('http://localhost:8765/delayed-fetch.html');
  console.log('Page loaded. Initial navigation complete.\n');

  // Wait a moment for page to stabilize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test 1: Check network idle returns immediately on loaded page
  console.log('Test 1: Calling waitForNetworkIdle on loaded page...');
  const start1 = Date.now();
  await page.waitForNetworkIdle({ timeout: 5000 });
  console.log(`  Returned in ${Date.now() - start1}ms (should be ~0ms)\n`);

  // Test 2: Click button (triggers 2s fetch) then immediately call waitForNetworkIdle
  console.log('Test 2: Clicking button (triggers 2s fetch) then calling waitForNetworkIdle...');

  const statusBefore = await page.$eval('#status', (el) => el.textContent);
  console.log(`  Status before click: "${statusBefore}"`);

  await page.click('#load');
  console.log('  Click dispatched, calling waitForNetworkIdle...');

  const start2 = Date.now();
  try {
    await page.waitForNetworkIdle({ timeout: 5000 });
  } catch {
    console.log(`  Timed out after ${Date.now() - start2}ms`);
  }
  const elapsed = Date.now() - start2;
  console.log(`  waitForNetworkIdle returned in ${elapsed}ms`);
  const statusAfter = await page.$eval('#status', (el) => el.textContent);
  console.log(`  Status after waitForNetworkIdle: "${statusAfter}"`);

  if (elapsed < 1500) {
    console.log('\n❌ BUG CONFIRMED: waitForNetworkIdle returned too early!');
    console.log('   The 2s fetch was NOT awaited.\n');
  } else {
    console.log('\n✅ waitForNetworkIdle waited for the fetch.');
  }

  // Wait for fetch to actually complete to verify
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const statusFinal = await page.$eval('#status', (el) => el.textContent);
  console.log(`  Status after 3s wait: "${statusFinal}"`);

  await browser.close();
}

test().catch(console.error);
