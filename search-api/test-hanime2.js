const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

(async () => {
  const slug = "asa-kara-zusshiri-milk-pot-2";
  const r = await fetch(`https://hanime.tv/api/v8/video?id=${slug}`, {
    headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
  });
  const data = await r.json();
  
  console.log("player_base_url:", data.player_base_url);
  console.log("\nvideos_manifest servers:");
  
  for (const server of data.videos_manifest?.servers || []) {
    console.log(`\n  Server: ${server.name} (slug: ${server.slug}, id: ${server.id})`);
    for (const stream of server.streams || []) {
      console.log(`    ${stream.width}x${stream.height} ${stream.extension} ${stream.kind} — ${stream.filename} (${stream.filesize_mbs}MB)`);
      console.log(`    slug: ${stream.slug}`);
      console.log(`    url: ${data.player_base_url}${stream.slug}`);
    }
  }
  
  // Construct a full video URL and test it
  const server = data.videos_manifest?.servers?.[0];
  const stream = server?.streams?.[0];
  if (stream) {
    const videoUrl = `${data.player_base_url}${stream.slug}`;
    console.log("\n\nConstructed URL:", videoUrl);
    
    // HEAD check
    const headResp = await fetch(videoUrl, { 
      method: "HEAD",
      headers: { "User-Agent": UA, "Referer": "https://hanime.tv/" },
    });
    console.log("HEAD status:", headResp.status);
    console.log("Content-Type:", headResp.headers.get("content-type"));
    console.log("Content-Length:", headResp.headers.get("content-length"));
  }
})();
