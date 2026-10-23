// Test script to verify AI emits ACTION:IMAGE for image requests
// Run with: node test-ai-image-action.js

const testQueries = [
  "show me cowgirl gifs",
  "send me images of cats",
  "get me some fanart of eevee",
  "find wallpapers of nature",
  "I want photos of dogs",
];

const API_URL = "http://localhost:3000/api/chat";
const fs = require('fs');
const path = require('path');

// Read the system prompt from core.txt
const systemPrompt = fs.readFileSync(
  path.join(__dirname, 'src/app/prompts/core.txt'),
  'utf8'
);

async function testQuery(query) {
  console.log(`\nTesting: "${query}"`);
  console.log("=".repeat(60));

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: query }
        ],
        systemPrompt: systemPrompt,
      }),
    });

    if (!response.ok) {
      console.log(`❌ Request failed: ${response.status}`);
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
    }

    // Parse SSE format to extract actual content
    const lines = fullResponse.split('\n');
    let actualContent = "";
    for (const line of lines) {
      const trimmed = line.replace(/^\s*data: /, "").trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      try {
        const json = JSON.parse(trimmed);
        if (json.content) {
          actualContent += json.content;
        }
      } catch {
        // skip malformed lines
      }
    }

    // Check for ACTION:IMAGE in the actual content
    const hasImageAction = /\[ACTION:IMAGE:/i.test(actualContent);
    const hasSearchAction = /\[ACTION:SEARCH:/i.test(actualContent);

    console.log(`Response length: ${fullResponse.length} chars`);
    console.log(`Has ACTION:IMAGE: ${hasImageAction ? "✓ YES" : "✗ NO"}`);
    console.log(`Has ACTION:SEARCH: ${hasSearchAction ? "✗ YES (WRONG)" : "✓ NO"}`);

    // Extract the action if present
    const imageMatch = actualContent.match(/\[ACTION:IMAGE:([^\]]+)\]/i);
    const searchMatch = actualContent.match(/\[ACTION:SEARCH:([^\]]+)\]/i);

    if (imageMatch) {
      console.log(`✓ ACTION:IMAGE query: "${imageMatch[1].trim()}"`);
    }
    if (searchMatch) {
      console.log(`✗ ACTION:SEARCH query: "${searchMatch[1].trim()}" (should be IMAGE)`);
    }

    // Show first 200 chars of actual content for context
    console.log(`\nResponse preview:`);
    console.log(actualContent.slice(0, 200) + (actualContent.length > 200 ? "..." : ""));

    return hasImageAction && !hasSearchAction;
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log("AI Response Test - ACTION:IMAGE Detection");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const query of testQueries) {
    const result = await testQuery(query);
    if (result) {
      passed++;
      console.log(`✓ PASSED`);
    } else {
      failed++;
      console.log(`✗ FAILED`);
    }

    // Wait longer between tests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${testQueries.length} tests`);

  if (failed === 0) {
    console.log("✓ All tests passed!");
    process.exit(0);
  } else {
    console.log("✗ Some tests failed - AI still using ACTION:SEARCH for images");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Test error:", error);
  process.exit(1);
});
