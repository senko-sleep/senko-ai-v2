import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status}`, content: "" });
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

    // Extract meta description
    const metaMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i
    );
    const description = metaMatch ? metaMatch[1].trim() : "";

    // Remove scripts, styles, nav, footer, header, aside, svg, forms
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<form[\s\S]*?<\/form>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

    // Extract text from main/article/body
    const mainMatch =
      cleaned.match(/<main[\s\S]*?<\/main>/i) ||
      cleaned.match(/<article[\s\S]*?<\/article>/i) ||
      cleaned.match(/<div[^>]*(?:class|id)=["'][^"']*(?:content|main|article|post|entry|body)[^"']*["'][\s\S]*?<\/div>/i);

    const targetHtml = mainMatch ? mainMatch[0] : cleaned;

    // Strip all HTML tags, collapse whitespace
    const text = targetHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Truncate to ~3000 chars to keep context manageable
    const truncated = text.length > 3000 ? text.slice(0, 3000) + "..." : text;

    return Response.json({
      title,
      description,
      content: truncated,
      url,
      length: text.length,
    });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Scrape failed",
      content: "",
    });
  }
}
