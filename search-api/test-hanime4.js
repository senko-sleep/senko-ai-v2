const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  const slug = "asa-kara-zusshiri-milk-pot-2";
  const apiResp = await fetch(`https://hanime.tv/api/v8/video?id=${slug}`, {
    headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
  });
  const apiData = await apiResp.json();
  
  // The stream URL field is the key
  const server = apiData.videos_manifest?.servers?.[0];
  const stream = server?.streams?.[0];
  console.log("Stream URL:", stream?.url);
  console.log("Stream group:", stream?.video_stream_group_id);
  console.log("Filename:", stream?.filename);
  
  // Try the URL directly
  const directUrl = stream?.url;
  if (directUrl) {
    console.log("\n=== Testing direct URL ===");
    const r = await fetch(directUrl, {
      method: "HEAD",
      headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
    });
    console.log(`${directUrl} => ${r.status} ${r.headers.get("content-type") || ""}`);
  }
  
  // Try constructing URL with video_stream_group_id
  const patterns = [
    `https://streamable.cloud/hls/${slug}/stream.m3u8`,
    `https://streamable.cloud/hls/${slug}/master.m3u8`,
    `https://streamable.cloud/${slug}/stream.m3u8`,
    `https://streamable.cloud/hls/stream.m3u8?id=${slug}`,
    stream?.url, // direct
  ];
  
  console.log("\n=== Testing URL patterns ===");
  for (const url of patterns) {
    if (!url) continue;
    try {
      const r = await fetch(url, {
        method: "HEAD",  
        headers: { "User-Agent": UA, "Referer": "https://hanime.tv/", "Origin": "https://hanime.tv" },
        redirect: "follow",
      });
      console.log(`${url.slice(0, 80)} => ${r.status} ct:${(r.headers.get("content-type") || "").slice(0, 40)} len:${r.headers.get("content-length") || "?"}`);
      if (r.status === 200 || r.status === 206) {
        // GET a small chunk to verify it's real video data
        const r2 = await fetch(url, {
          headers: { "User-Agent": UA, "Referer": "https://hanime.tv/", "Range": "bytes=0-200" },
        });
        const text = await r2.text();
        console.log(`  First 200 bytes: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`${url.slice(0, 80)} => ERROR: ${e.message?.slice(0, 60)}`);
    }
  }
})();
