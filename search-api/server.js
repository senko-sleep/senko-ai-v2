const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3010;

// Detect Chromium executable path based on environment
function getChromiumPath() {
  // Explicit env var takes priority
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  
  // On Render.com (Linux), use system Chromium
  if (process.platform === "linux") {
    const fs = require("fs");
    const paths = [
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }
  
  // On Windows/Mac, let Puppeteer use its bundled Chromium
  return undefined;
}

// Reusable browser instance
let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    const execPath = getChromiumPath();
    console.log(`[puppeteer] Launching browser${execPath ? ` with executablePath: ${execPath}` : " (using bundled Chromium)"}`);
    browser = await puppeteer.launch({
      headless: "new",
      ...(execPath && { executablePath: execPath }),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--metrics-recording-only",
        "--mute-audio",
        "--no-first-run",
        "--safebrowsing-disable-auto-update",
        "--js-flags=--no-zygote",
      ],
    });
  }
  return browser;
}

// ============================================================================
// HTML PARSING UTILITIES
// ============================================================================

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeDDGUrl(raw) {
  try {
    const clean = raw.replace(/&amp;/g, "&");
    const decoded = decodeURIComponent(clean);
    if (decoded.startsWith("/") || decoded.startsWith("//")) {
      const uddg = new URL(`https://duckduckgo.com${decoded}`);
      return uddg.searchParams.get("uddg") || raw;
    }
    if (decoded.startsWith("http")) return decoded;
  } catch { }
  return raw;
}

function extractDDGResults(html) {
  const results = [];
  let m;

  const combined =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  while ((m = combined.exec(html)) !== null && results.length < 25) {
    const url = decodeDDGUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }

  if (results.length === 0) {
    const links =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((m = links.exec(html)) !== null && results.length < 25) {
      const url = decodeDDGUrl(m[1]);
      const title = stripTags(m[2]);
      if (title && url.startsWith("http"))
        results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

function extractGoogleResults(html) {
  const results = [];
  let m;

  const linkRegex =
    /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  while ((m = linkRegex.exec(html)) !== null && results.length < 25) {
    const url = decodeURIComponent(m[1]);
    const title = stripTags(m[2]);
    if (
      title &&
      url &&
      !url.includes("google.com") &&
      !url.includes("youtube.com/results")
    ) {
      results.push({ title, url, snippet: "" });
    }
  }

  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites = [];
    const titles = [];
    while ((m = citeRegex.exec(html)) !== null)
      cites.push(stripTags(m[1]));
    while ((m = h3Regex.exec(html)) !== null)
      titles.push(stripTags(m[1]));
    for (let i = 0; i < Math.min(cites.length, titles.length, 25); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      let title = titles[i];
      if (!title) continue;
      if (/^https?:\/\//i.test(title)) {
        try { title = new URL(title).hostname.replace(/^www\./, ""); } catch { }
      }
      const concatMatch = title.match(/^([a-zA-Z0-9.-]+\.[a-z]{2,})(https?:\/\/.*)/i);
      if (concatMatch) {
        try { title = new URL(concatMatch[2]).hostname.replace(/^www\./, ""); } catch { title = concatMatch[1]; }
      }
      if (title) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

function extractBingResults(html) {
  const results = [];
  let m;

  const algoRegex =
    /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
  while ((m = algoRegex.exec(html)) !== null && results.length < 25) {
    const url = m[1];
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url) results.push({ title, url, snippet });
  }

  if (results.length === 0) {
    const simpleRegex =
      /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = simpleRegex.exec(html)) !== null && results.length < 25) {
      const url = m[1];
      const title = stripTags(m[2]);
      if (title && url) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

// ============================================================================
// SEARCH ENGINES (fetch-based, no Puppeteer)
// ============================================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

async function fetchDDG(query) {
  const encoded = encodeURIComponent(query);
  const urls = [
    `https://lite.duckduckgo.com/lite/?q=${encoded}`,
    `https://html.duckduckgo.com/html/?q=${encoded}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { ...HEADERS, Referer: "https://duckduckgo.com/" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const results = extractDDGResults(html);
      if (results.length > 0) return { engine: "duckduckgo-fetch", results };
    } catch { }
  }
  return null;
}

async function fetchGoogle(query) {
  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`,
      {
        headers: { ...HEADERS, Referer: "https://www.google.com/" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const results = extractGoogleResults(html);
    if (results.length > 0) return { engine: "google-fetch", results };
  } catch { }
  return null;
}

async function fetchBing(query) {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      {
        headers: { ...HEADERS, Referer: "https://www.bing.com/" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const results = extractBingResults(html);
    if (results.length > 0) return { engine: "bing-fetch", results };
  } catch { }
  return null;
}

// ============================================================================
// PUPPETEER-BASED SEARCH (real browser, bypasses bot detection)
// ============================================================================

async function puppeteerGoogle(query) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("#search .g").forEach((el) => {
        const a = el.querySelector("a[href]");
        const h3 = el.querySelector("h3");
        const snip = el.querySelector("[data-sncf], .VwiC3b, .IsZvec");
        if (a && h3 && a.href.startsWith("http")) {
          items.push({
            title: h3.textContent?.trim() || "",
            url: a.href,
            snippet: snip?.textContent?.trim() || "",
          });
        }
      });
      return items.slice(0, 25);
    });

    await page.close();
    if (results.length > 0) return { engine: "google-puppeteer", results };
  } catch (e) {
    if (page) await page.close().catch(() => { });
    console.log("[puppeteer-google] Error:", e.message);
  }
  return null;
}

async function puppeteerDDG(query) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.goto(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );

    await page.waitForSelector("[data-result]", { timeout: 8000 }).catch(() => { });

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("[data-result]").forEach((el) => {
        const a = el.querySelector("a[href]");
        const snippet = el.querySelector("[data-result] .result__snippet, .OgdwYG6p5DWYkMkWLBL5");
        if (a && a.href.startsWith("http") && !a.href.includes("duckduckgo.com")) {
          items.push({
            title: a.textContent?.trim() || "",
            url: a.href,
            snippet: snippet?.textContent?.trim() || "",
          });
        }
      });
      return items.slice(0, 25);
    });

    await page.close();
    if (results.length > 0) return { engine: "duckduckgo-puppeteer", results };
  } catch (e) {
    if (page) await page.close().catch(() => { });
    console.log("[puppeteer-ddg] Error:", e.message);
  }
  return null;
}

async function puppeteerBing(query) {
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.goto(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll("li.b_algo").forEach((el) => {
        const a = el.querySelector("h2 a");
        const snip = el.querySelector("p, .b_caption p");
        if (a && a.href.startsWith("http")) {
          items.push({
            title: a.textContent?.trim() || "",
            url: a.href,
            snippet: snip?.textContent?.trim() || "",
          });
        }
      });
      return items.slice(0, 25);
    });

    await page.close();
    if (results.length > 0) return { engine: "bing-puppeteer", results };
  } catch (e) {
    if (page) await page.close().catch(() => { });
    console.log("[puppeteer-bing] Error:", e.message);
  }
  return null;
}

// ============================================================================
// URL RESOLUTION HELPER
// ============================================================================

function resolveUrl(src, baseOrigin, baseUrl) {
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return baseOrigin + src;
  if (src.startsWith("http")) return src;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return "";
  }
}

// ============================================================================
// UNIVERSAL VIDEO EXTRACTION HELPERS (no site-specific rules)
// ============================================================================

// Universal ad/tracker domain pattern — blocks known ad networks regardless of site
const AD_DOMAIN_PATTERN = /\b(doubleclick|googlesyndication|googletagmanager|google-analytics|adsystem|adserver|adclick|clicktrack|exoclick|exosrv|juicyads|trafficjunky|trafficstars|popunder|popads|popcash|adsterra|propellerads|adglare|banhq|otcagpqmeoqb|eunow4u|facebook\.net|fbcdn|amazon-adsystem|outbrain|taboola|criteo|rubiconproject|pubmatic|openx|bidswitch|adsrvr|adnxs|moatads|quantserve|scorecardresearch|bluekai|demdex|krxd|serving-sys|smartadserver|smaato|yieldmo|nativo|sharethrough|hilltopads|adcash|clickaine|revcontent|zergnet|adtng|afcpatrk|aftrk1|aftrk\d*|nutaku\.net|adxpansion|ero-advertising|tsyndicate|clickadu|ad-maven|admaven|a-ads|coinzilla|mellowads|trafficforce|plugrush|tubecorporate|twinrdsrv|tsyndicate|blankmp4s\.pages\.dev)\b/i;

// Check if a URL looks like a video resource (by extension or CDN pattern)
function isVideoUrl(url) {
  if (/\.(?:mp4|webm|m3u8|mpd|flv|ts|ogg|mov|avi)\b/i.test(url)) return true;
  // CDN patterns that serve video without file extensions
  if (/remote_control\.php|boomio-cdn\.com/i.test(url)) return true;
  if (/[?&]file=.*(?:%2Fvideos%2F|\/videos\/)/i.test(url)) return true;
  if (/[?&](?:type=video|mime=video)/i.test(url)) return true;
  return false;
}

// Check if a network request is a video request (universal detection)
function isVideoRequest(url, resourceType, headers) {
  // Browser's own media type detection is the most reliable signal
  if (resourceType === "media") return true;
  // Check URL patterns
  if (isVideoUrl(url)) return true;
  // Check accept headers
  if (/video\/|mpegurl|dash/i.test(headers?.accept || "")) return true;
  return false;
}

// Check if a response content-type indicates video
function isVideoResponse(contentType, url) {
  if (/video\//i.test(contentType)) return true;
  if (/mpegurl|dash\+xml/i.test(contentType)) return true;
  // application/octet-stream could be video — accept if URL looks like video
  if (/octet-stream/i.test(contentType) && isVideoUrl(url)) return true;
  // Reject octet-stream for fonts
  if (/octet-stream/i.test(contentType) && /\.(woff2?|ttf|eot|otf)\b/i.test(url)) return false;
  return false;
}

// Infer video MIME type from URL
function inferVideoType(url) {
  if (/\.mp4/i.test(url)) return "video/mp4";
  if (/\.webm/i.test(url)) return "video/webm";
  if (/\.m3u8/i.test(url)) return "application/x-mpegURL";
  if (/\.mpd/i.test(url)) return "application/dash+xml";
  if (/\.flv/i.test(url)) return "video/x-flv";
  if (/\.ogg/i.test(url)) return "video/ogg";
  if (/\.mov/i.test(url)) return "video/quicktime";
  if (/\.avi/i.test(url)) return "video/x-msvideo";
  if (/\.ts\b/i.test(url)) return "video/mp2t";
  return "";
}

// Infer video quality from URL
function inferVideoQuality(url) {
  const m = url.match(/(\d{3,4})p/);
  return m ? m[1] + "p" : "";
}

// Sort videos: mp4 > webm > m3u8 > dash > unknown > iframe, higher quality first
function sortVideos(videos) {
  const typeOrder = { "video/mp4": 0, "video/webm": 1, "application/x-mpegURL": 2, "application/dash+xml": 3 };
  return videos.sort((a, b) => {
    const ta = typeOrder[a.type] ?? (a.type === "iframe" ? 10 : 5);
    const tb = typeOrder[b.type] ?? (b.type === "iframe" ? 10 : 5);
    if (ta !== tb) return ta - tb;
    return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
  });
}

// Set universal age-gate cookies for ANY domain (harmless on non-age-gated sites)
async function setAgeGateCookies(page, url) {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    await page.setCookie(
      { name: "age_verified", value: "1", domain: `.${domain}` },
      { name: "age-verified", value: "1", domain: `.${domain}` },
      { name: "over18", value: "1", domain: `.${domain}` },
      { name: "is_adult", value: "1", domain: `.${domain}` },
      { name: "disclaimer", value: "1", domain: `.${domain}` },
      { name: "consent", value: "1", domain: `.${domain}` },
      { name: "age_check", value: "1", domain: `.${domain}` },
      { name: "mature_content", value: "1", domain: `.${domain}` },
      { name: "accessAgeDisclaimerPH", value: "1", domain: `.${domain}` },
      { name: "accessAgeDisclaimerXV", value: "1", domain: `.${domain}` },
      { name: "accessPH", value: "1", domain: `.${domain}` },
    );
  } catch { }
}

