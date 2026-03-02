const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  // Fetch the player page HTML to find the JS that constructs URLs
  const playerUrl = "https://player.hanime.tv/";
  const r1 = await fetch(playerUrl, {
    headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
  });
  const playerHtml = await r1.text();
  console.log("=== Player HTML ===");
  console.log(playerHtml);
  
  // Also check the script files loaded by the player
  const scriptSrcs = playerHtml.match(/src=["']([^"']+)["']/gi) || [];
  console.log("\n=== Script sources ===");
  scriptSrcs.forEach(s => console.log(s));
  
  // Fetch the player JS
  for (const src of scriptSrcs) {
    const url = src.replace(/^src=["']|["']$/g, "");
    if (url.includes("player") || url.includes("hanime") || url.includes("app")) {
      console.log(`\n=== Fetching: ${url} ===`);
      try {
        const fullUrl = url.startsWith("http") ? url : `https://player.hanime.tv${url}`;
        const r = await fetch(fullUrl, { headers: { "User-Agent": UA } });
        const js = await r.text();
        console.log(`Length: ${js.length}`);
        
        // Look for URL construction patterns
        const urlPatterns = js.match(/(?:m3u8|stream|video|server|cdn|player_base|manifest|hls)[^;]{0,200}/gi) || [];
        console.log("Video-related patterns:", urlPatterns.length);
        [...new Set(urlPatterns)].slice(0, 20).forEach(p => console.log("  ", p.slice(0, 150)));
        
        // Look for fetch/axios calls
        const fetchCalls = js.match(/(?:axios|fetch|get|post)\s*\([^)]*(?:api|video|server|stream)[^)]*\)/gi) || [];
        console.log("API calls:", fetchCalls.length);
        fetchCalls.slice(0, 10).forEach(f => console.log("  ", f.slice(0, 200)));
      } catch (e) {
        console.log("Error:", e.message?.slice(0, 100));
      }
    }
  }
  
  // Also try the known CDN patterns for hanime
  console.log("\n=== Testing direct CDN URLs ===");
  const cdnPatterns = [
    "https://weserv.nl/?url=https://hanime-cdn.com/hentai-videos/asa-kara-zusshiri-milk-pot-2/stream.m3u8",
    "https://h.freeanimehentai.net/videos/hentai/asa-kara-zusshiri-milk-pot-2/stream.m3u8",
    "https://cached.freeanimehentai.net/videos/hentai/asa-kara-zusshiri-milk-pot-2/stream.m3u8",
    "https://hanime-cdn.com/videos/hentai/asa-kara-zusshiri-milk-pot-2/stream.m3u8",
  ];
  
  for (const url of cdnPatterns) {
    try {
      const r = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
      });
      console.log(`${url.slice(0, 100)} => ${r.status} ${r.headers.get("content-type") || ""}`);
    } catch (e) {
      console.log(`${url.slice(0, 100)} => ERROR`);
    }
  }
  
  // Fetch full API response with more detail on streams
  console.log("\n=== Full API stream data ===");
  const slug = "asa-kara-zusshiri-milk-pot-2";
  const apiResp = await fetch(`https://hanime.tv/api/v8/video?id=${slug}`, {
    headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
  });
  const apiData = await apiResp.json();
  
  // Print the hentai_video fields that might have URLs
  const hv = apiData.hentai_video;
  if (hv) {
    console.log("hentai_video.slug:", hv.slug);
    console.log("hentai_video.server_url:", hv.server_url || "none");
    for (const [k, v] of Object.entries(hv)) {
      if (typeof v === "string" && (v.includes("http") || v.includes("cdn") || v.includes("video") || v.includes("m3u8"))) {
        console.log(`  ${k}: ${v.slice(0, 200)}`);
      }
    }
  }
  
  // Print full streams data
  for (const server of apiData.videos_manifest?.servers || []) {
    for (const stream of server.streams || []) {
      console.log(`\nStream: ${stream.width}x${stream.height} ${stream.extension}`);
      for (const [k, v] of Object.entries(stream)) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
})();
