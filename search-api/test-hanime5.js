const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  // Fetch the player app JS to understand URL construction
  const jsUrl = "https://player.hanime.tv/js/app.9ffad1a7.js";
  const r = await fetch(jsUrl, { headers: { "User-Agent": UA } });
  const js = await r.text();
  console.log("JS length:", js.length);
  
  // Search for URL construction patterns around "m3u8" or "stream" or "hls"
  // Find all occurrences of these keywords with surrounding context
  const keywords = ["m3u8", "stream.m3u8", "hls", "server_url", "video_stream_group", "slug", "freeanimehentai", "cdn"];
  
  for (const kw of keywords) {
    const idx = js.indexOf(kw);
    if (idx !== -1) {
      // Show 300 chars of context around each occurrence
      const start = Math.max(0, idx - 150);
      const end = Math.min(js.length, idx + 150);
      console.log(`\n=== "${kw}" at index ${idx} ===`);
      console.log(js.slice(start, end));
    }
    
    // Find ALL occurrences
    let searchIdx = 0;
    let count = 0;
    while (count < 3) {
      const found = js.indexOf(kw, searchIdx);
      if (found === -1) break;
      if (count === 0) {
        // Already printed first one above
      } else {
        const s = Math.max(0, found - 100);
        const e = Math.min(js.length, found + 100);
        console.log(`  occurrence ${count + 1} at ${found}: ...${js.slice(s, e)}...`);
      }
      searchIdx = found + 1;
      count++;
    }
  }
  
  // Also look for template literal URL construction
  const templateUrls = [];
  const regex = /`[^`]*\$\{[^}]*\}[^`]*`/g;
  let match;
  while ((match = regex.exec(js)) !== null) {
    const val = match[0];
    if (/video|stream|hls|m3u8|server|cdn|url/i.test(val)) {
      templateUrls.push({ index: match.index, value: val });
    }
  }
  console.log("\n=== Template literal URLs ===");
  templateUrls.forEach(t => console.log(`  at ${t.index}: ${t.value.slice(0, 300)}`));
  
  // Look for string concatenation with + operator near video keywords  
  const concatPattern = /["'][^"']*(?:video|stream|hls|cdn)[^"']*["']\s*\+/gi;
  let cm;
  console.log("\n=== String concatenation patterns ===");
  while ((cm = concatPattern.exec(js)) !== null) {
    const ctx = js.slice(Math.max(0, cm.index - 50), Math.min(js.length, cm.index + 200));
    console.log(`  at ${cm.index}: ${ctx}`);
  }
})();