// Inject JavaScript hooks BEFORE page navigation to track blob URL sources
// Sites using MediaSource Extensions (PornHub, etc.) create blob: URLs from m3u8/mpd streams
// This captures the actual stream/video URLs that feed into the blob
async function injectBlobTracking(page) {
  await page.evaluateOnNewDocument(() => {
    window.__capturedStreamUrls = [];

    // Hook XMLHttpRequest to capture m3u8/mpd/video fetches
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        const urlStr = typeof url === 'string' ? url : String(url);
        const lower = urlStr.toLowerCase();
        if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
          const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
          if (!window.__capturedStreamUrls.some(e => e.url === fullUrl)) {
            window.__capturedStreamUrls.push({
              url: fullUrl,
              source: 'xhr',
              type: /\.m3u8|mpegurl|\/hls\//i.test(lower) ? 'application/x-mpegURL' :
                    /\.mpd|dash/i.test(lower) ? 'application/dash+xml' :
                    /\.mp4/i.test(lower) ? 'video/mp4' :
                    /\.webm/i.test(lower) ? 'video/webm' : ''
            });
          }
        }
      } catch(e) {}
      return origXHROpen.apply(this, arguments);
    };

    // Hook fetch to capture m3u8/mpd/video fetches
    const origFetch = window.fetch;
    window.fetch = function(input) {
      try {
        const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
        if (urlStr) {
          const lower = urlStr.toLowerCase();
          if (/\.m3u8|\.mpd|\.mp4|\.webm|\/manifest|\/master\.|mpegurl|\/hls\/|\/dash\//i.test(lower)) {
            const fullUrl = urlStr.startsWith('http') ? urlStr : new URL(urlStr, location.origin).href;
            if (!window.__capturedStreamUrls.some(e => e.url === fullUrl)) {
              window.__capturedStreamUrls.push({
                url: fullUrl,
                source: 'fetch',
                type: /\.m3u8|mpegurl|\/hls\//i.test(lower) ? 'application/x-mpegURL' :
                      /\.mpd|dash/i.test(lower) ? 'application/dash+xml' :
                      /\.mp4/i.test(lower) ? 'video/mp4' :
                      /\.webm/i.test(lower) ? 'video/webm' : ''
              });
            }
          }
        }
      } catch(e) {}
      return origFetch.apply(this, arguments);
    };
  });
}

// Setup universal network interception to catch all video URLs
function setupVideoInterception(page, networkVideos, seenNetworkUrls) {
  page.on("request", (request) => {
    const reqUrl = request.url();
    const resourceType = request.resourceType();

    // Catch video requests from any source
    if (isVideoRequest(reqUrl, resourceType, request.headers())) {
      if (!seenNetworkUrls.has(reqUrl) && !AD_DOMAIN_PATTERN.test(reqUrl)) {
        seenNetworkUrls.add(reqUrl);
        networkVideos.push({
          url: reqUrl,
          type: inferVideoType(reqUrl) || undefined,
          quality: inferVideoQuality(reqUrl) || undefined,
          source: "network",
        });
      }
    }

    // Block ads/trackers to speed up page load — but allow Google IMA SDK
    // (video players depend on IMA to complete pre-roll ad flow before playing actual video)
    const isAd = AD_DOMAIN_PATTERN.test(reqUrl) && !/imasdk\.googleapis|2mdn\.net|s0\.2mdn/i.test(reqUrl);
    const isHeavy = resourceType === "font";
    if (isAd || isHeavy) {
      request.abort();
    } else {
      request.continue();
    }
  });

  page.on("response", async (response) => {
    try {
      const respUrl = response.url();
      const contentType = response.headers()["content-type"] || "";
      if (isVideoResponse(contentType, respUrl)) {
        if (!seenNetworkUrls.has(respUrl) && !AD_DOMAIN_PATTERN.test(respUrl)) {
          seenNetworkUrls.add(respUrl);
          networkVideos.push({
            url: respUrl,
            type: contentType.split(";")[0].trim(),
            source: "response",
          });
        }
      }
    } catch { }
  });
}

