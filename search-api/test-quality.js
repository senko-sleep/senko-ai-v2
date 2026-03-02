// Test if we can derive higher quality URLs from the 240P fallback
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  // The 240P URL pattern from PornHub
  const base240 = "https://em.phncdn.com/videos/202305/01/430658121/230501_1401_240P_1000K_430658121.mp4";
  
  // Quality variants to try — PornHub uses these common patterns
  const qualities = [
    { q: "1080P", k: "8000K" },
    { q: "720P", k: "4000K" },
    { q: "480P", k: "2000K" },
    { q: "360P", k: "1500K" },
  ];

  // First fetch the page to get fresh auth params
  const resp = await fetch("https://www.pornhub.com/view_video.php?viewkey=667c4e4dcb498", {
    headers: { "User-Agent": UA, "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1" },
  });
  const html = await resp.text();
  const mp4Match = html.match(/https?:\/\/em\.phncdn\.com\/videos\/[^\s"'&]+\.mp4\?[^\s"'&]+(?:&amp;[^\s"']+)*/);
  if (!mp4Match) { console.log("No MP4 found in HTML"); return; }
  
  const fullUrl = mp4Match[0].replace(/&amp;/g, "&");
  console.log("Base 240P URL:", fullUrl.slice(0, 150));
  
  // Parse URL parts
  const urlObj = new URL(fullUrl);
  const path = urlObj.pathname;
  const search = urlObj.search;
  
  console.log("Path:", path);
  console.log("Auth params:", search.slice(0, 100));
  
  // Try to construct quality variants
  for (const { q, k } of qualities) {
    const newPath = path.replace(/\d+P_\d+K/i, `${q}_${k}`);
    const newUrl = `${urlObj.origin}${newPath}${search}`;
    
    try {
      const r = await fetch(newUrl, {
        method: "HEAD",
        headers: {
          "User-Agent": UA,
          "Referer": "https://www.pornhub.com/",
          "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1",
        },
      });
      console.log(`${q}: status=${r.status} size=${r.headers.get("content-length") || "?"}`);
      if (r.status === 200 || r.status === 206) {
        console.log(`  ✓ WORKS: ${newUrl.slice(0, 150)}`);
      }
    } catch (e) {
      console.log(`${q}: error - ${e.message}`);
    }
  }
  
  // Also try without auth params (some CDNs don't need them for HEAD)
  console.log("\n--- Without auth params ---");
  for (const { q, k } of qualities) {
    const newPath = path.replace(/\d+P_\d+K/i, `${q}_${k}`);
    const newUrl = `${urlObj.origin}${newPath}`;
    
    try {
      const r = await fetch(newUrl, {
        method: "HEAD",
        headers: { "User-Agent": UA, "Referer": "https://www.pornhub.com/" },
      });
      console.log(`${q}: status=${r.status}`);
    } catch (e) {
      console.log(`${q}: error`);
    }
  }
  
  // Also test: does yt-dlp exist on this system?
  console.log("\n--- yt-dlp check ---");
  const { execSync } = require("child_process");
  try {
    const ver = execSync("yt-dlp --version", { timeout: 5000 }).toString().trim();
    console.log("yt-dlp version:", ver);
    
    // If yt-dlp exists, try extracting
    const result = execSync(
      `yt-dlp --dump-json --no-download "https://www.pornhub.com/view_video.php?viewkey=667c4e4dcb498"`,
      { timeout: 30000 }
    ).toString();
    const data = JSON.parse(result);
    console.log("Title:", data.title);
    console.log("Formats:", data.formats?.length);
    data.formats?.forEach(f => {
      if (f.ext === "mp4" || f.ext === "webm") {
        console.log(` ${f.format_id}: ${f.ext} ${f.width}x${f.height} ${f.url?.slice(0, 100)}`);
      }
    });
  } catch (e) {
    console.log("yt-dlp not available:", e.message?.slice(0, 100));
  }
})();
