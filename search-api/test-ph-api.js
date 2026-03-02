// PornHub's new Blazor SPA architecture serves video data through internal APIs.
// Let's try to find the video data endpoint by examining what the SPA fetches.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TEST_URL = "https://www.pornhub.com/view_video.php?viewkey=667c4e4dcb498";

(async () => {
  // First, let's examine the HTML more carefully for API endpoints and embedded data
  const resp = await fetch(TEST_URL, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1; platform=pc; cookiesBannerSeen=1",
    },
  });
  
  const html = await resp.text();
  
  // Look for ALL URLs in the page
  console.log("=== All phncdn URLs ===");
  const phnUrls = html.match(/https?:\/\/[^\s"'<>]+phncdn[^\s"'<>]*/gi) || [];
  phnUrls.forEach(u => console.log(" ", u.slice(0, 200)));
  
  // Look for video element and its attributes
  console.log("\n=== Video elements ===");
  const videoTags = html.match(/<video[\s\S]*?>/gi) || [];
  videoTags.forEach(t => console.log(t.slice(0, 500)));
  
  // Look for source elements
  console.log("\n=== Source elements ===");
  const sourceTags = html.match(/<source[^>]*>/gi) || [];
  sourceTags.forEach(t => console.log(t));
  
  // Look for any JSON data blocks
  console.log("\n=== Script content with video data ===");
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const s of scripts) {
    const inner = s.replace(/<\/?script[^>]*>/gi, "").trim();
    if (inner.length < 20) continue;
    // Show first 300 chars of each script that might have video data
    if (/video|mp4|m3u8|media|player|quality|cdn|phncdn/i.test(inner)) {
      console.log(`\n--- Script (${inner.length} chars) ---`);
      console.log(inner.slice(0, 500));
    }
  }
  
  // Look for og:video meta tag
  console.log("\n=== OG/Meta tags ===");
  const metaTags = html.match(/<meta[^>]*(?:video|player|embed)[^>]*>/gi) || [];
  metaTags.forEach(t => console.log(t.slice(0, 300)));
  
  // Look for _blazor related data
  console.log("\n=== Blazor/SPA data ===");
  const blazorData = html.match(/_blazor[^"'<>]*/gi) || [];
  blazorData.forEach(d => console.log(" ", d.slice(0, 200)));
  
  // Look for any JSON-LD
  console.log("\n=== JSON-LD ===");
  const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  jsonLd.forEach(j => console.log(j.slice(0, 500)));
  
  // Check for data attributes on the video container
  console.log("\n=== Video container/player divs ===");
  const playerDivs = html.match(/<div[^>]*(?:video|player|embed)[^>]*>/gi) || [];
  playerDivs.forEach(d => console.log(d.slice(0, 300)));
  
  // Try the embed URL approach - PornHub embed pages are often less protected
  console.log("\n\n=== TRYING EMBED URL ===");
  const viewkey = "667c4e4dcb498";
  const embedUrl = `https://www.pornhub.com/embed/${viewkey}`;
  console.log("Fetching:", embedUrl);
  
  const embedResp = await fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html",
      "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1",
    },
  });
  
  const embedHtml = await embedResp.text();
  console.log("Status:", embedResp.status, "Length:", embedHtml.length);
  console.log("Has flashvars:", /flashvars/i.test(embedHtml));
  console.log("Has mediaDefinitions:", /mediaDefinitions/i.test(embedHtml));
  console.log("Has quality:", /quality_\d+p/i.test(embedHtml));
  
  const embedMp4s = embedHtml.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || [];
  console.log("MP4 URLs:", embedMp4s.length);
  embedMp4s.forEach(u => console.log(" ", u.slice(0, 200)));
  
  const embedM3u8s = embedHtml.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || [];
  console.log("M3U8 URLs:", embedM3u8s.length);
  embedM3u8s.forEach(u => console.log(" ", u.slice(0, 200)));
  
  // Check for mediaDefinitions in embed
  const mdMatch = embedHtml.match(/mediaDefinitions\s*[:=]\s*(\[[\s\S]*?\])\s*[,;}\n]/);
  if (mdMatch) {
    console.log("\nmediaDefinitions found in embed!");
    console.log(mdMatch[1].slice(0, 1500));
  }
  
  // Check flashvars in embed
  const fvMatch = embedHtml.match(/flashvars\w*\s*=\s*({[\s\S]*?})\s*[;,\n]/);
  if (fvMatch) {
    console.log("\nflashvars found in embed!");
    console.log(fvMatch[1].slice(0, 1500));
  }
  
  // Show video-related scripts in embed
  const embedScripts = embedHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const s of embedScripts) {
    const inner = s.replace(/<\/?script[^>]*>/gi, "").trim();
    if (inner.length < 20) continue;
    if (/video|mp4|m3u8|media|player|quality|cdn|phncdn|flashvars|mediaDefinitions/i.test(inner)) {
      console.log(`\n--- Embed Script (${inner.length} chars) ---`);
      console.log(inner.slice(0, 800));
    }
  }
})();