// Universal DOM video extraction — runs inside page.evaluate()
// Detects ALL video sources without any site-specific logic
const universalDOMExtract = () => {
  const results = [];
  const seen = new Set();
  const add = (url, extra = {}) => {
    if (!url || seen.has(url) || url.startsWith("blob:") || url.startsWith("data:")) return;
    if (/\b(ad[sv]?|tracker|pixel|beacon|exoclick|trafficjunky|juicyads|adglare|popads|adsterra|adtng|afcpatrk|aftrk|nutaku\.net|adxpansion|clickadu|admaven|tubecorporate|twinrdsrv|plugrush|trafficforce)\b/i.test(url)) return;
    seen.add(url);
    results.push({ url, ...extra, source: extra.source || "dom" });
  };

  // 0. Captured stream URLs from blob tracking hooks (injected before page load)
  // Sites using MediaSource (blob: URLs) have their real m3u8/mp4 URLs captured here
  try {
    const captured = window.__capturedStreamUrls || [];
    for (const entry of captured) {
      if (entry.url) add(entry.url, { type: entry.type || '', source: entry.source || 'blob-tracking' });
    }
  } catch(e) {}

  // 1. <video> elements + <source> children
  document.querySelectorAll("video").forEach((v) => {
    const poster = v.poster || undefined;
    if (v.src) add(v.src, { poster });
    if (v.currentSrc && v.currentSrc !== v.src) add(v.currentSrc, { poster });
    v.querySelectorAll("source").forEach((s) => {
      if (s.src) add(s.src, { type: s.type || undefined, poster });
    });
  });

  // 2. Standalone <source> elements
  document.querySelectorAll("source").forEach((s) => {
    if (s.src && /\.(mp4|webm|m3u8|mpd|flv|ogg|mov)/i.test(s.src)) {
      add(s.src, { type: s.type || undefined });
    }
  });

  // 3. Data attributes on ANY element (universal attribute scan)
  const videoDataAttrs = [
    "data-src", "data-video-url", "data-video-src", "data-file-url",
    "data-mp4", "data-hls", "data-stream", "data-video", "data-source",
    "data-file", "data-url", "data-media", "data-content-url",
    "data-dash", "data-webm", "data-m3u8", "data-mpd",
  ];
  const attrSelector = videoDataAttrs.map((a) => `[${a}]`).join(",");
  document.querySelectorAll(attrSelector).forEach((el) => {
    for (const attr of videoDataAttrs) {
      const val = el.getAttribute(attr);
      if (val && (/\.(mp4|webm|m3u8|mpd|flv|ogg|mov)/i.test(val) || /video|stream|media|cdn|remote_control/i.test(val))) {
        add(val);
      }
    }
  });

  // 4. Iframes — any iframe with video-related URL (no hard-coded domains)
  document.querySelectorAll("iframe").forEach((iframe) => {
    const src = iframe.src;
    if (!src) return;
    if (/\b(embed|player|video|watch|play|stream|media)\b/i.test(src) && !/\b(ad|banner|widget|social|comment|pixel|tracker)\b/i.test(src)) {
      add(src, { type: "iframe" });
    }
  });

  // 5. <embed> and <object> elements
  document.querySelectorAll("embed[src], object[data]").forEach((el) => {
    const src = el.getAttribute("src") || el.getAttribute("data");
    if (src && /\.(mp4|webm|m3u8|swf|flv)/i.test(src)) add(src);
  });
  document.querySelectorAll("object param").forEach((p) => {
    const name = (p.getAttribute("name") || "").toLowerCase();
    const val = p.getAttribute("value");
    if (!val) return;
    if ((name === "src" || name === "movie" || name === "file") && /\.(mp4|webm|m3u8|flv)/i.test(val)) {
      add(val);
    }
    if (name === "flashvars") {
      try {
        const params = new URLSearchParams(val);
        for (const [k, v] of params) {
          if (/video|file|stream|source|url|quality/i.test(k)) {
            let clean = v.replace(/^function\/\d+\//, "");
            if (clean.startsWith("http")) add(clean, { source: "flashvars" });
          }
        }
      } catch {}
    }
  });

  // 6. JS Player API detection (all known player frameworks)

  // jwplayer
  try {
    if (window.jwplayer) {
      const instances = document.querySelectorAll("[id]");
      const tried = new Set();
      instances.forEach((el) => {
        try {
          if (tried.has(el.id)) return;
          tried.add(el.id);
          const p = window.jwplayer(el.id);
          if (p && typeof p.getPlaylistItem === "function") {
            const item = p.getPlaylistItem();
            if (item) {
              if (item.file) add(item.file, { source: "jwplayer" });
              if (item.sources) item.sources.forEach((s) => { if (s.file) add(s.file, { type: s.type, source: "jwplayer" }); });
              if (item.allSources) item.allSources.forEach((s) => { if (s.file) add(s.file, { type: s.type, source: "jwplayer" }); });
            }
            const playlist = p.getPlaylist?.();
            if (playlist) playlist.forEach((pi) => {
              if (pi.file) add(pi.file, { source: "jwplayer" });
              if (pi.sources) pi.sources.forEach((s) => { if (s.file) add(s.file, { source: "jwplayer" }); });
            });
          }
        } catch {}
      });
    }
  } catch {}

  // videojs
  try {
    const vjsPlayers = document.querySelectorAll(".video-js");
    vjsPlayers.forEach((el) => {
      const player = el.player || window.videojs?.getPlayer?.(el.id);
      if (player) {
        const src = player.currentSrc?.() || player.src?.();
        if (src) add(src, { source: "videojs" });
        const techEl = player.tech?.()?.el?.();
        if (techEl && techEl.src) add(techEl.src, { source: "videojs" });
      }
    });
    if (window.videojs?.getPlayers) {
      const players = window.videojs.getPlayers();
      for (const id in players) {
        const p = players[id];
        if (p) {
          const src = p.currentSrc?.() || p.src?.();
          if (src) add(src, { source: "videojs" });
        }
      }
    }
  } catch {}

  // flowplayer
  try {
    if (window.flowplayer) {
      document.querySelectorAll(".flowplayer").forEach((el) => {
        const fp = window.flowplayer(el);
        if (fp && fp.video) {
          if (fp.video.src) add(fp.video.src, { source: "flowplayer" });
          if (fp.video.sources) fp.video.sources.forEach((s) => { if (s.src) add(s.src, { type: s.type, source: "flowplayer" }); });
        }
      });
    }
  } catch {}

  // Plyr
  try {
    document.querySelectorAll(".plyr").forEach((el) => {
      const plyr = el.__plyr || el.plyr;
      if (plyr) {
        const sources = plyr.source?.sources;
        if (sources) sources.forEach((s) => { if (s.src) add(s.src, { source: "plyr" }); });
      }
    });
  } catch {}

  // MediaElement.js
  try {
    document.querySelectorAll(".mejs__container, .mejs-container").forEach((el) => {
      const player = el.querySelector("video, audio");
      if (player && player.src) add(player.src, { source: "mediaelement" });
    });
  } catch {}

  // Clappr
  try {
    if (window.Clappr || window.clappr) {
      document.querySelectorAll("[data-clappr], .clappr-player").forEach((el) => {
        try {
          const cfg = el.getAttribute("data-clappr");
          if (cfg) { const d = JSON.parse(cfg); if (d.source) add(d.source, { source: "clappr" }); }
        } catch {}
      });
    }
  } catch {}

  // KVS Player / kt_player (tube sites — e.g. rule34video, many others)
  try {
    if (window.flashvars) {
      const fv = window.flashvars;
      for (const key of Object.keys(fv)) {
        if (/video|file|stream|source|quality|url/i.test(key) && typeof fv[key] === "string") {
          let v = fv[key].replace(/^function\/\d+\//, "");
          if (v.startsWith("http")) add(v, { source: "flashvars" });
        }
      }
    }
    // kt_player element data
    const ktEl = document.querySelector("#kt_player, .kt_player, [id*=kt_player]");
    if (ktEl) {
      const df = ktEl.getAttribute("data-flashvars");
      if (df) {
        try {
          const params = new URLSearchParams(df);
          for (const [k, v] of params) {
            if (/video|file|stream|source|url|quality/i.test(k)) {
              let clean = v.replace(/^function\/\d+\//, "");
              if (clean.startsWith("http")) add(clean, { source: "kt_player" });
            }
          }
        } catch {}
      }
    }
  } catch {}

  // Shaka Player
  try {
    document.querySelectorAll("video").forEach((v) => {
      const p = v.shakaPlayer || v.__shakaPlayer;
      if (p) {
        const uri = p.getAssetUri?.() || p.getManifestUri?.();
        if (uri) add(uri, { source: "shaka" });
      }
    });
  } catch {}

  // hls.js instances
  try {
    document.querySelectorAll("video").forEach((v) => {
      const h = v._hls || v.hls;
      if (h && h.url) add(h.url, { type: "application/x-mpegURL", source: "hlsjs" });
    });
  } catch {}

  // dash.js instances
  try {
    document.querySelectorAll("video").forEach((v) => {
      const p = v._dashjs_player || v.dashPlayer;
      if (p) {
        const src = p.getSource?.();
        if (src) add(src, { type: "application/dash+xml", source: "dashjs" });
      }
    });
  } catch {}

  // 7. Scan inline <script> blocks for video URLs
  try {
    document.querySelectorAll("script:not([src])").forEach((script) => {
      const text = script.textContent || "";
      if (text.length > 2000000 || text.length < 20) return;

      // Direct video file URLs in strings
      const urlPatterns = [
        /["'](https?:\/\/[^"'\s]+\.(?:mp4|webm|m3u8|mpd|flv|ogg|mov)(?:\?[^"'\s]*)?)["']/gi,
        /["'](https?:\/\/[^"'\s]*(?:cdn|stream|media|video)[^"'\s]*(?:remote_control|get_file)[^"'\s]*)["']/gi,
        /(?:video_url|videoUrl|video_file|videoFile|file_url|fileUrl|mp4_url|source_url|stream_url|hls_url|dash_url|media_url|content_url|playback_url|video_src|videoSrc)\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/gi,
        // quality_720p: "https://..." patterns (PornHub, etc.)
        /["']?quality_\d+p["']?\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/gi,
      ];
      for (const pattern of urlPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null && results.length < 40) {
          let candidate = match[1].replace(/^function\/\d+\//, "");
          if (candidate.startsWith("http") && !/\b(ad|tracker|pixel|beacon)\b/i.test(candidate)) {
            add(candidate, { source: "script-scan" });
          }
        }
      }

      // flashvars object in script
      const fvMatch = text.match(/flashvars\w*\s*=\s*({[\s\S]*?})\s*;/);
      if (fvMatch) {
        const fvText = fvMatch[1];
        const urlInFv = /["']?(video_url|video_alt_url\d*|quality_\d+p|video_url_hd)["']?\s*[:=]\s*["']([^"']+)["']/gi;
        let m;
        while ((m = urlInFv.exec(fvText)) !== null) {
          let v = m[2].replace(/^function\/\d+\//, "");
          if (v.startsWith("http")) add(v, { source: "flashvars-script" });
        }
      }

      // mediaDefinitions array (PornHub and similar players)
      const mdMatch = text.match(/mediaDefinitions\s*[:=]\s*(\[[\s\S]*?\])\s*[,;})\n]/);
      if (mdMatch) {
        try {
          const mdText = mdMatch[1];
          // Extract videoUrl/url values from the array
          const mdUrlRegex = /["'](?:videoUrl|url)["']\s*:\s*["'](https?:\/\/[^"'\s]+)["']/gi;
          let m;
          while ((m = mdUrlRegex.exec(mdText)) !== null && results.length < 40) {
            add(m[1], { source: 'mediaDefinitions' });
          }
          // Also extract quality-labeled URLs
          const qualRegex = /["'](?:quality|format|label)["']\s*:\s*["'](\d+p?)["'][\s\S]*?["'](?:videoUrl|url)["']\s*:\s*["'](https?:\/\/[^"'\s]+)["']/gi;
          while ((m = qualRegex.exec(mdText)) !== null && results.length < 40) {
            add(m[2], { quality: m[1], source: 'mediaDefinitions' });
          }
        } catch {}
      }
    });
  } catch {}

  return results;
};

// Universal listing page link detection — detect video links on any site without hard-coded patterns
const universalVideoLinkExtract = () => {
  const links = [];
  const seen = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    const text = (a.textContent || a.title || a.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
    if (!href || seen.has(href) || !text) return;

    const u = href.toLowerCase();
    // Skip navigation, auth, taxonomy (tags/categories/models), and ad links
    if (/\/account|\/login|\/signup|\/register|\/tags\/|\/tags$|\/categories\/|\/categories$|\/models\/|\/models$|\/privacy|\/terms|\/dmca|\/contact|\/about/i.test(u)) return;
    if (/exoclick|trafficjunky|juicyads|adglare|popads|adsterra|adtng|afcpatrk|aftrk|nutaku\.net|adxpansion|clickadu|admaven|tubecorporate|twinrdsrv|plugrush|trafficforce|hilltopads|adcash|outbrain|taboola|criteo/i.test(u)) return;
    if (u === window.location.href.toLowerCase()) return;

    // Score the link — higher score = more likely to be a video/content link
    let score = 0;
    // URL contains video-related path segments
    if (/\/(video|watch|view_video|clip|embed|play|movie|episode)s?\b/i.test(u)) score += 3;
    if (/viewkey|watch\?v=|\/v\//i.test(u)) score += 3;
    // URL has an ID/slug pattern (not just a category)
    if (/\/[a-z0-9-]{10,}/i.test(u)) score += 1;
    if (/\d{3,}/.test(u)) score += 1;
    // Text is a reasonable title (not just "Home", "Next", etc.)
    if (text.length > 10 && text.length < 300) score += 1;
    // Has thumbnail nearby (img inside or adjacent)
    if (a.querySelector("img") || a.closest(".thumb, .video-item, .video-card, [class*=thumb], [class*=video]")) score += 2;

    if (score >= 3) {
      seen.add(href);
      links.push({ url: href, title: text.slice(0, 200) || "Video" });
    }
  });
  return links.slice(0, 50);
};

// ============================================================================
// IMAGE SEARCH UTILITIES
// ============================================================================

const IMAGE_SITE_DOMAINS = [
  "wallpapers.com", "wallpaperswide.com", "wallpaperflare.com", "wallpaperaccess.com",
  "wallhaven.cc", "alphacoders.com", "wall.alphacoders.com",
  "pinterest.com", "pinterest.co", "pin.it",
  "deviantart.com", "artstation.com",
  "flickr.com", "500px.com", "unsplash.com", "pexels.com", "pixabay.com",
  "zerochan.net", "danbooru.donmai.us", "gelbooru.com", "safebooru.org",
  "rule34.xxx", "rule34.paheal.net", "e621.net", "xbooru.com", "tbib.org", "realbooru.com",
  "imgur.com", "i.imgur.com",
  "fandom.com", "fandomwire.com",
  "screenrant.com", "cbr.com",
  "hdqwalls.com", "uhdpaper.com", "4kwallpapers.com",
];

function isImageSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return IMAGE_SITE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch { return false; }
}

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    const stripParams = ['w', 'h', 'width', 'height', 'size', 'quality', 'q', 'auto', 'fit', 'crop', 'format', 'fm', 'fl', 'dpr', 'cs', 'cb', 'v', 'token', 'sig', 'signature', 'hash', 'ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'resize', 'strip', 'compress'];
    for (const p of stripParams) u.searchParams.delete(p);
    return (u.origin + u.pathname.replace(/\/$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getImageFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/');
    return segments[segments.length - 1]?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function isImageDuplicate(newUrl, existing) {
  const normalized = normalizeImageUrl(newUrl);
  const filename = getImageFilename(newUrl);
  return existing.some((i) => {
    if (normalizeImageUrl(i.url) === normalized) return true;
    if (filename && filename.length > 10 && filename === getImageFilename(i.url)) return true;
    return false;
  });
}

function isValidImageUrl(src) {
  if (!src || !src.startsWith("http")) return false;
  if (src.includes("data:") || src.includes(".svg") || src.includes("favicon") || src.includes("pixel") || src.includes("tracking") || src.includes("1x1") || src.includes("spacer") || src.includes("blank.") || src.includes("placeholder")) return false;
  if (src.includes("gstatic.com") || src.includes("google.com/images") || src.includes("encrypted-tbn") || src.includes("googleusercontent.com")) return false;
  return true;
}

async function scrapeImagesFromUrl(url) {
  const images = [];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return images;
    const html = await res.text();
    let origin = "";
    try { origin = new URL(url).origin; } catch { }

    const resolveImgUrl = (src) => {
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = origin + src;
      else if (!src.startsWith("http")) return null;
      return isValidImageUrl(src) ? src : null;
    };

    // og:image
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1]) {
      const src = resolveImgUrl(ogMatch[1]);
      if (src) images.push({ url: src, alt: "", source: url });
    }

    // srcset
    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    let srcsetMatch;
    while ((srcsetMatch = srcsetRegex.exec(html)) !== null) {
      const entries = srcsetMatch[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const entry of entries) {
        const src = resolveImgUrl(entry);
        if (src && !images.some((i) => i.url === src)) {
          images.push({ url: src, alt: "", source: url });
        }
      }
    }

    // data-src, data-original, etc.
    const lazyRegex = /(?:data-src|data-original|data-lazy-src|data-full|data-image|data-bg)=["'](https?:\/\/[^"']+)["']/gi;
    let lazyMatch;
    while ((lazyMatch = lazyRegex.exec(html)) !== null) {
      const src = resolveImgUrl(lazyMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // background-image CSS
    const bgRegex = /background-image:\s*url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
    let bgMatch;
    while ((bgMatch = bgRegex.exec(html)) !== null) {
      const src = resolveImgUrl(bgMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // img tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src.includes("logo") || src.includes("icon")) continue;
      const resolved = resolveImgUrl(src);
      if (!resolved) continue;
      const tag = match[0];
      const w = tag.match(/width=["']?(\d+)/i);
      const h = tag.match(/height=["']?(\d+)/i);
      if (w && parseInt(w[1]) < 80) continue;
      if (h && parseInt(h[1]) < 80) continue;
      const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
      const alt = altMatch ? altMatch[1] : "";
      if (!images.some((i) => i.url === resolved)) {
        images.push({ url: resolved, alt, source: url });
      }
    }

    // JSON-LD
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdMatch;
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        const extractImages = (obj) => {
          if (typeof obj !== "object" || !obj) return;
          for (const [key, val] of Object.entries(obj)) {
            if ((key === "image" || key === "thumbnailUrl" || key === "contentUrl") && typeof val === "string") {
              const src = resolveImgUrl(val);
              if (src && !images.some((i) => i.url === src)) {
                images.push({ url: src, alt: "", source: url });
              }
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === "string" && item.startsWith("http")) {
                  const src = resolveImgUrl(item);
                  if (src && !images.some((i) => i.url === src)) {
                    images.push({ url: src, alt: "", source: url });
                  }
                } else if (typeof item === "object") {
                  extractImages(item);
                }
              }
            } else if (typeof val === "object") {
              extractImages(val);
            }
          }
        };
        extractImages(data);
      } catch { }
    }
  } catch { }
  return images;
}

function extractSourceFromGoogleHtml(html, imgUrl) {
  const idx = html.indexOf(imgUrl.slice(0, 60));
  if (idx > 0) {
    const chunk = html.slice(Math.max(0, idx - 2000), idx);
    const sourceMatches = [...chunk.matchAll(/\["(https?:\/\/(?!encrypted-tbn)[^"]{10,})"/g)];
    if (sourceMatches.length > 0) {
      const lastMatch = sourceMatches[sourceMatches.length - 1][1];
      if (!lastMatch.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        return lastMatch;
      }
    }
  }
  try {
    const u = new URL(imgUrl);
    return u.origin;
  } catch { return ""; }
}

// ============================================================================
// SCRAPE UTILITIES (for /scrape and /url endpoints)
// ============================================================================

function extractText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return text;
}

function cleanTitle(title, url) {
  let clean = decodeEntities(title).trim();
  const concat = clean.match(/^([a-zA-Z0-9.-]+\.[a-z]{2,})(https?:\/\/.*)/i);
  if (concat) {
    try { clean = new URL(concat[2]).hostname.replace(/^www\./, ""); } catch { clean = concat[1]; }
  }
  if (/^https?:\/\//i.test(clean)) {
    try { clean = new URL(clean).hostname.replace(/^www\./, ""); } catch { }
  }
  if (!clean) {
    try { clean = new URL(url).hostname.replace(/^www\./, ""); } catch { clean = url; }
  }
  return clean;
}

function makeFavicon(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return ""; }
}


function extractVideos(html, origin, finalUrl) {
  const videos = [];
  const seenVideos = new Set();
  const addVideo = (rawUrl, extra = {}) => {
    if (!rawUrl || typeof rawUrl !== "string") return;
    let decoded = rawUrl.replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    const vUrl = resolveUrl(decoded, origin, finalUrl);
    if (!vUrl || seenVideos.has(vUrl)) return;
    const lower = vUrl.toLowerCase();
    if (/\b(ad[sv]?|tracker|pixel|beacon|analytics|pop(?:up|under)|banner)\b/i.test(lower)) return;
    if (lower.includes("spacer") || lower.includes("blank.") || lower.includes("1x1")) return;
    seenVideos.add(vUrl);
    let quality = extra.quality || "";
    if (!quality) {
      const qMatch = vUrl.match(/(\d{3,4})p/);
      if (qMatch) quality = qMatch[1] + "p";
    }
    let type = extra.type || "";
    if (!type) {
      if (/\.mp4/i.test(vUrl)) type = "video/mp4";
      else if (/\.webm/i.test(vUrl)) type = "video/webm";
      else if (/\.m3u8/i.test(vUrl)) type = "application/x-mpegURL";
      else if (/\.mpd/i.test(vUrl)) type = "application/dash+xml";
      else if (/\.flv/i.test(vUrl)) type = "video/x-flv";
      else if (/\.ogg/i.test(vUrl)) type = "video/ogg";
      else if (/\.mov/i.test(vUrl)) type = "video/quicktime";
      else if (/\.avi/i.test(vUrl)) type = "video/x-msvideo";
      else if (/\.ts\b/i.test(vUrl)) type = "video/mp2t";
    }
    videos.push({ url: vUrl, type: type || undefined, quality: quality || undefined, poster: extra.poster || undefined });
  };

  // 1. og:video meta tags
  const ogVideoRegexes = [
    /<meta[^>]*property=["']og:video(?::(?:secure_)?url)?["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:video(?::(?:secure_)?url)?["']/gi,
  ];
  for (const rx of ogVideoRegexes) {
    let m; while ((m = rx.exec(html)) !== null) addVideo(m[1]);
  }

  // 2. twitter:player
  const twitterPlayerMatch = html.match(/<meta[^>]*(?:name|property)=["']twitter:player(?::stream)?["'][^>]*content=["']([^"']+)["']/i);
  if (twitterPlayerMatch) addVideo(twitterPlayerMatch[1]);

  // 3. <video> tags
  const videoTagRegex = /<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/gi;
  let vTagMatch;
  while ((vTagMatch = videoTagRegex.exec(html)) !== null) {
    const fullTag = vTagMatch[0];
    const srcMatch = fullTag.match(/\bsrc=["']([^"']+)["']/i);
    const posterMatch = fullTag.match(/poster=["']([^"']+)["']/i);
    const poster = posterMatch ? resolveUrl(posterMatch[1], origin, finalUrl) : undefined;
    if (srcMatch) addVideo(srcMatch[1], { poster });
    const innerSourceRegex = /<source[^>]*\bsrc=["']([^"']+)["'][^>]*/gi;
    let innerMatch;
    while ((innerMatch = innerSourceRegex.exec(fullTag)) !== null) {
      const typeM = innerMatch[0].match(/type=["']([^"']+)["']/i);
      addVideo(innerMatch[1], { poster, type: typeM ? typeM[1] : "" });
    }
  }

  // 4. Standalone <source> tags
  const sourceRegex = /<source[^>]*\bsrc=["']([^"']+)["'][^>]*/gi;
  let sourceMatch;
  while ((sourceMatch = sourceRegex.exec(html)) !== null) {
    const typeM = sourceMatch[0].match(/type=["']([^"']+)["']/i);
    addVideo(sourceMatch[1], { type: typeM ? typeM[1] : "" });
  }

  // 5. JSON-LD
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      const extractVideoLD = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(extractVideoLD); return; }
        if (obj["@type"] === "VideoObject" || obj["@type"] === "Video") {
          if (obj.contentUrl) addVideo(obj.contentUrl);
          if (obj.embedUrl) addVideo(obj.embedUrl);
          if (obj.url) addVideo(obj.url);
        }
        for (const val of Object.values(obj)) if (typeof val === "object") extractVideoLD(val);
      };
      extractVideoLD(data);
    } catch { }
  }

  // 6. JS Patterns
  const jsPatterns = [
    /(?:video_url|videoUrl|video_file|videoFile|file_url|fileUrl|mp4_url|mp4Url|source_url|sourceUrl|stream_url|streamUrl|hls_url|hlsUrl|dash_url|dashUrl|media_url|mediaUrl|content_url|contentUrl|download_url|downloadUrl|playback_url|playbackUrl|video_src|videoSrc)\s*[:=]\s*["']([^"'\s][^"']*?)["']/gi,
    /["'](?:file|src|source|url|mp4|mp4_url|video|video_url|stream|hls|dash|media|contentUrl|videoUrl|playUrl|play_url)["']\s*:\s*["']([^"'\s][^"']*?\.(?:mp4|webm|m3u8|mpd|flv|ogg|mov|avi|ts)(?:\?[^"']*)?)["']/gi,
    /(?:src|href|url|file)\s*[:=]\s*["']([^"'\s]+\.(?:mp4|webm|m3u8|mpd|flv|ogg|mov)(?:\?[^"']*)?)["']/gi,
    /(?:video_url|file_url|source|src|mp4|stream|media)=([a-zA-Z0-9%]+(?:%2F|%3A)[a-zA-Z0-9%./_\-?&=+]+)/gi,
  ];
  for (const pattern of jsPatterns) {
    let jsMatch;
    while ((jsMatch = pattern.exec(html)) !== null && videos.length < 20) {
      let candidate = jsMatch[1];
      if (candidate.includes("%2F") || candidate.includes("%3A")) { try { candidate = decodeURIComponent(candidate); } catch { } }
      addVideo(candidate);
    }
  }

  // 7. iframes — universal detection (no hard-coded domain list)
  const iframeRegex = /<iframe[^>]*\bsrc=["']([^"']+)["'][^>]*/gi;
  let iframeMatch;
  while ((iframeMatch = iframeRegex.exec(html)) !== null && videos.length < 20) {
    const src = resolveUrl(iframeMatch[1], origin, finalUrl);
    if (!src) continue;
    const lower = src.toLowerCase();
    // Accept any iframe that looks like a video embed (contains video-related keywords)
    if (/\b(embed|player|video|watch|play|stream|media)\b/i.test(lower) && !/\b(ad|banner|widget|social|comment|pixel|tracker)\b/i.test(lower)) {
      if (!seenVideos.has(src)) { videos.push({ url: src, type: "iframe" }); seenVideos.add(src); }
    }
  }

  return sortVideos(videos);
}

// ============================================================================
// ROUTES
// ============================================================================

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// GET /search?q=query
app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "q parameter required" });

  console.log(`[search] "${query}"`);
  const attempts = [];
  const start = Date.now();

  // Layer 1: fetch-based (fast, no browser overhead)
  const fetchEngines = [fetchDDG, fetchGoogle, fetchBing];
  for (const fn of fetchEngines) {
    const t = Date.now();
    try {
      const result = await fn(query);
      attempts.push({
        engine: result?.engine || fn.name,
        success: !!result,
        timeMs: Date.now() - t,
      });
      if (result) {
        console.log(`[search] ✓ ${result.engine} returned ${result.results.length} results in ${Date.now() - start}ms`);
        return res.json({
          results: result.results,
          engine: result.engine,
          attempts,
          totalTimeMs: Date.now() - start,
        });
      }
    } catch (e) {
      attempts.push({
        engine: fn.name,
        success: false,
        timeMs: Date.now() - t,
        error: e.message,
      });
    }
  }

  // Layer 2: Puppeteer-based (real browser, bypasses bot detection)
  console.log("[search] Fetch engines failed, trying Puppeteer...");
  const puppeteerEngines = [puppeteerGoogle, puppeteerBing, puppeteerDDG];
  for (const fn of puppeteerEngines) {
    const t = Date.now();
    try {
      const result = await fn(query);
      attempts.push({
        engine: result?.engine || fn.name,
        success: !!result,
        timeMs: Date.now() - t,
      });
      if (result) {
        console.log(`[search] ✓ ${result.engine} returned ${result.results.length} results in ${Date.now() - start}ms`);
        return res.json({
          results: result.results,
          engine: result.engine,
          attempts,
          totalTimeMs: Date.now() - start,
        });
      }
    } catch (e) {
      attempts.push({
        engine: fn.name,
        success: false,
        timeMs: Date.now() - t,
        error: e.message,
      });
    }
  }

  console.log(`[search] ✗ All engines failed in ${Date.now() - start}ms`);
  res.json({
    results: [],
    error: "All search engines failed",
    attempts,
    totalTimeMs: Date.now() - start,
  });
});

// GET /sources?q=query — search + deduplicate + add favicons
app.get("/sources", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "q parameter required" });

  console.log(`[sources] "${query}"`);
  const start = Date.now();
  const attempts = [];

  // Run through the same search cascade
  let results = [];
  let resolvedBy = "";

  const fetchEngines = [fetchDDG, fetchGoogle, fetchBing];
  for (const fn of fetchEngines) {
    const t = Date.now();
    try {
      const result = await fn(query);
      attempts.push({ engine: result?.engine || fn.name, success: !!result, timeMs: Date.now() - t });
      if (result) {
        results = result.results;
        resolvedBy = result.engine;
        break;
      }
    } catch (e) {
      attempts.push({ engine: fn.name, success: false, timeMs: Date.now() - t, error: e.message });
    }
  }

  if (results.length === 0) {
    const puppeteerEngines = [puppeteerGoogle, puppeteerBing, puppeteerDDG];
    for (const fn of puppeteerEngines) {
      const t = Date.now();
      try {
        const result = await fn(query);
        attempts.push({ engine: result?.engine || fn.name, success: !!result, timeMs: Date.now() - t });
        if (result) {
          results = result.results;
          resolvedBy = result.engine;
          break;
        }
      } catch (e) {
        attempts.push({ engine: fn.name, success: false, timeMs: Date.now() - t, error: e.message });
      }
    }
  }

  // Deduplicate and add favicons
  const seen = new Set();
  const sources = results
    .filter((r) => {
      if (!r.url || !r.title) return false;
      try {
        const key = new URL(r.url).hostname + new URL(r.url).pathname;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      } catch { return true; }
    })
    .slice(0, 10)
    .map((r) => ({
      url: r.url,
      title: cleanTitle(r.title, r.url),
      snippet: decodeEntities(r.snippet || ""),
      favicon: makeFavicon(r.url),
    }));

  console.log(`[sources] ${sources.length} results via ${resolvedBy || "none"} in ${Date.now() - start}ms`);
  res.json({ sources, query });
});

// GET /scrape?url=URL — fetch and extract text content from a page
app.get("/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url parameter required" });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.json({ error: `HTTP ${response.status}`, content: "" });
    }

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

    const metaMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i
    );
    const description = metaMatch ? metaMatch[1].trim() : "";

    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<form[\s\S]*?<\/form>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

    const mainMatch =
      cleaned.match(/<main[\s\S]*?<\/main>/i) ||
      cleaned.match(/<article[\s\S]*?<\/article>/i) ||
      cleaned.match(
        /<div[^>]*(?:class|id)=["'][^"']*(?:content|main|article|post|entry|body)[^"']*["'][\s\S]*?<\/div>/i
      );

    const targetHtml = mainMatch ? mainMatch[0] : cleaned;

    const text = targetHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Remove duplicate lines (common with navigation/header text)
    const lines = text.split("\n");
    const seenLines = new Set();
    const dedupedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) return false;
      const normalized = trimmed.toLowerCase();
      if (seenLines.has(normalized)) return false;
      seenLines.add(normalized);
      return true;
    });
    const dedupedText = dedupedLines.join("\n");
    const truncated = dedupedText.length > 50000 ? dedupedText.slice(0, 50000) + "..." : dedupedText;
    const videos = extractVideos(html, new URL(url).origin, url);

    // Extract images
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    const images = [];
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 12) {
      let src = imgMatch[1];
      if (src.includes("data:") || src.includes(".svg") || src.includes("pixel") || src.includes("tracking") || src.includes("favicon") || (src.includes("logo") && src.length < 50) || src.includes("1x1") || src.includes("spacer")) continue;
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) { try { src = new URL(url).origin + src; } catch { continue; } }
      else if (!src.startsWith("http")) { try { src = new URL(url).origin + "/" + src; } catch { continue; } }
      const tagStr = imgMatch[0];
      const widthMatch = tagStr.match(/width=["']?(\d+)/i);
      if (widthMatch && parseInt(widthMatch[1]) < 50) continue;
      const heightMatch = tagStr.match(/height=["']?(\d+)/i);
      if (heightMatch && parseInt(heightMatch[1]) < 50) continue;
      if (!images.includes(src)) images.push(src);
    }

    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogImageMatch && ogImageMatch[1] && !images.includes(ogImageMatch[1])) {
      images.unshift(ogImageMatch[1]);
    }

    res.json({ title, description, content: truncated, images: images.slice(0, 8), videos, url, length: text.length });
  } catch (err) {
    res.json({ error: err.message || "Scrape failed", content: "" });
  }
});

