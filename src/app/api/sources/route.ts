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
    // DDG hrefs contain &amp; HTML entities that need decoding first
    const clean = raw.replace(/&amp;/g, "&");
    const decoded = decodeURIComponent(clean);
    if (decoded.startsWith("/") || decoded.startsWith("//")) {
      const uddg = new URL(`https://duckduckgo.com${decoded}`);
      return uddg.searchParams.get("uddg") || raw;
    }
    // If it's already a full URL
    if (decoded.startsWith("http")) return decoded;
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
  console.log(`[sources/bing] Found ${blocks.length - 1} b_algo blocks`);
  for (let i = 1; i < blocks.length && results.length < 10; i++) {
    const block = blocks[i];

    // Extract URL: prefer href from <h2><a> (most reliable), then any non-bing href, then cite
    let url = "";
    // Primary: get href from the title link inside <h2>
    const titleLinkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>/i);
    if (titleLinkMatch) {
      url = titleLinkMatch[1].replace(/&amp;/g, "&");
    }
    // If it's a bing redirect, try to extract the real URL from the 'u' param
    if (url.includes("bing.com/ck/a")) {
      try {
        const bingUrl = new URL(url.startsWith("//") ? "https:" + url : url);
        const realUrl = bingUrl.searchParams.get("u");
        if (realUrl) {
          // Bing encodes with a1- prefix sometimes
          url = realUrl.startsWith("a1") ? decodeURIComponent(realUrl.slice(2)) : decodeURIComponent(realUrl);
        }
      } catch { /* keep original */ }
    }
    // Fallback: any non-bing href
    if (!url || url.includes("bing.com")) {
      const hrefMatch = block.match(/href="(https?:\/\/(?!www\.bing\.com)[^"]+)"/i);
      if (hrefMatch) url = hrefMatch[1].replace(/&amp;/g, "&");
    }
    // Last resort: cite tag (display URL with › separators)
    if (!url || url.includes("bing.com")) {
      const citeMatch = block.match(/<cite[^>]*>(.*?)<\/cite>/i);
      if (citeMatch) {
        url = citeMatch[1].replace(/<[^>]*>/g, "").replace(/\s/g, "").replace(/›/g, "/").trim();
        if (!url.startsWith("http")) url = "https://" + url;
      }
    }

    // Extract title from <h2> > <a> (strip all nested HTML)
    let title = "";
    const h2Match = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (h2Match) {
      title = h2Match[1].replace(/<[^>]*>/g, "").replace(/&#\d+;/g, (m) => {
        try { return String.fromCharCode(parseInt(m.slice(2, -1))); } catch { return m; }
      }).replace(/&amp;/g, "&").trim();
    }

    // Extract snippet from <p> or .b_caption
    let snippet = "";
    const snippetMatch = block.match(/<p[^>]*class="[^"]*"[^>]*>(.*?)<\/p>/i) || block.match(/<p[^>]*>(.*?)<\/p>/i);
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]*>/g, "").trim();
    }

    console.log(`[sources/bing] Block ${i}: url=${url.slice(0, 60)} title=${title.slice(0, 40)}`);
    if (title && url && url.startsWith("http") && !url.includes("bing.com")) {
      results.push({ title, url, snippet, favicon: makeFavicon(url) });
    }
  }

  return results;
}

