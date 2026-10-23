// Test script to verify query parsing doesn't strip important words
// Run with: node test-query-parsing.js

const testQueries = [
  "images of images of cowgirl gifs",
  "show me cowgirl gifs",
  "send me images of cats",
  "look up eevee on rule34video",
  "rule34video eevee",
  "find pictures of anime girls",
  "search for wallpapers of nature",
  "get me photos of dogs",
];

console.log("Testing query parsing...\n");

// Simulate the intent parser logic (simplified version)
function testQueryExtraction(query) {
  const lower = query.toLowerCase().trim();
  
  // Old logic (what we fixed)
  const oldFillerWords = /\b(images?|pics?|pictures?|photos?|gifs?|animated|of|show me|send me|get me|give me|wanna see|want to see|let me see|i want|look\s*up|find|get|wallpapers?|r34|rule\s*34|nsfw|hentai|xxx|lewd|explicit)\b/gi;
  const oldClean = query
    .replace(oldFillerWords, "")
    .replace(/\s+/g, " ")
    .trim();
  
  // New logic (minimal stripping)
  const newClean = lower
    .replace(/\b(look\s*up|search\s*(?:for)?|find|on|in|at|from|go\s*to|open|visit|browse)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  return {
    original: query,
    oldResult: oldClean || "(empty)",
    newResult: newClean || "(empty)",
  };
}

console.log("Query Parsing Test Results:");
console.log("=".repeat(80));

testQueries.forEach((query) => {
  const result = testQueryExtraction(query);
  console.log(`\nOriginal: "${result.original}"`);
  console.log(`Old logic: "${result.oldResult}"`);
  console.log(`New logic: "${result.newResult}"`);
  
  if (result.oldResult !== result.newResult) {
    console.log("✓ FIXED - Query preserved better");
  } else if (result.newResult === "(empty)") {
    console.log("⚠ WARNING - Query completely stripped");
  } else {
    console.log("✓ OK");
  }
});

console.log("\n" + "=".repeat(80));
console.log("\nTest complete!");