// GET /images?q=query&page=1 OR /images?url=URL — image search or scrape
app.get("/images", async (req, res) => {
  const query = req.query.q;
  const scrapeUrl = req.query.url;
  const page = Math.max(1, parseInt(req.query.page) || 1);

  if (!query && !scrapeUrl) {
    return res.status(400).json({ error: "q or url required" });
  }

  // Mode 1: Scrape images from a specific URL
  if (scrapeUrl) {
    const images = await scrapeImagesFromUrl(scrapeUrl);
    return res.json({ images, query: scrapeUrl, page, hasMore: false });
  }

  // Mode 2: Search for images via multiple strategies in parallel
  const images = [];
  // Query variations for later pages — keeps Google/Bing returning fresh results
  const querySuffixes = ["", "HD", "wallpaper", "fan art", "artwork", "render", "high quality", "4k", "illustration", "digital art"];
  const suffix = querySuffixes[page - 1] || querySuffixes[(page - 1) % querySuffixes.length];
  const pageQuery = suffix ? `${query} ${suffix}` : query;
  const encoded = encodeURIComponent(pageQuery);
  // Google caps at ~200, Bing at ~350 — cycle offsets within range
  const googleOffset = ((page - 1) % 2) * 100;
  const bingOffset = ((page - 1) % 2) * 175;
  const ddgOffset = (page - 1) * 100;
  const booruPage = page;
  console.log(`[images] Page ${page} query="${pageQuery}" googleOff=${googleOffset} bingOff=${bingOffset} ddgOff=${ddgOffset}`);

  // Detect NSFW queries — mainstream search engines filter these, so we need direct booru APIs
  const nsfwPattern = /\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|e621|gelbooru|danbooru|paheal|xbooru)\b/i;
  const isNsfwQuery = nsfwPattern.test(query);

  // Extract clean search tags for booru APIs (remove NSFW site names, keep the subject)
  const isGifQuery = /\b(gifs?|animated)\b/i.test(query);
  const booruTags = query
    .replace(/\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|images?|pics?|pictures?|photos?|gifs?|animated|show\s*me|send\s*me|of|on|from|e621|gelbooru|danbooru|paheal|xbooru)\b/gi, "")
    .trim()
    .replace(/\s+/g, "+")
    .toLowerCase();
  // If user wants GIFs/animated, append the 'animated' tag so boorus filter for animated content
  const booruTagsWithAnim = isGifQuery && booruTags ? booruTags + "+animated" : booruTags;

  // Run ALL strategies in parallel — boorus + Google + Bing + DDG all at once
  const allStrategies = await Promise.allSettled([
    // Strategy 0a: Rule34.xxx API (only for NSFW queries)
    ...(isNsfwQuery && booruTags ? [(async () => {
      const results = [];
      try {
        const apiUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${booruPage - 1}&tags=${encodeURIComponent(booruTagsWithAnim)}`;
        const apiRes = await fetch(apiUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(8000),
        });
        const posts = await apiRes.json();
        if (Array.isArray(posts)) {
          for (const post of posts) {
            const imgUrl = post.file_url || post.sample_url;
            if (imgUrl && isValidImageUrl(imgUrl)) {
              const tags = (post.tags || "").split(" ").slice(0, 5).join(", ");
              results.push({ url: imgUrl, alt: tags || booruTags.replace(/\+/g, " "), source: `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`, engine: "rule34" });
            }
          }
        }
      } catch (e) { console.log("[images] Rule34 API error:", e.message); }
      return results;
    })()] : []),

    // Strategy 0b: Gelbooru API (only for NSFW queries)
    ...(isNsfwQuery && booruTags ? [(async () => {
      const results = [];
      try {
        const apiUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${booruPage - 1}&tags=${encodeURIComponent(booruTagsWithAnim)}`;
        const apiRes = await fetch(apiUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(8000),
        });
        const data = await apiRes.json();
        const posts = data.post || data;
        if (Array.isArray(posts)) {
          for (const post of posts) {
            const imgUrl = post.file_url || post.sample_url;
            if (imgUrl && isValidImageUrl(imgUrl)) {
              const tags = (post.tags || "").split(" ").slice(0, 5).join(", ");
              results.push({ url: imgUrl, alt: tags || booruTags.replace(/\+/g, " "), source: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`, engine: "gelbooru" });
            }
          }
        }
      } catch (e) { console.log("[images] Gelbooru API error:", e.message); }
      return results;
    })()] : []),

    // Strategy 0c: e621 API (only for NSFW queries)
    ...(isNsfwQuery && booruTags ? [(async () => {
      const results = [];
      try {
        const apiUrl = `https://e621.net/posts.json?limit=100&page=${booruPage}&tags=${encodeURIComponent(booruTagsWithAnim)}`;
        const apiRes = await fetch(apiUrl, {
          headers: { "User-Agent": "SenkoAI/1.0 (search-api)" },
          signal: AbortSignal.timeout(8000),
        });
        const data = await apiRes.json();
        if (data.posts && Array.isArray(data.posts)) {
          for (const post of data.posts) {
            const imgUrl = post.file?.url || post.sample?.url || post.preview?.url;
            if (imgUrl && isValidImageUrl(imgUrl)) {
              const tags = (post.tags?.general || []).slice(0, 5).join(", ");
              results.push({ url: imgUrl, alt: tags || booruTags.replace(/\+/g, " "), source: `https://e621.net/posts/${post.id}`, engine: "e621" });
            }
          }
        }
      } catch (e) { console.log("[images] e621 API error:", e.message); }
      return results;
    })()] : []),

    // Strategy 1: Bing Images — fetch 10 pages in parallel (ALWAYS runs)
    (async () => {
      const results = [];
      try {
        const bingOffsets = Array.from({ length: 10 }, (_, i) => bingOffset + i * 35);
        const bingPages = await Promise.allSettled(
          bingOffsets.map((off) =>
            fetch(`https://www.bing.com/images/search?q=${encoded}&form=HDRSC2&first=${1 + off}&safeSearch=off`, {
              headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
              signal: AbortSignal.timeout(8000),
            }).then((r) => r.text())
          )
        );
        for (const pg of bingPages) {
          if (pg.status !== "fulfilled") continue;
          const html = pg.value;
          const mRegex = /m=["']({[^"']*?murl[^"']*?})["']/gi;
          let mMatch;
          while ((mMatch = mRegex.exec(html)) !== null) {
            try {
              const decoded = mMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
              const data = JSON.parse(decoded);
              if (data.murl && isValidImageUrl(data.murl) && !isImageDuplicate(data.murl, results)) {
                results.push({ url: data.murl, alt: data.t || query, source: data.purl || data.rurl || "", engine: "bing" });
              }
            } catch { }
          }
          const iuscRegex = /iusc=["']({[^"']*?})["']/gi;
          let iuscMatch;
          while ((iuscMatch = iuscRegex.exec(html)) !== null) {
            try {
              const decoded = iuscMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
              const data = JSON.parse(decoded);
              if (data.oi && isValidImageUrl(data.oi) && !isImageDuplicate(data.oi, results)) {
                results.push({ url: data.oi, alt: data.an || query, source: data.pi || "", engine: "bing" });
              }
            } catch { }
          }
        }
        console.log(`[images] Bing found ${results.length} images (10 pages)`);
      } catch (e) { console.log("[images] Bing error:", e.message); }
      return results;
    })(),

    // Strategy 2: DDG Images API (ALWAYS runs)
    (async () => {
      const results = [];
      try {
        const tokenRes = await fetch(`https://duckduckgo.com/?q=${encoded}&kp=-2&iax=images&ia=images`, {
          headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(6000),
        });
        const tokenHtml = await tokenRes.text();
        const vqdMatch = tokenHtml.match(/vqd=["']([^"']+)["']/i) || tokenHtml.match(/vqd=([\d-]+)/i);
        if (!vqdMatch) throw new Error("No vqd token found");
        const vqd = vqdMatch[1];
        const imgApiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=-1&s=${ddgOffset}`;
        const imgRes = await fetch(imgApiUrl, {
          headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://duckduckgo.com/" },
          signal: AbortSignal.timeout(8000),
        });
        const imgData = await imgRes.json();
        if (imgData.results && Array.isArray(imgData.results)) {
          for (const r of imgData.results) {
            const imgUrl = r.image;
            if (imgUrl && isValidImageUrl(imgUrl) && !isImageDuplicate(imgUrl, results)) {
              results.push({ url: imgUrl, alt: r.title || query, source: r.url || "", engine: "ddg" });
            }
          }
        }
        console.log(`[images] DDG Images API found ${results.length} images`);
      } catch (e) {
        console.log("[images] DDG Images API error:", e.message);
        try {
          const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}+images`, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(6000),
          });
          const searchHtml = await searchRes.text();
          const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
          const pageUrls = [];
          let urlMatch;
          while ((urlMatch = urlRegex.exec(searchHtml)) !== null) {
            try {
              const decoded = decodeURIComponent(urlMatch[1]);
              let pageUrl;
              if (decoded.startsWith("/") || decoded.startsWith("//")) {
                const uddg = new URL(`https://duckduckgo.com${decoded}`);
                pageUrl = uddg.searchParams.get("uddg") || "";
              } else {
                pageUrl = decoded;
              }
              if (pageUrl && pageUrl.startsWith("http") && !pageUrl.includes("youtube.com") && !pageUrl.includes("google.com")) {
                pageUrls.push(pageUrl);
              }
            } catch { }
          }
          const batchResults = await Promise.all(
            pageUrls.map((u) => scrapeImagesFromUrl(u).catch(() => []))
          );
          for (const pageImgs of batchResults) {
            for (const img of pageImgs) {
              if (!isImageDuplicate(img.url, results)) results.push({ ...img, engine: "ddg" });
            }
          }
        } catch { }
      }
      return results;
    })(),

    // Strategy 3: Google Images — fetch 10 pages in parallel (ALWAYS runs)
    (async () => {
      const results = [];
      try {
        const googleOffsets = Array.from({ length: 10 }, (_, i) => googleOffset + i * 20);
        const googlePages = await Promise.allSettled(
          googleOffsets.map((off) =>
            fetch(`https://www.google.com/search?q=${encoded}&tbm=isch&hl=en&start=${off}&safe=off`, {
              headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
              signal: AbortSignal.timeout(8000),
            }).then((r) => r.text())
          )
        );
        for (const pg of googlePages) {
          if (pg.status !== "fulfilled") continue;
          const html = pg.value;
          const jsonImgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
          let match;
          while ((match = jsonImgRegex.exec(html)) !== null) {
            const imgUrl = match[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
            const w = parseInt(match[2]);
            const h = parseInt(match[3]);
            if (w < 150 || h < 150) continue;
            if (!isValidImageUrl(imgUrl)) continue;
            if (!results.some((i) => i.url === imgUrl)) {
              const source = extractSourceFromGoogleHtml(html, match[1]);
              results.push({ url: imgUrl, alt: query, source, engine: "google" });
            }
          }
        }
        console.log(`[images] Google found ${results.length} images (10 pages)`);
      } catch (e) { console.log("[images] Google error:", e.message); }
      return results;
    })(),
  ]);

  // Merge all results — booru results first for NSFW, then mainstream engines
  const allResults = [];
  for (const s of allStrategies) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      for (const img of s.value) {
        allResults.push(img);
      }
    }
  }
  console.log(`[images] Total raw results: ${allResults.length} from ${allStrategies.length} strategies for "${query}"`);

  for (const img of allResults) {
    if (!isImageDuplicate(img.url, images)) images.push(img);
  }

  // Return all images with engine metadata for gallery mode source filtering
  const hasMore = images.length >= 10;
  console.log(`[images] Returning ${images.length} deduplicated images (page ${page})`);
  res.json({ images, query, page, hasMore });
});

