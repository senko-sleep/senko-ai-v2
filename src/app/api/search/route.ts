import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ── HTML parsing utilities ──

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
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
  } catch { /* ignore */ }
  return raw;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── Extract results from HTML ──

function extractDDGResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let m: RegExpExecArray | null;

  // Try combined title+snippet extraction
  const combined = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;
  while ((m = combined.exec(html)) !== null && results.length < 15) {
    const url = decodeDDGUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url.startsWith("http")) results.push({ title, url, snippet });
  }

  // Fallback: just links
  if (results.length === 0) {
    const links = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    while ((m = links.exec(html)) !== null && results.length < 15) {
      const url = decodeDDGUrl(m[1]);
      const title = stripTags(m[2]);
      if (title && url.startsWith("http")) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

function extractGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let m: RegExpExecArray | null;

  // Primary: <a href="/url?q=..."><h3>title</h3></a>
  const linkRegex = /<a[^>]*href="\/url\?q=(https?[^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>(.*?)<\/h3>/gi;
  while ((m = linkRegex.exec(html)) !== null && results.length < 15) {
    const url = decodeURIComponent(m[1]);
    const title = stripTags(m[2]);
    if (title && url && !url.includes("google.com") && !url.includes("youtube.com/results")) {
      // Try to find snippet near this result
      const afterMatch = html.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      const snippetMatch = afterMatch.match(/<span[^>]*class="[^"]*(?:st|IsZvec|VwiC3b)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
      results.push({ title, url, snippet });
    }
  }

  // Fallback: cite + h3 pairing
  if (results.length === 0) {
    const citeRegex = /<cite[^>]*>(.*?)<\/cite>/gi;
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gi;
    const cites: string[] = [];
    const titles: string[] = [];
    while ((m = citeRegex.exec(html)) !== null) cites.push(stripTags(m[1]));
    while ((m = h3Regex.exec(html)) !== null) titles.push(stripTags(m[1]));
    for (let i = 0; i < Math.min(cites.length, titles.length, 15); i++) {
      let url = cites[i];
      if (!url.startsWith("http")) url = "https://" + url;
      const title = titles[i];
      if (title) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

function extractBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let m: RegExpExecArray | null;

  // Primary: <li class="b_algo"> with link + snippet
  const algoRegex = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<p[^>]*>(.*?)<\/p>/gi;
  while ((m = algoRegex.exec(html)) !== null && results.length < 15) {
    const url = m[1];
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url) results.push({ title, url, snippet });
  }

  // Fallback: just links
  if (results.length === 0) {
    const simpleRegex = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = simpleRegex.exec(html)) !== null && results.length < 15) {
      const url = m[1];
      const title = stripTags(m[2]);
      if (title && url) results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

// ── Fetch-based search engines (direct HTML scraping, no browser needed) ──

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

async function fetchGoogle(query: string): Promise<{ engine: string; results: SearchResult[] } | null> {
  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=15`,
      { headers: { ...HEADERS, Referer: "https://www.google.com/" }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const results = extractGoogleResults(html);
    if (results.length > 0) return { engine: "google", results };
  } catch { /* ignore */ }
  return null;
}

async function fetchDDG(query: string): Promise<{ engine: string; results: SearchResult[] } | null> {
  const urls = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { ...HEADERS, Referer: "https://duckduckgo.com/" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const results = extractDDGResults(html);
      if (results.length > 0) return { engine: "duckduckgo", results };
    } catch { /* ignore */ }
  }
  return null;
}

async function fetchBing(query: string): Promise<{ engine: string; results: SearchResult[] } | null> {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      { headers: { ...HEADERS, Referer: "https://www.bing.com/" }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const html = await res.text();
    const results = extractBingResults(html);
    if (results.length > 0) return { engine: "bing", results };
  } catch { /* ignore */ }
  return null;
}

// ── Main search route — cascades through engines ──

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  console.log(`[search] Searching for: "${query}"`);
  const start = Date.now();
  const attempts: { engine: string; success: boolean; count: number; ms: number }[] = [];

  // Try all engines in order: Google first (best results), then DuckDuckGo, then Bing
  const engines = [
    { name: "google", fn: fetchGoogle },
    { name: "duckduckgo", fn: fetchDDG },
    { name: "bing", fn: fetchBing },
  ];

  for (const engine of engines) {
    const t = Date.now();
    try {
      const result = await engine.fn(query);
      const ms = Date.now() - t;
      if (result && result.results.length > 0) {
        attempts.push({ engine: result.engine, success: true, count: result.results.length, ms });
        console.log(`[search] ✓ ${result.engine}: ${result.results.length} results in ${ms}ms`);
        return Response.json({
          results: result.results,
          engine: result.engine,
          attempts,
          totalMs: Date.now() - start,
        });
      }
      attempts.push({ engine: engine.name, success: false, count: 0, ms });
      console.log(`[search] ✗ ${engine.name}: 0 results in ${ms}ms`);
    } catch (e) {
      const ms = Date.now() - t;
      attempts.push({ engine: engine.name, success: false, count: 0, ms });
      console.log(`[search] ✗ ${engine.name}: error in ${ms}ms -`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[search] All engines failed for "${query}" in ${Date.now() - start}ms`);
  return Response.json({
    results: [],
    error: "All search engines failed",
    attempts,
    totalMs: Date.now() - start,
  });
}
