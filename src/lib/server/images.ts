// Multi-engine image scraper used by /api/images and normal chat replies.
// Scrapes Bing, DuckDuckGo, Reddit, Wikimedia, Wallhaven, Boorus
// (Danbooru/Safebooru, Rule34, Gelbooru, e621), and deep gallery pages in parallel,
// returning ~255 deduplicated images per page with engine attribution.

export interface ScrapedImage {
  url: string;
  alt: string;
  source: string;
  engine: string;
}

export const IMAGES_BATCH_SIZE = 255;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const QUERY_SUFFIXES = [
  "",
  "HD",
  "wallpaper",
  "artwork",
  "high quality",
  "4k",
  "full",
  "illustration",
  "photo",
  "render",
];

export function isValidImageUrl(src: string): boolean {
  if (!src || !src.startsWith("http")) return false;
  if (/data:|\.svg|favicon|pixel|tracking|1x1|spacer|blank\.|placeholder|badge|button|icon|logo|sprite/i.test(src)) {
    return false;
  }
  if (/gstatic\.com|google\.com\/images|encrypted-tbn|googleusercontent\.com|schema\.org|bing\.com\/th\?id=OIP/i.test(src)) {
    return false;
  }
  return true;
}

export function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url);
    const strip = [
      "w",
      "h",
      "width",
      "height",
      "size",
      "quality",
      "q",
      "auto",
      "fit",
      "crop",
      "format",
      "fm",
      "dpr",
      "v",
      "token",
      "sig",
      "utm_source",
      "utm_medium",
      "utm_campaign",
    ];
    for (const p of strip) u.searchParams.delete(p);
    return (u.origin + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Key that is the same for size/format variants of one picture, e.g.
 * thumb-350-123.jpeg, thumb-1920-123.webp and 123-800x600.jpg all collapse together.
 */
export function imageVariantKey(url: string): string {
  return normalizeImageUrl(url)
    .replace(/\.(jpe?g|png|webp|gif|avif)$/, "")
    .replace(/\/(thumbnails?|thumbs?|samples?|previews?)\//g, "/")
    .replace(/(^|[/_-])(thumb(nail)?|sample|preview)[-_]?(\d{2,4}[-_])?/g, "$1")
    .replace(/[-_@]\d{2,4}x\d{0,4}(?=$|[-_.])/g, "")
    .replace(/[-_](small|medium|large|scaled|full|orig(inal)?)(?=$|[-_.])/g, "");
}

function addImage(results: ScrapedImage[], seen: Set<string>, img: ScrapedImage): void {
  if (!img.url || !isValidImageUrl(img.url)) return;
  const key = imageVariantKey(img.url);
  if (seen.has(key)) return;
  seen.add(key);
  results.push(img);
}

// ── 1. BING IMAGES (8 pages in parallel, ~280 raw images) ──
async function fetchBingImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const baseOffset = ((page - 1) % 3) * 210;
    const offsets = Array.from({ length: 8 }, (_, i) => baseOffset + i * 35);
    const pages = await Promise.allSettled(
      offsets.map((off) =>
        fetch(`https://www.bing.com/images/search?q=${encoded}&form=HDRSC2&first=${1 + off}&safeSearch=off`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(9000),
        }).then((r) => r.text())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const html = pg.value;
      const mRegex = /m=["']({[^"']*?murl[^"']*?})["']/gi;
      let m: RegExpExecArray | null;
      while ((m = mRegex.exec(html)) !== null) {
        try {
          const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          const data = JSON.parse(decoded);
          if (data.murl) {
            addImage(results, seen, {
              url: data.murl,
              alt: data.t || query,
              source: data.purl || data.rurl || "",
              engine: "bing",
            });
          }
        } catch {
          /* skip */
        }
      }
      const iuscRegex = /iusc=["']({[^"']*?})["']/gi;
      let iusc: RegExpExecArray | null;
      while ((iusc = iuscRegex.exec(html)) !== null) {
        try {
          const decoded = iusc[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          const data = JSON.parse(decoded);
          if (data.oi) {
            addImage(results, seen, {
              url: data.oi,
              alt: data.an || query,
              source: data.pi || "",
              engine: "bing",
            });
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// ── 3. DUCKDUCKGO IMAGES (3 pages via i.js JSON API) ──
async function fetchDDGImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encoded}&kp=-2&iax=images&ia=images`, {
      headers: { ...HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(6500),
    });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=["']([^"']+)["']/i) || tokenHtml.match(/vqd=([\d-]+)/i);
    if (!vqdMatch) return results;
    const vqd = vqdMatch[1];

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
      if (data?.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.image) {
            addImage(results, seen, {
              url: r.image,
              alt: r.title || query,
              source: r.url || "",
              engine: "ddg",
            });
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// ── 5. REDDIT IMAGES (JSON search API) ──
async function fetchRedditImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const sorts = ["relevance", "top", "hot", "new"];
    const sort = sorts[(page - 1) % sorts.length];
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encoded}&sort=${sort}&limit=100&include_over_18=on&raw_json=1`,
      {
        headers: { "User-Agent": "SenkoAI/2.0 (ImageAggregator)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return results;
    const data = await res.json();
    const children = data?.data?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const post = child?.data;
        if (!post) continue;
        const perm = post.permalink ? `https://www.reddit.com${post.permalink}` : "";
        const title = post.title || query;
        const dest = String(post.url_overridden_by_dest || post.url || "");
        if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(dest) || /i\.redd\.it|i\.imgur\.com/i.test(dest)) {
          addImage(results, seen, { url: dest, alt: title, source: perm, engine: "reddit" });
        }
        // Reddit gallery media_metadata
        if (post.media_metadata && typeof post.media_metadata === "object") {
          for (const meta of Object.values(post.media_metadata) as Record<string, unknown>[]) {
            const s = meta?.s as { u?: string; gif?: string } | undefined;
            const u = s?.u || s?.gif;
            if (u) addImage(results, seen, { url: u.replace(/&amp;/g, "&"), alt: title, source: perm, engine: "reddit" });
          }
        }
        // Preview high-res fallback
        const prev = post.preview?.images?.[0]?.source?.url;
        if (prev && typeof prev === "string") {
          addImage(results, seen, { url: prev.replace(/&amp;/g, "&"), alt: title, source: perm, engine: "reddit" });
        }
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// ── 6. WIKIMEDIA COMMONS (High-res open media API) ──
async function fetchWikimediaImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const offset = (page - 1) * 50;
    const encoded = encodeURIComponent(`filetype:bitmap ${query}`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encoded}&gsrnamespace=6&gsrlimit=50&gsroffset=${offset}&prop=imageinfo&iiprop=url|dimensions&format=json&origin=*`;
    const res = await fetch(url, {
      headers: { "User-Agent": "SenkoAI/2.0 (ImageAggregator)" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return results;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (pages && typeof pages === "object") {
      for (const pg of Object.values(pages) as Record<string, unknown>[]) {
        const info = (pg.imageinfo as Record<string, unknown>[] | undefined)?.[0];
        const imgUrl = info?.url as string | undefined;
        const descUrl = (info?.descriptionurl as string | undefined) || "";
        const title = String(pg.title || query).replace(/^File:/i, "").replace(/\.[^.]+$/, "");
        if (imgUrl && !/\.svg|\.tif|\.pdf/i.test(imgUrl)) {
          addImage(results, seen, { url: imgUrl, alt: title, source: descUrl, engine: "wikimedia" });
        }
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// Finds the most specific existing booru tag among the query's word runs.
// "frieren anime" -> frieren, "hatsune miku" -> hatsune_miku.
const booruTagCache = new Map<string, { name: string; specific: boolean } | null>();
async function resolveBooruTag(words: string[]): Promise<{ name: string; specific: boolean } | null> {
  const cacheKey = words.join(" ");
  if (booruTagCache.has(cacheKey)) return booruTagCache.get(cacheKey) ?? null;
  const candidates: string[] = [];
  for (let len = Math.min(words.length, 4); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) candidates.push(words.slice(i, i + len).join("_"));
  }
  let found: { name: string; specific: boolean } | null = null;
  try {
    const url = `https://danbooru.donmai.us/tags.json?search[name_comma]=${encodeURIComponent(candidates.slice(0, 20).join(","))}&search[hide_empty]=yes&limit=20`;
    const r = await fetch(url, { headers: { "User-Agent": "SenkoAI/2.0 (ImageAggregator)" }, signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const tags = (await r.json()) as { name: string; post_count: number; category: number }[];
      const usable = Array.isArray(tags) ? tags.filter((t) => t.post_count >= 20) : [];
      // Prefer the longest (most specific) match, then the most used.
      usable.sort((a, b) => b.name.split("_").length - a.name.split("_").length || b.post_count - a.post_count);
      const best = usable[0];
      // Categories 3 (series) and 4 (character) mean the query really is about anime/game art.
      if (best) found = { name: best.name, specific: best.category === 3 || best.category === 4 };
    }
  } catch {
    /* booru lookups are best effort */
  }
  booruTagCache.set(cacheKey, found);
  if (booruTagCache.size > 500) booruTagCache.delete(booruTagCache.keys().next().value as string);
  return found;
}

// ── 6b. WALLHAVEN (high-res wallpapers, JSON API) ──
async function fetchWallhavenImages(query: string, page: number, nsfw: boolean): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const key = process.env.WALLHAVEN_API_KEY ? `&apikey=${encodeURIComponent(process.env.WALLHAVEN_API_KEY)}` : "";
    const purity = nsfw ? (key ? "111" : "110") : "100";
    const pages = await Promise.allSettled(
      [page * 2 - 1, page * 2].map((p) =>
        fetch(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(query)}&page=${p}&purity=${purity}&sorting=relevance${key}`, {
          headers: { "User-Agent": "SenkoAI/2.0 (ImageAggregator)", Accept: "application/json" },
          signal: AbortSignal.timeout(7000),
        }).then((r) => (r.ok ? r.json() : null))
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled" || !Array.isArray(pg.value?.data)) continue;
      for (const w of pg.value.data as { path?: string; url?: string; resolution?: string }[]) {
        if (w.path) addImage(results, seen, { url: w.path, alt: `${query} ${w.resolution || ""}`.trim(), source: w.url || "", engine: "wallhaven" });
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// ── 7. BOORU / ART BOARDS (Danbooru/Safebooru, Rule34, Gelbooru, e621) ──
async function fetchBooruEngines(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();

  const nsfwPattern =
    /\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|e621|gelbooru|danbooru|paheal|xbooru|ecchi|waifu|anime\s*girl)\b/i;
  const isNsfw = nsfwPattern.test(query);
  const isGif = /\b(gifs?|animated)\b/i.test(query);

  const cleanSubject = query
    .replace(
      /\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|images?|pics?|pictures?|photos?|gifs?|animated|wallpapers?|gallery|art|fan\s*art|anime|manga|character|show\s*me|send\s*me|find|get\s*me|of|on|from|for|the|a|an|e621|gelbooru|danbooru|paheal|xbooru)\b/gi,
      ""
    )
    .trim();

  if (!cleanSubject) return results;

  const words = cleanSubject.toLowerCase().split(/\s+/).filter(Boolean);
  const animeHint = /\b(anime|manga|waifu|fan\s*art|booru|character|vtuber)\b/i.test(query);
  const resolved = await resolveBooruTag(words);
  // Without a known character/series tag, boorus only add noise to normal searches.
  if (!resolved && !isNsfw && !animeHint) return results;
  if (resolved && !resolved.specific && !isNsfw && !animeHint) return results;
  const mainTag = resolved?.name || words.join("_");
  // Space separates tags; anonymous Danbooru allows at most 2.
  const allTags = (isGif ? [mainTag, "animated"] : [mainTag]).join(" ");
  const plusTags = allTags;
  const underscoreTag = allTags;

  const tasks: Promise<void>[] = [];

  // Safebooru (always safe/anime art friendly)
  tasks.push(
    (async () => {
      try {
        const apiUrl = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=80&pid=${page - 1}&tags=${encodeURIComponent(underscoreTag)}`;
        const r = await fetch(apiUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
        if (!r.ok) return;
        const posts = await r.json();
        if (Array.isArray(posts)) {
          for (const post of posts) {
            const imgUrl = post.file_url || post.sample_url || (post.directory && post.image ? `https://safebooru.org/images/${post.directory}/${post.image}` : "");
            if (imgUrl) {
              const tags = String(post.tags || "").split(" ").slice(0, 5).join(", ");
              addImage(results, seen, {
                url: imgUrl,
                alt: tags || cleanSubject,
                source: `https://safebooru.org/index.php?page=post&s=view&id=${post.id}`,
                engine: "safebooru",
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    })()
  );

  // Danbooru
  tasks.push(
    (async () => {
      try {
        const tagParam = allTags;
        const apiUrl = `https://danbooru.donmai.us/posts.json?limit=80&page=${page}&tags=${encodeURIComponent(tagParam)}`;
        const r = await fetch(apiUrl, {
          headers: { "User-Agent": "SenkoAI/2.0 (ImageAggregator)" },
          signal: AbortSignal.timeout(7000),
        });
        if (!r.ok) return;
        const posts = await r.json();
        if (Array.isArray(posts)) {
          for (const post of posts) {
            const imgUrl = post.file_url || post.large_file_url || post.preview_file_url;
            if (imgUrl) {
              const tags = String(post.tag_string_general || "").split(" ").slice(0, 5).join(", ");
              addImage(results, seen, {
                url: imgUrl,
                alt: tags || cleanSubject,
                source: `https://danbooru.donmai.us/posts/${post.id}`,
                engine: "danbooru",
              });
            }
          }
        }
      } catch {
        /* ignore */
      }
    })()
  );

  if (isNsfw) {
    // Rule34.xxx
    tasks.push(
      (async () => {
        try {
          const apiUrl = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${page - 1}&tags=${encodeURIComponent(plusTags)}`;
          const r = await fetch(apiUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
          const posts = await r.json();
          if (Array.isArray(posts)) {
            for (const post of posts) {
              const imgUrl = post.file_url || post.sample_url;
              if (imgUrl) {
                const tags = String(post.tags || "").split(" ").slice(0, 5).join(", ");
                addImage(results, seen, {
                  url: imgUrl,
                  alt: tags || cleanSubject,
                  source: `https://rule34.xxx/index.php?page=post&s=view&id=${post.id}`,
                  engine: "rule34",
                });
              }
            }
          }
        } catch {
          /* ignore */
        }
      })()
    );

    // Gelbooru
    tasks.push(
      (async () => {
        try {
          const apiUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=100&pid=${page - 1}&tags=${encodeURIComponent(plusTags)}`;
          const r = await fetch(apiUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
          const data = await r.json();
          const posts = data?.post || data;
          if (Array.isArray(posts)) {
            for (const post of posts) {
              const imgUrl = post.file_url || post.sample_url;
              if (imgUrl) {
                const tags = String(post.tags || "").split(" ").slice(0, 5).join(", ");
                addImage(results, seen, {
                  url: imgUrl,
                  alt: tags || cleanSubject,
                  source: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
                  engine: "gelbooru",
                });
              }
            }
          }
        } catch {
          /* ignore */
        }
      })()
    );

    // e621
    tasks.push(
      (async () => {
        try {
          const apiUrl = `https://e621.net/posts.json?limit=100&page=${page}&tags=${encodeURIComponent(plusTags)}`;
          const r = await fetch(apiUrl, {
            headers: { "User-Agent": "SenkoAI/2.0 (search-api)" },
            signal: AbortSignal.timeout(8000),
          });
          const data = await r.json();
          if (Array.isArray(data?.posts)) {
            for (const post of data.posts) {
              const imgUrl = post.file?.url || post.sample?.url || post.preview?.url;
              if (imgUrl) {
                const tags = (post.tags?.general || []).slice(0, 5).join(", ");
                addImage(results, seen, {
                  url: imgUrl,
                  alt: tags || cleanSubject,
                  source: `https://e621.net/posts/${post.id}`,
                  engine: "e621",
                });
              }
            }
          }
        } catch {
          /* ignore */
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  return results;
}

// ── 8. DEEP GALLERY PAGE SCAN (Scrapes actual image/wallpaper sites) ──
export async function scrapeImagesFromPageUrl(pageUrl: string, defaultAlt = ""): Promise<ScrapedImage[]> {
  const imgs: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok) return imgs;
    const html = await res.text();
    let origin = "";
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      /* ignore */
    }

    const resolveImg = (src: string): string | null => {
      if (!src) return null;
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = origin + src;
      else if (!src.startsWith("http")) return null;
      return isValidImageUrl(src) ? src : null;
    };

    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch) {
      const s = resolveImg(ogMatch[1]);
      if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
    }

    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    let srcM: RegExpExecArray | null;
    while ((srcM = srcsetRegex.exec(html)) !== null) {
      // "a.jpg 320w, b.jpg 1280w" -> b.jpg (largest width/density)
      const entries = srcM[1]
        .split(/,\s+(?=\S)/)
        .map((part) => {
          const [u, d = ""] = part.trim().split(/\s+/);
          return { u, size: parseFloat(d) * (d.endsWith("x") ? 1000 : 1) || 0 };
        })
        .sort((a, b) => b.size - a.size);
      const s = entries[0] ? resolveImg(entries[0].u) : null;
      if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
    }

    const lazyRegex = /(?:data-src|data-original|data-lazy-src|data-full|data-image)=["'](https?:\/\/[^"']+)["']/gi;
    let lazyM: RegExpExecArray | null;
    while ((lazyM = lazyRegex.exec(html)) !== null) {
      const s = resolveImg(lazyM[1]);
      if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
    }

    const imgRegex = /<img[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let imgM: RegExpExecArray | null;
    while ((imgM = imgRegex.exec(html)) !== null) {
      const widthM = imgM[0].match(/width=["']?(\d+)/i);
      if (widthM && parseInt(widthM[1], 10) < 80) continue;
      const heightM = imgM[0].match(/height=["']?(\d+)/i);
      if (heightM && parseInt(heightM[1], 10) < 80) continue;
      const s = resolveImg(imgM[1]);
      if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
    }

    const linkImgRegex = /<a[^>]*href=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/gi;
    let linkM: RegExpExecArray | null;
    while ((linkM = linkImgRegex.exec(html)) !== null) {
      const s = resolveImg(linkM[1]);
      if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
    }
  } catch {
    /* ignore */
  }
  return imgs;
}

// Sites that show nothing useful without a login or JavaScript.
const NO_GALLERY_HOSTS = /(youtube\.com|google\.|facebook\.com|instagram\.com|tiktok\.com|pinterest\.|twitter\.com|x\.com\/)/i;

async function bingWebResultUrls(query: string): Promise<string[]> {
  try {
    const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=15`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const out: string[] = [];
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 8) {
      const u = m[1].replace(/&amp;/g, "&");
      if (!NO_GALLERY_HOSTS.test(u) && !/bing\.com|microsoft\.com/.test(u)) out.push(u);
    }
    return out;
  } catch {
    return [];
  }
}

async function scrapeGalleryImages(query: string): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(`${query} images gallery wallpaper`);
    const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { ...HEADERS, Referer: "https://duckduckgo.com/" },
      signal: AbortSignal.timeout(7000),
    });
    const searchHtml = searchRes.ok ? await searchRes.text() : "";

    const galleryUrls: string[] = [];
    const urlRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/gi;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRegex.exec(searchHtml)) !== null && galleryUrls.length < 8) {
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
        if (pageUrl && pageUrl.startsWith("http") && !NO_GALLERY_HOSTS.test(pageUrl)) {
          galleryUrls.push(pageUrl);
        }
      } catch {
        /* skip */
      }
    }

    if (galleryUrls.length < 3) {
      for (const u of await bingWebResultUrls(`${query} wallpaper gallery`)) {
        if (galleryUrls.length >= 8) break;
        if (!galleryUrls.includes(u)) galleryUrls.push(u);
      }
    }

    const scrapes = await Promise.allSettled(galleryUrls.map((u) => scrapeImagesFromPageUrl(u, query)));
    for (const s of scrapes) {
      if (s.status !== "fulfilled") continue;
      for (const img of s.value) addImage(results, seen, img);
    }
  } catch {
    /* ignore */
  }
  return results;
}

/**
 * Scrape images across all available search engines and image boards in parallel.
 * Interleaves results from each engine so the gallery has rich source diversity,
 * returning up to `limit` (default 255) deduplicated images per page.
 */
export async function searchMultiEngineImages(
  rawQuery: string,
  page = 1,
  limit = IMAGES_BATCH_SIZE
): Promise<{
  images: ScrapedImage[];
  query: string;
  page: number;
  hasMore: boolean;
  stats: Record<string, number>;
}> {
  const query = rawQuery.trim();
  if (!query) {
    return { images: [], query: "", page, hasMore: false, stats: {} };
  }

  const suffix = QUERY_SUFFIXES[(page - 1) % QUERY_SUFFIXES.length];
  const pagedQuery = page > 1 && suffix ? `${query} ${suffix}` : query;

  const searchApiUrl = process.env.SEARCH_API_URL;
  const proxyPromise: Promise<ScrapedImage[]> = searchApiUrl
    ? fetch(`${searchApiUrl}/images?q=${encodeURIComponent(query)}&page=${page}`, {
        signal: AbortSignal.timeout(12000),
      })
        .then((r) => (r.ok ? r.json() : { images: [] }))
        .then((d) => (Array.isArray(d?.images) ? d.images : []))
        .catch(() => [])
    : Promise.resolve([]);

  const nsfw = /\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|ecchi)\b/i.test(query);
  const [proxyResults, bingResults, ddgResults, redditResults, wikimediaResults, wallhavenResults, booruResults, galleryResults] =
    await Promise.all([
      proxyPromise,
      fetchBingImages(pagedQuery, page),
      fetchDDGImages(pagedQuery, page),
      fetchRedditImages(query, page),
      fetchWikimediaImages(query, page),
      fetchWallhavenImages(query, page, nsfw),
      fetchBooruEngines(query, page),
      scrapeGalleryImages(pagedQuery),
    ]);

  const images: ScrapedImage[] = [];
  const seen = new Set<string>();

  // Interleave all engine batches so the first ~255 images represent every browser/source
  const batches: ScrapedImage[][] = [
    bingResults,
    ddgResults,
    wallhavenResults,
    booruResults,
    galleryResults,
    redditResults,
    wikimediaResults,
    proxyResults,
  ].filter((b) => b.length > 0);

  const maxLen = batches.length ? Math.max(...batches.map((b) => b.length)) : 0;
  for (let i = 0; i < maxLen && images.length < limit; i++) {
    for (const batch of batches) {
      if (i < batch.length && images.length < limit) {
        const item = batch[i];
        addImage(images, seen, {
          url: item.url,
          alt: item.alt || query,
          source: item.source || "",
          engine: item.engine || "web",
        });
      }
    }
  }

  const stats: Record<string, number> = {};
  for (const img of images) {
    const eng = img.engine || "web";
    stats[eng] = (stats[eng] || 0) + 1;
  }

  return {
    images,
    query,
    page,
    hasMore: images.length >= 15,
    stats,
  };
}

const IMAGES_TAG_RE = /\[\[\s*images?\s*:\s*([^\]\n]+?)\s*\]\]/gi;
const LEGACY_IMAGES_ACTION_RE = /\[ACTION:(?:SCRAPE_)?IMAGES\s*:\s*([^\]\n]+?)\]/gi;

/**
 * Pulls `[[images: query]]` (or `[ACTION:IMAGES: query]`) tags out of an AI reply.
 */
export function extractImagesTag(text: string): { clean: string; query?: string } {
  let query: string | undefined;
  const cleaned = text
    .replace(IMAGES_TAG_RE, (_, q: string) => {
      if (!query && q?.trim()) query = q.trim();
      return "";
    })
    .replace(LEGACY_IMAGES_ACTION_RE, (_, q: string) => {
      if (!query && q?.trim()) query = q.trim();
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean: cleaned, query };
}

/**
 * Detects when a user's normal chat message is asking for images / photos / wallpapers / gallery
 * and extracts a clean search query. Returns undefined for ordinary non-image questions.
 */
export function detectImageIntentQuery(userMessage: string): string | undefined {
  const raw = userMessage.trim();
  if (!raw || raw.length > 260) return undefined;

  // Must mention an image-seeking phrase
  const hasImageNoun =
    /\b(images?|pics?|pictures?|photos?|photographs?|wallpapers?|fan\s*art|artworks?|illustrations?|gifs?|gallery|galleries|pfps?|icons?|banners?|renders?)\b/i.test(
      raw
    );
  const hasExplicitShow =
    /^\s*(?:show\s+me|send\s+me|find\s+me|get\s+me|give\s+me|let\s+me\s+see|i\s+wanna\s+see|i\s+want\s+to\s+see|can\s+(?:i|you)\s+(?:see|show|send|find)|scrape|search\s+for)\b/i.test(
      raw
    );

  // Avoid triggering when user is asking about an attached image ("what is in this image?")
  if (/\b(this|that|the\s+attached|my)\s+(image|pic|picture|photo|screenshot)\b/i.test(raw)) {
    return undefined;
  }

  // Trigger if:
  // 1. User says "show me / send me / find ... images/pics/photos/wallpapers/art of X"
  // 2. Or message starts with / consists of "<subject> images/pics/wallpapers/photos/gallery"
  const m1 = raw.match(
    /\b(?:images?|pics?|pictures?|photos?|wallpapers?|fan\s*art|artworks?|illustrations?|gifs?|gallery|galleries|pfps?|renders?)\s+(?:of|for|from|featuring|with|about)\s+([^\n?!.]+)/i
  );
  if (m1?.[1]) {
    const q = cleanExtractedSubject(m1[1]);
    if (q) return q;
  }

  if (hasImageNoun && (hasExplicitShow || raw.split(/\s+/).length <= 8)) {
    const q = cleanExtractedSubject(raw);
    if (q && q.length >= 2) return q;
  }

  return undefined;
}

function cleanExtractedSubject(input: string): string {
  return input
    .replace(
      /^\s*(?:hey\s+senko[,!\s]*|senko[,!\s]*|please\s+|pls\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|can\s+i\s+see\s+|let\s+me\s+see\s+|i\s+want\s+to\s+see\s+|i\s+wanna\s+see\s+|show\s+me\s+|send\s+me\s+|find\s+me\s+|get\s+me\s+|give\s+me\s+|search\s+for\s+|scrape\s+|look\s+up\s+)+/gi,
      ""
    )
    .replace(
      /\b(?:some\s+|any\s+|a\s+lot\s+of\s+|all\s+the\s+|the\s+best\s+|cool\s+|cute\s+|good\s+|more\s+)*(?:images?|pics?|pictures?|photos?|photographs?|wallpapers?|gallery|galleries|in\s+a\s+carousel|from\s+all\s+browsers)\b/gi,
      ""
    )
    .replace(/^\s*(?:of|for|from|about|with)\s+/i, "")
    .replace(/[?!.,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
