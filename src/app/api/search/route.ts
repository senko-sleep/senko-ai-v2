import { NextRequest } from "next/server";
import { normalizeSafeSearch, type SafeSearch } from "@/lib/content-policy";
import { TtlCache, normalizeQuery } from "@/lib/agent/google-gate";
import { searchWeb } from "@/lib/server/web-search";

export const runtime = "nodejs";

interface SearchPayload {
  results: { title: string; url: string; snippet: string; source: string; category: string; engines: string[] }[];
  [key: string]: unknown;
}

// The same query asked again within 10 minutes (a retry, a follow-up, another tab) is answered
// from memory, and identical queries in flight at once share one request.
const searchCache = new TtlCache<SearchPayload>(10 * 60_000, 300);

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const level = normalizeSafeSearch(req.nextUrl.searchParams.get("safe"));
  const count = Math.max(1, Math.min(30, Number(req.nextUrl.searchParams.get("n")) || 15));
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }
  const payload = await searchCache.getOrLoad(`${level}|${count}|${normalizeQuery(query)}`, () => searchEngines(query, level, count), (v) => v.results.length > 0);
  return Response.json(payload);
}

async function searchEngines(query: string, level: SafeSearch, count: number): Promise<SearchPayload> {
  const start = Date.now();
  // Links are checked by the chat card; this route answers fast for its callers.
  const run = await searchWeb(query, { safe: level, count, checkLinks: false });
  console.log(`[search] "${query}": ${run.results.length} results via ${run.engines.join(", ") || "none"} in ${Date.now() - start}ms`);
  return {
    results: run.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, source: r.source, category: r.category, engines: r.engines })),
    engine: run.engines[0],
    engines: run.engines,
    attempts: run.attempts,
    hiddenAdult: run.hiddenAdult,
    totalMs: Date.now() - start,
    ...(run.results.length ? {} : { error: "All search engines failed" }),
  };
}
