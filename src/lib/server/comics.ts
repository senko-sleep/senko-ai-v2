// Comic sites the chat reader can search and read from.
// Webtoon (Canvas = creator-uploaded, Originals = official) is read from its public pages;
// MangaDex through its public API; Tapas and E-Hentai from their public pages.
// Each site needs: search -> chapters -> page images.
import type { SafeSearch } from "@/lib/content-policy";
import { COMIC_SOURCE_IDS, GALLERY_SITES, type ComicChapter, type ComicPage, type ComicSeries, type ComicSourceId, type ComicSourceInfo } from "@/lib/comics/types";
import { MINOR_WORDS } from "./adult-guard";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const MD_API = "https://api.mangadex.org";
const MD_UA = "SenkoAI/1.0 (personal reader)";
export const WEBTOON_REFERER = "https://www.webtoons.com/";

export const COMIC_SOURCES: ComicSourceInfo[] = [
  { id: "webtoon-canvas", name: "Webtoon Canvas", blurb: "Fan comics and indie series uploaded by creators", aliases: ["canvas", "webtoon canvas", "webtoons canvas", "webtoon", "webtoons", "line webtoon"] },
  { id: "mangadex", name: "MangaDex", blurb: "Big manga library with fan works and doujins", aliases: ["mangadex", "manga dex", "md", "dex"] },
  { id: "tapas", name: "Tapas", blurb: "Indie and fan comics, lots of free episodes", aliases: ["tapas", "tapas.io", "tapastic"] },
  { id: "webtoon-originals", name: "Webtoon Originals", blurb: "Official Webtoon series (early episodes free)", aliases: ["originals", "webtoon originals", "webtoons originals", "official"] },
  { id: "imhentai", name: "IMHentai", blurb: "Hentai manga, doujins and western porn comics", aliases: ["imhentai", "im hentai", "imhentai.xxx"], adult: true },
  { id: "ehentai", name: "E-Hentai", blurb: "Huge doujin and fan-comic archive, tagged in detail", aliases: ["e-hentai", "ehentai", "e hentai", "eh", "exhentai"], adult: true },
  { id: "hentaiera", name: "HentaiEra", blurb: "Big hentai and western comic library, updated daily", aliases: ["hentaiera", "hentai era"], adult: true },
  { id: "hentaifox", name: "HentaiFox", blurb: "Popular doujins and hentai manga, sorted by popularity", aliases: ["hentaifox", "hentai fox"], adult: true },
];

/** Adult requests list only the hentai sites; normal requests never list them. */
export function sourcesFor(adult: boolean): ComicSourceInfo[] {
  return COMIC_SOURCES.filter((s) => !!s.adult === adult);
}

const reach = new Map<ComicSourceId, { ok: boolean; at: number }>();
const ADULT_HOME: Partial<Record<ComicSourceId, string>> = {
  ehentai: "https://e-hentai.org/",
  imhentai: "https://imhentai.xxx/",
  hentaiera: "https://hentaiera.com/",
  hentaifox: "https://hentaifox.com/",
};

/**
 * The hentai sites this server can actually load right now. Some sit behind Cloudflare checks
 * that block server requests from some hosts (IMHentai from here), so blocked ones are left off
 * the list instead of failing after the pick. Checked at most every 10 minutes.
 */
export async function reachableAdultSources(signal?: AbortSignal): Promise<ComicSourceInfo[]> {
  const list = sourcesFor(true);
  const now = Date.now();
  await Promise.all(
    list.map(async (s) => {
      const hit = reach.get(s.id);
      if (hit && now - hit.at < 10 * 60_000) return;
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000);
      const ok = await fetch(ADULT_HOME[s.id]!, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, signal: sig })
        .then(async (r) => r.ok && !/Just a moment\.\.\./.test((await r.text()).slice(0, 2000)))
        .catch(() => false);
      reach.set(s.id, { ok, at: now });
    })
  );
  const ok = list.filter((s) => reach.get(s.id)?.ok);
  return ok.length ? ok : list;
}

