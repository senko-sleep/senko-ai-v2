import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface PageLink {
  url: string;
  text: string;
}

interface PageImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

interface PageMeta {
  title: string;
  description: string;
  ogImage: string;
  ogTitle: string;
  ogDescription: string;
  canonical: string;
  favicon: string;
}

interface PageVideo {
  url: string;
  type?: string;
  poster?: string;
}

interface PageData {
  url: string;
  finalUrl: string;
  meta: PageMeta;
  content: string;
  links: PageLink[];
  images: PageImage[];
  videos: PageVideo[];
  headings: { level: number; text: string }[];
  rawHtml?: string;
}

function resolveUrl(src: string, baseOrigin: string, baseUrl: string): string {
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return baseOrigin + src;
  if (src.startsWith("http")) return src;
  // Relative URL
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return "";
  }
}

function extractText(html: string): string {
  // Remove script, style, noscript, nav, footer, header tags entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Replace block elements with newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return text;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const raw = req.nextUrl.searchParams.get("raw") === "1"; // Return raw HTML too
  const maxContent = parseInt(req.nextUrl.searchParams.get("maxContent") || "5000", 10);

  if (!url) {
    return Response.json({ error: "url parameter required. Usage: /api/url?url=https://example.com" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json({ error: `HTTP ${res.status} ${res.statusText}`, url }, { status: res.status });
    }

    const finalUrl = res.url || url;
    const html = await res.text();
    let origin = "";
    try { origin = new URL(finalUrl).origin; } catch { /* skip */ }

    // --- Extract metadata ---
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);

    const meta: PageMeta = {
      title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "",
      description: descMatch ? descMatch[1].trim() : "",
      ogImage: ogImageMatch ? resolveUrl(ogImageMatch[1], origin, finalUrl) : "",
      ogTitle: ogTitleMatch ? ogTitleMatch[1].trim() : "",
      ogDescription: ogDescMatch ? ogDescMatch[1].trim() : "",
      canonical: canonicalMatch ? canonicalMatch[1] : "",
      favicon: faviconMatch ? resolveUrl(faviconMatch[1], origin, finalUrl) : `${origin}/favicon.ico`,
    };

    // --- Extract text content ---
    const content = extractText(html).slice(0, maxContent);

    // --- Extract links ---
    const links: PageLink[] = [];
    // Match <a> tags — capture the full opening tag (for title attr) and inner content
    const linkRegex = /<a\b([^>]*?)href=["']([^"'#]+)["']([^>]*?)>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    const seenUrls = new Set<string>();
    while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 100) {
      const preAttrs = linkMatch[1];
      const href = resolveUrl(linkMatch[2].trim(), origin, finalUrl);
      const postAttrs = linkMatch[3];
      const innerHtml = linkMatch[4];
      if (!href || seenUrls.has(href)) continue;
      if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      seenUrls.add(href);
      // Try to get label from: title attribute > inner text > URL path
      const titleAttr = (preAttrs + postAttrs).match(/title=["']([^"']+)["']/i);
      const innerText = innerHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const label = titleAttr?.[1] || (innerText.length > 0 && innerText.length < 200 ? innerText : (() => { try { return decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop() || href); } catch { return href; } })());
      links.push({ url: href, text: label });
    }

    // --- Extract images ---
    const images: PageImage[] = [];
    // Add og:image first
    if (meta.ogImage) {
      images.push({ url: meta.ogImage, alt: meta.ogTitle || meta.title || "" });
    }
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let imgMatch;
    const seenImgs = new Set<string>(meta.ogImage ? [meta.ogImage] : []);
    while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 30) {
      const src = resolveUrl(imgMatch[1], origin, finalUrl);
      if (!src || seenImgs.has(src)) continue;
      if (src.includes("data:") || src.includes(".svg") || src.includes("favicon") || src.includes("logo") || src.includes("icon") || src.includes("pixel") || src.includes("1x1") || src.includes("spacer") || src.includes("tracking")) continue;
      seenImgs.add(src);

      const tag = imgMatch[0];
      const wMatch = tag.match(/width=["']?(\d+)/i);
      const hMatch = tag.match(/height=["']?(\d+)/i);
      const w = wMatch ? parseInt(wMatch[1]) : undefined;
      const h = hMatch ? parseInt(hMatch[1]) : undefined;
      if (w && w < 50) continue;
      if (h && h < 50) continue;

      const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
      images.push({ url: src, alt: altMatch?.[1] || "", width: w, height: h });
    }

    // --- Extract video sources ---
    const videos: PageVideo[] = [];
    const seenVideos = new Set<string>();

    // og:video meta tag
    const ogVideoMatch = html.match(/<meta[^>]*property=["']og:video["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:video["']/i);
    if (ogVideoMatch) {
      const vUrl = resolveUrl(ogVideoMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) { videos.push({ url: vUrl }); seenVideos.add(vUrl); }
    }
    // og:video:url and og:video:secure_url
    const ogVideoUrlMatch = html.match(/<meta[^>]*property=["']og:video:(?:secure_)?url["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:video:(?:secure_)?url["']/i);
    if (ogVideoUrlMatch) {
      const vUrl = resolveUrl(ogVideoUrlMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) { videos.push({ url: vUrl }); seenVideos.add(vUrl); }
    }

    // <video> tags with src attribute
    const videoSrcRegex = /<video[^>]*\ssrc=["']([^"']+)["'][^>]*/gi;
    let videoMatch;
    while ((videoMatch = videoSrcRegex.exec(html)) !== null && videos.length < 10) {
      const vUrl = resolveUrl(videoMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) {
        const posterMatch = videoMatch[0].match(/poster=["']([^"']+)["']/i);
        videos.push({ url: vUrl, poster: posterMatch ? resolveUrl(posterMatch[1], origin, finalUrl) : undefined });
        seenVideos.add(vUrl);
      }
    }

    // <source> tags inside <video> elements
    const sourceRegex = /<source[^>]*\ssrc=["']([^"']+)["'][^>]*/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(html)) !== null && videos.length < 10) {
      const vUrl = resolveUrl(sourceMatch[1], origin, finalUrl);
      if (vUrl && !seenVideos.has(vUrl)) {
        const typeMatch = sourceMatch[0].match(/type=["']([^"']+)["']/i);
        videos.push({ url: vUrl, type: typeMatch?.[1] });
        seenVideos.add(vUrl);
      }
    }

    // Common JS video player patterns (e.g., video_url = "...", file: "...", sources: [{src: "..."}])
    const jsVideoPatterns = [
      /(?:video_url|videoUrl|file_url|fileUrl|mp4_url|source_url|stream_url)\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /["'](?:file|src|source|url|mp4|video)["']\s*:\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/gi,
      /(?:src|href)\s*[:=]\s*["']([^"']+\.(?:mp4|webm|m3u8)(?:\?[^"']*)?)["']/gi,
    ];
    for (const pattern of jsVideoPatterns) {
      let jsMatch;
      while ((jsMatch = pattern.exec(html)) !== null && videos.length < 10) {
        const vUrl = resolveUrl(jsMatch[1], origin, finalUrl);
        if (vUrl && !seenVideos.has(vUrl) && !vUrl.includes("ad") && !vUrl.includes("tracker")) {
          videos.push({ url: vUrl });
          seenVideos.add(vUrl);
        }
      }
    }

    // --- Extract headings ---
    const headings: { level: number; text: string }[] = [];
    const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hMatch;
    while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 30) {
      const text = hMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        headings.push({ level: parseInt(hMatch[1]), text });
      }
    }

    const result: PageData = {
      url,
      finalUrl,
      meta,
      content,
      links,
      images,
      videos,
      headings,
    };

    if (raw) {
      result.rawHtml = html.slice(0, 50000);
    }

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message, url }, { status: 500 });
  }
}
