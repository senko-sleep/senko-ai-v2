const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3001;

// Reusable browser instance
let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.CHROME_BIN || "/usr/bin/chromium-browser",
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
  } catch {}
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
        try { title = new URL(title).hostname.replace(/^www\./, ""); } catch {}
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
    } catch {}
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
  } catch {}
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
  } catch {}
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
    if (page) await page.close().catch(() => {});
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

    await page.waitForSelector("[data-result]", { timeout: 8000 }).catch(() => {});

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
    if (page) await page.close().catch(() => {});
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
    if (page) await page.close().catch(() => {});
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
// IMAGE SEARCH UTILITIES
// ============================================================================

const IMAGE_SITE_DOMAINS = [
  "wallpapers.com", "wallpaperswide.com", "wallpaperflare.com", "wallpaperaccess.com",
  "wallhaven.cc", "alphacoders.com", "wall.alphacoders.com",
  "pinterest.com", "pinterest.co", "pin.it",
  "deviantart.com", "artstation.com",
  "flickr.com", "500px.com", "unsplash.com", "pexels.com", "pixabay.com",
  "zerochan.net", "danbooru.donmai.us", "gelbooru.com", "safebooru.org",
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

async function scrapeImagesFromUrl(url, limit = 12) {
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
    try { origin = new URL(url).origin; } catch {}

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
    while ((srcsetMatch = srcsetRegex.exec(html)) !== null && images.length < limit) {
      const entries = srcsetMatch[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const entry of entries) {
        if (images.length >= limit) break;
        const src = resolveImgUrl(entry);
        if (src && !images.some((i) => i.url === src)) {
          images.push({ url: src, alt: "", source: url });
        }
      }
    }

    // data-src, data-original, etc.
    const lazyRegex = /(?:data-src|data-original|data-lazy-src|data-full|data-image|data-bg)=["'](https?:\/\/[^"']+)["']/gi;
    let lazyMatch;
    while ((lazyMatch = lazyRegex.exec(html)) !== null && images.length < limit) {
      const src = resolveImgUrl(lazyMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // background-image CSS
    const bgRegex = /background-image:\s*url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
    let bgMatch;
    while ((bgMatch = bgRegex.exec(html)) !== null && images.length < limit) {
      const src = resolveImgUrl(bgMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // img tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null && images.length < limit) {
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
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null && images.length < limit) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        const extractImages = (obj) => {
          if (typeof obj !== "object" || !obj) return;
          for (const [key, val] of Object.entries(obj)) {
            if ((key === "image" || key === "thumbnailUrl" || key === "contentUrl") && typeof val === "string") {
              const src = resolveImgUrl(val);
              if (src && !images.some((i) => i.url === src) && images.length < limit) {
                images.push({ url: src, alt: "", source: url });
              }
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === "string" && item.startsWith("http")) {
                  const src = resolveImgUrl(item);
                  if (src && !images.some((i) => i.url === src) && images.length < limit) {
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
      } catch {}
    }
  } catch {}
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
    try { clean = new URL(clean).hostname.replace(/^www\./, ""); } catch {}
  }
  if (!clean) {
    try { clean = new URL(url).hostname.replace(/^www\./, ""); } catch { clean = url; }
  }
  return clean;
}

function makeFavicon(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return ""; }
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

    const truncated = text.length > 5000 ? text.slice(0, 5000) + "..." : text;

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

    res.json({ title, description, content: truncated, images: images.slice(0, 8), url, length: text.length });
  } catch (err) {
    res.json({ error: err.message || "Scrape failed", content: "" });
  }
});

// GET /images?q=query OR /images?url=URL — image search or scrape
app.get("/images", async (req, res) => {
  const query = req.query.q;
  const scrapeUrl = req.query.url;

  if (!query && !scrapeUrl) {
    return res.status(400).json({ error: "q or url required" });
  }

  // Mode 1: Scrape images from a specific URL
  if (scrapeUrl) {
    const images = await scrapeImagesFromUrl(scrapeUrl, 20);
    return res.json({ images, query: scrapeUrl });
  }

  // Mode 2: Search for images via multiple strategies in parallel
  const images = [];
  const encoded = encodeURIComponent(query);

  const [strategy1, strategy2, strategy3] = await Promise.allSettled([
    // Strategy 1: Bing Images
    (async () => {
      const results = [];
      try {
        const bingUrl = `https://www.bing.com/images/search?q=${encoded}&form=HDRSC2&first=1`;
        const bingRes = await fetch(bingUrl, {
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(8000),
        });
        const html = await bingRes.text();
        const mRegex = /m=["']({[^"']*?murl[^"']*?})["']/gi;
        let mMatch;
        while ((mMatch = mRegex.exec(html)) !== null && results.length < 20) {
          try {
            const decoded = mMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const data = JSON.parse(decoded);
            if (data.murl && isValidImageUrl(data.murl)) {
              const source = data.purl || data.rurl || "";
              if (!isImageDuplicate(data.murl, results)) {
                results.push({ url: data.murl, alt: data.t || query, source });
              }
            }
          } catch {}
        }
        if (results.length < 5) {
          const iuscRegex = /iusc=["']({[^"']*?})["']/gi;
          let iuscMatch;
          while ((iuscMatch = iuscRegex.exec(html)) !== null && results.length < 20) {
            try {
              const decoded = iuscMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
              const data = JSON.parse(decoded);
              if (data.oi && isValidImageUrl(data.oi)) {
                if (!results.some((i) => i.url === data.oi)) {
                  results.push({ url: data.oi, alt: data.an || query, source: data.pi || "" });
                }
              }
            } catch {}
          }
        }
      } catch {}
      return results;
    })(),

    // Strategy 2: DDG search → scrape top pages
    (async () => {
      const results = [];
      try {
        const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(6000),
        });
        const searchHtml = await searchRes.text();
        const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
        const imageSiteUrls = [];
        const otherUrls = [];
        let urlMatch;
        while ((urlMatch = urlRegex.exec(searchHtml)) !== null && (imageSiteUrls.length + otherUrls.length) < 10) {
          try {
            const decoded = decodeURIComponent(urlMatch[1]);
            let pageUrl;
            if (decoded.startsWith("/") || decoded.startsWith("//")) {
              const uddg = new URL(`https://duckduckgo.com${decoded}`);
              pageUrl = uddg.searchParams.get("uddg") || "";
            } else {
              pageUrl = decoded;
            }
            if (!pageUrl || !pageUrl.startsWith("http") || pageUrl.includes("youtube.com") || pageUrl.includes("google.com")) continue;
            if (isImageSite(pageUrl)) imageSiteUrls.push(pageUrl);
            else otherUrls.push(pageUrl);
          } catch {}
        }
        const toScrape = [...imageSiteUrls.slice(0, 5), ...otherUrls.slice(0, 3)];
        const batchResults = await Promise.all(
          toScrape.map((u) => scrapeImagesFromUrl(u, 6).catch(() => []))
        );
        for (const pageImgs of batchResults) {
          for (const img of pageImgs) {
            if (results.length >= 20) break;
            if (!results.some((i) => i.url === img.url)) results.push(img);
          }
        }
      } catch {}
      return results;
    })(),

    // Strategy 3: Google Images
    (async () => {
      const results = [];
      try {
        const googleUrl = `https://www.google.com/search?q=${encoded}&tbm=isch&hl=en`;
        const googleRes = await fetch(googleUrl, {
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(8000),
        });
        const html = await googleRes.text();
        const jsonImgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
        let match;
        while ((match = jsonImgRegex.exec(html)) !== null && results.length < 20) {
          const imgUrl = match[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
          const w = parseInt(match[2]);
          const h = parseInt(match[3]);
          if (w < 150 || h < 150) continue;
          if (!isValidImageUrl(imgUrl)) continue;
          if (!results.some((i) => i.url === imgUrl)) {
            const source = extractSourceFromGoogleHtml(html, match[1]);
            results.push({ url: imgUrl, alt: query, source });
          }
        }
      } catch {}
      return results;
    })(),
  ]);

  const allResults = [
    ...(strategy1.status === "fulfilled" ? strategy1.value : []),
    ...(strategy2.status === "fulfilled" ? strategy2.value : []),
    ...(strategy3.status === "fulfilled" ? strategy3.value : []),
  ];

  for (const img of allResults) {
    if (images.length >= 24) break;
    if (!isImageDuplicate(img.url, images)) images.push(img);
  }

  res.json({ images: images.slice(0, 20), query });
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
      return res.status(fetchRes.status).json({ error: `HTTP ${fetchRes.status} ${fetchRes.statusText}`, url });
    }

    const finalUrl = fetchRes.url || url;
    const html = await fetchRes.text();
    let origin = "";
    try { origin = new URL(finalUrl).origin; } catch {}

    // --- Extract metadata ---
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);

    const meta = {
      title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "",
      description: descMatch ? descMatch[1].trim() : "",
      ogImage: ogImageMatch ? resolveUrl(ogImageMatch[1], origin, finalUrl) : "",
      ogTitle: ogTitleMatch ? ogTitleMatch[1].trim() : "",
      ogDescription: ogDescMatch ? ogDescMatch[1].trim() : "",
      canonical: canonicalMatch ? canonicalMatch[1] : "",
      favicon: faviconMatch ? resolveUrl(faviconMatch[1], origin, finalUrl) : `${origin}/favicon.ico`,
    };

    // --- Extract text content ---
    const content = extractText(html).slice(0, maxContent);

    // --- Extract links ---
    const links = [];
    const linkRegex = /<a\b([^>]*?)href=["']([^"'#]+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    const seenUrls = new Set();
    while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 100) {
      const preAttrs = linkMatch[1];
      const href = resolveUrl(linkMatch[2].trim(), origin, finalUrl);
      const postAttrs = linkMatch[3];
      const innerHtml = linkMatch[4];
      if (!href || seenUrls.has(href)) continue;
      if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      seenUrls.add(href);
      const titleAttr = (preAttrs + postAttrs).match(/title=["']([^"']+)["']/i);
      const innerText = innerHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const label = titleAttr ? titleAttr[1] : (innerText.length > 0 && innerText.length < 200 ? innerText : (() => { try { return decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop() || href); } catch { return href; } })());
      links.push({ url: href, text: label });
    }

    // --- Extract images ---
    const pageImages = [];
    if (meta.ogImage) {
      pageImages.push({ url: meta.ogImage, alt: meta.ogTitle || meta.title || "" });
    }
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let imgMatch;
    const seenImgs = new Set(meta.ogImage ? [meta.ogImage] : []);
    while ((imgMatch = imgRegex.exec(html)) !== null && pageImages.length < 30) {
      const src = resolveUrl(imgMatch[1], origin, finalUrl);
      if (!src || seenImgs.has(src)) continue;
      if (src.includes("data:") || src.includes(".svg") || src.includes("favicon") || src.includes("logo") || src.includes("icon") || src.includes("pixel") || src.includes("1x1") || src.includes("spacer") || src.includes("tracking")) continue;
      seenImgs.add(src);
      const tag = imgMatch[0];
      const wMatch = tag.match(/width=["']?(\d+)/i);
      const hMatch = tag.match(/height=["']?(\d+)/i);
      const w = wMatch ? parseInt(wMatch[1]) : undefined;
      const h = hMatch ? parseInt(hMatch[1]) : undefined;
      if (w && w < 50) continue;
      if (h && h < 50) continue;
      const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
      pageImages.push({ url: src, alt: altMatch ? altMatch[1] : "", width: w, height: h });
    }

    // --- Extract video sources ---
    const videos = [];
    const seenVideos = new Set();

    const ogVideoMatch = html.match(/<meta[^>]*property=["']og:video["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:video["']/i);
    if (ogVideoMatch) {
      const vUrl = resolveUrl(ogVideoMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) { videos.push({ url: vUrl }); seenVideos.add(vUrl); }
    }
    const ogVideoUrlMatch = html.match(/<meta[^>]*property=["']og:video:(?:secure_)?url["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:video:(?:secure_)?url["']/i);
    if (ogVideoUrlMatch) {
      const vUrl = resolveUrl(ogVideoUrlMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) { videos.push({ url: vUrl }); seenVideos.add(vUrl); }
    }

    const videoSrcRegex = /<video[^>]*\ssrc=["']([^"']+)["'][^>]*/gi;
    let videoMatch;
    while ((videoMatch = videoSrcRegex.exec(html)) !== null && videos.length < 10) {
      const vUrl = resolveUrl(videoMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) {
        const posterMatch = videoMatch[0].match(/poster=["']([^"']+)["']/i);
        videos.push({ url: vUrl, poster: posterMatch ? resolveUrl(posterMatch[1], origin, finalUrl) : undefined });
        seenVideos.add(vUrl);
      }
    }

    const sourceRegex = /<source[^>]*\ssrc=["']([^"']+)["'][^>]*/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(html)) !== null && videos.length < 10) {
      const vUrl = resolveUrl(sourceMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) {
        const typeMatch = sourceMatch[0].match(/type=["']([^"']+)["']/i);
        videos.push({ url: vUrl, type: typeMatch ? typeMatch[1] : undefined });
        seenVideos.add(vUrl);
      }
    }

    const jsVideoPatterns = [
      /(?:video_url|videoUrl|file_url|fileUrl|mp4_url|source_url|stream_url)\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /["'](?:file|src|source|url|mp4|video)["']\s*:\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /(?:src|href)\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m3u8)(?:\?[^"']*)?)["']/gi,
    ];
    for (const pattern of jsVideoPatterns) {
      let jsMatch;
      while ((jsMatch = pattern.exec(html)) !== null && videos.length < 10) {
        const vUrl = resolveUrl(jsMatch[1], origin, finalUrl);
        if (vUrl && !seenVideos.has(vUrl) && !vUrl.includes("ad") && !vUrl.includes("tracker")) {
          videos.push({ url: vUrl });
          seenVideos.add(vUrl);
        }
      }
    }

    // --- Extract headings ---
    const headings = [];
    const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hMatch;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 30) {
      const text = hMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        headings.push({ level: parseInt(hMatch[1]), text });
      }
    }

    const result = { url, finalUrl, meta, content, links, images: pageImages, videos, headings };
    if (raw) result.rawHtml = html.slice(0, 50000);

    res.json(result);
  } catch (err) {
    const message = err.message || "Unknown error";
    res.status(500).json({ error: message, url });
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
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message || "Screenshot failed" });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Search API running on port ${PORT}`);
});
