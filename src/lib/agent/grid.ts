// Reads full-size image URLs from a repeated image grid on any page, so the agent can fetch
// them in one batch instead of opening tiles one at a time. It looks at what sites commonly
// expose: srcset, lazy-load attributes, JSON attributes, wrapped URLs and direct media links.
// Explicit requests are not handled here.
import type { Page } from "playwright";
import { isExplicitMediaText } from "@/lib/policy-classifier";

export interface GridImage {
  url: string;
  alt: string;
  source: string;
}

export interface RawGridCandidate {
  value: string;
  /** "image" = the image's real src/srcset; "attr" = another attribute; "link" = an anchor href. */
  kind: "image" | "attr" | "link";
  width?: number;
}

export interface RawGridTile {
  candidates: RawGridCandidate[];
  alt: string;
  href: string;
  /** How many similar tiles sit beside this one. */
  groupSize: number;
}

const MAX_GRID_URLS = 12;
const MAX_SCANNED_IMAGES = 400;
const MIN_GROUP = 3;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const DIRECT_MEDIA = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i;
const THUMBNAIL = /\/\/(?:tse\d*\.mm\.bing\.net|th\.bing\.com|encrypted-tbn\d*\.gstatic\.com|external-content\.duckduckgo\.com)\/|\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews)\//i;
const NOT_CONTENT = /\.svg(?:[?#]|$)|sprite|favicon|\/(?:logo|icon|icons|avatar|avatars|badge|badges)[/._-]/i;
const WRAPPER_PARAMS = ["imgurl", "mediaurl", "img_url", "image_url", "image", "u", "url", "src", "file"];

/** Every URL a raw attribute value holds, including ones wrapped in JSON or query params. */
function expandValue(value: string): { url: string; unwrapped: boolean }[] {
  const text = value.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const found: string[] = [];
      const walk = (v: unknown) => {
        if (typeof v === "string") {
          if (/^https?:\/\//i.test(v)) found.push(v);
        } else if (v && typeof v === "object") {
          Object.values(v).forEach(walk);
        }
      };
      walk(JSON.parse(text));
      return found.map((url) => ({ url, unwrapped: true }));
    } catch {
      return [];
    }
  }
  if (!/^https?:\/\//i.test(text)) return [];
  const out = [{ url: text, unwrapped: false }];
  try {
    const params = new URL(text).searchParams;
    for (const key of WRAPPER_PARAMS) {
      const inner = params.get(key);
      if (inner && /^https?:\/\//i.test(inner)) out.push({ url: inner, unwrapped: true });
    }
  } catch {
    /* not a parseable URL */
  }
  return out;
}

/** The best full-size URL in one tile, or "" when it only has thumbnails or page links. */
export function bestTileUrl(tile: RawGridTile): string {
  let best = "";
  let bestScore = -1;
  for (const c of tile.candidates) {
    for (const { url, unwrapped } of expandValue(c.value)) {
      if (THUMBNAIL.test(url) || NOT_CONTENT.test(url)) continue;
      const direct = DIRECT_MEDIA.test(url);
      if (!direct && !(c.kind === "image" && !unwrapped)) continue;
      const score = (direct ? 100 : 0) + (unwrapped || c.kind === "link" ? 50 : 0) + Math.min(40, (c.width || 0) / 100);
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Unique full-size images from tiles that belong to a repeated group. */
export function buildGrid(tiles: RawGridTile[], limit = MAX_GRID_URLS): GridImage[] {
  const seen = new Set<string>();
  const out: GridImage[] = [];
  for (const tile of tiles) {
    if (tile.groupSize < MIN_GROUP) continue;
    const url = bestTileUrl(tile);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      alt: tile.alt.slice(0, 80),
      source: /^https?:\/\//i.test(tile.href) && !DIRECT_MEDIA.test(tile.href) ? tile.href : "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function collectTiles(page: Page): Promise<RawGridTile[]> {
  return page.evaluate((maxImages) => {
    const TILE = 'li, article, figure, [role=listitem], [role=gridcell], [class*="tile" i], [class*="card" i], [class*="item" i], [class*="thumb" i], [class*="result" i]';
    const keyOf = (el: Element) => `${el.tagName}.${(el.getAttribute("class") || "").trim().split(/\s+/)[0] || ""}`;
    const groupOf = (el: Element) => {
      let most = 1;
      let cur: Element | null = el;
      for (let depth = 0; cur?.parentElement && depth < 3; depth++, cur = cur.parentElement) {
        const key = keyOf(cur);
        most = Math.max(most, Array.from(cur.parentElement.children).filter((c) => keyOf(c) === key).length);
      }
      return most;
    };
    const tiles: RawGridTile[] = [];
    for (const img of Array.from(document.images).slice(0, maxImages)) {
      const rect = img.getBoundingClientRect();
      if (Math.max(rect.width, img.naturalWidth) < 60) continue;
      const link = img.closest("a");
      const tile = img.closest(TILE) || link || img.parentElement;
      if (!tile) continue;
      const candidates: RawGridCandidate[] = [];
      if (img.currentSrc || img.src) candidates.push({ value: img.currentSrc || img.src, kind: "image" });
      for (const el of [img, link, tile]) {
        if (!el) continue;
        for (const attr of Array.from(el.attributes)) {
          if (attr.value.length > 4000 || !attr.value.includes("http")) continue;
          if (/srcset$/i.test(attr.name)) {
            for (const part of attr.value.split(/,\s+/)) {
              const [value, size] = part.trim().split(/\s+/);
              candidates.push({ value, kind: "image", width: parseInt(size || "", 10) || 0 });
            }
          } else if (attr.name !== "src") {
            candidates.push({ value: attr.value, kind: el === link && attr.name === "href" ? "link" : "attr" });
          }
        }
      }
      tiles.push({ candidates, alt: img.alt || img.title || "", href: link?.href || "", groupSize: groupOf(tile) });
    }
    return tiles;
  }, MAX_SCANNED_IMAGES);
}

/** DuckDuckGo tiles only hold proxied thumbnails; its results JSON has the originals. */
async function fetchDdgImages(query: string, signal: AbortSignal, limit: number): Promise<GridImage[]> {
  const q = encodeURIComponent(query);
  const timed = () => AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  const tokenRes = await fetch(`https://duckduckgo.com/?q=${q}&kp=1&iax=images&ia=images`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: timed(),
  });
  const html = await tokenRes.text();
  const vqd = (html.match(/vqd=["']([^"']+)["']/i) || html.match(/vqd=([\d-]+)/i))?.[1];
  if (!vqd) return [];
  const res = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://duckduckgo.com/" },
    signal: timed(),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: { image?: unknown; title?: unknown; url?: unknown }[] };
  const seen = new Set<string>();
  const out: GridImage[] = [];
  for (const r of data.results || []) {
    if (typeof r.image !== "string" || !/^https?:\/\//i.test(r.image) || seen.has(r.image)) continue;
    seen.add(r.image);
    out.push({ url: r.image, alt: typeof r.title === "string" ? r.title.slice(0, 80) : "", source: typeof r.url === "string" ? r.url : "" });
    if (out.length >= limit) break;
  }
  return out;
}

/** Full-size images from the grid on the current page, on any site. */
export async function readGridImages(page: Page, opts: { goal: string; signal: AbortSignal; limit?: number }): Promise<GridImage[]> {
  const limit = opts.limit ?? MAX_GRID_URLS;
  if (isExplicitMediaText(opts.goal)) return [];
  let ddgQuery = "";
  try {
    const u = new URL(page.url());
    if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) ddgQuery = u.searchParams.get("q") || "";
  } catch {
    return [];
  }
  if (ddgQuery) {
    if (isExplicitMediaText(ddgQuery)) return [];
    return fetchDdgImages(ddgQuery, opts.signal, limit).catch(() => []);
  }
  return buildGrid(await collectTiles(page).catch(() => []), limit);
}

/** A note for the agent's history listing the grid's direct URLs, or "" when there are none. */
export async function describeGrid(page: Page, opts: { goal: string; signal: AbortSignal; onImages?: (images: GridImage[]) => void }): Promise<string> {
  const images = await readGridImages(page, opts).catch(() => []);
  if (!images.length) return "";
  opts.onImages?.(images);
  const lines = images.map((img, i) => `  ${i + 1}. ${img.url}${img.alt ? ` "${img.alt}"` : ""}`).join("\n");
  return `\nDirect image URLs from this grid. Use fetch_images with these (send:true when the user wants them in chat) instead of clicking tiles:\n${lines}`;
}
