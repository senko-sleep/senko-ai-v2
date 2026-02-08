import { NextRequest } from "next/server";
import { executeSearch } from "@/lib/search-orchestrator";

export const runtime = "nodejs";

function makeFavicon(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { return ""; }
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
      title: r.title,
      snippet: r.snippet,
      favicon: makeFavicon(r.url),
    }));

  console.log(`[sources] ${sources.length} results via ${log.resolvedBy || "none"} in ${log.totalTimeMs}ms`);
  return Response.json({ sources, query });
}