// GET /url?url=URL&maxContent=5000&raw=0 — full page data extraction
app.get("/url", async (req, res) => {
  const url = req.query.url;
  const raw = req.query.raw === "1";
  const maxContent = parseInt(req.query.maxContent || "5000", 10);

  if (!url) {
    return res.status(400).json({ error: "url parameter required" });
  }

  try {
    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `HTTP ${fetchRes.status}`, url });
    }

    const finalUrl = fetchRes.url || url;
    const html = await fetchRes.text();
    let origin = "";
    try { origin = new URL(finalUrl).origin; } catch { }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);

    const meta = {
      title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "",
      description: descMatch ? descMatch[1].trim() : "",
      ogImage: ogImageMatch ? resolveUrl(ogImageMatch[1], origin, finalUrl) : "",
      favicon: faviconMatch ? resolveUrl(faviconMatch[1], origin, finalUrl) : `${origin}/favicon.ico`,
    };

    let content = "";
    try {
      content = extractText(html).slice(0, maxContent);
    } catch (e) {
      console.log("[url] extractText error:", e.message);
    }

    let videos = [];
    try {
      videos = extractVideos(html, origin, finalUrl);
    } catch (e) {
      console.log("[url] extractVideos error:", e.message);
    }

    const links = [];
    try {
      const linkRegex = /<a\b([^>]*?)href=["']([^"'#]+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
      let linkMatch;
      const seenUrls = new Set();
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 50) {
        const href = resolveUrl(linkMatch[2].trim(), origin, finalUrl);
        if (!href || seenUrls.has(href) || href.startsWith("javascript:") || AD_DOMAIN_PATTERN.test(href)) continue;
        seenUrls.add(href);
        const innerText = linkMatch[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        links.push({ url: href, text: innerText || href });
      }
    } catch (e) {
      console.log("[url] link extraction error:", e.message);
    }

    const pageImages = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let imgMatch;
    const seenImgs = new Set();
    while ((imgMatch = imgRegex.exec(html)) !== null && pageImages.length < 20) {
      const src = resolveUrl(imgMatch[1], origin, finalUrl);
      if (!src || seenImgs.has(src) || src.includes("favicon")) continue;
      seenImgs.add(src);
      pageImages.push({ url: src, alt: "" });
    }

    const headings = [];
    try {
      const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
      let hMatch;
      while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 20) {
        headings.push({ level: parseInt(hMatch[1]), text: hMatch[2].replace(/<[^>]+>/g, "").trim() });
      }
    } catch (e) {
      console.log("[url] heading extraction error:", e.message);
    }

    res.json({ url, finalUrl, meta, content, links, images: pageImages, videos, headings });
  } catch (err) {
    res.status(500).json({ error: err.message, url });
  }
});

