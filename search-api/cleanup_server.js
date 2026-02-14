const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

const functionStart = 'function extractRule34VideoContent(html, origin) {';
const functionEnd = '  return null;\n}';

// We know the function body is consistent.
// We will split the content by the functionStart.
const parts = content.split(functionStart);

if (parts.length > 2) {
    console.log(`Found ${parts.length - 1} occurrences. Cleaning up...`);
    // Keep the first part (preamble + DDG results)
    // Keep the last part (rest of file)
    // The middle parts contain the duplicate logic.

    // Actually, splitting removes the separator.
    // parts[0] is everything up to the first occurrence.
    // parts[1] starts with the body of the function.

    // We want to keep ONE occurrence.
    // Let's reconstruct.

    // But wait, the parts between occurrences might contain other functions (Google, Bing).
    // splitting by specific string is risky if they are interleaved.

    // Let's us regex to find all occurrences and their indices.

    const regex = /function extractRule34VideoContent[\s\S]*?return null;\r?\n}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length });
    }

    console.log(`Found ${matches.length} matches via regex.`);

    // We want to keep the last one (or any one). Let's keep the last one.
    // We will slice the content to exclude the others.
    // Work backwards to avoid index shifting.

    let newContent = content;
    for (let i = matches.length - 2; i >= 0; i--) {
        const m = matches[i];
        // Remove this block
        newContent = newContent.slice(0, m.start) + newContent.slice(m.end);

        // Also clean up potential extra newlines if needed, but not critical.
    }

    fs.writeFileSync(filePath, newContent);
    console.log("Cleanup done.");
} else {
    console.log("No duplicates found or only one occurrence.");
}