export function sourceInfo(id: ComicSourceId): ComicSourceInfo {
  return COMIC_SOURCES.find((s) => s.id === id) || COMIC_SOURCES[0];
}

/** Tags/titles of sexual works with characters presented as children. Always dropped. */
const MINOR_TAGS = /\b(?:lolicon|shotacon|toddlercon|loli|shota)\b/i;

function minorWork(s: { title: string; tags?: string[] }): boolean {
  return MINOR_WORDS.test(s.title) || MINOR_TAGS.test(s.title) || (s.tags || []).some((t) => MINOR_TAGS.test(t));
}

export { comicReferer as refererFor } from "@/lib/comics/types";

const TOP = 20;

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function getText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, signal: sig, redirect: "follow" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}`);
  return res.text();
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const res = await fetch(url, { headers: { "User-Agent": MD_UA, Accept: "application/json" }, signal: sig });
  if (!res.ok) throw new Error(`MangaDex returned ${res.status}`);
  return res.json() as Promise<T>;
}

/** Only pages on the site itself (ids come back from the browser). */
function webtoonUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !/(^|\.)webtoons\.com$/i.test(u.hostname)) throw new Error("Not a Webtoon link.");
  return u;
}

// ---------- Webtoon ----------

/** Series cards on a Webtoon search page. */
export function parseWebtoonSearch(html: string, source: ComicSourceId): ComicSeries[] {
  const out: ComicSeries[] = [];
  const re = /<a\s+href="(https:\/\/www\.webtoons\.com\/[^"]+\/list\?title_no=(\d+))"[^>]*_card_item[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const body = m[3];
    const title = decode(/<strong class="title">([\s\S]*?)<\/strong>/.exec(body)?.[1] || "");
    if (!title) continue;
    out.push({
      id: decode(m[1]),
      source,
      title,
      author: decode(/<div class="author">([\s\S]*?)<\/div>/.exec(body)?.[1] || "") || undefined,
      cover: /<img[^>]+src="([^"]+)"/.exec(body)?.[1],
      url: decode(m[1]),
      stat: decode(/<div class="view_count">([\s\S]*?)<\/div>/.exec(body)?.[1] || "") || undefined,
      mature: /data-title-unsuitable-for-children="true"/.test(body),
    });
  }
  return out;
}

/** Episodes on one page of a Webtoon series list (newest first, as the site shows them). */
export function parseWebtoonEpisodes(html: string): { no: number; title: string; url: string; date?: string }[] {
  const out: { no: number; title: string; url: string; date?: string }[] = [];
  const re = /<li[^>]*_episodeItem[^>]*data-episode-no="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  for (const m of html.matchAll(re)) {
    const body = m[2];
    const href = /<a\s+href="([^"]+viewer\?[^"]+)"/.exec(body)?.[1];
    if (!href) continue;
    const title = decode(/<span class="subj">([\s\S]*?)<\/span>\s*<\/span>|<span class="subj">([\s\S]*?)<\/span>/.exec(body)?.slice(1).find(Boolean) || "") || `Episode ${m[1]}`;
    out.push({ no: Number(m[1]), title, url: decode(href), date: decode(/<span class="date">([\s\S]*?)<\/span>/.exec(body)?.[1] || "") || undefined });
  }
  return out;
}

/** Page images in a Webtoon episode viewer. */
export function parseWebtoonPages(html: string): ComicPage[] {
  const pages: ComicPage[] = [];
  for (const m of html.matchAll(/<img\b[^>]*class="_images"[^>]*>/g)) {
    const tag = m[0];
    const src = /data-url="([^"]+)"/.exec(tag)?.[1];
    if (!src) continue;
    const w = Number(/width="([\d.]+)"/.exec(tag)?.[1]);
    const h = Number(/height="([\d.]+)"/.exec(tag)?.[1]);
    pages.push({ src: decode(src), width: w || undefined, height: h || undefined });
  }
  return pages;
}

async function webtoonSearch(source: ComicSourceId, queries: string[], signal?: AbortSignal): Promise<ComicSeries[]> {
  const kind = source === "webtoon-originals" ? "originals" : "canvas";
  const seen = new Map<string, ComicSeries>();
  for (const q of queries) {
    if (seen.size >= TOP) break;
    const html = await getText(`https://www.webtoons.com/en/search/${kind}?keyword=${encodeURIComponent(q)}`, signal).catch(() => "");
    for (const s of parseWebtoonSearch(html, source)) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  return [...seen.values()];
}

