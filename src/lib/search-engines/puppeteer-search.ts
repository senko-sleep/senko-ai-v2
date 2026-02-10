// Fallback Level 4: Custom Puppeteer instance for browser-based scraping
// Uses ScraperAPI or a remote Puppeteer WS endpoint to bypass bot detection

import { config } from "@/lib/config";
import type { SearchResult, EngineResponse } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Strategy A: Use ScraperAPI proxy to fetch Google results through a residential proxy.
 * This avoids needing a local Puppeteer binary on Vercel.
 */
async function scraperApiSearch(query: string): Promise<EngineResponse> {
  const apiKey = config.scraperApiKey;
  console.log(`[puppeteer] ScraperAPI key check: ${apiKey ? 'present' : 'missing'}, length: ${apiKey?.length || 0}`);
  if (!apiKey) {
    return {
      results: [],
      status: 401,
      error: "SCRAPER_API_KEY not configured — skipping ScraperAPI strategy",
    };
  }

  try {
    const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`;
    const scraperUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=us`;

    const res = await fetch(scraperUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(config.searchTimeout + 5000), // extra time for proxy
    });

    if (res.status === 401 || res.status === 403) {
      return {
        results: [],
        status: res.status,
        error: `ScraperAPI authentication failed (HTTP ${res.status}) — check SCRAPER_API_KEY`,
      };
    }

    if (res.status === 429) {
      return {
        results: [],
        status: 429,
        error: "ScraperAPI rate limit exceeded",
      };
    }

    if (!res.ok) {
      return {
        results: [],
        status: res.status,
        error: `ScraperAPI returned HTTP ${res.status}`,
      };
    }

    const html = await res.text();
    const results = extractGoogleResults(html);

    if (results.length === 0) {
      // Check for CAPTCHA
      if (html.toLowerCase().includes("captcha") || html.toLowerCase().includes("unusual traffic")) {
        return {
          results: [],
          status: 403,
          error: "ScraperAPI returned Google CAPTCHA page — proxy IP may be flagged",
        };
      }
      return {
        results: [],
        status: 200,
        error: "ScraperAPI returned HTML but no extractable Google results",
      };
    }

    return { results, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort")) {
      return {
        results: [],
        status: 408,
        error: `ScraperAPI request timed out after ${config.searchTimeout + 5000}ms`,
      };
    }
    return {
      results: [],
      status: 0,
      error: `ScraperAPI network error: ${msg}`,
    };
  }
}

/**
 * Strategy B: Use a remote Puppeteer WebSocket endpoint (e.g., Browserless, BrowserBase)
 * to run a real browser and extract search results.
 */
async function remotePuppeteerSearch(query: string): Promise<EngineResponse> {
  const wsEndpoint = config.puppeteerWsEndpoint;
  if (!wsEndpoint) {
    return {
      results: [],
      status: 0,
      error: "PUPPETEER_WS_ENDPOINT not configured — skipping remote Puppeteer strategy",
    };
  }

  try {
    // Dynamic import to avoid bundling puppeteer-core on client
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1920, height: 1080 });

      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: config.searchTimeout });

      // Check for CAPTCHA
      const content = await page.content();
      if (content.toLowerCase().includes("captcha") || content.toLowerCase().includes("unusual traffic")) {
        await page.close();
        return {
          results: [],
          status: 403,
          error: "Remote Puppeteer encountered Google CAPTCHA",
        };
      }

      // Extract results from the rendered page
      const results = await page.evaluate(() => {
        const items: { title: string; url: string; snippet: string }[] = [];
        const elements = document.querySelectorAll("#search .g");
        elements.forEach((el) => {
          const anchor = el.querySelector("a[href]") as HTMLAnchorElement | null;
          const h3 = el.querySelector("h3");
          const snippetEl = el.querySelector("[data-sncf], .VwiC3b, .IsZvec");
          if (anchor && h3 && anchor.href.startsWith("http")) {
            items.push({
              title: h3.textContent?.trim() || "",
              url: anchor.href,
              snippet: snippetEl?.textContent?.trim() || "",
            });
          }
        });
        return items.slice(0, 25);
      });

      await page.close();

      if (results.length === 0) {
        return {
          results: [],
          status: 200,
          error: "Remote Puppeteer loaded page but found no search result elements",
        };
      }

      return { results, status: 200 };
    } finally {
      browser.disconnect();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort")) {
      return {
        results: [],
        status: 408,
        error: `Remote Puppeteer timed out: ${msg}`,
      };
    }
    return {
      results: [],
      status: 0,
      error: `Remote Puppeteer error: ${msg}`,
    };
  }
}

function extractGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let m;

  // Google wraps results in <a href="/url?q=REAL_URL&..."><h3>Title</h3></a>
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  while ((m = linkRegex.exec(html)) !== null && results.length < 25) {
    const url = decodeURIComponent(m[1]);
    const title = m[2].replace(/<[^>]*>/g, "").trim();
    if (title && url && !url.includes("google.com") && !url.includes("youtube.com/results")) {
      results.push({ title, url, snippet: "" });
    }
  }

  // Fallback: extract from <cite> + <h3> pairs
  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites: string[] = [];
    const titles: string[] = [];
    while ((m = citeRegex.exec(html)) !== null) cites.push(m[1].replace(/<[^>]*>/g, "").trim());
    while ((m = h3Regex.exec(html)) !== null) titles.push(m[1].replace(/<[^>]*>/g, "").trim());
    for (let i = 0; i < Math.min(cites.length, titles.length, 25); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      if (titles[i]) results.push({ title: titles[i], url, snippet: "" });
    }
  }

  return results;
}

/**
 * Puppeteer-based search: tries ScraperAPI first (no binary needed),
 * then falls back to remote Puppeteer WS endpoint.
 */
export async function searchPuppeteer(query: string): Promise<EngineResponse> {
  // Quick bail: if neither ScraperAPI nor Puppeteer WS are configured, skip immediately
  if (!config.scraperApiKey && !config.puppeteerWsEndpoint) {
    return {
      results: [],
      status: 0,
      error: "Neither SCRAPER_API_KEY nor PUPPETEER_WS_ENDPOINT configured — skipping Puppeteer fallback",
    };
  }

  // Strategy A: ScraperAPI (works on Vercel, no binary)
  const scraperResult = await scraperApiSearch(query);
  if (scraperResult.results.length > 0) {
    return scraperResult;
  }

  // Strategy B: Remote Puppeteer WS (only try if ScraperAPI failed completely, not just no results)
  if (scraperResult.status === 401 || scraperResult.status === 403 || scraperResult.status === 429) {
    // ScraperAPI auth/rate limit error, try remote Puppeteer
    const puppeteerResult = await remotePuppeteerSearch(query);
    if (puppeteerResult.results.length > 0) {
      return puppeteerResult;
    }
    // Return the most descriptive error
    const error = puppeteerResult.error || scraperResult.error;
    const status = puppeteerResult.status || scraperResult.status;
    return { results: [], status, error };
  }

  // ScraperAPI worked but found no results, return that response
  return scraperResult;
}
