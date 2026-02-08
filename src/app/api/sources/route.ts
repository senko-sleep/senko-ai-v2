import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  favicon: string;
}

function extractDDGResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];

  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
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
      let hostname = "";
      try { hostname = new URL(url).hostname; } catch { /* skip */ }
      results.push({
        title,
        url,
        snippet,
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
      });
    }
  }

  // Fallback pattern
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null && results.length < 8) {
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
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch { /* skip */ }
        results.push({
          title,
          url,
          snippet: "",
          favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
        });
      }
    }
  }

  return results;
}

function extractGoogleResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null && results.length < 8) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    if (title && url && !url.includes("google.com")) {
      let hostname = "";
      try { hostname = new URL(url).hostname; } catch { /* skip */ }
      results.push({
        title,
        url,
        snippet: "",
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
      });
    }
  }
  return results;
}

function extractBingResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  const linkRegex = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null && results.length < 8) {
    const url = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();
    if (title && url) {
      let hostname = "";
      try { hostname = new URL(url).hostname; } catch { /* skip */ }
      results.push({
        title,
        url,
        snippet,
        favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`,
      });
    }
  }
  return results;
}

// GET /api/sources?q=query - Returns relevant source links for any topic
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const encoded = encodeURIComponent(query);
  let results: SourceResult[] = [];

  // Strategy 1: DuckDuckGo
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = await res.text();
      results = extractDDGResults(html);
    }
  } catch { /* DDG failed */ }

  // Strategy 2: Google fallback
  if (results.length === 0) {
    try {
      const res = await fetch(`https://www.google.com/search?q=${encoded}&hl=en&num=10`, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const html = await res.text();
        results = extractGoogleResults(html);
      }
    } catch { /* Google failed */ }
  }

  // Strategy 3: Bing fallback
  if (results.length === 0) {
    try {
      const res = await fetch(`https://www.bing.com/search?q=${encoded}`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const html = await res.text();
        results = extractBingResults(html);
      }
    } catch { /* Bing failed */ }
  }

  return Response.json({ sources: results, query });
}
