import { NextRequest } from "next/server";
import { search, SafeSearchType } from "duck-duck-scrape";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  favicon: string;
}

function makeFavicon(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return ""; }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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

function extractDDGResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  let match;
  const combinedRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  while ((match = combinedRegex.exec(html)) !== null && results.length < 10) {
    const url = decodeDDGUrl(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();
    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet, favicon: makeFavicon(url) });
    }
  }
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
      const url = decodeDDGUrl(match[1]);
      const title = match[2].replace(/<[^>]*>/g, "").trim();
      if (title && url.startsWith("http")) {
        results.push({ title, url, snippet: "", favicon: makeFavicon(url) });
      }
    }
  }
  return results;
}

// Fallback: direct HTML scraping if duck-duck-scrape fails
async function fallbackDDGHtml(query: string): Promise<SourceResult[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(6000),
    });
    console.log(`[sources/fallback] DDG HTML status: ${res.status}`);
    if (!res.ok) return [];
    const html = await res.text();
    console.log(`[sources/fallback] DDG HTML length: ${html.length}, has result__a: ${html.includes("result__a")}`);
    return extractDDGResults(html);
  } catch (e) {
    console.log(`[sources/fallback] Error: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

// GET /api/sources?q=query - Returns relevant source links for any topic
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  console.log(`[sources] Query: "${query}"`);

  // Try duck-duck-scrape first
  try {
    const searchResults = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    console.log(`[sources] DDG search returned ${searchResults.results?.length || 0} results, noResults: ${searchResults.noResults}`);

    if (!searchResults.noResults && searchResults.results && searchResults.results.length > 0) {
      const seen = new Set<string>();
      const results: SourceResult[] = [];

      for (const r of searchResults.results) {
        if (!r.url || !r.title) continue;
        try {
          const key = new URL(r.url).hostname + new URL(r.url).pathname;
          if (seen.has(key)) continue;
          seen.add(key);
        } catch { /* keep it */ }

        results.push({
          url: r.url,
          title: decodeHtmlEntities(r.title),
          snippet: decodeHtmlEntities(r.description || ""),
          favicon: makeFavicon(r.url),
        });

        if (results.length >= 10) break;
      }

      console.log(`[sources] Library success: ${results.length} results`);
      return Response.json({ sources: results, query });
    }
  } catch (e) {
    console.log(`[sources] Library failed: ${e instanceof Error ? e.message : e}`);
  }

  // Fallback to direct HTML scraping
  console.log(`[sources] Falling back to HTML scraping`);
  const fallbackResults = await fallbackDDGHtml(query);
  console.log(`[sources] Fallback: ${fallbackResults.length} results`);
  return Response.json({ sources: fallbackResults, query });
}
