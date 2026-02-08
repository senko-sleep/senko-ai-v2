import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      return Response.json({ results: [], error: "Search failed" });
    }

    const html = await res.text();

    const results: { title: string; url: string; snippet: string }[] = [];
    const resultRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 6) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]*>/g, "").trim();
      const snippet = match[3].replace(/<[^>]*>/g, "").trim();

      let url = rawUrl;
      try {
        const decoded = decodeURIComponent(rawUrl);
        const uddg = new URL(`https://duckduckgo.com${decoded}`);
        url = uddg.searchParams.get("uddg") || rawUrl;
      } catch {
        // use raw
      }

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    return Response.json({ results, query });
  } catch (err) {
    return Response.json({
      results: [],
      error: err instanceof Error ? err.message : "Search failed",
    });
  }
}