async function webtoonChapters(seriesUrl: string, signal?: AbortSignal): Promise<ComicChapter[]> {
  const base = webtoonUrl(seriesUrl);
  const byNo = new Map<number, { no: number; title: string; url: string; date?: string }>();
  // The list shows 10 episodes a page, newest first; past the last page it repeats page 1.
  for (let page = 1; page <= 40; page++) {
    const u = new URL(base);
    u.searchParams.set("page", String(page));
    const eps = parseWebtoonEpisodes(await getText(u.href, signal));
    const fresh = eps.filter((e) => !byNo.has(e.no));
    for (const e of fresh) byNo.set(e.no, e);
    if (!fresh.length || eps.length < 10) break;
  }
  return [...byNo.values()]
    .sort((a, b) => a.no - b.no)
    .map((e, i) => ({ id: e.url, title: e.title, index: i + 1, url: e.url, date: e.date }));
}

async function webtoonPages(viewerUrl: string, signal?: AbortSignal): Promise<ComicPage[]> {
  return parseWebtoonPages(await getText(webtoonUrl(viewerUrl).href, signal, { Referer: WEBTOON_REFERER }));
}

// ---------- MangaDex ----------

interface MdRel { id: string; type: string; attributes?: { fileName?: string; name?: string } }
interface MdManga {
  id: string;
  attributes: { title: Record<string, string>; altTitles?: Record<string, string>[]; description?: Record<string, string>; contentRating?: string };
  relationships: MdRel[];
}
interface MdChapter { id: string; attributes: { chapter: string | null; title: string | null; volume: string | null; pages: number; externalUrl: string | null; publishAt?: string } }

/** Sexual ratings (erotica/pornographic) only for adult requests with SafeSearch off. */
function mdRatings(safe: SafeSearch, adult = false): string {
  const ratings = safe === "strict" ? ["safe"] : safe === "off" && adult ? ["safe", "suggestive", "erotica", "pornographic"] : ["safe", "suggestive"];
  return ratings.map((r) => `contentRating[]=${r}`).join("&");
}

function mdTitle(m: MdManga): string {
  const t = m.attributes.title;
  return t.en || m.attributes.altTitles?.find((a) => a.en)?.en || Object.values(t)[0] || "Untitled";
}

async function mangadexSearch(queries: string[], safe: SafeSearch, adult: boolean, signal?: AbortSignal): Promise<ComicSeries[]> {
  const seen = new Map<string, ComicSeries>();
  for (const q of queries) {
    if (seen.size >= TOP) break;
    const url = `${MD_API}/manga?title=${encodeURIComponent(q)}&limit=${TOP}&order[followedCount]=desc&includes[]=cover_art&includes[]=author&availableTranslatedLanguage[]=en&hasAvailableChapters=true&${mdRatings(safe, adult)}`;
    const res = await getJson<{ data: MdManga[] }>(url, signal).catch(() => ({ data: [] as MdManga[] }));
    for (const m of res.data) {
      if (seen.has(m.id)) continue;
      const cover = m.relationships.find((r) => r.type === "cover_art")?.attributes?.fileName;
      seen.set(m.id, {
        id: m.id,
        source: "mangadex",
        title: mdTitle(m),
        author: m.relationships.find((r) => r.type === "author")?.attributes?.name,
        cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : undefined,
        url: `https://mangadex.org/title/${m.id}`,
        description: m.attributes.description?.en?.slice(0, 300),
        mature: !!m.attributes.contentRating && m.attributes.contentRating !== "safe",
      });
    }
  }
  return [...seen.values()];
}