// Full browser-like headers to avoid datacenter IP blocking
const BROWSER_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// DuckDuckGo Instant Answer API (JSON, very reliable from servers)
async function fetchDDGInstant(query: string): Promise<SourceResult[]> {
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results: SourceResult[] = [];
    // Related topics contain URLs
    const topics = [...(data.RelatedTopics || []), ...(data.Results || [])];
    for (const topic of topics) {
      if (topic.FirstURL && topic.Text && results.length < 10) {
        results.push({
          url: topic.FirstURL,
          title: topic.Text.slice(0, 100),
          snippet: topic.Text,
          favicon: makeFavicon(topic.FirstURL),
        });
      }
      // Handle sub-topics (grouped results)
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (sub.FirstURL && sub.Text && results.length < 10) {
            results.push({
              url: sub.FirstURL,
              title: sub.Text.slice(0, 100),
              snippet: sub.Text,
              favicon: makeFavicon(sub.FirstURL),
            });
          }
        }
      }
    }
    // Also add the abstract source if available
    if (data.AbstractURL && data.AbstractSource && results.length < 10) {
      results.push({
        url: data.AbstractURL,
        title: data.AbstractSource + " - " + (data.Heading || query),
        snippet: data.AbstractText || "",
        favicon: makeFavicon(data.AbstractURL),
      });
    }
    return results;
  } catch (e) {
    console.log(`[sources/ddg-api] Error: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

// DuckDuckGo Lite (simpler HTML, less likely to be blocked)
function extractDDGLiteResults(html: string): SourceResult[] {
  const results: SourceResult[] = [];
  // DDG Lite uses <a class="result-link" href="...">
  const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
    const url = decodeDDGUrl(match[1]);
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    if (title && url.startsWith("http")) {
      results.push({ title, url, snippet: "", favicon: makeFavicon(url) });
    }
  }
  // Fallback: any link with uddg param
  if (results.length === 0) {
    const uddgRegex = /href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>(.*?)<\/a>/gi;
    while ((match = uddgRegex.exec(html)) !== null && results.length < 10) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = match[2].replace(/<[^>]*>/g, "").trim();
        if (title && url.startsWith("http")) {
          results.push({ title, url, snippet: "", favicon: makeFavicon(url) });
        }
      } catch { /* skip */ }
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

  console.log(`[sources] Query: "${query}"`);

  // Run ALL strategies in parallel for speed
  const [ddgResults, ddgLiteResults, ddgApiResults, googleResults, bingResults] = await Promise.all([
    // DDG HTML (full)
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        console.log(`[sources/ddg] Status: ${res.status}`);
        if (!res.ok) return [];
        const html = await res.text();
        console.log(`[sources/ddg] HTML length: ${html.length}, has result__a: ${html.includes("result__a")}`);
        return extractDDGResults(html);
      } catch (e) {
        console.log(`[sources/ddg] Error: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    })(),
    // DDG Lite (fallback, simpler page)
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        console.log(`[sources/ddg-lite] Status: ${res.status}`);
        if (!res.ok) return [];
        const html = await res.text();
        console.log(`[sources/ddg-lite] HTML length: ${html.length}`);
        return extractDDGLiteResults(html);
      } catch (e) {
        console.log(`[sources/ddg-lite] Error: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    })(),
    // DDG Instant Answer API (JSON, most reliable)
    fetchDDGInstant(query),
    // Google
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://www.google.com/search?q=${encoded}&hl=en&num=10`, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        console.log(`[sources/google] Status: ${res.status}`);
        if (!res.ok) return [];
        const html = await res.text();
        console.log(`[sources/google] HTML length: ${html.length}`);
        return extractGoogleResults(html);
      } catch (e) {
        console.log(`[sources/google] Error: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    })(),
    // Bing
    (async (): Promise<SourceResult[]> => {
      try {
        const res = await fetch(`https://www.bing.com/search?q=${encoded}`, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        console.log(`[sources/bing] Status: ${res.status}`);
        if (!res.ok) return [];
        const html = await res.text();
        console.log(`[sources/bing] HTML length: ${html.length}`);
        return extractBingResults(html);
      } catch (e) {
        console.log(`[sources/bing] Error: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    })(),
  ]);

  console.log(`[sources] DDG: ${ddgResults.length}, DDG-Lite: ${ddgLiteResults.length}, DDG-API: ${ddgApiResults.length}, Google: ${googleResults.length}, Bing: ${bingResults.length}`);

  // Merge: prefer DDG HTML > Bing > DDG Lite > DDG API > Google. Dedup by hostname+path.
  const seen = new Set<string>();
  const results: SourceResult[] = [];
  for (const source of [...ddgResults, ...bingResults, ...ddgLiteResults, ...ddgApiResults, ...googleResults]) {
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

  console.log(`[sources] Final: ${results.length} results`);
  return Response.json({ sources: results, query });
}
