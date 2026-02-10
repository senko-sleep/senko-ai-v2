// Fallback search: Direct Google HTML scrape (no API key needed)

import { config } from "@/lib/config";
import type { SearchResult, EngineResponse } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function stripTags(html: string): string {
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

function extractGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let m;

  // Pattern 1: Standard Google result links with h3 titles
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  while ((m = linkRegex.exec(html)) !== null && results.length < 15) {
    const url = decodeURIComponent(m[1]);
    const title = stripTags(m[2]);
    if (title && url && !url.includes("google.com") && !url.includes("youtube.com/results")) {
      results.push({ title, url, snippet: "" });
    }
  }

  // Pattern 2: Fallback — extract from cite + h3 pairs
  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites: string[] = [];
    const titles: string[] = [];
    while ((m = citeRegex.exec(html)) !== null) cites.push(stripTags(m[1]));
    while ((m = h3Regex.exec(html)) !== null) titles.push(stripTags(m[1]));
    for (let i = 0; i < Math.min(cites.length, titles.length, 15); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      const title = titles[i];
      if (title && !title.startsWith("http")) {
        results.push({ title, url, snippet: "" });
      }
    }
  }

  return results;
}

/**
 * Direct Google HTML scrape — no API key needed.
 * Works well for local dev. May get rate-limited on heavy use.
 */
export async function searchGoogleScrape(query: string): Promise<EngineResponse> {
  const timeout = config.searchTimeout;

  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`,
      {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Referer": "https://www.google.com/",
        },
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!res.ok) {
      return { results: [], status: res.status, error: `Google returned HTTP ${res.status}` };
    }

    const html = await res.text();

    // Check for CAPTCHA / bot detection
    if (html.includes("unusual traffic") || html.includes("captcha") || html.includes("sorry/index")) {
      return { results: [], status: 429, error: "Google bot detection triggered" };
    }

    const results = extractGoogleResults(html);
    if (results.length === 0) {
      return { results: [], status: 200, error: "Google returned HTML but no extractable results" };
    }

    return { results, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort")) {
      return { results: [], status: 408, error: `Google scrape timed out after ${timeout}ms` };
    }
    return { results: [], status: 0, error: `Google scrape error: ${msg}` };
  }
}
