/**
 * Test: hanime.tv video extraction
 * 
 * hanime.tv architecture:
 * - Main page has <iframe src="https://player.hanime.tv/?&#v2,ID,SLUG,...">
 * - Player iframe uses videojs with blob: URL
 * - blob: is fed by m3u8/mp4 stream fetched via XHR/fetch
 * - Network interception catches requests from ALL frames (including iframes)
 * 
 * Strategy:
 * 1. Try hanime.tv API first (fastest, no browser needed)
 * 2. If API fails, use Puppeteer with network interception
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const TEST_URL = "https://hanime.tv/videos/hentai/asa-kara-zusshiri-milk-pot-2";
const TEST_SLUG = "asa-kara-zusshiri-milk-pot-2";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Strategy 1: hanime.tv API
async function tryHanimeAPI(slug) {
  console.log("\n=== Strategy 1: hanime.tv API ===");
  try {
    const apiUrl = `https://hanime.tv/api/v8/video?id=${slug}`;
    console.log(`Fetching: ${apiUrl}`);
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "X-Signature-Version": "web2",
        "X-Signature": "null",
      },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!res.ok) {
      console.log(`API returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    console.log("API response keys:", Object.keys(data));
    
    // Look for video server URLs
    if (data.videos_manifest) {
      console.log("videos_manifest:", JSON.stringify(data.videos_manifest, null, 2).slice(0, 2000));
    }
    if (data.hentai_video) {
      const vid = data.hentai_video;
      console.log("Video:", vid.name, "| slug:", vid.slug);
      if (vid.server_id !== undefined) console.log("server_id:", vid.server_id);
    }
    
    // Extract server URLs
    const servers = data.videos_manifest?.servers || [];
    const videos = [];
    for (const server of servers) {
      console.log(`\nServer: ${server.name} (id: ${server.id})`);
      for (const stream of (server.streams || [])) {
        console.log(`  Stream: ${stream.height}p | url: ${stream.url?.slice(0, 100)}...`);
        if (stream.url) {
          videos.push({
            url: stream.url,
            quality: `${stream.height}p`,
            width: stream.width,
            height: stream.height,
            source: "hanime-api",
          });
        }
      }
    }
    
    if (videos.length > 0) {
      console.log(`\n✅ Found ${videos.length} video URLs via API`);
      return videos;
    }
    
    console.log("No video URLs in API response");
    return null;
  } catch (err) {
    console.log(`API error: ${err.message}`);
    return null;
  }
}

// Strategy 2: Puppeteer network interception on main page
async function tryPuppeteerMainPage(url) {
  console.log("\n=== Strategy 2: Puppeteer main page ===");
  let browser, page;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Track ALL network requests
    const allRequests = [];
    const videoUrls = [];
    const seenUrls = new Set();
    
    await page.setRequestInterception(true);
    
    page.on("request", (request) => {
      const reqUrl = request.url();
      const type = request.resourceType();
      
      // Log video-related requests
      if (type === "media" || /\.m3u8|\.mp4|\.webm|\.ts\b|\.mpd/i.test(reqUrl)) {
        console.log(`  [NET:${type}] ${reqUrl.slice(0, 150)}`);
        if (!seenUrls.has(reqUrl)) {
          seenUrls.add(reqUrl);
          videoUrls.push({ url: reqUrl, source: "network", type });
        }
      }
      
      // Log XHR/fetch that look like video manifests
      if ((type === "xhr" || type === "fetch") && /m3u8|manifest|stream|video|mp4|playlist/i.test(reqUrl)) {
        console.log(`  [XHR:${type}] ${reqUrl.slice(0, 150)}`);
        if (!seenUrls.has(reqUrl)) {
          seenUrls.add(reqUrl);
          videoUrls.push({ url: reqUrl, source: "xhr", type });
        }
      }
      
      // Block ads
      if (/adtng|afcpatrk|aftrk|exoclick|trafficjunky|adsterra/i.test(reqUrl)) {
        request.abort();
        return;
      }
      
      request.continue();
    });
    
    page.on("response", async (response) => {
      try {
        const respUrl = response.url();
        const ct = response.headers()["content-type"] || "";
        if (/video\/|mpegurl|dash\+xml/i.test(ct)) {
          console.log(`  [RESP] ${ct} -> ${respUrl.slice(0, 150)}`);
          if (!seenUrls.has(respUrl)) {
            seenUrls.add(respUrl);
            videoUrls.push({ url: respUrl, source: "response", contentType: ct });
          }
        }
      } catch {}
    });
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {
      console.log("networkidle2 timed out, continuing...");
    });
    
    // Wait for player iframe to load
    console.log("Waiting 5s for player iframe...");
    await new Promise(r => setTimeout(r, 5000));
    
    // Check for iframe
    const iframeSrc = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="player.hanime"]');
      return iframe ? iframe.src : null;
    });
    console.log("Player iframe src:", iframeSrc);
    
    // Try to access frames
    const frames = page.frames();
    console.log(`Page has ${frames.length} frames`);
    for (const frame of frames) {
      console.log(`  Frame: ${frame.url().slice(0, 100)}`);
    }
    
    // Try to find video in player frame
    for (const frame of frames) {
      if (frame.url().includes("player.hanime")) {
        console.log("\nFound player frame, checking for video...");
        try {
          const videoSrc = await frame.evaluate(() => {
            const v = document.querySelector("video");
            return {
              src: v?.src || null,
              currentSrc: v?.currentSrc || null,
              sources: Array.from(document.querySelectorAll("source")).map(s => ({ src: s.src, type: s.type })),
            };
          });
          console.log("Video element:", JSON.stringify(videoSrc));
        } catch (e) {
          console.log("Cannot access player frame (cross-origin):", e.message);
        }
      }
    }
    
    if (videoUrls.length > 0) {
      console.log(`\n✅ Found ${videoUrls.length} video URLs via network interception:`);
      videoUrls.forEach(v => console.log(`  ${v.source}: ${v.url.slice(0, 150)}`));
      return videoUrls;
    }
    
    console.log("\n❌ No video URLs found via main page network interception");
    return null;
  } catch (err) {
    console.error("Puppeteer error:", err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Strategy 3: Navigate directly to player iframe URL
async function tryPlayerDirect(slug) {
  console.log("\n=== Strategy 3: Direct player iframe navigation ===");
  // The iframe URL format: https://player.hanime.tv/?&#v2,ID,SLUG,POSTER_URL,no
  // We can construct it or just use the pattern
  const playerUrl = `https://player.hanime.tv/?&#v2,0,${slug},about:blank,no`;
  
  let browser, page;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
    await page.setUserAgent(UA);
    
    // Inject blob tracking BEFORE navigation
    await page.evaluateOnNewDocument(() => {
      window.__capturedStreamUrls = [];
      
      const origXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          const urlStr = typeof url === 'string' ? url : String(url);
          if (/\.m3u8|\.mp4|\.webm|master\.|playlist\.|manifest|mpegurl|\/hls\//i.test(urlStr.toLowerCase())) {
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
            window.__capturedStreamUrls.push({ url: fullUrl, source: 'xhr' });
            console.log('[BLOB-TRACK] XHR:', fullUrl);
          }
        } catch(e) {}
        return origXHROpen.apply(this, arguments);
      };
      
      const origFetch = window.fetch;
      window.fetch = function(input) {
        try {
          const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
          if (urlStr && /\.m3u8|\.mp4|\.webm|master\.|playlist\.|manifest|mpegurl|\/hls\//i.test(urlStr.toLowerCase())) {
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
            window.__capturedStreamUrls.push({ url: fullUrl, source: 'fetch' });
            console.log('[BLOB-TRACK] fetch:', fullUrl);
          }
        } catch(e) {}
        return origFetch.apply(this, arguments);
      };
    });
    
    const videoUrls = [];
    const seenUrls = new Set();
    
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      const type = req.resourceType();
      
      if (type === "media" || /\.m3u8|\.mp4|\.webm|\.ts\b|\.mpd/i.test(reqUrl)) {
        console.log(`  [NET:${type}] ${reqUrl.slice(0, 200)}`);
        if (!seenUrls.has(reqUrl)) {
          seenUrls.add(reqUrl);
          videoUrls.push({ url: reqUrl, source: "network" });
        }
      }
      
      if ((type === "xhr" || type === "fetch") && /m3u8|manifest|stream|video.*url|playlist/i.test(reqUrl)) {
        console.log(`  [XHR] ${reqUrl.slice(0, 200)}`);
        if (!seenUrls.has(reqUrl)) {
          seenUrls.add(reqUrl);
          videoUrls.push({ url: reqUrl, source: "xhr" });
        }
      }
      
      if (/adtng|afcpatrk|aftrk|exoclick/i.test(reqUrl)) {
        req.abort();
        return;
      }
      req.continue();
    });
    
    page.on("response", async (resp) => {
      try {
        const ct = resp.headers()["content-type"] || "";
        const respUrl = resp.url();
        if (/video\/|mpegurl|dash\+xml/i.test(ct)) {
          console.log(`  [RESP] ${ct} -> ${respUrl.slice(0, 200)}`);
          if (!seenUrls.has(respUrl)) {
            seenUrls.add(respUrl);
            videoUrls.push({ url: respUrl, source: "response" });
          }
        }
      } catch {}
    });
    
    console.log(`Navigating to player: ${playerUrl}`);
    await page.goto(playerUrl, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {
      console.log("networkidle2 timed out");
    });
    
    // Wait for video to start
    console.log("Waiting 5s for video to load...");
    await new Promise(r => setTimeout(r, 5000));
    
    // Check blob tracking captures
    const captured = await page.evaluate(() => window.__capturedStreamUrls || []);
    console.log("Blob tracking captured:", captured.length, "URLs");
    for (const c of captured) {
      console.log(`  [CAPTURED] ${c.source}: ${c.url.slice(0, 200)}`);
      if (!seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        videoUrls.push({ url: c.url, source: `blob-${c.source}` });
      }
    }
    
    // Check video element
    const videoInfo = await page.evaluate(() => {
      const v = document.querySelector("video");
      if (!v) return null;
      return {
        src: v.src,
        currentSrc: v.currentSrc,
        readyState: v.readyState,
        paused: v.paused,
        duration: v.duration,
      };
    });
    console.log("Video element:", JSON.stringify(videoInfo));
    
    // Try clicking play
    try {
      await page.click("video");
      await new Promise(r => setTimeout(r, 3000));
      
      const captured2 = await page.evaluate(() => window.__capturedStreamUrls || []);
      for (const c of captured2) {
        if (!seenUrls.has(c.url)) {
          console.log(`  [CAPTURED-POST-CLICK] ${c.source}: ${c.url.slice(0, 200)}`);
          seenUrls.add(c.url);
          videoUrls.push({ url: c.url, source: `blob-${c.source}` });
        }
      }
    } catch {}
    
    if (videoUrls.length > 0) {
      console.log(`\n✅ Found ${videoUrls.length} video URLs via direct player:`);
      videoUrls.forEach(v => console.log(`  ${v.source}: ${v.url.slice(0, 200)}`));
      return videoUrls;
    }
    
    console.log("\n❌ No video URLs from direct player");
    return null;
  } catch (err) {
    console.error("Direct player error:", err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// Run all strategies
async function main() {
  console.log("Testing hanime.tv video extraction");
  console.log("URL:", TEST_URL);
  console.log("Slug:", TEST_SLUG);
  
  // Strategy 1: API
  let videos = await tryHanimeAPI(TEST_SLUG);
  if (videos && videos.length > 0) {
    console.log("\n🎉 SUCCESS via API");
    process.exit(0);
  }
  
  // Strategy 2: Puppeteer main page  
  videos = await tryPuppeteerMainPage(TEST_URL);
  if (videos && videos.length > 0) {
    console.log("\n🎉 SUCCESS via main page network interception");
    process.exit(0);
  }
  
  // Strategy 3: Direct player navigation
  videos = await tryPlayerDirect(TEST_SLUG);
  if (videos && videos.length > 0) {
    console.log("\n🎉 SUCCESS via direct player");
    process.exit(0);
  }
  
  console.log("\n💀 ALL STRATEGIES FAILED");
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
