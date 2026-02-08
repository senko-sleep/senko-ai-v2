import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Known dedicated image/wallpaper sites that host real, direct image URLs
const IMAGE_SITE_DOMAINS = [
  "wallpapers.com", "wallpaperswide.com", "wallpaperflare.com", "wallpaperaccess.com",
  "wallhaven.cc", "alphacoders.com", "wall.alphacoders.com",
  "pinterest.com", "pinterest.co", "pin.it",
  "deviantart.com", "artstation.com",
  "flickr.com", "500px.com", "unsplash.com", "pexels.com", "pixabay.com",
  "zerochan.net", "danbooru.donmai.us", "gelbooru.com", "safebooru.org",
  "imgur.com", "i.imgur.com",
  "fandom.com", "fandomwire.com",
  "screenrant.com", "cbr.com",
  "hdqwalls.com", "uhdpaper.com", "4kwallpapers.com",
];

function isImageSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return IMAGE_SITE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch { return false; }
}

function isValidImageUrl(src: string): boolean {
  if (!src || !src.startsWith("http")) return false;
  if (src.includes("data:") || src.includes(".svg") || src.includes("favicon") || src.includes("pixel") || src.includes("tracking") || src.includes("1x1") || src.includes("spacer") || src.includes("blank.") || src.includes("placeholder")) return false;
  // Skip Google's proxied/cached image URLs
  if (src.includes("gstatic.com") || src.includes("google.com/images") || src.includes("encrypted-tbn") || src.includes("googleusercontent.com")) return false;
  return true;
}

// Helper: scrape images from any URL with improved extraction
async function scrapeImagesFromUrl(url: string, limit = 12): Promise<{ url: string; alt: string; source: string }[]> {
  const images: { url: string; alt: string; source: string }[] = [];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!res.ok) return images;
    const html = await res.text();
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* skip */ }

    const resolveUrl = (src: string): string | null => {
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = origin + src;
      else if (!src.startsWith("http")) return null;
      return isValidImageUrl(src) ? src : null;
    };

    // Extract og:image first (usually the best/main image)
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch?.[1]) {
      const src = resolveUrl(ogMatch[1]);
      if (src) images.push({ url: src, alt: "", source: url });
    }

    // Extract from srcset attributes (often has highest-res versions)
    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    let srcsetMatch;
    while ((srcsetMatch = srcsetRegex.exec(html)) !== null && images.length < limit) {
      const entries = srcsetMatch[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const entry of entries) {
        if (images.length >= limit) break;
        const src = resolveUrl(entry);
        if (src && !images.some((i) => i.url === src)) {
          images.push({ url: src, alt: "", source: url });
        }
      }
    }

    // Extract from data-src, data-original, data-lazy-src (lazy-loaded images)
    const lazyRegex = /(?:data-src|data-original|data-lazy-src|data-full|data-image|data-bg)=["'](https?:\/\/[^"']+)["']/gi;
    let lazyMatch;
    while ((lazyMatch = lazyRegex.exec(html)) !== null && images.length < limit) {
      const src = resolveUrl(lazyMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // Extract from background-image CSS (some galleries use this)
    const bgRegex = /background-image:\s*url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
    let bgMatch;
    while ((bgMatch = bgRegex.exec(html)) !== null && images.length < limit) {
      const src = resolveUrl(bgMatch[1]);
      if (src && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", source: url });
      }
    }

    // Extract all img tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null && images.length < limit) {
      const src = match[1];
      // Skip tiny icons/logos
      if (src.includes("logo") || src.includes("icon")) continue;
      const resolved = resolveUrl(src);
      if (!resolved) continue;

      // Size filter from tag attributes
      const tag = match[0];
      const w = tag.match(/width=["']?(\d+)/i);
      const h = tag.match(/height=["']?(\d+)/i);
      if (w && parseInt(w[1]) < 80) continue;
      if (h && parseInt(h[1]) < 80) continue;

      // Get alt text
      const altMatch = tag.match(/alt=["']([^"']*?)["']/i);
      const alt = altMatch?.[1] || "";

      if (!images.some((i) => i.url === resolved)) {
        images.push({ url: resolved, alt, source: url });
      }
    }

    // Extract from JSON-LD structured data (high quality image URLs)
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdMatch;
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null && images.length < limit) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        const extractImages = (obj: Record<string, unknown>) => {
          if (typeof obj !== "object" || !obj) return;
          for (const [key, val] of Object.entries(obj)) {
            if ((key === "image" || key === "thumbnailUrl" || key === "contentUrl") && typeof val === "string") {
              const src = resolveUrl(val);
              if (src && !images.some((i) => i.url === src) && images.length < limit) {
                images.push({ url: src, alt: "", source: url });
              }
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === "string" && item.startsWith("http")) {
                  const src = resolveUrl(item);
                  if (src && !images.some((i) => i.url === src) && images.length < limit) {
                    images.push({ url: src, alt: "", source: url });
                  }
                } else if (typeof item === "object") {
                  extractImages(item as Record<string, unknown>);
                }
              }
            } else if (typeof val === "object") {
              extractImages(val as Record<string, unknown>);
            }
          }
        };
        extractImages(data);
      } catch { /* skip malformed JSON-LD */ }
    }
  } catch { /* skip */ }
  return images;
}