// GET /browse?url=URL&maxContent=5000 — REAL BROWSER browsing with Puppeteer
// Unlike /url (static fetch), this loads the page in a real browser, runs JS, and extracts
// links, content, videos, and images from the fully rendered DOM. Use this for JS-heavy sites.
app.get("/browse", async (req, res) => {
  const url = req.query.url;
  const maxContent = parseInt(req.query.maxContent || "8000", 10);
  if (!url) return res.status(400).json({ error: "url required" });

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });

    // Inject blob tracking hooks BEFORE navigation (captures m3u8/mpd/mp4 URLs from XHR/fetch)
    await injectBlobTracking(page);

    // Universal network interception — catches ALL video requests regardless of site
    const networkVideos = [];
    const seenNetworkUrls = new Set();
    await page.setRequestInterception(true);
    setupVideoInterception(page, networkVideos, seenNetworkUrls);

    // Universal age-gate cookies — set for any domain (harmless on non-age-gated sites)
    await setAgeGateCookies(page, url);

    console.log(`[browse] Loading ${url}`);
    // Use shorter timeout — ad-heavy sites (rule34video etc.) never reach networkidle2
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {
      console.log(`[browse] networkidle2 timed out, continuing with partial load`);
    });
    const finalUrl = page.url();

    // Wait for dynamic content to render
    await new Promise((r) => setTimeout(r, 2000));

    // Try clicking play button — check both main document AND iframes
    try {
      const browsPlaySels = [
        "video", ".play-button", ".vjs-big-play-button", ".jw-icon-display",
        "[class*='play']", "[aria-label*='play']", "[title*='play']",
        ".fp-play", ".plyr__control--overlaid", ".video-play-button",
        "button[class*='play']", "div[class*='play']", ".vjs-poster",
      ];
      await page.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) { el.click(); break; }
        }
      }, browsPlaySels);
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          await frame.evaluate((sels) => {
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) { el.click(); break; }
            }
          }, browsPlaySels);
        } catch { }
      }
      await new Promise((r) => setTimeout(r, 5000));
    } catch { }

    // Extract everything from the rendered DOM
    const pageData = await page.evaluate((maxLen) => {
      const result = {
        title: document.title || "",
        description: "",
        content: "",
        links: [],
        images: [],
        videos: [],
        headings: [],
      };

      // Meta description
      const descMeta = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
      if (descMeta) result.description = descMeta.getAttribute("content") || "";

      // OG image
      const ogImg = document.querySelector('meta[property="og:image"]');
      const ogImage = ogImg ? ogImg.getAttribute("content") : "";

      // Extract text content from main content areas
      const mainEl = document.querySelector("main, article, [role='main'], .content, #content, .main-content") || document.body;
      const textParts = [];
      if (mainEl) {
        const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (["script", "style", "noscript", "svg", "iframe"].includes(tag)) return NodeFilter.FILTER_REJECT;
            const text = node.textContent.trim();
            if (text.length < 2) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let node;
        while ((node = walker.nextNode()) && textParts.join("\n").length < maxLen) {
          textParts.push(node.textContent.trim());
        }
      }
      result.content = textParts.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, maxLen);

      // Extract ALL links from rendered DOM (filtering ad/tracker domains)
      const adPattern = /\b(doubleclick|googlesyndication|adsystem|adserver|exoclick|juicyads|trafficjunky|trafficstars|popads|adsterra|adtng|afcpatrk|aftrk|nutaku\.net|adxpansion|clickadu|admaven|tubecorporate|twinrdsrv|plugrush|trafficforce|hilltopads|adcash|outbrain|taboola|criteo)\b/i;
      const seenUrls = new Set();
      document.querySelectorAll("a[href]").forEach((a) => {
        if (result.links.length >= 150) return;
        const href = a.href;
        if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || href === "#") return;
        if (seenUrls.has(href) || adPattern.test(href)) return;
        seenUrls.add(href);
        const text = (a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > 0 && text.length < 300) {
          result.links.push({ url: href, text });
        }
      });

      // Extract images from rendered DOM
      const seenImgs = new Set();
      if (ogImage) {
        result.images.push({ url: ogImage, alt: result.title });
        seenImgs.add(ogImage);
      }
      document.querySelectorAll("img").forEach((img) => {
        if (result.images.length >= 30) return;
        const src = img.currentSrc || img.src;
        if (!src || src.startsWith("data:") || seenImgs.has(src)) return;
        if (/favicon|icon|logo|pixel|1x1|spacer|tracking|\.svg/i.test(src)) return;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w && w < 50) return;
        if (h && h < 50) return;
        seenImgs.add(src);
        result.images.push({ url: src, alt: img.alt || "" });
      });

      // Extract videos from rendered DOM — uses universal extractor injected below
      // (video extraction is done via separate page.evaluate call after this one)

      // Extract headings
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        if (result.headings.length >= 30) return;
        const text = h.textContent.replace(/\s+/g, " ").trim();
        if (text.length > 0) {
          result.headings.push({ level: parseInt(h.tagName[1]), text });
        }
      });

      return result;
    }, maxContent);

    // Universal DOM video extraction — detects all player frameworks, data attrs, iframes, scripts
    const domVideos = await page.evaluate(universalDOMExtract);

    const title = await page.title();
    await page.close();

    // Merge network-intercepted videos with DOM-extracted videos (network = highest confidence)
    const allVideos = [];
    const allSeenVids = new Set();
    for (const v of networkVideos) {
      if (!allSeenVids.has(v.url)) { allVideos.push(v); allSeenVids.add(v.url); }
    }
    for (const v of domVideos) {
      if (!allSeenVids.has(v.url)) { allVideos.push(v); allSeenVids.add(v.url); }
    }

    sortVideos(allVideos);

    // Build meta
    const meta = {
      title: pageData.title || title,
      description: pageData.description,
      ogImage: pageData.images[0]?.url || "",
      favicon: `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(finalUrl).hostname; } catch { return ""; } })()}&sz=16`,
    };

    // Filter out ad/tracker links from extracted links
    const filteredLinks = pageData.links.filter(link => !AD_DOMAIN_PATTERN.test(link.url));

    console.log(`[browse] Done: ${finalUrl} — ${filteredLinks.length} links (${pageData.links.length - filteredLinks.length} ad links filtered), ${allVideos.length} videos, ${pageData.images.length} images`);
    res.json({
      url,
      finalUrl,
      meta,
      content: pageData.content,
      links: filteredLinks,
      images: pageData.images,
      videos: allVideos,
      headings: pageData.headings,
    });
  } catch (err) {
    if (page) await page.close().catch(() => { });
    console.error("[browse] Error:", err.message);
    res.status(500).json({ error: err.message || "Browse failed", url });
  }
});

