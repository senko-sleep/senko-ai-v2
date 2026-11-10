// Shared shapes for the in-chat comic reader (pick a site -> pick a series -> read it).

export type ComicSourceId = "webtoon-canvas" | "webtoon-originals" | "mangadex" | "tapas" | "ehentai" | "imhentai" | "hentaiera" | "hentaifox";

export const COMIC_SOURCE_IDS: ComicSourceId[] = ["webtoon-canvas", "webtoon-originals", "mangadex", "tapas", "ehentai", "imhentai", "hentaiera", "hentaifox"];

/** Sites built on the same gallery engine (search cards, /gallery/<id>/, one page lists every image). */
export const GALLERY_SITES: Partial<Record<ComicSourceId, { host: string; search: (q: string) => string }>> = {
  imhentai: { host: "imhentai.xxx", search: (q) => `https://imhentai.xxx/search/?key=${encodeURIComponent(q)}` },
  hentaiera: { host: "hentaiera.com", search: (q) => `https://hentaiera.com/search/?key=${encodeURIComponent(q)}` },
  hentaifox: { host: "hentaifox.com", search: (q) => `https://hentaifox.com/search/?q=${encodeURIComponent(q)}&sort=popular` },
};

export interface ComicSourceInfo {
  id: ComicSourceId;
  name: string;
  /** One line on what the site has. */
  blurb: string;
  /** Words people use for it ("canvas", "md"). */
  aliases: string[];
  /** Adult-only site: listed for adult requests when SafeSearch is off. */
  adult?: boolean;
}

export interface ComicSeries {
  id: string;
  source: ComicSourceId;
  title: string;
  author?: string;
  cover?: string;
  url: string;
  /** e.g. "10K views" or "2.3K follows". */
  stat?: string;
  description?: string;
  /** The site marks it as mature / not for kids. */
  mature?: boolean;
}

export interface ComicChapter {
  id: string;
  title: string;
  /** Position in reading order (1-based). */
  index: number;
  url?: string;
  date?: string;
}

export interface ComicPage {
  src: string;
  width?: number;
  height?: number;
}

/** What the chat card shows, stored on the assistant message. */
export type ComicCard =
  // adult: the request asked for explicit comics (SafeSearch off, subject already checked).
  | { stage: "sources"; query: string; sources: ComicSourceInfo[]; adult?: boolean }
  | { stage: "results"; query: string; source: ComicSourceId; sourceName: string; results: ComicSeries[]; adult?: boolean }
  | {
      stage: "reader";
      source: ComicSourceId;
      sourceName: string;
      series: ComicSeries;
      chapters: ComicChapter[];
      /** Chapter shown first, with its pages already loaded. */
      chapterId: string;
      pages: ComicPage[];
      /** Referer the image proxy must send (sites that block hotlinking). */
      referer?: string;
    };

/** Page image URL the browser can load (through our proxy when the site needs a Referer). */
export function comicImageUrl(src: string, referer?: string): string {
  // Already one of our own routes (E-Hentai pages are looked up when they load).
  if (src.startsWith("/api/")) return src;
  const q = new URLSearchParams({ url: src });
  if (referer) q.set("referer", referer);
  return `/api/video-proxy?${q.toString()}`;
}

/** The Referer each site expects on its images. */
export function comicReferer(source: ComicSourceId): string {
  if (source === "mangadex") return "https://mangadex.org/";
  if (source === "tapas") return "https://tapas.io/";
  if (source === "ehentai") return "https://e-hentai.org/";
  const g = GALLERY_SITES[source];
  if (g) return `https://${g.host}/`;
  return "https://www.webtoons.com/";
}
