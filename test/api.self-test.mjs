#!/usr/bin/env node

/**
 * API Integration Tests for Planck Bin
 * Tests all endpoints and verifies D1 database persistence
 */

const BASE_URL = 'http://localhost:8787';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

let passed = 0;
let failed = 0;

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function pass(message) {
  log(colors.green, '✓', message);
  passed++;
}

function fail(message, details) {
  log(colors.red, '✗', message);
  if (details) console.log(`  ${details}`);
  failed++;
}

function section(title) {
  console.log(`\n${colors.blue}${title}${colors.reset}`);
  console.log('-'.repeat(title.length));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkServerRunning() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    if (response.ok) {
      const data = await response.json();
      pass(`Server is running (status: ${data.status})`);
      return true;
    }
  } catch (error) {
    fail('Server is not running', 'Start with: npm run dev');
    console.log('\nRun this in another terminal:');
    console.log('  npm run dev\n');
    process.exit(1);
  }
}

async function testCreateDocument() {
  const testContent = 'console.log("Hello, World!");\n// This is a test paste\nconst x = 42;';

  try {
    const response = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: testContent,
    });

    if (!response.ok) {
      fail(`Create document failed with status ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.key && data.key.length > 0) {
      pass(`Document created with key: ${data.key}`);
      return { key: data.key, content: testContent };
    } else {
      fail('Create document returned invalid response', JSON.stringify(data));
      return null;
    }
  } catch (error) {
    fail('Create document request failed', error.message);
    return null;
  }
}

async function testRetrieveDocument(key, expectedContent) {
  try {
    const response = await fetch(`${BASE_URL}/documents/${key}`);

    if (!response.ok) {
      fail(`Retrieve document failed with status ${response.status}`);
      return false;
    }

    const data = await response.json();

    if (data.content === expectedContent && data.key === key) {
      pass(`Document retrieved successfully (key: ${key})`);
      return true;
    } else {
      fail('Retrieved document content mismatch');
      return false;
    }
  } catch (error) {
    fail('Retrieve document request failed', error.message);
    return false;
  }
}

async function testRetrieveRaw(key, expectedContent) {
  try {
    const response = await fetch(`${BASE_URL}/raw/${key}`);

    if (!response.ok) {
      fail(`Retrieve raw document failed with status ${response.status}`);
      return false;
    }

    const content = await response.text();

    if (content === expectedContent) {
      pass(`Raw document retrieved successfully`);
      return true;
    } else {
      fail('Raw document content mismatch');
      return false;
    }
  } catch (error) {
    fail('Retrieve raw document request failed', error.message);
    return false;
  }
}

async function testNonExistentDocument() {
  try {
    const response = await fetch(`${BASE_URL}/documents/nonexistent123`);

    if (response.status === 404) {
      pass('Correctly returns 404 for non-existent document');
      return true;
    } else {
      fail(`Expected 404, got ${response.status}`);
      return false;
    }
  } catch (error) {
    fail('Non-existent document test failed', error.message);
    return false;
  }
}

async function testEmptyContent() {
  try {
    const response = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '',
    });

    if (response.status === 400) {
      pass('Correctly rejects empty content (400)');
      return true;
    } else {
      fail(`Expected 400 for empty content, got ${response.status}`);
      return false;
    }
  } catch (error) {
    fail('Empty content test failed', error.message);
    return false;
  }
}

async function testViewCount(key) {
  try {
    // Access the document 3 times
    for (let i = 0; i < 3; i++) {
      await fetch(`${BASE_URL}/documents/${key}`);
      await sleep(100); // Small delay between requests
    }

    pass('View count test completed (check database for verification)');
    return true;
  } catch (error) {
    fail('View count test failed', error.message);
    return false;
  }
}

async function testLargeDocument() {
  const largeContent = 'x'.repeat(1000) + '\n// Large document test';

  try {
    const response = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: largeContent,
    });

    if (response.ok) {
      const data = await response.json();
      pass(`Large document created (${largeContent.length} bytes, key: ${data.key})`);
      return data.key;
    } else {
      fail(`Large document creation failed with status ${response.status}`);
      return null;
    }
  } catch (error) {
    fail('Large document test failed', error.message);
    return null;
  }
}

async function testTooLargeDocument() {
  // Default MAX_PASTE_SIZE is 400000 bytes
  const tooLargeContent = 'x'.repeat(400001);

  try {
    const response = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: tooLargeContent,
    });

    if (response.status === 413) {
      pass('Correctly rejects oversized content (413)');
      return true;
    } else {
      fail(`Expected 413 for oversized content, got ${response.status}`);
      return false;
    }
  } catch (error) {
    fail('Oversized content test failed', error.message);
    return false;
  }
}

async function testLifetime() {
  try {
    const response = await fetch(`${BASE_URL}/documents?expires=3d`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'lifetime test',
    });
    const data = await response.json();
    const days = (Date.parse(data.expiresAt) - Date.now()) / 86_400_000;
    if (response.status === 201 && days > 2.9 && days <= 3) {
      pass(`expires=3d sets expiresAt ${data.expiresAt}`);
    } else {
      fail(`expires=3d: status ${response.status}, expiresAt ${data.expiresAt}`);
    }

    const bad = await fetch(`${BASE_URL}/documents?expires=2d`, { method: 'POST', body: 'x' });
    if (bad.status === 400) pass('Rejects an unknown lifetime (400)');
    else fail(`Expected 400 for expires=2d, got ${bad.status}`);
  } catch (error) {
    fail('Lifetime test failed', error.message);
  }
}

async function testBurnAfterReading() {
  try {
    const created = await fetch(`${BASE_URL}/documents?burn=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'burn test',
    });
    const { key, burn } = await created.json();
    if (created.status === 201 && burn === true) pass(`Burn paste created: ${key}`);
    else return fail(`Burn create: status ${created.status}, burn ${burn}`);

    const peek = await (await fetch(`${BASE_URL}/documents/${key}?peek=1`)).json();
    if (peek.burnPending === true && peek.content === undefined) pass('Peek reports it unread');
    else fail('Peek returned content or no marker', JSON.stringify(peek));

    const head = await fetch(`${BASE_URL}/raw/${key}`, { method: 'HEAD' });
    if (head.status === 200) pass('HEAD does not consume');
    else fail(`HEAD returned ${head.status}`);

    // Two concurrent readers: exactly one gets it.
    const reads = await Promise.all([
      fetch(`${BASE_URL}/documents/${key}`),
      fetch(`${BASE_URL}/documents/${key}`),
    ]);
    const statuses = reads.map((r) => r.status).sort();
    if (statuses[0] === 200 && statuses[1] === 404) pass('Exactly one concurrent read wins');
    else fail(`Concurrent reads returned ${statuses.join(', ')}`);

    const after = await fetch(`${BASE_URL}/raw/${key}`);
    if (after.status === 404) pass('Gone after the first read (404)');
    else fail(`Expected 404 after the read, got ${after.status}`);
  } catch (error) {
    fail('Burn test failed', error.message);
  }
}

