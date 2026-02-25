import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface ImageResult {
  url: string;
  alt: string;
  source: string;
  engine: string;
}

function isValidImageUrl(src: string): boolean {
  if (!src || !src.startsWith("http")) return false;
  if (/data:|\.svg|favicon|pixel|tracking|1x1|spacer|blank\.|placeholder|badge|button|icon/i.test(src)) return false;
  if (/gstatic\.com|google\.com\/images|encrypted-tbn|googleusercontent\.com|schema\.org/i.test(src)) return false;
  return true;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const strip = ["w", "h", "width", "height", "size", "quality", "q", "auto", "fit", "crop", "format", "fm", "dpr", "v", "token", "sig"];
    for (const p of strip) u.searchParams.delete(p);
    return (u.origin + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch { return url.toLowerCase(); }
}

function isDuplicate(url: string, seen: Set<string>): boolean {
  return seen.has(normalizeUrl(url));
}

function addImage(results: ImageResult[], seen: Set<string>, img: ImageResult): void {
  const norm = normalizeUrl(img.url);
  if (!isDuplicate(img.url, seen) && isValidImageUrl(img.url)) {
    seen.add(norm);
    results.push(img);
  }
}

// ── BING IMAGES: Fetch 5 pages in parallel ──
async function fetchBingImages(query: string, page: number): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    // 5 pages of 35 results each = ~175 potential images
    const offsets = Array.from({ length: 5 }, (_, i) => (page - 1) * 175 + i * 35);
    const pages = await Promise.allSettled(
      offsets.map((off) =>
        fetch(`https://www.bing.com/images/search?q=${encoded}&form=HDRSC2&first=${1 + off}&safeSearch=off`, {
          headers: HEADERS, signal: AbortSignal.timeout(10000),
        }).then((r) => r.text())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const html = pg.value;
      // Extract from m= JSON attributes
      const mRegex = /m=["']({[^"']*?murl[^"']*?})["']/gi;
      let m: RegExpExecArray | null;
      while ((m = mRegex.exec(html)) !== null) {
        try {
          const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          const data = JSON.parse(decoded);
          if (data.murl) {
            addImage(results, seen, { url: data.murl, alt: data.t || query, source: data.purl || data.rurl || "", engine: "bing" });
          }
        } catch { /* skip */ }
      }
      // Also try iusc= format
      const iuscRegex = /iusc=["']({[^"']*?})["']/gi;
      let iusc: RegExpExecArray | null;
      while ((iusc = iuscRegex.exec(html)) !== null) {
        try {
          const decoded = iusc[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          const data = JSON.parse(decoded);
          if (data.oi) {
            addImage(results, seen, { url: data.oi, alt: data.an || query, source: data.pi || "", engine: "bing" });
          }
        } catch { /* skip */ }
      }
    }
    console.log(`[images] Bing: ${results.length} images from 5 pages`);
  } catch (e) { console.log("[images] Bing error:", e instanceof Error ? e.message : e); }
  return results;
}

// ── GOOGLE IMAGES: Fetch 5 pages in parallel ──
async function fetchGoogleImages(query: string, page: number): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const offsets = Array.from({ length: 5 }, (_, i) => (page - 1) * 100 + i * 20);
    const pages = await Promise.allSettled(
      offsets.map((off) =>
        fetch(`https://www.google.com/search?q=${encoded}&tbm=isch&hl=en&start=${off}&safe=off`, {
          headers: { ...HEADERS, Referer: "https://www.google.com/" }, signal: AbortSignal.timeout(10000),
        }).then((r) => r.text())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const html = pg.value;
      // Extract image URLs from Google's JSON-like structures
      const jsonImgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
      let match: RegExpExecArray | null;
      while ((match = jsonImgRegex.exec(html)) !== null) {
        const imgUrl = match[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
        const w = parseInt(match[2]);
        const h = parseInt(match[3]);
        if (w < 100 || h < 100) continue;
        addImage(results, seen, { url: imgUrl, alt: query, source: "", engine: "google" });
      }
    }
    console.log(`[images] Google: ${results.length} images from 5 pages`);
  } catch (e) { console.log("[images] Google error:", e instanceof Error ? e.message : e); }
  return results;
}

// ── DUCKDUCKGO IMAGES: JSON API with pagination ──
async function fetchDDGImages(query: string, page: number): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encoded}&kp=-2&iax=images&ia=images`, {
      headers: { ...HEADERS, Accept: "text/html" }, signal: AbortSignal.timeout(8000),
    });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=["']([^"']+)["']/i) || tokenHtml.match(/vqd=([\d-]+)/i);
    if (!vqdMatch) return results;
    const vqd = vqdMatch[1];

    // Fetch 3 pages of DDG results
    const offsets = Array.from({ length: 3 }, (_, i) => (page - 1) * 300 + i * 100);
    const pages = await Promise.allSettled(
      offsets.map((off) =>
        fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encoded}&vqd=${vqd}&f=,,,,,&p=-1&s=${off}`, {
          headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://duckduckgo.com/" },
          signal: AbortSignal.timeout(8000),
        }).then((r) => r.json())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const data = pg.value;
      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.image) {
            addImage(results, seen, { url: r.image, alt: r.title || query, source: r.url || "", engine: "ddg" });
          }
        }
      }
    }
    console.log(`[images] DDG: ${results.length} images from 3 pages`);
  } catch (e) { console.log("[images] DDG error:", e instanceof Error ? e.message : e); }
  return results;
}