// GET /video-extract?url=URL — Puppeteer deep video extraction (catches JS-rendered players)
app.get("/video-extract", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });

    // Universal age-gate cookies — set for any domain
    await setAgeGateCookies(page, url);

    // Inject blob tracking hooks BEFORE navigation (captures m3u8/mpd/mp4 URLs from XHR/fetch)
    await injectBlobTracking(page);

    // Universal network interception — catches ALL video requests regardless of site
    const networkVideos = [];
    const seenNetworkUrls = new Set();
    await page.setRequestInterception(true);
    setupVideoInterception(page, networkVideos, seenNetworkUrls);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {
      console.log(`[video-extract] networkidle2 timed out, continuing`);
    });

    // Wait for video player to initialize
    await new Promise((r) => setTimeout(r, 3000));

    // Try clicking play button — check both main document AND iframes (e.g. hanime omni-player)
    const playSelectors = [
      "video", ".play-button", ".vjs-big-play-button", ".jw-icon-display",
      "[class*='play']", "[aria-label*='play']", "[title*='play']",
      ".fp-play", ".plyr__control--overlaid", ".video-play-button",
      "button[class*='play']", "div[class*='play']", ".vjs-poster",
    ];
    try {
      // Click in main document first
      await page.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) { el.click(); break; }
        }
      }, playSelectors);
      // Also click inside all iframes (cross-origin iframes will throw — that's OK)
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          await frame.evaluate((sels) => {
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) { el.click(); break; }
            }
          }, playSelectors);
        } catch { }
      }
      // Wait for pre-roll ad to complete and real video to start loading
      await new Promise((r) => setTimeout(r, 8000));
    } catch { }

    // Universal DOM video extraction — detects all player frameworks, data attrs, iframes, scripts
    const domVideos = await page.evaluate(universalDOMExtract);

    const title = await page.title();
    await page.close();

    // Merge network + DOM videos, deduplicate
    const allVideos = [];
    const allSeen = new Set();
    // Network-intercepted videos are highest confidence
    for (const v of networkVideos) {
      if (!allSeen.has(v.url)) { allVideos.push(v); allSeen.add(v.url); }
    }
    for (const v of domVideos) {
      if (!allSeen.has(v.url)) { allVideos.push(v); allSeen.add(v.url); }
    }

    sortVideos(allVideos);

    console.log(`[video-extract] Found ${allVideos.length} videos on ${url} (${networkVideos.length} network, ${domVideos.length} DOM)`);
    
    // If no videos found, this might be a listing page — use universal link detection
    if (allVideos.length === 0) {
      console.log(`[video-extract] No videos found, checking for video links (listing page detection)`);
      let linkPage;
      try {
        const b = await getBrowser();
        linkPage = await b.newPage();
        await linkPage.setUserAgent(UA);
        await setAgeGateCookies(linkPage, url);
        await linkPage.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise((r) => setTimeout(r, 2000));
        
        // Universal listing page detection — no hard-coded URL patterns
        const videoLinks = await linkPage.evaluate(universalVideoLinkExtract);
        await linkPage.close();
        
        if (videoLinks.length > 0) {
          console.log(`[video-extract] Found ${videoLinks.length} video links on listing page`);
          res.json({ 
            videos: [], 
            videoLinks: videoLinks, 
            isListingPage: true, 
            title, 
            url,
            message: `This is a listing page with ${videoLinks.length} video links. Pick one to watch.`
          });
          return;
        }
      } catch (linkErr) {
        if (linkPage) await linkPage.close().catch(() => {});
        console.error("[video-extract] Link extraction failed:", linkErr.message);
      }
    }
    
    res.json({ videos: allVideos, title, url });
  } catch (err) {
    if (page) await page.close().catch(() => { });
    console.error("[video-extract] Error:", err.message);
    res.status(500).json({ error: err.message || "Video extraction failed", url });
  }
});

// GET /structured-browse?url=URL — Intelligent structured page extraction with navigation instructions
// Returns JSON that the AI can use to understand and navigate the page
app.get("/structured-browse", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1920, height: 1080 });

    // Inject blob tracking hooks BEFORE navigation
    await injectBlobTracking(page);

    // Universal network interception
    const networkVideos = [];
    const seenNetworkUrls = new Set();
    await page.setRequestInterception(true);
    setupVideoInterception(page, networkVideos, seenNetworkUrls);

    // Universal age-gate cookies
    await setAgeGateCookies(page, url);

    console.log(`[structured-browse] Loading ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 }).catch(() => {
      console.log(`[structured-browse] networkidle2 timed out, continuing`);
    });
    const finalUrl = page.url();

    // Wait for dynamic content
    await new Promise((r) => setTimeout(r, 2000));

    // Extract structured page data
    const structuredData = await page.evaluate(() => {
      const result = {
        pageType: "unknown", // listing, video, article, search, gallery, homepage
        title: document.title || "",
        description: "",
        
        // Content items (videos, images, articles, etc.)
        items: [],
        
        // Navigation options
        navigation: {
          pagination: null, // { currentPage, totalPages, nextUrl, prevUrl, pageUrls }
          categories: [],   // [{ name, url, count? }]
          filters: [],      // [{ name, options: [{ label, url, active }] }]
          search: null,     // { formUrl, inputName, currentQuery }
          sorting: [],      // [{ label, url, active }]
          breadcrumbs: [],  // [{ text, url }]
        },
        
        // Page sections for complex navigation
        sections: [],
        
        // Raw content for fallback
        textContent: "",
      };

      // Helper: extract text safely
      const getText = (el) => el?.textContent?.replace(/\s+/g, " ").trim() || "";
      
      // Helper: resolve URL
      const resolveUrl = (href) => {
        if (!href) return "";
        try {
          return new URL(href, location.origin).href;
        } catch { return href; }
      };

      // Helper: check if URL is navigation (not content)
      const isNavUrl = (url) => /\/(login|signup|register|account|privacy|terms|dmca|contact|about|help|faq)\b/i.test(url);
      
      // Helper: check if URL is ad/tracker
      const isAdUrl = (url) => /\b(doubleclick|googlesyndication|adsystem|exoclick|juicyads|trafficjunky|popads|adsterra|adtng|afcpatrk|nutaku|adxpansion|clickadu|admaven|tubecorporate|plugrush|trafficforce|hilltopads|outbrain|taboola|criteo)\b/i.test(url);

      // 1. Detect page type based on URL and content
      const urlLower = location.href.toLowerCase();
      const hasVideoPlayer = !!document.querySelector("video, .video-player, .player-container, #player, .jw-video, .vjs-tech, [class*='player']");
      const hasSearchResults = !!document.querySelector(".search-results, .results, [class*='search-result'], [class*='video-list'], .videos-list, .thumb-list");
      const hasGallery = !!document.querySelector(".gallery, .image-gallery, [class*='gallery'], .thumbs, .grid");
      const hasPagination = !!document.querySelector(".pagination, .pager, [class*='pagination'], .page-numbers, nav[aria-label*='page']");
      
      if (hasVideoPlayer && !hasSearchResults) {
        result.pageType = "video";
      } else if (/\/search|[?&]q=|[?&]query=|[?&]search=/i.test(urlLower) || hasSearchResults) {
        result.pageType = "search";
      } else if (hasGallery || /\/gallery|\/images|\/photos/i.test(urlLower)) {
        result.pageType = "gallery";
      } else if (hasPagination || /\/videos|\/browse|\/category|\/tag/i.test(urlLower)) {
        result.pageType = "listing";
      } else if (urlLower === location.origin + "/" || urlLower === location.origin) {
        result.pageType = "homepage";
      } else if (document.querySelector("article, .article, .post, .entry-content")) {
        result.pageType = "article";
      }

      // 2. Extract meta description
      const descMeta = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
      if (descMeta) result.description = descMeta.getAttribute("content") || "";

      // 3. Extract content items using scoring approach (same as universalVideoLinkExtract)
      // This works reliably for rule34video, pornhub, and other video sites
      let items = [];
      const seenUrls = new Set();
      
      document.querySelectorAll("a[href]").forEach((a) => {
        if (items.length >= 50) return;
        const href = a.href;
        if (!href || seenUrls.has(href)) return;
        
        // Get title from multiple sources
        const titleAttr = a.getAttribute("title") || "";
        const altAttr = a.getAttribute("alt") || "";
        const innerText = (a.textContent || "").replace(/\s+/g, " ").trim();
        // Prefer title attribute, then alt, then inner text
        let title = titleAttr || altAttr || innerText;
        
        // Skip if no meaningful title
        if (!title || title.length < 3) return;
        
        const u = href.toLowerCase();
        // Skip navigation, auth, taxonomy, and ad links
        if (isNavUrl(u)) return;
        if (isAdUrl(u)) return;
        if (u === location.href.toLowerCase()) return;
        
        // Score the link — higher score = more likely to be content
        let score = 0;
        
        // URL contains video-related path segments
        if (/\/(video|watch|view_video|clip|embed|play|movie|episode)s?\b/i.test(u)) score += 3;
        if (/viewkey|watch\?v=|\/v\//i.test(u)) score += 3;
        // URL has an ID/slug pattern
        if (/\/[a-z0-9-]{10,}/i.test(u)) score += 1;
        if (/\d{3,}/.test(u)) score += 1;
        // Title is a reasonable length (not just "Home", "Next", etc.)
        if (title.length > 10 && title.length < 300) score += 2;
        // Has thumbnail inside
        const img = a.querySelector("img");
        if (img) score += 2;
        // Parent has video-related class
        if (a.closest(".thumb, .video-item, .video-card, [class*=thumb], [class*=video]")) score += 2;
        
        // Only include if score is high enough
        if (score >= 3) {
          seenUrls.add(href);
          
          // Get thumbnail
          const thumbnail = img ? (img.currentSrc || img.src || img.getAttribute("data-src") || "") : "";
          
          // Try to find duration from nearby elements
          const parent = a.closest(".thumb, .video-item, .video-card, [class*=thumb], [class*=video]") || a.parentElement;
          const durationEl = parent?.querySelector(".duration, .time, [class*='duration'], [class*='time']");
          const duration = durationEl ? getText(durationEl) : "";
          
          items.push({
            index: items.length + 1,
            title: title.slice(0, 200),
            url: resolveUrl(href),
            thumbnail: thumbnail ? resolveUrl(thumbnail) : "",
            duration,
            type: (img || duration) ? "video" : "link",
          });
        }
      });

      result.items = items;

      // 4. Extract pagination
      const paginationContainer = document.querySelector(".pagination, .pager, [class*='pagination'], .page-numbers, nav[aria-label*='page'], .pages");
      if (paginationContainer) {
        const pagination = { currentPage: 1, totalPages: null, nextUrl: null, prevUrl: null, pageUrls: [] };
        
        // Find current page
        const currentEl = paginationContainer.querySelector(".current, .active, [aria-current='page'], .selected");
        if (currentEl) {
          const num = parseInt(getText(currentEl));
          if (!isNaN(num)) pagination.currentPage = num;
        }
        
        // Find next/prev links
        const nextEl = paginationContainer.querySelector("a[rel='next'], .next a, a.next, [class*='next'] a, a[aria-label*='next']");
        const prevEl = paginationContainer.querySelector("a[rel='prev'], .prev a, a.prev, [class*='prev'] a, a[aria-label*='prev']");
        if (nextEl) pagination.nextUrl = resolveUrl(nextEl.href);
        if (prevEl) pagination.prevUrl = resolveUrl(prevEl.href);
        
        // Find page number links
        paginationContainer.querySelectorAll("a[href]").forEach((a) => {
          const num = parseInt(getText(a));
          if (!isNaN(num) && num > 0 && num < 1000) {
            pagination.pageUrls.push({ page: num, url: resolveUrl(a.href) });
            if (num > (pagination.totalPages || 0)) pagination.totalPages = num;
          }
        });
        
        if (pagination.nextUrl || pagination.prevUrl || pagination.pageUrls.length > 0) {
          result.navigation.pagination = pagination;
        }
      }

      // 5. Extract categories/tags
      const categoryContainers = document.querySelectorAll(".categories, .tags, [class*='category'], [class*='tag-list'], nav.tags, .sidebar-tags");
      categoryContainers.forEach((container) => {
        container.querySelectorAll("a[href]").forEach((a) => {
          const href = resolveUrl(a.href);
          const text = getText(a);
          if (text && text.length < 50 && !isAdUrl(href)) {
            const countMatch = text.match(/\((\d+)\)/);
            result.navigation.categories.push({
              name: text.replace(/\(\d+\)/, "").trim(),
              url: href,
              count: countMatch ? parseInt(countMatch[1]) : null,
            });
          }
        });
      });
      // Dedupe categories
      const seenCats = new Set();
      result.navigation.categories = result.navigation.categories.filter((c) => {
        if (seenCats.has(c.name.toLowerCase())) return false;
        seenCats.add(c.name.toLowerCase());
        return true;
      }).slice(0, 30);

      // 6. Extract sorting options
      const sortContainers = document.querySelectorAll(".sort, .sorting, [class*='sort'], .order-by, select[name*='sort'], select[name*='order']");
      sortContainers.forEach((container) => {
        if (container.tagName === "SELECT") {
          container.querySelectorAll("option").forEach((opt) => {
            result.navigation.sorting.push({
              label: opt.textContent.trim(),
              value: opt.value,
              active: opt.selected,
            });
          });
        } else {
          container.querySelectorAll("a[href]").forEach((a) => {
            result.navigation.sorting.push({
              label: getText(a),
              url: resolveUrl(a.href),
              active: a.classList.contains("active") || a.classList.contains("selected"),
            });
          });
        }
      });

      // 7. Extract search form
      const searchForm = document.querySelector("form[action*='search'], form[role='search'], form.search, .search-form form, #search-form");
      if (searchForm) {
        const input = searchForm.querySelector("input[type='search'], input[type='text'], input[name*='q'], input[name*='search'], input[name*='query']");
        if (input) {
          result.navigation.search = {
            formUrl: resolveUrl(searchForm.action || location.href),
            inputName: input.name || "q",
            currentQuery: input.value || "",
            method: searchForm.method?.toUpperCase() || "GET",
          };
        }
      }

      // 8. Extract breadcrumbs
      const breadcrumbContainer = document.querySelector(".breadcrumb, .breadcrumbs, [class*='breadcrumb'], nav[aria-label*='breadcrumb']");
      if (breadcrumbContainer) {
        breadcrumbContainer.querySelectorAll("a[href]").forEach((a) => {
          result.navigation.breadcrumbs.push({
            text: getText(a),
            url: resolveUrl(a.href),
          });
        });
      }

      // 9. Extract page sections (for complex sites)
      const sectionHeaders = document.querySelectorAll("h2, h3, .section-title, [class*='section-header']");
      sectionHeaders.forEach((header) => {
        const text = getText(header);
        if (text && text.length > 2 && text.length < 100) {
          // Find associated link if any
          const link = header.querySelector("a[href]") || header.closest("a[href]");
          result.sections.push({
            title: text,
            url: link ? resolveUrl(link.href) : null,
          });
        }
      });
      result.sections = result.sections.slice(0, 20);

      // 10. Extract text content (truncated)
      const mainEl = document.querySelector("main, article, [role='main'], .content, #content") || document.body;
      const textParts = [];
      const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (["script", "style", "noscript", "svg", "iframe"].includes(tag)) return NodeFilter.FILTER_REJECT;
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode()) && textParts.join(" ").length < 3000) {
        textParts.push(node.textContent.trim());
      }
      result.textContent = textParts.join(" ").replace(/\s+/g, " ").slice(0, 3000);

      return result;
    });

    // Extract videos from DOM
    const domVideos = await page.evaluate(universalDOMExtract);

    const title = await page.title();
    await page.close();

    // Merge network + DOM videos
    const allVideos = [];
    const allSeenVids = new Set();
    for (const v of networkVideos) {
      if (!allSeenVids.has(v.url)) { allVideos.push(v); allSeenVids.add(v.url); }
    }
    for (const v of domVideos) {
      if (!allSeenVids.has(v.url)) { allVideos.push(v); allSeenVids.add(v.url); }
    }
    sortVideos(allVideos);

    // Build navigation instructions for the AI
    const instructions = [];
    
    if (structuredData.items.length > 0) {
      instructions.push(`Found ${structuredData.items.length} items. Say "open #N" or "play #N" to select one.`);
    }
    
    if (structuredData.navigation.pagination) {
      const p = structuredData.navigation.pagination;
      let pageInfo = `Page ${p.currentPage}`;
      if (p.totalPages) pageInfo += ` of ${p.totalPages}`;
      if (p.nextUrl) pageInfo += `. Say "next page" to continue.`;
      if (p.prevUrl) pageInfo += ` Say "previous page" to go back.`;
      instructions.push(pageInfo);
    }
    
    if (structuredData.navigation.categories.length > 0) {
      instructions.push(`${structuredData.navigation.categories.length} categories available. Say "go to [category]" to browse.`);
    }
    
    if (structuredData.navigation.search) {
      instructions.push(`Search available. Say "search for [query]" to find content.`);
    }
    
    if (structuredData.navigation.sorting.length > 0) {
      const sortOpts = structuredData.navigation.sorting.map(s => s.label).slice(0, 5).join(", ");
      instructions.push(`Sort by: ${sortOpts}`);
    }

    console.log(`[structured-browse] Done: ${finalUrl} — ${structuredData.pageType} page, ${structuredData.items.length} items, ${allVideos.length} videos`);
    
    res.json({
      url,
      finalUrl,
      pageType: structuredData.pageType,
      title: structuredData.title || title,
      description: structuredData.description,
      items: structuredData.items,
      videos: allVideos,
      navigation: structuredData.navigation,
      sections: structuredData.sections,
      instructions,
      textContent: structuredData.textContent,
    });
  } catch (err) {
    if (page) await page.close().catch(() => { });
    console.error("[structured-browse] Error:", err.message);
    res.status(500).json({ error: err.message || "Structured browse failed", url });
  }
});

// GET /screenshot?url=URL — take a screenshot using Puppeteer
app.get("/screenshot", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

    // Wait for dynamic content
    await new Promise((r) => setTimeout(r, 2000));

    const screenshot = await page.screenshot({ type: "png", fullPage: false, encoding: "base64" });
    const title = await page.title();
    await page.close();

    res.json({ screenshot: `data:image/png;base64,${screenshot}`, title, url });
  } catch (err) {
    if (page) await page.close().catch(() => { });
    res.status(500).json({ error: err.message || "Screenshot failed" });
  }
});

// GET /video-proxy?url=VIDEO_URL — Stream video through our server to bypass CORS/referer/hotlink restrictions
// The browser can't play videos from sites that check Referer or block CORS. This proxies the request
// with the correct headers so the video plays in our <video> tag.
app.get("/video-proxy", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.status(400).json({ error: "url required" });

  try {
    const parsed = new URL(videoUrl);
    const origin = parsed.origin;
    
    // CDN URLs need the original site as referer, not the CDN itself
    // boomio-cdn serves rule34video, remote_control.php URLs need the source site referer
    let referer = origin + "/";
    if (/streamable\.cloud/i.test(videoUrl)) {
      referer = "https://player.hanime.tv/";
    } else if (/boomio-cdn\.com|remote_control\.php/i.test(videoUrl)) {
      // Extract source site from acctoken or default to rule34video
      const acctoken = parsed.searchParams.get("acctoken");
      if (acctoken) {
        // acctoken contains base64 encoded data with source domain
        try {
          const decoded = atob(acctoken.split("|")[0]);
          const domainMatch = decoded.match(/\b(rule34video|rule34world|xvideos|pornhub|xhamster)\.(com|net|org)\b/i);
          if (domainMatch) referer = `https://${domainMatch[0]}/`;
        } catch { }
      }
      // Fallback: boomio-cdn is primarily used by rule34video
      if (referer === origin + "/") referer = "https://rule34video.com/";
    }

    // Build headers that mimic a real browser on the source site
    const proxyHeaders = {
      "User-Agent": UA,
      "Referer": referer,
      "Origin": origin,
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "video",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    };

    // Forward Range header for seeking support
    if (req.headers.range) {
      proxyHeaders["Range"] = req.headers.range;
    }

    // Universal age-gate cookies — works for any site (harmless on non-age-gated sites)
    // Covers all common cookie names used by adult sites
    proxyHeaders["Cookie"] = [
      "age_verified=1",
      "age-verified=1",
      "over18=1",
      "is_adult=1",
      "disclaimer=1",
      "consent=1",
      "age_check=1",
      "mature_content=1",
      "accessAgeDisclaimerPH=1",
      "accessAgeDisclaimerXV=1",
      "accessPH=1",
      "platform=pc",
      "country=US",
      "age=1",
    ].join("; ");

    console.log(`[video-proxy] Proxying: ${videoUrl.slice(0, 120)}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const upstream = await fetch(videoUrl, {
      headers: proxyHeaders,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[video-proxy] Upstream returned ${upstream.status} for ${videoUrl.slice(0, 80)}`);
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    // Forward relevant response headers
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");

    // Set CORS headers so the browser can play this
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

    // Use 206 for range requests, 200 otherwise
    res.status(upstream.status);

    // Stream the video data through
    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          if (!res.writableEnded) {
            const ok = res.write(Buffer.from(value));
            if (!ok) {
              await new Promise((resolve) => res.once("drain", resolve));
            }
          } else {
            break;
          }
        }
      } catch (err) {
        if (!res.writableEnded) res.end();
      }
    };

    // Handle client disconnect
    req.on("close", () => {
      reader.cancel().catch(() => { });
    });

    await pump();
  } catch (err) {
    console.error("[video-proxy] Error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Proxy failed" });
    }
  }
});