const MD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mangadexChapters(mangaId: string, safe: SafeSearch, signal?: AbortSignal): Promise<ComicChapter[]> {
  if (!MD_ID.test(mangaId)) throw new Error("Bad MangaDex id.");
  const all: MdChapter[] = [];
  for (let offset = 0; offset < 2000; offset += 500) {
    const res = await getJson<{ data: MdChapter[]; total: number }>(
      // The series was already picked from the results, so any rating SafeSearch allows is fine here.
      `${MD_API}/manga/${mangaId}/feed?translatedLanguage[]=en&order[volume]=asc&order[chapter]=asc&limit=500&offset=${offset}&${mdRatings(safe, true)}`,
      signal
    );
    all.push(...res.data);
    if (offset + 500 >= res.total) break;
  }
  // Several groups may upload the same chapter: keep the first readable one.
  const seen = new Set<string>();
  const out: ComicChapter[] = [];
  for (const c of all) {
    if (c.attributes.externalUrl || !c.attributes.pages) continue;
    const key = c.attributes.chapter ?? c.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = [c.attributes.chapter ? `Ch. ${c.attributes.chapter}` : "Oneshot", c.attributes.title].filter(Boolean).join(" · ");
    out.push({ id: c.id, title: label, index: out.length + 1, url: `https://mangadex.org/chapter/${c.id}`, date: c.attributes.publishAt?.slice(0, 10) });
  }
  return out;
}

async function mangadexPages(chapterId: string, signal?: AbortSignal): Promise<ComicPage[]> {
  if (!MD_ID.test(chapterId)) throw new Error("Bad MangaDex id.");
  const res = await getJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(`${MD_API}/at-home/server/${chapterId}`, signal);
  return res.chapter.data.map((f) => ({ src: `${res.baseUrl}/data/${res.chapter.hash}/${f}` }));
}

// ---------- Tapas ----------

export const TAPAS_REFERER = "https://tapas.io/";

/** Series cards on a Tapas search page. */
export function parseTapasSearch(html: string): ComicSeries[] {
  const out: ComicSeries[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<li class="search-item-wrap">([\s\S]*?)<\/li>/g)) {
    const body = m[1];
    const id = /data-series-id="(\d+)"/.exec(body)?.[1];
    const href = /href="(\/series\/[^"]+)"/.exec(body)?.[1];
    if (!id || !href || seen.has(id)) continue;
    const img = /<img\s+src="([^"]+)"\s+alt="([^"]*)"/.exec(body);
    const title = decode(/<a class="link link--ink[^>]*>([\s\S]*?)<\/a>/.exec(body)?.[1] || img?.[2] || "");
    if (!title) continue;
    seen.add(id);
    const author = decode(/<a[^>]*class="[^"]*\bname\b[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(body)?.[1] || "") || undefined;
    out.push({ id, source: "tapas", title, author, cover: img?.[1], url: `https://tapas.io${decode(href)}` });
  }
  return out;
}

/** Page images in a Tapas episode. */
export function parseTapasPages(html: string): ComicPage[] {
  const pages: ComicPage[] = [];
  for (const m of html.matchAll(/<img\b[^>]*class="content__img[^"]*"[^>]*>/g)) {
    const src = /data-src="([^"]+)"/.exec(m[0])?.[1];
    if (!src) continue;
    const w = Number(/data-width="([\d.]+)"/.exec(m[0])?.[1]);
    const h = Number(/data-height="([\d.]+)"/.exec(m[0])?.[1]);
    pages.push({ src: decode(src), width: w || undefined, height: h || undefined });
  }
  return pages;
}

