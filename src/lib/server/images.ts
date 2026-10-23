// Multi-engine image scraper used by /api/images and normal chat replies.
// Scrapes Bing, Google, DuckDuckGo, Yahoo, Brave, Reddit, Wikimedia, Boorus
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

function addImage(results: ScrapedImage[], seen: Set<string>, img: ScrapedImage): void {
  if (!img.url || !isValidImageUrl(img.url)) return;
  const norm = normalizeImageUrl(img.url);
  if (seen.has(norm)) return;
  seen.add(norm);
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

function extractSourceFromGoogleHtml(html: string, imgUrl: string): string {
  const idx = html.indexOf(imgUrl.slice(0, 60));
  if (idx > 0) {
    const chunk = html.slice(Math.max(0, idx - 2000), idx);
    const matches = [...chunk.matchAll(/\["(https?:\/\/(?!encrypted-tbn)[^"]{10,})"/g)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1][1];
      if (!/\.(jpg|jpeg|png|gif|webp)/i.test(last)) return last;
    }
  }
  try {
    return new URL(imgUrl).origin;
  } catch {
    return "";
  }
}

// ── 2. GOOGLE IMAGES (8 pages in parallel, ~160 raw images) ──
async function fetchGoogleImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const baseOffset = ((page - 1) % 3) * 120;
    const offsets = Array.from({ length: 8 }, (_, i) => baseOffset + i * 20);
    const pages = await Promise.allSettled(
      offsets.map((off) =>
        fetch(`https://www.google.com/search?q=${encoded}&tbm=isch&hl=en&start=${off}&safe=off`, {
          headers: { ...HEADERS, Referer: "https://www.google.com/" },
          signal: AbortSignal.timeout(9000),
        }).then((r) => r.text())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const html = pg.value;
      const jsonImgRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
      let match: RegExpExecArray | null;
      while ((match = jsonImgRegex.exec(html)) !== null) {
        const imgUrl = match[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
        const w = parseInt(match[2], 10);
        const h = parseInt(match[3], 10);
        if (w < 100 || h < 100) continue;
        addImage(results, seen, {
          url: imgUrl,
          alt: query,
          source: extractSourceFromGoogleHtml(html, match[1]),
          engine: "google",
        });
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

// ── 4. YAHOO IMAGES (3 pages in parallel) ──
async function fetchYahooImages(query: string, page: number): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(query);
    const baseOffset = (page - 1) * 180;
    const offsets = [baseOffset + 1, baseOffset + 61, baseOffset + 121];
    const pages = await Promise.allSettled(
      offsets.map((b) =>
        fetch(`https://images.search.yahoo.com/search/images?p=${encoded}&b=${b}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(8000),
        }).then((r) => r.text())
      )
    );
    for (const pg of pages) {
      if (pg.status !== "fulfilled") continue;
      const html = pg.value;
      // Yahoo embeds data-data='{..."iurl":"...","rurl":"..."}' orimgurl= in links
      const dataRegex = /data=["']({[^"']*?(?:iurl|imgurl)[^"']*?})["']/gi;
      let m: RegExpExecArray | null;
      while ((m = dataRegex.exec(html)) !== null) {
        try {
          const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
          const data = JSON.parse(decoded);
          const url = data.iurl || data.imgurl || data.oi;
          if (url) {
            addImage(results, seen, {
              url,
              alt: data.alt || data.tit || query,
              source: data.rurl || "",
              engine: "yahoo",
            });
          }
        } catch {
          /* skip */
        }
      }
      const paramRegex = /[?&]imgurl=(https?%3A%2F%2F[^&"']+)/gi;
      let pm: RegExpExecArray | null;
      while ((pm = paramRegex.exec(html)) !== null) {
        try {
          const url = decodeURIComponent(pm[1]);
          addImage(results, seen, { url, alt: query, source: "", engine: "yahoo" });
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
      /\b(r34|rule\s*34|nsfw|hentai|porn|xxx|lewd|nude|naked|explicit|images?|pics?|pictures?|photos?|gifs?|animated|wallpapers?|gallery|art|fan\s*art|show\s*me|send\s*me|find|get\s*me|of|on|from|for|the|a|an|e621|gelbooru|danbooru|paheal|xbooru)\b/gi,
      ""
    )
    .trim();

  if (!cleanSubject) return results;

  // Booru tags use underscores for multi-word tags when searching single subjects, or + between tags
  const words = cleanSubject.toLowerCase().split(/\s+/).filter(Boolean);
  const plusTags = (isGif ? [...words, "animated"] : words).join("+");
  const underscoreTag = words.length === 2 ? `${words[0]}_${words[1]}` : plusTags;

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
        const tagParam = words.length <= 2 ? underscoreTag : words.slice(0, 2).join("+");
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
      const entries = srcM[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const entry of entries) {
        const s = resolveImg(entry);
        if (s) addImage(imgs, seen, { url: s, alt: defaultAlt, source: pageUrl, engine: "gallery" });
      }
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

async function scrapeGalleryImages(query: string): Promise<ScrapedImage[]> {
  const results: ScrapedImage[] = [];
  const seen = new Set<string>();
  try {
    const encoded = encodeURIComponent(`${query} images gallery wallpaper`);
    const searchRes = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: { ...HEADERS, Referer: "https://duckduckgo.com/" },
      signal: AbortSignal.timeout(7000),
    });
    if (!searchRes.ok) return results;
    const searchHtml = await searchRes.text();

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
      } catch {
        /* skip */
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

  const [
    proxyResults,
    bingResults,
    googleResults,
    ddgResults,
    yahooResults,
    redditResults,
    wikimediaResults,
    booruResults,
    galleryResults,
  ] = await Promise.all([
    proxyPromise,
    fetchBingImages(pagedQuery, page),
    fetchGoogleImages(pagedQuery, page),
    fetchDDGImages(pagedQuery, page),
    fetchYahooImages(pagedQuery, page),
    fetchRedditImages(query, page),
    fetchWikimediaImages(query, page),
    fetchBooruEngines(query, page),
    scrapeGalleryImages(pagedQuery),
  ]);

  const images: ScrapedImage[] = [];
  const seen = new Set<string>();

  // Interleave all engine batches so the first ~255 images represent every browser/source
  const batches: ScrapedImage[][] = [
    bingResults,
    googleResults,
    ddgResults,
    yahooResults,
    redditResults,
    booruResults,
    wikimediaResults,
    galleryResults,
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