// ── DEEP GALLERY SCANNING: Scrape actual image gallery pages ──
async function scrapeGalleryImages(query: string): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const seen = new Set<string>();
  try {
    // Search for gallery/wallpaper pages
    const encoded = encodeURIComponent(query + " images gallery wallpaper");
    const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { ...HEADERS, Referer: "https://duckduckgo.com/" }, signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return results;
    const searchHtml = await searchRes.text();

    // Extract page URLs from DDG results
    const galleryUrls: string[] = [];
    const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(searchHtml)) !== null && galleryUrls.length < 6) {
      try {
        const raw = urlMatch[1].replace(/&amp;/g, "&");
        const decoded = decodeURIComponent(raw);
        let pageUrl: string;
        if (decoded.startsWith("/") || decoded.startsWith("//")) {
          const uddg = new URL(`https://duckduckgo.com${decoded}`);
          pageUrl = uddg.searchParams.get("uddg") || "";
        } else {
          pageUrl = decoded;
        }
        if (pageUrl && pageUrl.startsWith("http") && !pageUrl.includes("youtube.com") && !pageUrl.includes("google.com")) {
          galleryUrls.push(pageUrl);
        }
      } catch { /* skip */ }
    }

    // Scrape images from gallery pages in parallel
    const galleryScrapes = await Promise.allSettled(
      galleryUrls.map(async (pageUrl) => {
        const imgs: ImageResult[] = [];
        try {
          const res = await fetch(pageUrl, {
            headers: { "User-Agent": UA, Accept: "text/html,*/*" },
            signal: AbortSignal.timeout(10000),
            redirect: "follow",
          });
          if (!res.ok) return imgs;
          const html = await res.text();
          let origin = "";
          try { origin = new URL(pageUrl).origin; } catch { /* */ }

          const resolveImg = (src: string): string | null => {
            if (src.startsWith("//")) src = "https:" + src;
            else if (src.startsWith("/")) src = origin + src;
            else if (!src.startsWith("http")) return null;
            return isValidImageUrl(src) ? src : null;
          };

          // og:image
          const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
          if (ogMatch) { const s = resolveImg(ogMatch[1]); if (s) imgs.push({ url: s, alt: query, source: pageUrl, engine: "gallery" }); }

          // srcset (high-res images)
          const srcsetRegex = /srcset=["']([^"']+)["']/gi;
          let srcM: RegExpExecArray | null;
          while ((srcM = srcsetRegex.exec(html)) !== null) {
            const entries = srcM[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
            for (const entry of entries) {
              const s = resolveImg(entry);
              if (s) imgs.push({ url: s, alt: query, source: pageUrl, engine: "gallery" });
            }
          }

          // data-src, data-original, data-full (lazy-loaded images)
          const lazyRegex = /(?:data-src|data-original|data-lazy-src|data-full|data-image)=["'](https?:\/\/[^"']+)["']/gi;
          let lazyM: RegExpExecArray | null;
          while ((lazyM = lazyRegex.exec(html)) !== null) {
            const s = resolveImg(lazyM[1]);
            if (s) imgs.push({ url: s, alt: query, source: pageUrl, engine: "gallery" });
          }

          // Regular img src
          const imgRegex = /<img[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
          let imgM: RegExpExecArray | null;
          while ((imgM = imgRegex.exec(html)) !== null) {
            // Skip small images
            const widthM = imgM[0].match(/width=["']?(\d+)/i);
            if (widthM && parseInt(widthM[1]) < 80) continue;
            const heightM = imgM[0].match(/height=["']?(\d+)/i);
            if (heightM && parseInt(heightM[1]) < 80) continue;
            const s = resolveImg(imgM[1]);
            if (s) imgs.push({ url: s, alt: query, source: pageUrl, engine: "gallery" });
          }

          // Links to image files
          const linkImgRegex = /<a[^>]*href=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/gi;
          let linkM: RegExpExecArray | null;
          while ((linkM = linkImgRegex.exec(html)) !== null) {
            const s = resolveImg(linkM[1]);
            if (s) imgs.push({ url: s, alt: query, source: pageUrl, engine: "gallery" });
          }
        } catch { /* skip */ }
        return imgs;
      })
    );

    for (const scrape of galleryScrapes) {
      if (scrape.status !== "fulfilled") continue;
      for (const img of scrape.value) {
        addImage(results, seen, img);
      }
    }
    console.log(`[images] Gallery scan: ${results.length} images from ${galleryUrls.length} pages`);
  } catch (e) { console.log("[images] Gallery error:", e instanceof Error ? e.message : e); }
  return results;
}

// ── Main route — ALL engines + gallery scan in parallel ──

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1"));
  if (!query) {
    return Response.json({ error: "q required", images: [] }, { status: 400 });
  }

  console.log(`[images] Deep search for: "${query}" (page ${page})`);
  const start = Date.now();

  // Run ALL strategies in parallel
  const [bingResults, googleResults, ddgResults, galleryResults] = await Promise.all([
    fetchBingImages(query, page),
    fetchGoogleImages(query, page),
    fetchDDGImages(query, page),
    scrapeGalleryImages(query),
  ]);

  // Merge all results — deduplicate globally
  const images: ImageResult[] = [];
  const seen = new Set<string>();
  // Interleave engines for variety
  const allBatches = [bingResults, googleResults, ddgResults, galleryResults];
  const maxLen = Math.max(...allBatches.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const batch of allBatches) {
      if (i < batch.length) {
        addImage(images, seen, batch[i]);
      }
    }
  }

  const ms = Date.now() - start;
  console.log(`[images] Total: ${images.length} images in ${ms}ms (bing:${bingResults.length} google:${googleResults.length} ddg:${ddgResults.length} gallery:${galleryResults.length})`);
  return Response.json({
    images,
    query,
    page,
    hasMore: images.length >= 20,
    stats: { bing: bingResults.length, google: googleResults.length, ddg: ddgResults.length, gallery: galleryResults.length, ms },
  });
}