async function tapasSearch(queries: string[], signal?: AbortSignal): Promise<ComicSeries[]> {
  const seen = new Map<string, ComicSeries>();
  for (const q of queries) {
    if (seen.size >= TOP) break;
    const html = await getText(`https://tapas.io/search?q=${encodeURIComponent(q)}&t=COMICS`, signal).catch(() => "");
    for (const s of parseTapasSearch(html)) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  return [...seen.values()];
}

interface TapasEpisode { id: number; title: string; free: boolean; must_pay: boolean; mature: boolean; publish_date?: string; scheduled?: boolean }

async function tapasChapters(seriesId: string, signal?: AbortSignal): Promise<ComicChapter[]> {
  if (!/^\d+$/.test(seriesId)) throw new Error("Bad Tapas id.");
  const eps: TapasEpisode[] = [];
  for (let page = 1; page <= 50; page++) {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    const res = await fetch(`https://tapas.io/series/${seriesId}/episodes?page=${page}&sort=OLDEST&max_limit=20`, {
      headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      signal: sig,
    });
    if (!res.ok) throw new Error(`tapas.io returned ${res.status}`);
    const j = (await res.json()) as { data?: { episodes?: TapasEpisode[]; pagination?: { has_next?: boolean } } };
    eps.push(...(j.data?.episodes || []));
    if (!j.data?.pagination?.has_next) break;
  }
  // Paid and mature episodes need a Tapas login, so only free public ones are readable here.
  return eps
    .filter((e) => e.free && !e.must_pay && !e.mature && !e.scheduled)
    .map((e, i) => ({ id: String(e.id), title: decode(e.title), index: i + 1, url: `https://tapas.io/episode/${e.id}`, date: e.publish_date?.slice(0, 10) }));
}

async function tapasPages(episodeId: string, signal?: AbortSignal): Promise<ComicPage[]> {
  if (!/^\d+$/.test(episodeId)) throw new Error("Bad Tapas id.");
  return parseTapasPages(await getText(`https://tapas.io/episode/${episodeId}`, signal, { Referer: TAPAS_REFERER }));
}

// ---------- E-Hentai ----------

const EH = "https://e-hentai.org";
// Searched without these, and anything still tagged with them is dropped (see minorWork).
const EH_EXCLUDE = ' -"female:lolicon$" -"male:lolicon$" -"male:shotacon$" -"female:shotacon$" -"female:toddlercon$" -"male:toddlercon$"';

/** Only gallery (/g/) and page (/s/) links on e-hentai.org. */
function ehUrl(raw: string, kind: "g" | "s"): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.hostname !== "e-hentai.org" || !u.pathname.startsWith(`/${kind}/`)) throw new Error("Not an E-Hentai link.");
  return u;
}

/** Gallery rows on an E-Hentai search page (compact list view), with their tags. */
export function parseEhSearch(html: string): (ComicSeries & { tags: string[] })[] {
  const out: (ComicSeries & { tags: string[] })[] = [];
  for (const row of html.split(/<tr>(?=<td class="gl1c)/).slice(1)) {
    const link = /<a href="(https:\/\/e-hentai\.org\/g\/(\d+)\/[0-9a-f]+\/)">\s*<div class="glink">([\s\S]*?)<\/div>/.exec(row);
    if (!link) continue;
    const img = /<img[^>]+(?:data-src|src)="(https:\/\/ehgt\.org\/[^"]+)"/.exec(row)?.[1];
    const tags = [...row.matchAll(/class="gt[l]?" title="([^"]+)"/g)].map((t) => decode(t[1]));
    const pages = /<div>(\d+) pages?<\/div>/.exec(row)?.[1];
    const category = decode(/<div class="cn[^"]*"[^>]*>([^<]+)<\/div>/.exec(row)?.[1] || "");
    out.push({
      id: link[1],
      source: "ehentai",
      title: decode(link[3]),
      author: decode(/<a href="https:\/\/e-hentai\.org\/uploader\/[^"]+">([^<]+)<\/a>/.exec(row)?.[1] || "") || undefined,
      cover: img,
      url: link[1],
      stat: [category, pages && `${pages} pages`].filter(Boolean).join(" · ") || undefined,
      description: tags.slice(0, 12).join(", ") || undefined,
      mature: true,
      tags,
    });
  }
  return out;
}

