const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TEST_URL = "https://www.pornhub.com/view_video.php?viewkey=667c4e4dcb498";

(async () => {
  console.log("Fetching:", TEST_URL);
  
  const resp = await fetch(TEST_URL, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": "age_verified=1; accessAgeDisclaimerPH=1; accessPH=1; platform=pc; cookiesBannerSeen=1; hasVisited=1",
      "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    redirect: "follow",
  });

  console.log("Status:", resp.status);
  console.log("Final URL:", resp.url.slice(0, 120));
  console.log("Content-Type:", resp.headers.get("content-type"));
  
  const html = await resp.text();
  console.log("HTML length:", html.length);
  console.log("Title:", html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.slice(0, 80));

  // Check for key data structures
  console.log("\n=== DATA STRUCTURES ===");
  console.log("flashvars:", /flashvars/i.test(html));
  console.log("mediaDefinitions:", /mediaDefinitions/i.test(html));
  console.log("quality_\\d+p:", /quality_\d+p/i.test(html));
  console.log("playerObjList:", /playerObjList/i.test(html));
  console.log("videoUrl:", /videoUrl/i.test(html));
  
  // Extract video URLs
  const mp4s = html.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || [];
  console.log("\n=== MP4 URLs ===", mp4s.length);
  mp4s.forEach(u => console.log(" ", u.slice(0, 180)));
  
  const m3u8s = html.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || [];
  console.log("\n=== M3U8 URLs ===", m3u8s.length);
  m3u8s.forEach(u => console.log(" ", u.slice(0, 180)));

  // Extract mediaDefinitions if present
  const mdMatch = html.match(/mediaDefinitions\s*[:=]\s*(\[[\s\S]*?\])\s*[,;}\n]/);
  if (mdMatch) {
    console.log("\n=== mediaDefinitions ===");
    console.log(mdMatch[1].slice(0, 1000));
  }
  
  // Check for flashvars object
  const fvMatch = html.match(/flashvars\w*\s*=\s*({[\s\S]*?})\s*;/);
  if (fvMatch) {
    console.log("\n=== flashvars ===");
    console.log(fvMatch[1].slice(0, 1000));
  }
  
  // Show a snippet around any video-related scripts
  const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  console.log("\n=== Script blocks ===", scriptBlocks.length, "total");
  let videoScripts = 0;
  for (const block of scriptBlocks) {
    if (/video|media|player|quality|flashvar/i.test(block)) {
      videoScripts++;
      console.log(`\n--- Video-related script (${block.length} chars) ---`);
      console.log(block.slice(0, 500));
    }
  }
  console.log("Video-related scripts:", videoScripts);
})();
