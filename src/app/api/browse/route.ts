import { NextRequest } from "next/server";
import { validateOrReject } from "@/lib/url-validator";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function stripHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<[^>]*>/g, " ");
  text = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return text;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() : "";
}

function extractLinks(html: string, baseUrl: string): { url: string; text: string }[] {
  const links: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null && links.length < 50) {
    let href = m[1];
    const text = m[2].replace(/<[^>]*>/g, "").trim();
    if (!text || text.length < 2) continue;
    if (href.startsWith("/")) { try { href = new URL(href, baseUrl).href; } catch { continue; } }
    else if (!href.startsWith("http")) continue;
    if (!seen.has(href)) { seen.add(href); links.push({ url: href, text }); }
  }
  return links;
}

function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const regex = /<img[^>]*src="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null && images.length < 20) {
    let src = m[1];
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) { try { src = new URL(src, baseUrl).href; } catch { continue; } }
    else if (!src.startsWith("http")) { try { src = new URL(src, baseUrl).href; } catch { continue; } }
    if (/favicon|icon|logo|badge|pixel|spacer|tracking/i.test(src)) continue;
    if (!seen.has(src)) { seen.add(src); images.push(src); }
  }
  return images;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const maxContent = parseInt(req.nextUrl.searchParams.get("maxContent") || "8000");

  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  const ssrfBlock = validateOrReject(url);
  if (ssrfBlock) return ssrfBlock;

  // ── Proxy to Render search-api first ──
  const searchApiUrl = process.env.SEARCH_API_URL;
  if (searchApiUrl) {
    try {
      const proxyRes = await fetch(`${searchApiUrl}/browse?url=${encodeURIComponent(url)}&maxContent=${maxContent}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        if (data.content || data.title || data.links) {
          return Response.json(data);
        }
      }
    } catch { /* fall through to direct scraping */ }
  }

  // ── Direct scraping fallback ──
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(25000),
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}`, url });
    }

    const html = await res.text();
    const title = extractTitle(html);
    const content = stripHtml(html).slice(0, maxContent);
    const links = extractLinks(html, url);
    const images = extractImages(html, url);

    return Response.json({ title, content, links, images, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
