// "send me a embed of imhentai.com" / "embed the new sml video": find the real page first
// (follow redirects, skip parked domains, open the newest video), then put it in the chat as
// a live embed with working images, players and fullscreen.
//
//   direct  the site allows framing                        -> the real site in an iframe
//   proxy   it refuses framing but answers the server       -> /api/proxy re-serves it
//   live    it shows the server a bot check                 -> the chat's real Chromium opens it
import type { MessageMeta } from "./chats";
import type { SafeSearch } from "@/lib/content-policy";
import type { ChatVideo } from "@/lib/chat-video";
import type { SiteEmbedCard, EmbedMode } from "@/lib/embed/types";
import { detectEmbedRequest, type EmbedFollowContext, type EmbedRequest } from "@/lib/embed/intent";
import { kindOf, youtubeEmbed } from "@/lib/agent/page-videos";
import { categorize, hostCategory, queryTerms, relevance } from "@/lib/search/classify";
import { ADULT_SEARCH } from "@/lib/search/intent";
import type { SearchCategory } from "@/lib/search/types";
import { GALLERY_SITES } from "@/lib/comics/types";
import { assertPublicHttpUrl } from "./net-guard";
import { fetchUpstream } from "./upstream-fetch";
import { detectFakeVerification } from "@/lib/security/fake-verification";
import { searchYouTube, canonicalWatchUrl } from "./youtube";

type Step = (s: { id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string }) => void;

export interface EmbedTurn {
  content: string;
  meta: Pick<MessageMeta, "embed" | "videos">;
}

export interface EmbedContext {
  safe: SafeSearch;
  step: Step;
  signal?: AbortSignal;
  chatId?: string;
  ownerId?: string;
  /** What the chat did recently: earlier results to pick from, hosts already shown. */
  follow?: EmbedFollowContext;
  /** Tests: replace the network pieces. */
  deps?: Partial<EmbedDeps>;
}

export interface Probe {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  headers: Headers;
  challenged: boolean;
  error?: string;
}

export interface EmbedDeps {
  probe: (url: string, signal?: AbortSignal) => Promise<Probe>;
  /** The real site for a name ("imhentai" -> https://imhentai.xxx/). */
  findSite: (name: string, safe: SafeSearch, signal?: AbortSignal) => Promise<string | null>;
  /** Newest (or best matching) YouTube video for a creator / topic. */
  youtube: (name: string, latest: boolean, signal?: AbortSignal) => Promise<{ video: ChatVideo; channel?: string; published?: string } | null>;
  /** Open the URL in the chat's real browser; returns the videos found there when asked. */
  openLive: (chatId: string, ownerId: string, url: string, findVideos: boolean) => Promise<{ url: string; title?: string; videos: ChatVideo[] }>;
  /** Web results for a query (finding sites of a kind). */
  search: (query: string, safe: SafeSearch, signal?: AbortSignal) => Promise<SiteHit[]>;
  /** The fixed legal limits on adult requests (no minors, no real people). */
  allowed: (query: string, signal?: AbortSignal) => Promise<{ allowed: boolean; reason?: string }>;
  /** 0..1, for random picks (tests pin it). */
  random: () => number;
}

/** A search result considered as a site to embed. */
export interface SiteHit {
  title: string;
  url: string;
  snippet?: string;
  category?: string;
}

// ── Page facts ──────────────────────────────────────────────────────────────

const PARKED = /parklogic\.com|sedoparking|bodis\.com|parkingcrew|above\.com\/marketplace|dan\.com\/|afternic|hugedomains|undeveloped\.com|domain\s+(?:name\s+)?(?:is\s+|may\s+be\s+)?for\s+sale|buy\s+this\s+domain|this\s+domain\s+is\s+parked|parked\s+free/i;

/** A for-sale / parking page instead of the site people mean. */
export function isParked(html: string): boolean {
  return PARKED.test(html.slice(0, 40_000));
}

/** Whether the site lets other pages show it in an iframe. */
export function allowsFraming(headers: Headers): boolean {
  const xfo = (headers.get("x-frame-options") || "").toLowerCase();
  if (/deny|sameorigin|allow-from/.test(xfo)) return false;
  const csp = headers.get("content-security-policy") || "";
  const fa = /frame-ancestors\s+([^;]*)/i.exec(csp)?.[1];
  if (fa !== undefined && !/(?:^|\s)\*(?:\s|$)/.test(fa)) return false;
  return true;
}

