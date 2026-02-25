import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

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

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const maxContent = parseInt(req.nextUrl.searchParams.get("maxContent") || "5000");

  if (!url) {
    return Response.json({ error: "url parameter required" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}`, url });
    }

    const html = await res.text();
    const title = extractTitle(html);
    const content = stripHtml(html).slice(0, maxContent);
    const links = extractLinks(html, url);

    return Response.json({ title, content, links, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
