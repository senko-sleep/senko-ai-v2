import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  try {
    // Reuse our own /api/search route internally
    const baseUrl = req.nextUrl.origin;
    const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    
    // Transform search results into sources with favicons
    const sources = (data.results || []).map((r: { title: string; url: string; snippet?: string }) => {
      let favicon = "";
      try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=16`; } catch { /* */ }
      return { url: r.url, title: r.title, snippet: r.snippet || "", favicon };
    });

    return Response.json({ sources, query });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Sources request failed",
      sources: [],
    });
  }
}