// Extract the actual source page URL from a Google Images result context
function extractSourceFromGoogleHtml(html: string, imgUrl: string): string {
  // Google embeds source page URLs near the image URLs in their JS data
  // Look for patterns like ["sourceUrl",...,["imgUrl",w,h]]
  const idx = html.indexOf(imgUrl.slice(0, 60));
  if (idx > 0) {
    // Search backwards from the image URL for a page URL
    const chunk = html.slice(Math.max(0, idx - 2000), idx);
    const sourceMatches = [...chunk.matchAll(/\["(https?:\/\/(?!encrypted-tbn)[^"]{10,})"/g)];
    if (sourceMatches.length > 0) {
      const lastMatch = sourceMatches[sourceMatches.length - 1][1];
      if (!lastMatch.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        return lastMatch;
      }
    }
  }
  // Fallback: extract domain from image URL itself
  try {
    const u = new URL(imgUrl);
    return u.origin;
  } catch { return ""; }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const scrapeUrl = req.nextUrl.searchParams.get("url"); // Direct URL to scrape images from

  if (!query && !scrapeUrl) {
    return Response.json({ error: "q or url required" }, { status: 400 });
  }

  // Mode 1: Scrape images directly from a specific URL
  if (scrapeUrl) {
    const images = await scrapeImagesFromUrl(scrapeUrl, 20);
    return Response.json({ images, query: scrapeUrl });
  }

  // Mode 2: Search for images via multiple strategies in parallel
  const images: { url: string; alt: string; source: string }[] = [];
  const encoded = encodeURIComponent(query!);

  // Run all strategies in parallel for speed
  const [strategy1, strategy2, strategy3] = await Promise.allSettled([
    // Strategy 1: Bing Images HTML scrape (most reliable for direct image URLs)
    (async () => {
      const results: { url: string; alt: string; source: string }[] = [];
      try {
        const bingUrl = `https://www.bing.com/images/search?q=${encoded}&form=HDRSC2&first=1`;
        const res = await fetch(bingUrl, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(8000),
        });
        const html = await res.text();

        // Bing embeds image data in 'm' attribute as JSON: {"murl":"...","purl":"...","turl":"..."}
        const mRegex = /m=["']({[^"']*?murl[^"']*?})["']/gi;
        let mMatch;
        while ((mMatch = mRegex.exec(html)) !== null && results.length < 20) {
          try {
            const decoded = mMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const data = JSON.parse(decoded);
            if (data.murl && isValidImageUrl(data.murl)) {
              const source = data.purl || data.rurl || "";
              if (!results.some((i) => i.url === data.murl)) {
                results.push({
                  url: data.murl,
                  alt: data.t || query!,
                  source: source,
                });
              }
            }
          } catch { /* skip malformed JSON */ }
        }

        // Fallback: extract from iusc data attributes
        if (results.length < 5) {
          const iuscRegex = /iusc=["']({[^"']*?})["']/gi;
          let iuscMatch;
          while ((iuscMatch = iuscRegex.exec(html)) !== null && results.length < 20) {
            try {
              const decoded = iuscMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
              const data = JSON.parse(decoded);
              if (data.oi && isValidImageUrl(data.oi)) {
                if (!results.some((i) => i.url === data.oi)) {
                  results.push({ url: data.oi, alt: data.an || query!, source: data.pi || "" });
                }
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* Bing failed */ }
      return results;
    })(),

    // Strategy 2: DuckDuckGo search results → scrape top pages for images
    (async () => {
      const results: { url: string; alt: string; source: string }[] = [];
      try {
        const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(6000),
        });
        const searchHtml = await searchRes.text();
        const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
        const imageSiteUrls: string[] = [];
        const otherUrls: string[] = [];
        let urlMatch;
        while ((urlMatch = urlRegex.exec(searchHtml)) !== null && (imageSiteUrls.length + otherUrls.length) < 10) {
          try {
            const decoded = decodeURIComponent(urlMatch[1]);
            let url: string;
            if (decoded.startsWith("/") || decoded.startsWith("//")) {
              const uddg = new URL(`https://duckduckgo.com${decoded}`);
              url = uddg.searchParams.get("uddg") || "";
            } else {
              url = decoded;
            }
            if (!url || !url.startsWith("http") || url.includes("youtube.com") || url.includes("google.com")) continue;
            if (isImageSite(url)) {
              imageSiteUrls.push(url);
            } else {
              otherUrls.push(url);
            }
          } catch { /* skip */ }
        }

        // Scrape image sites first, then others
        const toScrape = [...imageSiteUrls.slice(0, 5), ...otherUrls.slice(0, 3)];
        const batchResults = await Promise.all(
          toScrape.map((u) => scrapeImagesFromUrl(u, 6).catch(() => []))
        );
        for (const pageImgs of batchResults) {
          for (const img of pageImgs) {
            if (results.length >= 20) break;
            if (!results.some((i) => i.url === img.url)) results.push(img);
          }
        }
      } catch { /* DDG search+scrape failed */ }
      return results;
    })(),

    // Strategy 3: Google Images - extract original source URLs with proper source tracking
    (async () => {
      const results: { url: string; alt: string; source: string }[] = [];
      try {
        const googleUrl = `https://www.google.com/search?q=${encoded}&tbm=isch&hl=en`;
        const res = await fetch(googleUrl, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(8000),
        });
        const html = await res.text();

        // Extract original source URLs from Google's JSON data
        const jsonImgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
        let match;
        while ((match = jsonImgRegex.exec(html)) !== null && results.length < 20) {
          const url = match[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
          const w = parseInt(match[2]);
          const h = parseInt(match[3]);
          if (w < 150 || h < 150) continue;
          if (!isValidImageUrl(url)) continue;
          if (!results.some((i) => i.url === url)) {
            const source = extractSourceFromGoogleHtml(html, match[1]);
            results.push({ url, alt: query!, source });
          }
        }
      } catch { /* Google Images failed */ }
      return results;
    })(),
  ]);

  // Merge results: Bing first (most reliable), then DDG scraped, then Google
  const allResults = [
    ...(strategy1.status === "fulfilled" ? strategy1.value : []),
    ...(strategy2.status === "fulfilled" ? strategy2.value : []),
    ...(strategy3.status === "fulfilled" ? strategy3.value : []),
  ];

  for (const img of allResults) {
    if (images.length >= 24) break;
    if (!images.some((i) => i.url === img.url)) {
      images.push(img);
    }
  }

  return Response.json({ images: images.slice(0, 20), query });
}
