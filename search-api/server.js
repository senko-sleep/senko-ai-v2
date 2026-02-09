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

  // Pattern 1: Combined link + snippet
  const combined =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  while ((m = combined.exec(html)) !== null && results.length < 25) {
    const url = decodeDDGUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }

  // Pattern 2: Links only
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
      // Skip if title is empty, looks like a URL, or is a domain+URL concatenation
      if (!title) continue;
      if (/^https?:\/\//i.test(title)) {
        try { title = new URL(title).hostname.replace(/^www\./, ""); } catch {}
      }
      // Detect domain+URL concatenation like "stackexchange.comhttps://..."
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

    // Wait for results to load
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

// GET /scrape?url=URL
app.get("/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url parameter required" });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
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
      .replace(/<form[\s\S]*?<\/form>/gi, "");

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

    res.json({ title, description, content: truncated, url, length: text.length });
  } catch (err) {
    res.json({
      error: err.message || "Scrape failed",
      content: "",
    });
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
