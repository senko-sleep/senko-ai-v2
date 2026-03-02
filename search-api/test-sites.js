// Test blob extraction on multiple sites to verify our fixes work
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function testExtraction(url) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${url}`);
  console.log("=".repeat(60));
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--mute-audio",
           "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1920, height: 1080 });

  // Inject blob tracking hooks
  await page.evaluateOnNewDocument(() => {
    window.__capturedStreamUrls = [];
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        const urlStr = typeof url === 'string' ? url : String(url);
        const lower = urlStr.toLowerCase();
        if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
          const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
          if (!window.__capturedStreamUrls.some(e => e.url === fullUrl)) {
            window.__capturedStreamUrls.push({ url: fullUrl, source: 'xhr',
              type: /\.m3u8|mpegurl/i.test(lower) ? 'application/x-mpegURL' :
                    /\.mpd|dash/i.test(lower) ? 'application/dash+xml' :
                    /\.mp4/i.test(lower) ? 'video/mp4' : /\.webm/i.test(lower) ? 'video/webm' : ''
            });
          }
        }
      } catch(e) {}
      return origXHROpen.apply(this, arguments);
    };
    const origFetch = window.fetch;
    window.fetch = function(input) {
      try {
        const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
        if (urlStr) {
          const lower = urlStr.toLowerCase();
          if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
            if (!window.__capturedStreamUrls.some(e => e.url === fullUrl)) {
              window.__capturedStreamUrls.push({ url: fullUrl, source: 'fetch',
                type: /\.m3u8|mpegurl/i.test(lower) ? 'application/x-mpegURL' :
                      /\.mpd|dash/i.test(lower) ? 'application/dash+xml' :
                      /\.mp4/i.test(lower) ? 'video/mp4' : /\.webm/i.test(lower) ? 'video/webm' : ''
              });
            }
          }
        }
      } catch(e) {}
      return origFetch.apply(this, arguments);
    };
  });

  // Age gate cookies
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    await page.setCookie(
      { name: "age_verified", value: "1", domain: `.${domain}` },
      { name: "over18", value: "1", domain: `.${domain}` },
      { name: "consent", value: "1", domain: `.${domain}` },
      { name: "accessAgeDisclaimerPH", value: "1", domain: `.${domain}` },
      { name: "accessPH", value: "1", domain: `.${domain}` },
    );
  } catch {}

  // Network interception
  const networkVideos = [];
  await page.setRequestInterception(true);
  const seenUrls = new Set();
  page.on("request", req => {
    const rUrl = req.url();
    const type = req.resourceType();
    if (type === "media" || /\.m3u8|\.mp4|\.webm|\.mpd/i.test(rUrl)) {
      if (!seenUrls.has(rUrl) && !/doubleclick|googlesyndication|trafficjunky|exoclick|adserver/i.test(rUrl)) {
        seenUrls.add(rUrl);
        networkVideos.push({ url: rUrl.slice(0, 200), type, source: "network" });
      }
    }
    if (/doubleclick|googlesyndication|trafficjunky|exoclick|adserver/i.test(rUrl) || type === "font") {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {
    console.log("  networkidle2 timed out");
  });
  
  const pageUrl = page.url();
  const pageTitle = await page.title();
  console.log(`  Title: ${pageTitle.slice(0, 60)}`);
  console.log(`  Final URL: ${pageUrl.slice(0, 100)}`);

  await new Promise(r => setTimeout(r, 3000));
  
  // Click play
  try {
    await page.evaluate(() => {
      const vid = document.querySelector("video");
      if (vid) { vid.play().catch(() => {}); vid.click(); }
      const btns = document.querySelectorAll("[class*='play'], [aria-label*='play']");
      btns.forEach(b => b.click());
    });
    await new Promise(r => setTimeout(r, 3000));
  } catch {}

  // Collect blob tracking results
  const captured = await page.evaluate(() => window.__capturedStreamUrls || []);
  
  // Check video element
  const videoInfo = await page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    return { src: v.src?.slice(0, 200), currentSrc: v.currentSrc?.slice(0, 200), isBlob: v.src?.startsWith("blob:") };
  });

  // Check scripts for video data
  const scriptVideos = await page.evaluate(() => {
    const urls = [];
    document.querySelectorAll("script:not([src])").forEach(s => {
      const text = s.textContent || "";
      // flashvars
      const fvMatch = text.match(/flashvars\w*\s*=\s*({[\s\S]*?})\s*;/);
      if (fvMatch) {
        const qualUrls = fvMatch[1].match(/https?:\/\/[^\s"']+/g) || [];
        qualUrls.forEach(u => urls.push({ url: u.slice(0, 200), source: "flashvars" }));
      }
      // mediaDefinitions
      if (/mediaDefinitions/i.test(text)) {
        const mdUrls = text.match(/["'](?:videoUrl|url)["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi) || [];
        mdUrls.forEach(m => {
          const u = m.match(/https?:\/\/[^"']+/)?.[0];
          if (u) urls.push({ url: u.slice(0, 200), source: "mediaDefinitions" });
        });
      }
      // Quality URLs
      const qualUrls = text.match(/quality_\d+p["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi) || [];
      qualUrls.forEach(m => {
        const u = m.match(/https?:\/\/[^"']+/)?.[0];
        if (u) urls.push({ url: u.slice(0, 200), source: "quality-script" });
      });
      // General video URLs in scripts
      const vidUrls = text.match(/["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8|webm|mpd)(?:\?[^"'\s]*)?)["']/gi) || [];
      vidUrls.forEach(m => {
        const u = m.replace(/^["']|["']$/g, "");
        if (!/ad|tracker|pixel/i.test(u)) urls.push({ url: u.slice(0, 200), source: "script-scan" });
      });
    });
    return urls;
  });

  console.log(`\n  Video element: ${videoInfo ? (videoInfo.isBlob ? "BLOB" : videoInfo.src?.slice(0, 80)) : "none"}`);
  console.log(`  Network videos: ${networkVideos.length}`);
  networkVideos.forEach(v => console.log(`    [${v.source}] ${v.url}`));
  console.log(`  Blob tracking captured: ${captured.length}`);
  captured.forEach(v => console.log(`    [${v.source}] ${v.url?.slice(0, 150)}`));
  console.log(`  Script-extracted videos: ${scriptVideos.length}`);
  scriptVideos.forEach(v => console.log(`    [${v.source}] ${v.url}`));
  
  const totalVideos = networkVideos.length + captured.length + scriptVideos.length;
  console.log(`\n  TOTAL VIDEOS FOUND: ${totalVideos} ${totalVideos > 0 ? "✓" : "✗"}`);

  await browser.close();
  return totalVideos;
}

(async () => {
  const testUrls = [
    "https://www.xhamster.com/videos/test-video-17277671",
    "https://www.xvideos.com/video.hzqpobc9c63/",
  ];
  
  let passed = 0;
  for (const url of testUrls) {
    try {
      const count = await testExtraction(url);
      if (count > 0) passed++;
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
  }
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${passed}/${testUrls.length} sites extracted successfully`);
  console.log("=".repeat(60));
})();