/** Page links on one gallery page, and how many images the gallery has in all. */
export function parseEhGallery(html: string): { pages: string[]; total: number } {
  const pages = [...new Set([...html.matchAll(/href="(https:\/\/e-hentai\.org\/s\/[0-9a-f]+\/\d+-\d+)"/g)].map((m) => m[1]))];
  const total = Number(/Showing [\d,]+ - [\d,]+ of ([\d,]+) images?/.exec(html)?.[1].replace(/,/g, "")) || pages.length;
  return { pages, total };
}

/** The full-size image on one E-Hentai page. */
export function parseEhImage(html: string): string | null {
  const src = /<img id="img" src="([^"]+)"/.exec(html)?.[1];
  return src ? decode(src) : null;
}

async function ehSearch(queries: string[], signal?: AbortSignal): Promise<ComicSeries[]> {
  const seen = new Map<string, ComicSeries & { tags: string[] }>();
  for (const q of queries) {
    if (seen.size >= TOP) break;
    // The default (compact) list carries each gallery's tags in its row.
    const html = await getText(`${EH}/?f_search=${encodeURIComponent(q + EH_EXCLUDE)}`, signal).catch(() => "");
    for (const s of parseEhSearch(html)) if (!seen.has(s.id) && !minorWork(s)) seen.set(s.id, s);
  }
  return [...seen.values()].map((s) => {
    const { tags, ...series } = s;
    void tags; // used for filtering only
    return series;
  });
}

/** A gallery is one "chapter"; its pages come from the gallery's thumbnail pages. */
function ehChapters(galleryUrl: string): ComicChapter[] {
  const u = ehUrl(galleryUrl, "g");
  return [{ id: u.href, title: "Full gallery", index: 1, url: u.href }];
}

async function ehPages(galleryUrl: string, signal?: AbortSignal): Promise<ComicPage[]> {
  const base = ehUrl(galleryUrl, "g");
  const at = (p: number) => {
    const u = new URL(base);
    if (p) u.searchParams.set("p", String(p));
    return u.href;
  };
  // The nw cookie skips the "offensive content" interstitial (?nw=always redirects and drops ?p).
  const headers = { Cookie: "nw=1" };
  const first = parseEhGallery(await getText(at(0), signal, headers));
  const perPage = Math.max(first.pages.length, 1);
  const count = Math.min(Math.ceil(first.total / perPage), 30);
  const rest = await Promise.all(
    Array.from({ length: count - 1 }, (_, i) => getText(at(i + 1), signal, headers).then(parseEhGallery).catch(() => ({ pages: [] as string[], total: 0 })))
  );
  const links = [...new Set([...first.pages, ...rest.flatMap((r) => r.pages)])];
  // Each page's image URL is looked up when the reader loads it.
  return links.map((s) => ({ src: `/api/comics?source=ehentai&op=image&id=${encodeURIComponent(s)}` }));
}

/** Fetches the image behind an E-Hentai page link (used by the reader's <img> tags). */
export async function ehImage(pageUrl: string, signal?: AbortSignal): Promise<Response> {
  const html = await getText(ehUrl(pageUrl, "s").href, signal, { Referer: `${EH}/` });
  const img = parseEhImage(html);
  if (!img || !/^https:\/\//.test(img)) throw new Error("No image on that page.");
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const res = await fetch(img, { headers: { "User-Agent": UA, Referer: `${EH}/` }, signal: sig });
  if (!res.ok) throw new Error(`Image host returned ${res.status}`);
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) throw new Error("Not an image.");
  return new Response(res.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
}

// ---------- IMHentai / HentaiEra / HentaiFox (one gallery engine) ----------

type Tagged = ComicSeries & { tags: string[] };

function gallerySite(source: ComicSourceId) {
  const g = GALLERY_SITES[source];
  if (!g) throw new Error("Not a gallery site.");
  return g;
}

/** Only /gallery/<id>/ pages on the site itself. */
function galleryUrl(source: ComicSourceId, raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.hostname !== gallerySite(source).host || !/^\/gallery\/\d+\/?$/.test(u.pathname)) throw new Error("Not a gallery link.");
  return u;
}

