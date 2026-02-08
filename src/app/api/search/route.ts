import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function extractDDGResults(html: string): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];

  // Pattern 1: Standard DDG HTML results
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < 25) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();
    let url = rawUrl;
    try {
      const decoded = decodeURIComponent(rawUrl);
      if (decoded.startsWith("/") || decoded.startsWith("//")) {
        const uddg = new URL(`https://duckduckgo.com${decoded}`);
        url = uddg.searchParams.get("uddg") || rawUrl;
      }
    } catch { /* use raw */ }
    if (title && url && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }

  // Pattern 2: Fallback - extract links + snippets separately if pattern 1 fails
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && results.length < 25) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]*>/g, "").trim();
      let url = rawUrl;
      try {
        const decoded = decodeURIComponent(rawUrl);
        if (decoded.startsWith("/") || decoded.startsWith("//")) {
          const uddg = new URL(`https://duckduckgo.com${decoded}`);
          url = uddg.searchParams.get("uddg") || rawUrl;
        }
      } catch { /* use raw */ }
      if (title && url && url.startsWith("http")) {
        results.push({ title, url, snippet: "" });
      }
    }
  }

  return results;
}

function extractGoogleResults(html: string): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];

  // Google wraps results in <a href="/url?q=REAL_URL&..."><h3>Title</h3></a>
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null && results.length < 25) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    if (title && url && !url.includes("google.com") && !url.includes("youtube.com/results")) {
      results.push({ title, url, snippet: "" });
    }
  }

  // Fallback: extract from <cite> tags which contain URLs
  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites: string[] = [];
    const titles: string[] = [];
    while ((match = citeRegex.exec(html)) !== null) cites.push(match[1].replace(/<[^>]*>/g, "").trim());
    while ((match = h3Regex.exec(html)) !== null) titles.push(match[1].replace(/<[^>]*>/g, "").trim());
    for (let i = 0; i < Math.min(cites.length, titles.length, 25); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      if (titles[i]) results.push({ title: titles[i], url, snippet: "" });
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const encoded = encodeURIComponent(query);
  let results: { title: string; url: string; snippet: string }[] = [];

  // Strategy 1: DuckDuckGo HTML search
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const html = await res.text();
      results = extractDDGResults(html);
    }
  } catch { /* DDG failed */ }

  // Strategy 2: Google search fallback if DDG returned nothing
  if (results.length === 0) {
    try {
      const res = await fetch(`https://www.google.com/search?q=${encoded}&hl=en&num=15`, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        results = extractGoogleResults(html);
      }
    } catch { /* Google failed */ }
  }

  // Strategy 3: Bing search as last resort
  if (results.length === 0) {
    try {
      const res = await fetch(`https://www.bing.com/search?q=${encoded}`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        const linkRegex = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null && results.length < 25) {
          const url = match[1];
          const title = match[2].replace(/<[^>]*>/g, "").trim();
          const snippet = match[3].replace(/<[^>]*>/g, "").trim();
          if (title && url) results.push({ title, url, snippet });
        }
      }
    } catch { /* Bing failed */ }
  }

  return Response.json({ results, query });
}