export function pageTitle(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{1,200})["']/i.exec(html)?.[1];
  const t = og || /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1];
  return t ? decode(t).replace(/\s+/g, " ").trim() || undefined : undefined;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

/** A JS / meta-refresh hop to another site ("Redirecting..." pages). */
export function scriptRedirect(html: string, base: string): string | null {
  if (html.length > 60_000) return null;
  const meta = /<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']\s*\d+\s*;\s*url=([^"'>]+)/i.exec(html)?.[1];
  const js = /(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']/i.exec(html);
  const raw = meta || js?.[1] || js?.[2];
  if (!raw) return null;
  try {
    const u = new URL(decode(raw.trim()), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const VIDEO_LINK = /\/(?:videos?|watch|v|view(?:_video)?|play(?:er)?|embed|clip|movies?|episode)\/[^?#\s"']+|[?&](?:v|viewkey|video_?id|vid)=[\w-]{3,}/i;
const NOT_VIDEO = /\/(?:categor(?:y|ies)|tags?|channels?|models?|pornstars?|search|login|signup|register|upload|terms|privacy|dmca|faq|contact|about)(?:\/|$|\?)/i;
const LATEST_LIST = /\/(?:latest|newest|new|recent|most-?recent)(?:[-_/]|\/?$)|[?&](?:sort|o|order|s)=(?:new|newest|latest|recent|mr|date)/i;

function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb || ha.endsWith("." + hb) || hb.endsWith("." + ha);
  } catch {
    return false;
  }
}

/** Links on the page, absolute, in page order, deduped. */
export function pageLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/gi)) {
    try {
      const u = new URL(decode(m[2]), base);
      u.hash = "";
      if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) continue;
      seen.add(u.href);
      out.push(u.href);
    } catch {
      /* bad href */
    }
  }
  return out;
}

/** The page that lists newest uploads first, if the site links one. */
export function latestListLink(html: string, base: string): string | null {
  return pageLinks(html, base).find((u) => sameSite(u, base) && LATEST_LIST.test(u) && !NOT_VIDEO.test(new URL(u).pathname)) || null;
}

/** Links that look like single-video pages, in page order (homepages list newest first). */
export function videoPageLinks(html: string, base: string): string[] {
  return pageLinks(html, base).filter((u) => {
    if (!sameSite(u, base)) return false;
    const { pathname, search } = new URL(u);
    const path = pathname + search;
    // "/videos/" alone is the list, not one video.
    return VIDEO_LINK.test(path) && !NOT_VIDEO.test(path) && !(!search && /\/(?:videos?|watch)\/?$/i.test(pathname));
  });
}

