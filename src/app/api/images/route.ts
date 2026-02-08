import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const images: { url: string; alt: string; source: string }[] = [];

  try {
    // Strategy 1: DuckDuckGo image search via their vqd token + API
    const encoded = encodeURIComponent(query);

    // First get the vqd token from DuckDuckGo
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encoded}&iax=images&ia=images`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000),
    });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=["']([^"']+)["']/);

    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const imgRes = await fetch(
        `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=1`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://duckduckgo.com/",
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      const imgData = await imgRes.json();
      if (imgData.results) {
        for (const r of imgData.results.slice(0, 8)) {
          if (r.image && r.image.startsWith("http")) {
            images.push({
              url: r.image,
              alt: r.title || query,
              source: r.source || "",
            });
          }
        }
      }
    }
  } catch {
    // DuckDuckGo image search failed, try fallback
  }

  // Strategy 2: If DDG images failed, scrape multiple search result pages for images
  if (images.length < 3) {
    try {
      const encoded = encodeURIComponent(query);
      const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(5000),
      });
      const searchHtml = await searchRes.text();

      // Extract URLs from search results
      const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
      const urls: string[] = [];
      let match;
      while ((match = urlRegex.exec(searchHtml)) !== null && urls.length < 3) {
        try {
          const decoded = decodeURIComponent(match[1]);
          const uddg = new URL(`https://duckduckgo.com${decoded}`);
          const url = uddg.searchParams.get("uddg") || match[1];
          if (url && !url.includes("youtube.com") && !url.includes("google.com")) {
            urls.push(url);
          }
        } catch {
          // skip
        }
      }

      // Scrape each URL for images in parallel
      const scrapePromises = urls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            signal: AbortSignal.timeout(5000),
          });
          const html = await res.text();
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
          const pageImages: string[] = [];
          let imgMatch;
          while ((imgMatch = imgRegex.exec(html)) !== null && pageImages.length < 3) {
            let src = imgMatch[1];
            if (src.includes("data:") || src.includes(".svg") || src.includes("favicon") || src.includes("logo") || src.includes("icon")) continue;
            if (src.startsWith("//")) src = "https:" + src;
            else if (src.startsWith("/")) {
              try { src = new URL(url).origin + src; } catch { continue; }
            } else if (!src.startsWith("http")) continue;

            // Check for size hints
            const tag = imgMatch[0];
            const w = tag.match(/width=["']?(\d+)/i);
            const h = tag.match(/height=["']?(\d+)/i);
            if (w && parseInt(w[1]) < 80) continue;
            if (h && parseInt(h[1]) < 80) continue;

            pageImages.push(src);
          }

          // Also check og:image
          const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
          if (ogMatch && ogMatch[1]) {
            pageImages.unshift(ogMatch[1]);
          }

          return pageImages;
        } catch {
          return [];
        }
      });

      const allPageImages = await Promise.all(scrapePromises);
      for (const pageImgs of allPageImages) {
        for (const img of pageImgs) {
          if (images.length >= 8) break;
          if (!images.some((i) => i.url === img)) {
            images.push({ url: img, alt: query, source: "" });
          }
        }
      }
    } catch {
      // fallback scraping failed
    }
  }

  return Response.json({ images, query });
}