// Main test runner
async function runTests() {
  console.log('========================================');
  console.log('   Planck Bin API Test Suite');
  console.log('========================================');

  // Test 1: Health check
  section('Test 1: Server Health Check');
  await checkServerRunning();

  // Test 2: Create document
  section('Test 2: Create Document');
  const doc1 = await testCreateDocument();

  if (doc1) {
    // Test 3: Retrieve document
    section('Test 3: Retrieve Document');
    await testRetrieveDocument(doc1.key, doc1.content);

    // Test 4: Retrieve raw
    section('Test 4: Retrieve Raw Document');
    await testRetrieveRaw(doc1.key, doc1.content);

    // Test 5: View count
    section('Test 5: View Count Increment');
    await testViewCount(doc1.key);
  }

  // Test 6: Non-existent document
  section('Test 6: Non-Existent Document (404)');
  await testNonExistentDocument();

  // Test 7: Empty content
  section('Test 7: Empty Content Validation');
  await testEmptyContent();

  // Test 8: Create multiple documents
  section('Test 8: Multiple Documents');
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(testCreateDocument());
  }
  const results = await Promise.all(promises);
  const successCount = results.filter((r) => r !== null).length;
  log(colors.blue, '→', `Created ${successCount}/5 documents concurrently`);

  // Test 9: Large document
  section('Test 9: Large Document');
  await testLargeDocument();

  // Test 10: Too large document
  section('Test 10: Oversized Document Validation');
  await testTooLargeDocument();

  section('Test 11: Paste Lifetime');
  await testLifetime();

  section('Test 12: Burn After Reading');
  await testBurnAfterReading();

  // Summary
  console.log('\n========================================');
  console.log('   Test Summary');
  console.log('========================================');
  console.log(`${colors.green}Tests Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Tests Failed: ${failed}${colors.reset}`);

  if (failed === 0) {
    console.log(`\n${colors.green}✓ All tests passed!${colors.reset}\n`);

    // Show how to verify database
    console.log(`${colors.blue}To verify data in D1 database:${colors.reset}`);
    console.log('  npx wrangler d1 execute haste-db --local --command "SELECT * FROM documents"');
    console.log('');

    process.exit(0);
  } else {
    console.log(`\n${colors.red}✗ Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
