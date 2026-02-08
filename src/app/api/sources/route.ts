import { NextRequest } from "next/server";

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

function decodeDDGUrl(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/") || decoded.startsWith("//")) {
      const uddg = new URL(`https://duckduckgo.com${decoded}`);
      return uddg.searchParams.get("uddg") || raw;
    }
  } catch { /* use raw */ }
  return raw;
}

function extractDDGResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  let match;

  // Pattern 1: link + snippet combined
  const combinedRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  while ((match = combinedRegex.exec(html)) !== null && results.length < 10) {
    const url = decodeDDGUrl(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();
    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet, favicon: makeFavicon(url) });
    }
  }

  // Fallback: link only
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

function extractGoogleResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  let match;

  // Pattern 1: /url?q= links with h3 titles
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    if (title && url && !url.includes("google.com")) {
      results.push({ title, url, snippet: "", favicon: makeFavicon(url) });
    }
  }

  // Pattern 2: cite + h3 fallback
  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites: string[] = [];
    const titles: string[] = [];
    while ((match = citeRegex.exec(html)) !== null) cites.push(match[1].replace(/<[^>]*>/g, "").trim());
    while ((match = h3Regex.exec(html)) !== null) titles.push(match[1].replace(/<[^>]*>/g, "").trim());
    for (let i = 0; i < Math.min(cites.length, titles.length, 10); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      if (titles[i]) results.push({ title: titles[i], url, snippet: "", favicon: makeFavicon(url) });
    }
  }

  return results;
}

function extractBingResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];

  // Split by b_algo list items and extract from each block
  const blocks = html.split(/<li class="b_algo"/i);
  for (let i = 1; i < blocks.length && results.length < 10; i++) {
    const block = blocks[i];

    // Extract real URL from <cite> tag (Bing wraps links in bing.com/ck/a redirects)
    let url = "";
    const citeMatch = block.match(/<cite[^>]*>(.*?)<\/cite>/i);
    if (citeMatch) {
      url = citeMatch[1].replace(/<[^>]*>/g, "").replace(/\s/g, "").trim();
      if (!url.startsWith("http")) url = "https://" + url;
    }
    // Fallback: try to find a direct non-bing href
    if (!url || url.includes("bing.com")) {
      const hrefMatch = block.match(/href="(https?:\/\/(?!www\.bing\.com)[^"]+)"/i);
      if (hrefMatch) url = hrefMatch[1].replace(/&amp;/g, "&");
    }

    // Extract title from <h2> > <a> (strip all nested HTML)
    let title = "";
    const h2Match = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (h2Match) {
      title = h2Match[1].replace(/<[^>]*>/g, "").trim();
    }

    // Extract snippet from <p> or .b_caption
    let snippet = "";
    const snippetMatch = block.match(/<p[^>]*class="[^"]*"[^>]*>(.*?)<\/p>/i) || block.match(/<p[^>]*>(.*?)<\/p>/i);
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]*>/g, "").trim();
    }

    if (title && url && url.startsWith("http") && !url.includes("bing.com")) {
      results.push({ title, url, snippet, favicon: makeFavicon(url) });
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

  // Run ALL strategies in parallel for speed
  const [ddgResults, googleResults, bingResults] = await Promise.all([
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(5000),
        });
        return res.ok ? extractDDGResults(await res.text()) : [];
      } catch { return []; }
    })(),
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://www.google.com/search?q=${encoded}&hl=en&num=10`, {
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(6000),
        });
        return res.ok ? extractGoogleResults(await res.text()) : [];
      } catch { return []; }
    })(),
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://www.bing.com/search?q=${encoded}`, {
          headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
          signal: AbortSignal.timeout(6000),
        });
        return res.ok ? extractBingResults(await res.text()) : [];
      } catch { return []; }
    })(),
  ]);

  // Merge: prefer DDG (best quality), then Google, then Bing. Dedup by hostname+path.
  const seen = new Set<string>();
  const results: SourceResult[] = [];
  for (const source of [...ddgResults, ...googleResults, ...bingResults]) {
    try {
      const key = new URL(source.url).hostname + new URL(source.url).pathname;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(source);
      }
    } catch {
      results.push(source);
    }
    if (results.length >= 10) break;
  }

  return Response.json({ sources: results, query });
}
