const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  // Test 1: PornHub embed page
  const viewkey = "667c4e4dcb498";
  const embedUrl = `https://www.pornhub.com/embed/${viewkey}`;
  console.log("=== Test 1: Embed URL ===");
  console.log("Fetching:", embedUrl);
  
  const r1 = await fetch(embedUrl, {
    headers: { "User-Agent": UA, "Accept": "text/html", "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1" },
  });
  const h1 = await r1.text();
  console.log("Status:", r1.status, "Len:", h1.length, "URL:", r1.url.slice(0, 100));
  console.log("flashvars:", /flashvars/i.test(h1));
  console.log("mediaDefinitions:", /mediaDefinitions/i.test(h1));
  
  const mp4s = h1.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || [];
  console.log("MP4s:", mp4s.length);
  mp4s.forEach(u => console.log(" ", u.slice(0, 180)));
  
  const m3u8s = h1.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || [];
  console.log("M3U8s:", m3u8s.length);
  m3u8s.forEach(u => console.log(" ", u.slice(0, 180)));

  // Show video-related script content
  const scripts = h1.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const s of scripts) {
    const inner = s.replace(/<\/?script[^>]*>/gi, "").trim();
    if (inner.length < 20) continue;
    if (/video|mp4|m3u8|media|player|quality|flashvar|phncdn/i.test(inner)) {
      console.log(`\n--- Script (${inner.length} chars) ---`);
      console.log(inner.slice(0, 600));
    }
  }

  // Test 2: Try pornhub.com/video/search API (to verify connectivity)
  console.log("\n\n=== Test 2: og:video meta ===");
  const ogVideo = h1.match(/<meta[^>]*property=["']og:video[^"']*["'][^>]*content=["']([^"']+)["']/i);
  console.log("og:video:", ogVideo?.[1]?.slice(0, 200) || "none");
  
  const ogVideoUrl = h1.match(/<meta[^>]*property=["']og:video:url["'][^>]*content=["']([^"']+)["']/i);
  console.log("og:video:url:", ogVideoUrl?.[1]?.slice(0, 200) || "none");

  // Show ALL video/source tags
  console.log("\n=== Video/Source tags ===");
  const videoTags = h1.match(/<video[\s\S]*?<\/video>/gi) || [];
  videoTags.forEach(t => console.log(t.slice(0, 500)));
  
  if (!videoTags.length) {
    const vTag = h1.match(/<video[^>]*>/gi) || [];
    vTag.forEach(t => console.log(t));
  }
  
  const srcTags = h1.match(/<source[^>]*>/gi) || [];
  srcTags.forEach(t => console.log(t));
})();
