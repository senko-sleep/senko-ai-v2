import { NextRequest } from "next/server";
import { executeSearch } from "@/lib/search-orchestrator";

export const runtime = "nodejs";

function makeFavicon(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return ""; }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanTitle(title: string, url: string): string {
  let clean = decodeEntities(title).trim();
  // Fix domain+URL concatenation (e.g. "stackexchange.comhttps://...")
  const concat = clean.match(/^([a-zA-Z0-9.-]+\.[a-z]{2,})(https?:\/\/.*)/i);
  if (concat) {
    try { clean = new URL(concat[2]).hostname.replace(/^www\./, ""); } catch { clean = concat[1]; }
  }
  if (/^https?:\/\//i.test(clean)) {
    try { clean = new URL(clean).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  }
  if (!clean) {
    try { clean = new URL(url).hostname.replace(/^www\./, ""); } catch { clean = url; }
  }
  return clean;
}

// GET /api/sources?q=query - Returns relevant source links for any topic
// Now powered by the full search cascade (DDG → Serper → Brave → Puppeteer → Bing)
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  console.log(`[sources] Query: "${query}"`);

  const { results, log } = await executeSearch(query);

  // Deduplicate and add favicons
  const seen = new Set<string>();
  const sources = results
    .filter((r) => {
      if (!r.url || !r.title) return false;
      try {
        const key = new URL(r.url).hostname + new URL(r.url).pathname;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      } catch {
        return true;
      }
    })
    .slice(0, 10)
    .map((r) => ({
      url: r.url,
      title: cleanTitle(r.title, r.url),
      snippet: decodeEntities(r.snippet || ""),
      favicon: makeFavicon(r.url),
    }));

  console.log(`[sources] ${sources.length} results via ${log.resolvedBy || "none"} in ${log.totalTimeMs}ms`);
  return Response.json({ sources, query });
}
