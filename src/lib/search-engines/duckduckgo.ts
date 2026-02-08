// Fallback Level 1: DuckDuckGo VQD with enhanced headers and cookie management

import { config } from "@/lib/config";
import type { SearchResult, EngineResponse } from "./types";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};

// Persistent cookie jar for session management
const cookies = new Map<string, string>();

function getCookieString(): string {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function storeCookies(setCookieHeader: string | null): void {
  if (!setCookieHeader) return;
  // set-cookie can have multiple values separated by commas (for non-expires commas)
  // but typically each header is one cookie
  const parts = setCookieHeader.split(/,(?=[^ ])/);
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      const name = part.slice(0, eqIdx).trim();
      const valEnd = part.indexOf(";", eqIdx);
      const value = valEnd > 0 ? part.slice(eqIdx + 1, valEnd) : part.slice(eqIdx + 1);
      cookies.set(name, value.trim());
    }
  }
}

function isBlocked(html: string): boolean {
  const lower = html.toLowerCase();
  const indicators = [
    "failed to get the vqd",
    "bot",
    "automated",
    "blocked",
    "suspicious activity",
    "access denied",
    "captcha",
    "rate limit",
    "too many requests",
    "unusual traffic",
  ];
  return indicators.some(i => lower.includes(i));
}

function extractResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  if (isBlocked(html)) return results;

  // Pattern 1: Combined link + snippet
  const combined = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let m;
  while ((m = combined.exec(html)) !== null && results.length < 25) {
    const url = decodeDDGUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }

  // Pattern 2: Links only (no snippet)
  if (results.length === 0) {
    const links = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((m = links.exec(html)) !== null && results.length < 25) {
      const url = decodeDDGUrl(m[1]);
      const title = stripTags(m[2]);
      if (title && url.startsWith("http")) results.push({ title, url, snippet: "" });
    }
  }

  // Pattern 3: Lite version format (table rows)
  if (results.length === 0) {
    const lite = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*class="result-link"[^>]*>(.*?)<\/a>/gi;
    while ((m = lite.exec(html)) !== null && results.length < 25) {
      const url = decodeDDGUrl(m[1]);
      const title = stripTags(m[2]);
      if (title && url.startsWith("http")) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

function decodeDDGUrl(raw: string): string {
  try {
    const clean = raw.replace(/&amp;/g, "&");
    const decoded = decodeURIComponent(clean);
    if (decoded.startsWith("/") || decoded.startsWith("//")) {
      const uddg = new URL(`https://duckduckgo.com${decoded}`);
      return uddg.searchParams.get("uddg") || raw;
    }
    if (decoded.startsWith("http")) return decoded;
  } catch { /* use raw */ }
  return raw;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * DuckDuckGo search with VQD handling, cookie persistence, and multiple endpoint fallbacks.
 * Tries lite.duckduckgo.com first (less bot detection), then html.duckduckgo.com.
 */
export async function searchDuckDuckGo(query: string): Promise<EngineResponse> {
  const encoded = encodeURIComponent(query);
  const timeout = config.searchTimeout;

  const endpoints = [
    { url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, referer: "https://lite.duckduckgo.com/" },
    { url: `https://html.duckduckgo.com/html/?q=${encoded}`, referer: "https://duckduckgo.com/" },
    { url: `https://duckduckgo.com/html/?q=${encoded}`, referer: "https://duckduckgo.com/" },
  ];

  let lastStatus = 0;
  let lastError = "";

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: {
          ...BASE_HEADERS,
          Cookie: getCookieString(),
          Referer: ep.referer,
        },
        signal: AbortSignal.timeout(timeout),
      });

      lastStatus = res.status;
      storeCookies(res.headers.get("set-cookie"));

      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${ep.url}`;
        continue;
      }

      const html = await res.text();

      if (isBlocked(html)) {
        lastStatus = 403;
        lastError = "DuckDuckGo VQD bot detection triggered";
        continue;
      }

      const results = extractResults(html);
      if (results.length === 0) {
        lastError = "DuckDuckGo returned HTML but no extractable results";
        continue;
      }

      return { results, status: 200 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout") || msg.includes("abort")) {
        lastStatus = 408;
        lastError = `DuckDuckGo request timed out after ${timeout}ms`;
      } else {
        lastStatus = 0;
        lastError = `DuckDuckGo network error: ${msg}`;
      }
    }
  }

  return { results: [], status: lastStatus, error: lastError };
}
