const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  // From the HTML, the iframe src is:
  // https://player.hanime.tv/?&#v2,1294,asa-kara-zusshiri-milk-pot-2,https%3A%2F%2Fhanime-cdn.com%2Fimages%2Fposters%2Fasa-kara-zusshiri-milk-pot-2-tfjuN.jpg,no
  // The format is: #v2,{id},{slug},{poster_url},{autoplay}
  
  // Test 1: Fetch the player iframe HTML
  const playerUrl = "https://player.hanime.tv/?&#v2,1294,asa-kara-zusshiri-milk-pot-2,https%3A%2F%2Fhanime-cdn.com%2Fimages%2Fposters%2Fasa-kara-zusshiri-milk-pot-2-tfjuN.jpg,no";
  console.log("=== Test 1: Player iframe ===");
  const r1 = await fetch(playerUrl, {
    headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
  });
  const h1 = await r1.text();
  console.log("Status:", r1.status, "Len:", h1.length);
  
  // Look for video URLs
  const m3u8s = h1.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/g) || [];
  console.log("M3U8s:", m3u8s.length);
  m3u8s.forEach(u => console.log(" ", u.slice(0, 200)));
  
  const mp4s = h1.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/g) || [];
  console.log("MP4s:", mp4s.length);
  mp4s.forEach(u => console.log(" ", u.slice(0, 200)));
  
  // Look for API endpoints or video data
  const apiUrls = h1.match(/https?:\/\/[^\s"'\\]*(?:api|video|stream|cdn)[^\s"'\\]*/gi) || [];
  console.log("\nAPI/CDN URLs:", apiUrls.length);
  [...new Set(apiUrls)].forEach(u => console.log(" ", u.slice(0, 200)));
  
  // Show script content
  const scripts = h1.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  console.log("\nScripts:", scripts.length);
  for (const s of scripts) {
    const inner = s.replace(/<\/?script[^>]*>/gi, "").trim();
    if (inner.length > 10) {
      console.log(`\n--- Script (${inner.length} chars) ---`);
      console.log(inner.slice(0, 800));
    }
  }

  // Test 2: Try hanime.tv API — many sites have a public API
  console.log("\n\n=== Test 2: hanime.tv API ===");
  const slug = "asa-kara-zusshiri-milk-pot-2";
  
  // Try common API patterns
  const apiEndpoints = [
    `https://hanime.tv/api/v8/video?id=${slug}`,
    `https://hw.hanime.tv/api/v8/video?id=${slug}`,
    `https://hanime.tv/rapi/v7/video?id=${slug}`,
    `https://hw.hanime.tv/rapi/v7/video?id=${slug}`,
    `https://members.hanime.tv/rapi/v7/video?id=${slug}`,
  ];
  
  for (const endpoint of apiEndpoints) {
    try {
      const r = await fetch(endpoint, {
        headers: { 
          "User-Agent": UA, 
          "Accept": "application/json",
          "Referer": "https://hanime.tv/",
          "Origin": "https://hanime.tv",
          "X-Signature-Version": "web2",
        },
      });
      console.log(`${endpoint.slice(0, 80)} => ${r.status}`);
      if (r.status === 200) {
        const text = await r.text();
        console.log("  Length:", text.length);
        // Try to parse as JSON
        try {
          const data = JSON.parse(text);
          if (data.videos_manifest || data.server_data || data.hentai_video) {
            console.log("  Keys:", Object.keys(data).join(", "));
            if (data.videos_manifest) {
              console.log("  videos_manifest:", JSON.stringify(data.videos_manifest).slice(0, 500));
            }
            if (data.hentai_video?.server_url) {
              console.log("  server_url:", data.hentai_video.server_url);
            }
          } else {
            console.log("  Keys:", Object.keys(data).join(", "));
            console.log("  Preview:", text.slice(0, 300));
          }
        } catch {
          console.log("  Not JSON, preview:", text.slice(0, 300));
        }
      }
    } catch (e) {
      console.log(`${endpoint.slice(0, 80)} => ERROR: ${e.message?.slice(0, 80)}`);
    }
  }
  
  // Test 3: Check the __NUXT__ data from the main page for video server info
  console.log("\n\n=== Test 3: Main page __NUXT__ data ===");
  const mainResp = await fetch(`https://hanime.tv/videos/hentai/${slug}`, {
    headers: { "User-Agent": UA },
  });
  const mainHtml = await mainResp.text();
  
  // Extract __NUXT__ data
  const nuxtMatch = mainHtml.match(/window\.__NUXT__\s*=\s*\(function\([\s\S]*?\)\s*\{([\s\S]*?)\}\([\s\S]*?\)\);/);
  if (nuxtMatch) {
    const nuxtBody = nuxtMatch[1];
    // Look for server URLs, CDN URLs, video URLs
    const serverUrls = nuxtBody.match(/https?:\\u002F\\u002F[^\s"',}]+/g) || [];
    const videoServerUrls = serverUrls.filter(u => /video|stream|cdn|player|server/i.test(u));
    console.log("Video/server URLs in __NUXT__:", videoServerUrls.length);
    [...new Set(videoServerUrls)].slice(0, 10).forEach(u => console.log(" ", u.replace(/\\u002F/g, "/")));
    
    // Look for server_url pattern
    if (/server_url/i.test(nuxtBody)) {
      const serverMatch = nuxtBody.match(/server_url[^,}]*["']([^"']+)["']/);
      console.log("server_url found:", serverMatch?.[1]?.slice(0, 200));
    }
  } else {
    console.log("No __NUXT__ data found");
  }

  // Look for the video ID from the page
  const iframeSrc = mainHtml.match(/player\.hanime\.tv[^"']*/);
  console.log("Player iframe:", iframeSrc?.[0]?.slice(0, 200));
})();