/** Gallery cards on a search page. */
export function parseGallerySearch(html: string, source: ComicSourceId): ComicSeries[] {
  const host = gallerySite(source).host;
  const out: ComicSeries[] = [];
  const seen = new Set<string>();
  for (const card of html.split(/<div class="thumb"/).slice(1)) {
    const id = /href="\/gallery\/(\d+)\/"/.exec(card)?.[1];
    if (!id || seen.has(id)) continue;
    const title = decode(/<(?:div class="caption"|h2 class="g?_?(?:gallery_)?title")[^>]*>\s*(?:<h2[^>]*>)?\s*<a href="\/gallery\/\d+\/">([\s\S]*?)<\/a>/.exec(card)?.[1] || /alt="([^"]+)"/.exec(card)?.[1] || "");
    if (!title) continue;
    seen.add(id);
    const category = decode(/href="\/category\/[^"]+\/"[^>]*>(?:<h3[^>]*>)?([^<]+)</.exec(card)?.[1] || "");
    const url = `https://${host}/gallery/${id}/`;
    out.push({ id: url, source, title, cover: /data-src="(https:\/\/[^"]+)"/.exec(card)?.[1], url, stat: category || undefined, mature: true });
  }
  return out;
}

const EXT: Record<string, string> = { j: "jpg", p: "png", w: "webp", g: "gif", b: "bmp" };

/** Tags and every page image on a gallery page. */
export function parseGalleryPage(html: string): { tags: string[]; pages: ComicPage[] } {
  const tags = [...html.matchAll(/href=['"]\/(tag|parody|character|artist|group)\/([^'"/]+)\/['"]/g)].map((m) => `${m[1]}:${m[2].replace(/-/g, " ")}`);
  const first = /data-src="(https:\/\/[^"]+\/)1t\.[a-z]+"/.exec(html)?.[1];
  const thumbs = /g_th = \$\.parseJSON\('([^']+)'\)/.exec(html)?.[1];
  const pages: ComicPage[] = [];
  if (first && thumbs) {
    let map: Record<string, string> = {};
    try { map = JSON.parse(thumbs) as Record<string, string>; } catch { /* no pages */ }
    for (const n of Object.keys(map).map(Number).filter(Boolean).sort((a, b) => a - b)) {
      const [e, w, h] = map[String(n)].split(",");
      pages.push({ src: `${first}${n}.${EXT[e] || "jpg"}`, width: Number(w) || undefined, height: Number(h) || undefined });
    }
  }
  return { tags: [...new Set(tags)], pages };
}

async function galleryDetails(source: ComicSourceId, url: string, signal?: AbortSignal) {
  return parseGalleryPage(await getText(galleryUrl(source, url).href, signal));
}

