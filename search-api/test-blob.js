const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TEST_URL = "https://www.pornhub.com/view_video.php?viewkey=667c4e4dcb498";

(async () => {
  const browser = await puppeteer.launch({
    headless: "shell",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--mute-audio",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });

  // Inject blob tracking BEFORE navigation
  await page.evaluateOnNewDocument(() => {
    window.__capturedStreamUrls = [];
    window.__allXhrUrls = [];

    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        const urlStr = typeof url === 'string' ? url : String(url);
        window.__allXhrUrls.push(urlStr.slice(0, 200));
        const lower = urlStr.toLowerCase();
        if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
          const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
          window.__capturedStreamUrls.push({ url: fullUrl, source: 'xhr' });
        }
      } catch(e) {}
      return origXHROpen.apply(this, arguments);
    };

    const origFetch = window.fetch;
    window.fetch = function(input) {
      try {
        const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
        if (urlStr) {
          window.__allXhrUrls.push('fetch:' + urlStr.slice(0, 200));
          const lower = urlStr.toLowerCase();
          if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
            window.__capturedStreamUrls.push({ url: fullUrl, source: 'fetch' });
          }
        }
      } catch(e) {}
      return origFetch.apply(this, arguments);
    };
  });

  // Age gate cookies
  const domain = "pornhub.com";
  await page.setCookie(
    { name: "age_verified", value: "1", domain: `.${domain}` },
    { name: "accessAgeDisclaimerPH", value: "1", domain: `.${domain}` },
    { name: "accessPH", value: "1", domain: `.${domain}` },
    { name: "consent", value: "1", domain: `.${domain}` },
    { name: "cookiesBannerSeen", value: "1", domain: `.${domain}` },
    { name: "hasVisited", value: "1", domain: `.${domain}` },
    { name: "platform", value: "pc", domain: `.${domain}` },
  );

  // Track ALL network requests — NO blocking at all
  const allRequests = [];
  const videoRequests = [];

  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();
    allRequests.push({ url: url.slice(0, 150), type });
    
    if (type === "media" || /\.m3u8|\.mpd|\.mp4|\.webm|\.ts\b|mpegurl|\/hls\//i.test(url)) {
      videoRequests.push({ url: url.slice(0, 200), type });
    }
  });

  page.on("response", async (resp) => {
    const ct = resp.headers()["content-type"] || "";
    if (/video\/|mpegurl|dash/i.test(ct)) {
      videoRequests.push({ url: resp.url().slice(0, 200), type: "response:" + ct.slice(0, 50) });
    }
  });

  // Step 1: Visit homepage first to establish session
  console.log("Step 1: Visiting homepage first...");
  await page.goto("https://www.pornhub.com/", { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  console.log("Homepage title:", (await page.title()).slice(0, 50));
  console.log("Homepage URL:", page.url().slice(0, 80));

  // Step 2: Navigate to the video page
  console.log("\nStep 2: Navigating to video page:", TEST_URL);
  await page.goto(TEST_URL, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {
    console.log("networkidle2 timed out, continuing...");
  });

  // Wait for player to init
  await new Promise(r => setTimeout(r, 8000));

  // Check page title / URL to see if we're on the right page
  const pageTitle = await page.title();
  const pageUrl = page.url();
  console.log("Video page title:", pageTitle.slice(0, 80));
  console.log("Video page URL:", pageUrl.slice(0, 120));

  // Check for consent/age verification overlay
  const hasOverlay = await page.evaluate(() => {
    const overlay = document.querySelector('.age-verification, .consent-overlay, [class*="age-gate"], [class*="consent"]');
    return overlay ? overlay.className : null;
  });
  if (hasOverlay) console.log("Overlay found:", hasOverlay);

  // Click play
  try {
    await page.evaluate(() => {
      const vid = document.querySelector("video");
      if (vid) { vid.play().catch(() => {}); vid.click(); }
      const playBtns = document.querySelectorAll("[class*='play'], [aria-label*='play']");
      playBtns.forEach(b => b.click());
    });
    await new Promise(r => setTimeout(r, 5000));
  } catch {}

  // Collect results
  const capturedUrls = await page.evaluate(() => window.__capturedStreamUrls || []);
  const allXhr = await page.evaluate(() => window.__allXhrUrls || []);
  const videoSrc = await page.evaluate(() => {
    const vid = document.querySelector("video");
    return vid ? { src: vid.src?.slice(0, 200), currentSrc: vid.currentSrc?.slice(0, 200), readyState: vid.readyState } : null;
  });
  
  // Check for flashvars/mediaDefinitions in ALL scripts
  const scriptData = await page.evaluate(() => {
    const results = { flashvars: false, mediaDefinitions: false, qualityUrls: [], allScriptLengths: [], scriptSnippets: [] };
    document.querySelectorAll("script").forEach(s => {
      const text = s.textContent || "";
      if (text.length > 10) results.allScriptLengths.push(text.length);
      
      if (/flashvars/i.test(text)) {
        results.flashvars = true;
        const qualMatch = text.match(/quality_\d+p['"]*\s*[:=]\s*['"]([^'"]+)['"]/gi);
        if (qualMatch) results.qualityUrls.push(...qualMatch.map(m => m.slice(0, 150)));
      }
      if (/mediaDefinitions/i.test(text)) {
        results.mediaDefinitions = true;
        const mdMatch = text.match(/mediaDefinitions\s*[:=]\s*(\[[\s\S]{0,2000})/);
        if (mdMatch) results.scriptSnippets.push(mdMatch[1].slice(0, 800));
      }
      // Check for ANY video URLs in any script
      const vidUrls = text.match(/https?:\/\/[^\s"']+(?:\.mp4|\.m3u8|\.webm)[^\s"']*/gi);
      if (vidUrls) results.qualityUrls.push(...vidUrls.map(u => u.slice(0, 200)));
    });
    return results;
  });

  console.log("\n=== VIDEO ELEMENT ===");
  console.log(videoSrc);
  
  console.log("\n=== CAPTURED STREAM URLs (blob tracking) ===");
  console.log(capturedUrls.length, "captured");
  capturedUrls.forEach(u => console.log(" ", u.source, u.url?.slice(0, 150)));
  
  console.log("\n=== NETWORK VIDEO REQUESTS ===");
  console.log(videoRequests.length, "video requests");
  videoRequests.forEach(v => console.log(" ", v.type, v.url));
  
  console.log("\n=== SCRIPT DATA ===");
  console.log("flashvars:", scriptData.flashvars);
  console.log("mediaDefinitions:", scriptData.mediaDefinitions);
  console.log("inline script count:", scriptData.allScriptLengths.length, "lengths:", scriptData.allScriptLengths.slice(0, 20));
  console.log("quality/video URLs found:", scriptData.qualityUrls.length);
  scriptData.qualityUrls.forEach(u => console.log(" ", u));
  if (scriptData.scriptSnippets.length > 0) {
    console.log("mediaDefinitions snippet:", scriptData.scriptSnippets[0]);
  }
  
  console.log("\n=== ALL XHR/FETCH URLs ===");
  console.log(allXhr.length, "total XHR/fetch");
  allXhr.forEach(u => console.log(" ", u));

  console.log("\n=== ALL REQUEST TYPES ===");
  const typeCounts = {};
  allRequests.forEach(r => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });
  console.log(typeCounts);
  console.log("Total requests:", allRequests.length);
  
  await browser.close();
})();