/** Every playable video a page declares or references, best first. */
export function extractVideos(html: string, pageUrl: string): ChatVideo[] {
  const found: { src: string; score: number; poster?: string }[] = [];
  const add = (raw: string | undefined, score: number) => {
    if (!raw) return;
    try {
      const src = new URL(decode(raw.replace(/\\\//g, "/")).trim(), pageUrl).href;
      if (/^https?:/.test(src)) found.push({ src, score });
    } catch {
      /* not a URL */
    }
  };
  const poster = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] || /<video[^>]*\sposter=["']([^"']+)["']/i.exec(html)?.[1];
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["'][^>]*content=["']([^"']+)["']/gi)) add(m[1], 90);
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*?\ssrc=["']([^"']+)["']/gi)) add(m[1], 100);
  for (const m of html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/gi)) add(m[1], 85);
  for (const m of html.matchAll(/"embedUrl"\s*:\s*"([^"]+)"/gi)) add(m[1], 60);
  for (const m of html.matchAll(/https?:(?:\\?\/){2}[^\s"'<>]+?\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>]*)?/gi)) add(m[0], /\.m3u8/i.test(m[0]) ? 70 : 65);
  for (const m of html.matchAll(/<iframe\b[^>]*?\ssrc=["']([^"']+)["']/gi)) if (/\/embed|player|\/e\//i.test(m[1])) add(m[1], 50);

  const seen = new Set<string>();
  const posterUrl = poster ? (() => { try { return new URL(decode(poster), pageUrl).href; } catch { return undefined; } })() : undefined;
  const title = pageTitle(html);
  return found
    .sort((a, b) => b.score - a.score)
    .flatMap((c): ChatVideo[] => {
      if (seen.has(c.src) || /\.(?:ts|m4s)(?:[?#]|$)|preview|thumb|trailer/i.test(c.src)) return [];
      seen.add(c.src);
      const yt = youtubeEmbed(c.src);
      if (yt) return [{ src: yt, kind: "embed" as const, pageUrl, title }];
      const kind = kindOf(c.src);
      return kind ? [{ src: c.src, kind, pageUrl, poster: posterUrl, title }] : [];
    })
    .slice(0, 3);
}

// ── Network pieces ──────────────────────────────────────────────────────────

async function probe(url: string, signal?: AbortSignal): Promise<Probe> {
  try {
    await assertPublicHttpUrl(url);
    const r = await fetchUpstream(url, { signal, timeoutMs: 12_000, headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    const type = r.res.headers.get("content-type") || "";
    const html = /html|text|xml/i.test(type) || !type ? (await r.res.text()).slice(0, 1_500_000) : "";
    return { ok: r.res.status < 400 && !r.challenged, status: r.res.status, finalUrl: r.finalUrl, html, headers: r.res.headers, challenged: r.challenged };
  } catch (e) {
    return { ok: false, status: 0, finalUrl: url, html: "", headers: new Headers(), challenged: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sites people name without their real TLD. */
const KNOWN_SITES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(GALLERY_SITES).map(([id, s]) => [id, `https://${s!.host}/`])),
  ehentai: "https://e-hentai.org/",
  nhentai: "https://nhentai.net/",
  youtube: "https://www.youtube.com/",
};

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/^https?:\/\//, "").replace(/\.[a-z]{2,24}(?:\/.*)?$/, "").replace(/[^a-z0-9]/g, "");
}

async function findSite(name: string, safe: SafeSearch, signal?: AbortSignal): Promise<string | null> {
  const slug = slugOf(name);
  if (!slug) return null;
  if (KNOWN_SITES[slug]) return KNOWN_SITES[slug];
  const { searchWeb, ddgProvider, bingProvider } = await import("./web-search");
  const run = await searchWeb(name, { safe, count: 6, signal, providers: [bingProvider, ddgProvider], checkLinks: false }).catch(() => null);
  const hit = run?.results.find((r) => {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      return host.replace(/[^a-z0-9]/g, "").startsWith(slug) || host.split(".")[0].replace(/-/g, "") === slug;
    } catch {
      return false;
    }
  });
  return hit ? new URL(hit.url).origin + "/" : null;
}

async function channelIdFor(channelUrl: string, signal?: AbortSignal): Promise<string | null> {
  const r = await fetch(channelUrl, { signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" } });
  const html = await r.text();
  return /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] || /channel_id=(UC[\w-]{22})/.exec(html)?.[1] || /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1] || null;
}

/** The channel's own upload feed: newest first, no guessing from search ranking. */
export function parseChannelFeed(xml: string): { id: string; title: string; published?: string; channel?: string } | null {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const id = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry)?.[1];
  const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1];
  if (!id || !title) return null;
  return { id, title: decode(title), published: /<published>([^<]+)<\/published>/.exec(entry)?.[1], channel: /<author>\s*<name>([^<]+)<\/name>/.exec(xml)?.[1] };
}

async function youtube(name: string, latest: boolean, signal?: AbortSignal): Promise<{ video: ChatVideo; channel?: string; published?: string } | null> {
  const asUrl = /^https?:\/\//i.test(name) ? name : null;
  const direct = asUrl ? youtubeEmbed(asUrl) : null;
  if (direct) return { video: { src: direct, kind: "embed", pageUrl: asUrl!, title: undefined } };

  let channelUrl = asUrl && /youtube\.com\/(?:@|channel\/|c\/|user\/)/i.test(asUrl) ? asUrl.replace(/\/(?:videos|featured|shorts|streams)\/?$/, "") : null;
  let fallback: { video: ChatVideo; channel?: string; published?: string } | null = null;
  if (!channelUrl) {
    const found = await searchYouTube({ query: name, limit: 6 }, { signal, verify: async (id) => ({ id, status: "unchecked", reason: "" }) });
    const top = found.results[0];
    if (!top) return null;
    fallback = { video: { src: youtubeEmbed(top.url)!, kind: "embed", pageUrl: top.url, title: top.title }, channel: top.channel, published: top.publishedAt };
    if (!latest) return fallback;
    // The channel most of the top results come from is the creator they mean.
    const counts = new Map<string, number>();
    for (const r of found.results) if (r.channelUrl) counts.set(r.channelUrl, (counts.get(r.channelUrl) || 0) + 1);
    channelUrl = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || top.channelUrl || null;
  }
  if (!channelUrl) return fallback;
  const channelId = /\/channel\/(UC[\w-]{22})/.exec(channelUrl)?.[1] || (await channelIdFor(channelUrl, signal).catch(() => null));
  if (!channelId) return fallback;
  const feed = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal }).then((r) => (r.ok ? r.text() : ""), () => "");
  const newest = parseChannelFeed(feed);
  if (!newest) return fallback;
  const watch = canonicalWatchUrl(newest.id);
  return { video: { src: youtubeEmbed(watch)!, kind: "embed", pageUrl: watch, title: newest.title }, channel: newest.channel, published: newest.published };
}

async function openLive(chatId: string, ownerId: string, url: string, findVideos: boolean) {
  const { sessions } = await import("@/lib/agent/sessions");
  const s = await sessions.open(chatId, ownerId);
  const page = s.active();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  let videos: ChatVideo[] = [];
  if (findVideos) {
    const links = videoPageLinks(await page.content(), page.url());
    if (links[0]) await page.goto(links[0], { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    const { findPageVideos } = await import("@/lib/agent/page-videos");
    videos = await findPageVideos(page).catch(() => []);
  }
  return { url: page.url(), title: await page.title().catch(() => undefined), videos: videos.slice(0, 2) };
}

async function search(query: string, safe: SafeSearch, signal?: AbortSignal): Promise<SiteHit[]> {
  const { searchWeb, bingProvider, ddgProvider, googleApiProvider, proxyProvider } = await import("./web-search");
  const providers = [googleApiProvider, bingProvider, ddgProvider, ...(process.env.SEARCH_API_URL ? [proxyProvider] : [])];
  const run = await searchWeb(query, { safe, count: 12, signal, providers, checkLinks: false });
  return run.results;
}

async function allowed(query: string, signal?: AbortSignal) {
  const { searchAllowed } = await import("./search-reply");
  return searchAllowed(query, signal);
}

const DEFAULT_DEPS: EmbedDeps = { probe, findSite, youtube, openLive, search, allowed, random: Math.random };

// ── The turn ────────────────────────────────────────────────────────────────

const CHALLENGE_TITLE = /^(?:just a moment|attention required|checking your browser|please wait)/i;

/** Drop Cloudflare's one-time challenge parameters from a URL. */
export function cleanChallengeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("__cf_chl")) u.searchParams.delete(k);
    return u.href;
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isYouTube(url?: string): boolean {
  return !!url && /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(hostOf(url));
}

function ago(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return ` (${iso})`;
  const h = Math.round((Date.now() - t) / 3_600_000);
  return h < 1 ? " (posted under an hour ago)" : h < 48 ? ` (posted ${h}h ago)` : ` (posted ${Math.round(h / 24)} days ago)`;
}

async function youtubeTurn(req: EmbedRequest, d: EmbedDeps, ctx: EmbedContext): Promise<EmbedTurn> {
  const target = req.url || req.name || req.asked;
  const latest = req.video === "latest";
  ctx.step({ id: 1, label: latest ? `Finding the newest ${req.name || hostOf(target)} upload` : `Finding ${req.asked} on YouTube`, status: "running" });
  const hit = await d.youtube(target, latest, ctx.signal).catch(() => null);
  if (!hit) {
    ctx.step({ id: 1, label: `Couldn't find ${req.asked} on YouTube`, status: "error" });
    return { content: `I couldn't find ${req.asked} on YouTube. Try the channel name or a link?`, meta: {} };
  }
  ctx.step({ id: 1, label: `Found "${hit.video.title || "the video"}"`, status: "done", detail: hit.channel, url: hit.video.pageUrl });
  const who = hit.channel ? ` from **${hit.channel}**` : "";
  const content = latest
    ? `Here's the newest upload${who}: **${hit.video.title || "video"}**${ago(hit.published)}. Fullscreen works from the player.`
    : `Here's **${hit.video.title || "the video"}**${who}. Fullscreen works from the player.`;
  return { content, meta: { videos: [hit.video] } };
}

// ── Picking a site of a kind ────────────────────────────────────────────────

/** Results that are about sites, not sites of the kind (an encyclopedia article on "hentai", a news story, a thread). */
const NOT_A_SITE: ReadonlySet<SearchCategory> = new Set<SearchCategory>(["wiki", "news", "forum", "social", "shopping", "docs", "code"]);
/** "Top 10 best anime sites", "sites like X", "X alternatives": pages that list sites rather than being one. */
const LISTICLE = /\b(?:\d+\s+)?(?:best|top|greatest|safest|legal|free)\b[^|]{0,48}\b(?:sites|websites|apps|alternatives|places|platforms)\b|\balternatives?\s+(?:to|for)\b|\b(?:sites|websites)\s+like\b|\breview(?:s|ed)?\b|\bvs\.?\s/i;

/** The query that finds sites of a kind: what they'd type to find one, not what they said to us. */
export function siteQuery(topic: string, purpose?: string): string {
  return purpose ? `${purpose} ${topic} online` : `${topic} website`;
}

/**
 * Sites (one per host) worth embedding for "<topic>", best first. Uses only what the results say
 * about themselves: their category, title, snippet and host.
 */
export function rankSites(hits: SiteHit[], topic: string, opts: { exclude?: string[]; homepage?: boolean } = {}): SiteHit[] {
  const terms = queryTerms(topic);
  const exclude = new Set((opts.exclude ?? []).map((h) => h.replace(/^www\./, "").toLowerCase()));
  const seen = new Set<string>();
  const scored: { hit: SiteHit; score: number }[] = [];
  hits.forEach((h, rank) => {
    let u: URL;
    try {
      u = new URL(h.url);
    } catch {
      return;
    }
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (seen.has(host) || exclude.has(host) || !/^https?:$/.test(u.protocol)) return;
    const category = (h.category as SearchCategory | undefined) ?? categorize(h.url, h.title, h.snippet || "");
    const byHost = hostCategory(h.url);
    if (NOT_A_SITE.has(category) || (byHost && NOT_A_SITE.has(byHost)) || LISTICLE.test(h.title)) return;
    const match = terms.length ? relevance(terms, { title: h.title, url: h.url, snippet: h.snippet || "" }, category) : 1;
    if (terms.length && match < (terms.length <= 2 ? 0.75 : 0.5)) return;
    seen.add(host);
    const slugHit = terms.some((t) => host.replace(/[^a-z0-9]/g, "").includes(t.replace(/[^a-z0-9]/g, ""))) ? 0.3 : 0;
    // Picking from results the user saw: a site's own front page beats a deep page on it.
    const shallow = !opts.homepage && u.pathname.split("/").filter(Boolean).length <= 1 ? 0.15 : 0;
    scored.push({ hit: opts.homepage ? { ...h, url: `${u.origin}/` } : h, score: match + slugHit + shallow - rank * 0.04 });
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.hit);
}

/** The order to try sites in: the chosen one first (random among the best few when they left it to us). */
export function pickOrder(sites: SiteHit[], pick: "random" | "best" | undefined, random: () => number): SiteHit[] {
  if (pick !== "random" || sites.length < 2) return sites;
  const pool = Math.min(sites.length, 5);
  const i = Math.min(pool - 1, Math.floor(random() * pool));
  return [sites[i], ...sites.filter((_, j) => j !== i)];
}

// ── Opening one site ────────────────────────────────────────────────────────

type Opened =
  | { ok: true; p: Probe; url: string; path: string[]; why?: string }
  | { ok: false; reason: string; content: string };

/**
 * Loads `url` the way the embed will see it: follows "Redirecting..." hops, and when the user
 * typed the address (`typed`), recovers from parked or dead domains. Refuses fake human checks
 * and adult sites under SafeSearch.
 */
async function openSite(url: string, typed: string | undefined, d: EmbedDeps, ctx: EmbedContext): Promise<Opened> {
  const { signal } = ctx;
  const path: string[] = [];
  let why: string | undefined;
  let p = await d.probe(url, signal);
  // "Redirecting..." pages that hop with JS (a server fetch doesn't run it).
  for (let hop = 0; hop < 2 && p.ok; hop++) {
    const next = scriptRedirect(p.html, p.finalUrl);
    if (!next || next === p.finalUrl || isParked(p.html)) break;
    path.push(p.finalUrl);
    p = await d.probe(next, signal);
  }
  if (p.ok && isParked(p.html)) {
    if (!typed) return { ok: false, reason: "parked domain", content: `${hostOf(url)} is a parked domain.` };
    // imhentai.com is a parked domain; the site people mean is imhentai.xxx.
    const real = await d.findSite(slugOf(hostOf(typed)), ctx.safe, signal).catch(() => null);
    if (real && hostOf(real) !== hostOf(p.finalUrl)) {
      why = `${hostOf(typed)} is a parked domain, so I opened the real site, ${hostOf(real)}`;
      path.push(p.finalUrl);
      p = await d.probe(real, signal);
      url = real;
    }
  }
  if (!p.ok && !p.challenged && p.status === 0 && typed && !/^https?:\/\/www\./i.test(url)) {
    const www = url.replace(/^https?:\/\//i, "https://www.");
    const again = await d.probe(www, signal);
    if (again.ok || again.challenged) p = again;
  }
  if (!p.ok && !p.challenged && typed) {
    // The address they typed is dead: find the site by its name instead.
    const real = await d.findSite(slugOf(hostOf(typed)), ctx.safe, signal).catch(() => null);
    if (real && hostOf(real) !== hostOf(url)) {
      const again = await d.probe(real, signal);
      if (again.ok || again.challenged) {
        why = `${hostOf(typed)} didn't load, so I opened ${hostOf(real)}`;
        p = again;
        url = real;
      }
    }
  }
  if (!p.ok && !p.challenged) {
    const reason = p.error || `HTTP ${p.status}`;
    return { ok: false, reason, content: `I couldn't open ${hostOf(url)} (${p.error ? p.error.replace(/[.\s]+$/, "") : `it answered HTTP ${p.status}`}). Is the address right?` };
  }
  const host = hostOf(p.finalUrl);
  // A fake "verify you're human" page (Win+R, paste, Enter) is malware bait: never embed it.
  const fake = detectFakeVerification({ html: p.html });
  if (fake) {
    return { ok: false, reason: `fake human check (${fake.signals.join(", ")})`, content: `I didn't embed ${host}. ${fake.reason} Don't follow any steps it shows, and don't paste or run anything from it.` };
  }
  // SafeSearch: adult sites only when it's off.
  if (ctx.safe !== "off" && categorize(p.finalUrl, pageTitle(p.html) || "", "") === "adult") {
    return { ok: false, reason: "adult site (SafeSearch)", content: `SafeSearch is set to ${ctx.safe}, so I can't embed ${host} (it's an adult site). You can turn it off in Settings.` };
  }
  return { ok: true, p, url, path, why };
}

/** "Find me a random hentai site" / "a manga site so I can read": choose one, then open it. */
async function topicTurn(req: EmbedRequest, d: EmbedDeps, ctx: EmbedContext): Promise<EmbedTurn> {
  const { step, signal } = ctx;
  const topic = (req.topic || "").trim();
  const label = topic ? `${topic} site` : "site";
  const aLabel = `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

  if (topic && ADULT_SEARCH.test(topic)) {
    if (ctx.safe !== "off") {
      return { content: `SafeSearch is set to ${ctx.safe}, so I can't embed ${topic} sites (they're adult sites). You can turn it off in Settings.`, meta: {} };
    }
    const check = await d.allowed(topic, signal).catch(() => ({ allowed: true }));
    if (!check.allowed) return { content: (check as { reason?: string }).reason || "I can't embed that.", meta: {} };
  }

  // Results already on screen come first: no second search for what the chat just found.
  const earlier = ctx.follow?.results ?? [];
  let sites = rankSites(earlier, topic, { exclude: req.exclude });
  let source: "earlier" | "search" = "earlier";
  if (sites.length) {
    step({ id: 1, label: topic ? `Picking ${aLabel} from the results above` : "Picking one of the results above", status: "running" });
  } else {
    if (!topic) {
      step({ id: 1, label: "No earlier results to pick from", status: "error" });
      return { content: "There aren't any results above for me to pick from. What kind of site should I find?", meta: {} };
    }
    source = "search";
    const query = siteQuery(topic, req.purpose);
    step({ id: 1, label: `Searching for ${aLabel}`, status: "running", detail: `"${query}"` });
    const found = await d.search(query, ctx.safe, signal).catch(() => [] as SiteHit[]);
    sites = rankSites(found, topic, { exclude: req.exclude, homepage: true });
    // Every match was already shown: showing one again beats showing none.
    if (!sites.length && req.exclude?.length) sites = rankSites(found, topic, { homepage: true });
    if (!sites.length) {
      step({ id: 1, label: found.length ? `None of the results is ${aLabel}` : "The search engines didn't answer", status: "error", detail: `"${query}"` });
      return {
        content: found.length
          ? `I searched "${query}" but none of the results was an actual ${label} I could open (just articles and lists about them). Got one in mind? Send me the address.`
          : `I couldn't reach the search engines to find ${aLabel} just now. Try again, or send me the address of one.`,
        meta: {},
      };
    }
  }

  const order = pickOrder(sites, req.pick, d.random).slice(0, 4);
  const skipped: string[] = [];
  // A site behind a bot check can only be shown in the live browser, not embedded. Since we're
  // choosing, keep it as a fallback and prefer one that really embeds.
  let botChecked: { opened: Extract<Opened, { ok: true }>; skippedBefore: string[] } | null = null;
  const done = (opened: Extract<Opened, { ok: true }>, before: string[]) => {
    step({ id: 1, label: `Opened ${hostOf(opened.p.finalUrl)}`, status: "done", detail: source === "earlier" ? "From the results above" : opened.p.challenged ? "Bot check in the way" : pageTitle(opened.p.html), url: opened.p.finalUrl });
    const why = before.length ? `${before.map((s) => s.split(":")[0]).join(" and ")} couldn't be embedded, so I went with ${hostOf(opened.p.finalUrl)}` : undefined;
    return finishEmbed(req, { ...opened, why }, d, ctx, { skipped: before, picked: source });
  };
  for (const site of order) {
    if (signal?.aborted) break;
    const host = hostOf(site.url);
    step({ id: 1, label: `Opening ${host}`, status: "running", url: site.url });
    const opened = await openSite(site.url, undefined, d, ctx);
    if (!opened.ok) {
      skipped.push(`${host}: ${opened.reason}`);
      continue;
    }
    // The page itself may say it's a directory of sites ("Best Porn Sites List") even when its
    // search result didn't: they asked for a site of the kind, not a list of them.
    const shownTitle = pageTitle(opened.p.html) || "";
    if (!opened.p.challenged && LISTICLE.test(shownTitle) && order.length > 1) {
      skipped.push(`${host}: a list of sites, not one`);
      continue;
    }
    if (opened.p.challenged) {
      botChecked ??= { opened, skippedBefore: [...skipped] };
      skipped.push(`${host}: bot check (live browser only)`);
      continue;
    }
    return done(opened, skipped);
  }
  if (botChecked && !signal?.aborted) return done(botChecked.opened, botChecked.skippedBefore);
  step({ id: 1, label: `None of the ${order.length} ${label}s would load`, status: "error", detail: skipped.join("; ") });
  return {
    content: `I tried ${order.length} ${label}${order.length === 1 ? "" : "s"} but none would load here (${skipped.join("; ")}). Want me to try a different kind of site, or do you have one in mind?`,
    meta: {},
  };
}

/** Pre-navigate to a video if asked, pick how to show the page, and write the reply. */
async function finishEmbed(
  req: EmbedRequest,
  opened: Extract<Opened, { ok: true }>,
  d: EmbedDeps,
  ctx: EmbedContext,
  extra: { skipped?: string[]; picked?: "earlier" | "search" } = {},
): Promise<EmbedTurn> {
  const { step, signal } = ctx;
  const { p, why } = opened;
  const path = [...opened.path];
  const host = hostOf(p.finalUrl);

  let page = p;
  let videos: ChatVideo[] = [];
  if (req.video && p.ok) {
    step({ id: 2, label: req.video === "latest" ? `Finding the newest video on ${host}` : `Finding a video on ${host}`, status: "running" });
    let list = p;
    const latestUrl = req.video === "latest" ? latestListLink(p.html, p.finalUrl) : null;
    if (latestUrl) {
      const l = await d.probe(latestUrl, signal);
      if (l.ok) {
        path.push(p.finalUrl);
        list = l;
      }
    }
    const link = videoPageLinks(list.html, list.finalUrl)[0];
    if (link) {
      const v = await d.probe(link, signal);
      if (v.ok || v.challenged) {
        path.push(list.finalUrl);
        page = v;
        videos = extractVideos(v.html, v.finalUrl);
      }
    }
    step({ id: 2, label: link ? `Opened "${pageTitle(page.html) || hostOf(link)}"` : `No video links on ${host}'s front page`, status: link ? "done" : "error", url: link });
  }

  // How to show it.
  const mode: EmbedMode = page.challenged ? "live" : allowsFraming(page.headers) ? "direct" : "proxy";
  let embedUrl = cleanChallengeUrl(page.finalUrl);
  let embedTitle = page.challenged ? undefined : pageTitle(page.html);
  let note = why;
  let liveOpened = false;
  if (mode === "live") {
    note = [note, `${host} shows a bot check to servers, so it's open in your live browser instead`].filter(Boolean).join(". ");
    if (ctx.chatId && ctx.ownerId) {
      step({ id: 3, label: `Opening ${host} in the live browser`, status: "running" });
      const live = await d.openLive(ctx.chatId, ctx.ownerId, embedUrl, !!req.video && !videos.length).catch((e) => {
        step({ id: 3, label: "The live browser isn't available here", status: "error", detail: e instanceof Error ? e.message.split("\n")[0] : String(e) });
        return null;
      });
      if (live) {
        // Not the bot check's temporary address or its "Just a moment..." title.
        const clean = cleanChallengeUrl(live.url);
        step({ id: 3, label: `Opened ${hostOf(clean)} in the live browser`, status: "done", url: clean });
        embedUrl = clean;
        liveOpened = true;
        if (live.title && !CHALLENGE_TITLE.test(live.title)) embedTitle = live.title;
        if (!videos.length) videos = live.videos;
      }
    }
    if (!liveOpened) note = [why, `${host} shows a bot check to servers and the live browser couldn't open it`].filter(Boolean).join(". ");
  }
  const card: SiteEmbedCard = {
    url: embedUrl,
    asked: req.asked,
    host: hostOf(embedUrl),
    title: embedTitle,
    mode,
    note,
    path: path.length ? path : undefined,
    topic: req.topic || undefined,
    purpose: req.purpose,
    skipped: extra.skipped?.length ? extra.skipped : undefined,
    liveUnavailable: mode === "live" && !liveOpened ? true : undefined,
  };
  const what = req.video ? (videos.length ? `the ${req.video === "latest" ? "newest " : ""}video from **${card.host}**` : `**${embedTitle || card.host}**`) : `**${card.host}**`;
  const chose = extra.picked
    ? extra.picked === "earlier" ? "picked from the results above: " : req.pick === "random" ? "picked one at random: " : ""
    : "";
  let content: string;
  if (mode === "live" && !liveOpened) {
    // Nothing is embedded: say so instead of pointing at a frame that can't show it.
    content = `${cap(chose)}${what} only loads in a real browser (it shows servers a bot check), and the live browser couldn't open it here${why ? ` (${why})` : ""}. The ↗ button on the card opens it in a new tab.`;
  } else if (mode === "live") {
    content = `${cap(`${chose}I opened ${what} in your live browser`)}~${why ? ` (${why}.)` : ""} Tap **Show live browser** on the card to watch it there.`;
  } else {
    content = `${cap(`${chose}here's ${what}, embedded`)}~${why ? ` (${why}.)` : ""}${req.purpose ? ` You can ${req.purpose} right in the frame.` : ""} Use the ⛶ button for fullscreen.`;
  }
  return { content, meta: { embed: card, videos: videos.length ? videos : undefined } };
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export async function runEmbedTurn(req: EmbedRequest, ctx: EmbedContext): Promise<EmbedTurn> {
  const d: EmbedDeps = { ...DEFAULT_DEPS, ...ctx.deps };
  const { step, signal } = ctx;

  if (isYouTube(req.url) || (!req.url && (req.youtube || req.video) && req.topic === undefined)) return youtubeTurn(req, d, ctx);
  if (!req.url && req.topic !== undefined) return topicTurn(req, d, ctx);

  // Find the real site.
  let url = req.url;
  step({ id: 1, label: `Opening ${req.url ? hostOf(req.url) : req.asked}`, status: "running" });
  if (!url) {
    url = (await d.findSite(req.name || req.asked, ctx.safe, signal).catch(() => null)) || undefined;
    if (!url) {
      step({ id: 1, label: `Couldn't find a site called ${req.asked}`, status: "error" });
      return { content: `I couldn't find a website called "${req.asked}". Send me the address (like example.com)?`, meta: {} };
    }
  }
  const opened = await openSite(url, req.url, d, ctx);
  if (!opened.ok) {
    step({ id: 1, label: /fake|SafeSearch/.test(opened.reason) ? `Didn't embed ${hostOf(url)}` : `${hostOf(url)} didn't answer`, status: "error", detail: opened.reason });
    return { content: opened.content, meta: {} };
  }
  step({ id: 1, label: `Opened ${hostOf(opened.p.finalUrl)}`, status: "done", detail: opened.p.challenged ? "Bot check in the way" : pageTitle(opened.p.html), url: opened.p.finalUrl });
  return finishEmbed(req, opened, d, ctx);
}

/** The embed flow for one chat message, or null if it isn't an embed request. */
export async function embedTurn(text: string, ctx: EmbedContext): Promise<EmbedTurn | null> {
  const req = detectEmbedRequest(text, ctx.follow);
  if (!req) return null;
  return runEmbedTurn(req, ctx);
}
