import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function stripHtml(html: string): string {
  // Remove script/style/noscript blocks
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");
  // Remove all tags
  text = text.replace(/<[^>]*>/g, " ");
  // Decode entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return text;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match) {
    return match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
  return "";
}

function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null && images.length < 20) {
    let src = m[1];
    // Resolve relative URLs
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) {
      try { src = new URL(src, baseUrl).href; } catch { continue; }
    } else if (!src.startsWith("http")) {
      try { src = new URL(src, baseUrl).href; } catch { continue; }
    }
    // Skip tiny/icon images
    const widthMatch = m[0].match(/width="(\d+)"/i);
    if (widthMatch && parseInt(widthMatch[1]) < 50) continue;
    if (/favicon|icon|logo|badge|button|pixel|spacer|tracking/i.test(src)) continue;
    if (!seen.has(src)) {
      seen.add(src);
      images.push(src);
    }
  }
  return images;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  // ── Proxy to Render search-api first ──
  const searchApiUrl = process.env.SEARCH_API_URL;
  if (searchApiUrl) {
    try {
      const proxyRes = await fetch(`${searchApiUrl}/scrape?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data.content || data.title) {
          return Response.json(data);
        }
      }
    } catch { /* fall through to direct scraping */ }
  }

  // ── Direct scraping fallback ──
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}`, content: "", title: "" });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
      return Response.json({ error: `Non-HTML content: ${contentType}`, content: "", title: "" });
    }

    const html = await res.text();
    const title = extractTitle(html);
    const content = stripHtml(html).slice(0, 8000);
    const images = extractImages(html, url);

    return Response.json({ title, content, images, url });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Scrape failed",
      content: "",
      title: "",
    });
  }
}