async function gallerySearch(source: ComicSourceId, queries: string[], signal?: AbortSignal): Promise<ComicSeries[]> {
  const seen = new Map<string, ComicSeries>();
  for (const q of queries) {
    if (seen.size >= TOP) break;
    const html = await getText(gallerySite(source).search(q), signal).catch(() => "");
    for (const s of parseGallerySearch(html, source)) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  // Cards carry no tag names: read each gallery's tags (and page count) so minors never reach the grid.
  const list = [...seen.values()].slice(0, TOP + 5);
  const tagged = await Promise.all(
    list.map(async (s): Promise<Tagged | null> => {
      const d = await galleryDetails(source, s.url, signal).catch(() => null);
      if (!d) return null;
      const stat = [s.stat, d.pages.length && `${d.pages.length} pages`].filter(Boolean).join(" · ") || undefined;
      return { ...s, stat, tags: d.tags, description: d.tags.slice(0, 12).join(", ") || undefined };
    })
  );
  return tagged.filter((s): s is Tagged => !!s && !minorWork(s)).map((s) => {
    const { tags, ...series } = s;
    void tags; // used for filtering and relevance only
    return { ...series, description: series.description };
  });
}

function galleryChapters(source: ComicSourceId, url: string): ComicChapter[] {
  const u = galleryUrl(source, url);
  return [{ id: u.href, title: "Full gallery", index: 1, url: u.href }];
}

async function galleryPages(source: ComicSourceId, url: string, signal?: AbortSignal): Promise<ComicPage[]> {
  const d = await galleryDetails(source, url, signal);
  if (d.tags.some((t) => MINOR_TAGS.test(t))) throw new Error("That gallery is tagged with minors, so I won't open it.");
  return d.pages;
}

// ---------- Relevance ----------

const norm = (s: string) => ` ${s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
const KIND_WORDS = /\b(?:comics?|manga|manhwa|doujin(?:shi)?|webtoons?|hentai)\b/gi;

/** Adult archives match loosely ("fnf" finds "n.f.n.f."): keep works whose title or tags name the subject. */
export function aboutSubject(s: { title: string; description?: string }, queries: string[]): boolean {
  const text = norm(`${s.title} ${s.description || ""}`);
  return queries.some((q) => {
    const n = norm(q.replace(KIND_WORDS, " "));
    return n.trim().length >= 2 && text.includes(n);
  });
}

// ---------- Public ----------

export const isAdultSite = (source: ComicSourceId) => source === "ehentai" || !!GALLERY_SITES[source];

/**
 * Top 20 for a subject on one site. `adult` (explicit request, SafeSearch off) widens what
 * MangaDex returns; works with characters presented as children are always dropped.
 */
export async function searchComics(
  source: ComicSourceId,
  queries: string[],
  safe: SafeSearch,
  signal?: AbortSignal,
  adult = false,
  opts: { relevance?: boolean } = {}
): Promise<ComicSeries[]> {
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  const adultSite = isAdultSite(source);
  if (adultSite && safe === "strict") return [];
  let found: ComicSeries[];
  if (source === "mangadex") found = await mangadexSearch(qs, safe, adult, signal);
  else if (source === "tapas") found = await tapasSearch(qs, signal);
  else if (source === "ehentai") found = await ehSearch(qs, signal);
  else if (GALLERY_SITES[source]) found = await gallerySearch(source, qs, signal);
  else found = await webtoonSearch(source, qs, signal);
  if (!adultSite && safe !== "off") found = found.filter((s) => !s.mature);
  if (adult || adultSite) found = found.filter((s) => !minorWork(s));
  if (adultSite && opts.relevance !== false) found = found.filter((s) => aboutSubject(s, qs));
  return found.slice(0, TOP);
}

export async function comicChapters(source: ComicSourceId, seriesId: string, safe: SafeSearch, signal?: AbortSignal): Promise<ComicChapter[]> {
  if (source === "mangadex") return mangadexChapters(seriesId, safe, signal);
  if (source === "tapas") return tapasChapters(seriesId, signal);
  if (source === "ehentai") return ehChapters(seriesId);
  if (GALLERY_SITES[source]) return galleryChapters(source, seriesId);
  return webtoonChapters(seriesId, signal);
}

export async function comicPages(source: ComicSourceId, chapterId: string, signal?: AbortSignal): Promise<ComicPage[]> {
  if (source === "mangadex") return mangadexPages(chapterId, signal);
  if (source === "tapas") return tapasPages(chapterId, signal);
  if (source === "ehentai") return ehPages(chapterId, signal);
  if (GALLERY_SITES[source]) return galleryPages(source, chapterId, signal);
  return webtoonPages(chapterId, signal);
}

export function isComicSource(v: unknown): v is ComicSourceId {
  return COMIC_SOURCE_IDS.includes(v as ComicSourceId);
}
