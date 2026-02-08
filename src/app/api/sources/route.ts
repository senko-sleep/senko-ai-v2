import { NextRequest } from "next/server";
import { search, SafeSearchType } from "duck-duck-scrape";

export const runtime = "nodejs";

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

// GET /api/sources?q=query - Returns relevant source links for any topic
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  console.log(`[sources] Query: "${query}"`);

  try {
    const searchResults = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    console.log(`[sources] DDG search returned ${searchResults.results?.length || 0} results, noResults: ${searchResults.noResults}`);

    if (searchResults.noResults || !searchResults.results || searchResults.results.length === 0) {
      console.log(`[sources] No results from DDG search`);
      return Response.json({ sources: [], query });
    }

    // Dedup by hostname+path
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

    console.log(`[sources] Final: ${results.length} results`);
    return Response.json({ sources: results, query });
  } catch (e) {
    console.error(`[sources] Error:`, e instanceof Error ? e.message : e);
    return Response.json({ sources: [], query, error: String(e instanceof Error ? e.message : e) });
  }
}
