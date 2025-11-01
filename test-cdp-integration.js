#!/usr/bin/env node

/**
 * Test script for Phase 2 CDP Integration
 *
 * This script tests the following MCP flows:
 * 1. Connect to CDP server
 * 2. Navigate to a page
 * 3. Query the DOM
 * 4. Execute JavaScript
 */

import CDP from 'chrome-remote-interface';

const host = process.env.CEF_BRIDGE_HOST || '127.0.0.1';
const port = parseInt(process.env.CEF_BRIDGE_PORT || '9223', 10);

console.log(`\n🧪 Testing CDP Integration`);
console.log(`   Host: ${host}`);
console.log(`   Port: ${port}\n`);

async function testCDPIntegration() {
  let client;

  try {
    // Test 1: Connect to CDP server
    console.log('1️⃣  Connecting to CDP server...');
    client = await CDP({ host, port });
    console.log('   ✅ Connected successfully\n');

    // Enable required domains
    console.log('2️⃣  Enabling CDP domains...');
    const { Page, DOM, Runtime } = client;
    await Page.enable();
    await DOM.enable();
    await Runtime.enable();
    console.log('   ✅ Domains enabled\n');

    // Test 2: Navigate to a page
    console.log('3️⃣  Navigating to example.com...');
    await Page.navigate({ url: 'https://example.com' });

    // Wait for page to load
    await new Promise((resolve) => {
      Page.loadEventFired(() => {
        console.log('   ✅ Page loaded successfully\n');
        resolve();
      });
    });

    // Small delay to ensure DOM is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Test 3: Query the DOM
    console.log('4️⃣  Querying DOM...');
    const doc = await DOM.getDocument({ depth: -1 });
    console.log(`   ✅ Document root: ${doc.root.nodeName}`);
    console.log(`   ✅ Document has ${doc.root.childNodeCount || 0} children\n`);

    // Test 4: Execute JavaScript
    console.log('5️⃣  Executing JavaScript...');
    const titleResult = await Runtime.evaluate({
      expression: 'document.title',
      returnByValue: true,
    });
    console.log(`   ✅ Page title: "${titleResult.result.value}"`);

    const urlResult = await Runtime.evaluate({
      expression: 'document.location.href',
      returnByValue: true,
    });
    console.log(`   ✅ Page URL: ${urlResult.result.value}\n`);

    // Test 5: Query specific element
    console.log('6️⃣  Querying specific element...');
    const h1Result = await Runtime.evaluate({
      expression: 'document.querySelector("h1")?.textContent',
      returnByValue: true,
    });
    if (h1Result.result.value) {
      console.log(`   ✅ H1 content: "${h1Result.result.value}"\n`);
    } else {
      console.log('   ⚠️  No H1 element found\n');
    }

    console.log('✅ All tests passed!\n');
    console.log('📊 Summary:');
    console.log('   - CDP Connection: ✅');
    console.log('   - Page Navigation: ✅');
    console.log('   - DOM Query: ✅');
    console.log('   - JavaScript Execution: ✅');
    console.log('   - Element Query: ✅\n');

    return true;
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure Athena browser is running with CDP enabled on port', port);
      console.error('   The browser should be started with remote_debugging_port set to', port);
    }
    return false;
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Connection closed\n');
    }
  }
}

// Run the test
testCDPIntegration()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