// OPTIONS handler for video-proxy CORS preflight
app.options("/video-proxy", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  res.status(204).end();
});

// Developer memory storage endpoint (file-based, persistent on Render.com)
const fs = require("fs");
const path = require("path");

const DEV_PASSPHRASE = "333senko";
const MEMORY_DIR = path.join(__dirname, "dev-memory");
const MEMORY_FILE = path.join(MEMORY_DIR, "memories.json");
const CONV_DIR = path.join(MEMORY_DIR, "conversations");

// Ensure directories exist
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });

// Auth middleware
function authDev(req, res, next) {
  const passphrase = req.headers["x-dev-passphrase"];
  if (passphrase !== DEV_PASSPHRASE) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// GET /dev-memory?type=memories|conversations&id=convId
app.get("/dev-memory", authDev, (req, res) => {
  const type = req.query.type || "memories";

  if (type === "memories") {
    try {
      const data = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) : [];
      res.json({ memories: data });
    } catch (err) {
      console.error("[dev-memory] Read error:", err);
      res.json({ memories: [] });
    }
  } else if (type === "conversations") {
    const convId = req.query.id;
    if (convId) {
      const convFile = path.join(CONV_DIR, `${convId}.json`);
      try {
        const data = fs.existsSync(convFile) ? JSON.parse(fs.readFileSync(convFile, "utf8")) : null;
        res.json({ conversation: data });
      } catch (err) {
        console.error("[dev-memory] Conv read error:", err);
        res.json({ conversation: null });
      }
    } else {
      // List all conversations
      try {
        const files = fs.readdirSync(CONV_DIR).filter(f => f.endsWith(".json"));
        const conversations = files.slice(-20).map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), "utf8"));
          } catch { return null; }
        }).filter(Boolean);
        res.json({ conversations });
      } catch (err) {
        console.error("[dev-memory] Conv list error:", err);
        res.json({ conversations: [] });
      }
    }
  } else {
    res.status(400).json({ error: "Invalid type" });
  }
});

// POST /dev-memory { type: "memory"|"conversation", key, value, id, title, summary }
app.post("/dev-memory", authDev, (req, res) => {
  const { type, key, value, id, title, summary } = req.body;

  if (type === "memory") {
    if (!key || !value) return res.status(400).json({ error: "key and value required" });

    try {
      const memories = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) : [];
      const existing = memories.findIndex(m => m.key.toLowerCase() === key.toLowerCase());

      if (existing >= 0) {
        memories[existing] = { key, value, timestamp: Date.now() };
      } else {
        memories.push({ key, value, timestamp: Date.now() });
      }

      const trimmed = memories.length > 200 ? memories.slice(-200) : memories;
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(trimmed, null, 2));
      res.json({ ok: true, count: trimmed.length });
    } catch (err) {
      console.error("[dev-memory] Write error:", err);
      res.status(500).json({ error: "Write failed" });
    }
  } else if (type === "conversation") {
    if (!id || !summary) return res.status(400).json({ error: "id and summary required" });

    try {
      const conv = { id, title: title || "Untitled", summary, timestamp: Date.now() };
      const convFile = path.join(CONV_DIR, `${id}.json`);
      fs.writeFileSync(convFile, JSON.stringify(conv, null, 2));
      res.json({ ok: true });
    } catch (err) {
      console.error("[dev-memory] Conv write error:", err);
      res.status(500).json({ error: "Write failed" });
    }
  } else {
    res.status(400).json({ error: "Invalid type" });
  }
});

// DELETE /dev-memory?key=memoryKey
app.delete("/dev-memory", authDev, (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: "key required" });

  try {
    const memories = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) : [];
    const filtered = memories.filter(m => m.key.toLowerCase() !== key.toLowerCase());

    if (filtered.length === memories.length) {
      return res.status(404).json({ error: "Memory not found" });
    }

    fs.writeFileSync(MEMORY_FILE, JSON.stringify(filtered, null, 2));
    res.json({ ok: true, count: filtered.length });
  } catch (err) {
    console.error("[dev-memory] Delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Search API running on port ${PORT} (0.0.0.0)`);
});
