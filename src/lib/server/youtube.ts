// YouTube retrieval + verification.
//
// Root cause of fake YouTube links: the model wrote video IDs/URLs from memory, and nothing
// checked them. This module fixes that at two layers:
//   1. Retrieval: real results come from YouTube itself (searchYouTube) and every result is
//      confirmed against YouTube's oEmbed endpoint before it is offered as "verified".
//   2. Reply sanitising: any YouTube link/ID in a finished AI reply is checked; dead ones are
//      removed, mismatching titles are corrected from YouTube's own record, statistics that
//      were not retrieved this turn are stripped, and unverifiable ones are labelled.
// A syntactically valid ID is never treated as proof that a video exists.
import { extractYouTubeVideoId, parseTolerantJSON } from "@/lib/ui-schema";

export type VerifyStatus = "verified" | "not_found" | "restricted" | "unchecked";

export interface VideoCheck {
  id: string;
  status: VerifyStatus;
  title?: string;
  channel?: string;
  reason: string;
}

export type Verifier = (id: string, signal?: AbortSignal) => Promise<VideoCheck>;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const cache = new Map<string, { at: number; check: VideoCheck }>();
const TTL_OK = 10 * 60_000;
const TTL_BAD = 60_000;

export function canonicalWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Ask YouTube's oEmbed endpoint whether a public video exists, and what it is. */
export async function verifyYouTubeVideo(id: string, signal?: AbortSignal): Promise<VideoCheck> {
  if (!ID_RE.test(id)) return { id, status: "not_found", reason: "Not a valid YouTube video ID." };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.check.status === "verified" ? TTL_OK : TTL_BAD)) return hit.check;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let check: VideoCheck;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalWatchUrl(id))}&format=json`, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SenkoAgent/1.0)" },
    });
    if (res.status === 200) {
      const j = (await res.json().catch(() => ({}))) as { title?: string; author_name?: string };
      check = j.title
        ? { id, status: "verified", title: j.title, channel: j.author_name, reason: "Exists and is public. Regional availability can't be checked." }
        : { id, status: "unchecked", reason: "YouTube answered without video details." };
    } else if (res.status === 404 || res.status === 400) {
      check = { id, status: "not_found", reason: "YouTube has no public video with this ID (deleted, never existed, or made unlisted/private)." };
    } else if (res.status === 401 || res.status === 403) {
      check = { id, status: "restricted", reason: "The video is private or its owner disabled embedding, so it could not be verified." };
    } else {
      check = { id, status: "unchecked", reason: `YouTube returned HTTP ${res.status}, so the video could not be checked.` };
    }
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    check = { id, status: "unchecked", reason: "YouTube could not be reached, so the video could not be checked." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (check.status !== "unchecked") cache.set(id, { at: Date.now(), check });
  return check;
}

/** Test hook. */
export function clearVerificationCache() {
  cache.clear();
}

/** Run `fn` over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Matching ────────────────────────────────────────────────────────────────

const STOP = new Set(["the", "a", "an", "of", "and", "official", "video", "music", "feat", "ft", "hd", "4k", "lyrics", "full"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/** 0..1: how much of the shorter text's words appear in the other. */
export function textOverlap(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

export function titleMatches(claimed: string | undefined, actual: string | undefined): boolean {
  if (!claimed || !actual) return true; // nothing to contradict
  return textOverlap(claimed, actual) >= 0.6;
}

export function channelMatches(claimed: string | undefined, actual: string | undefined): boolean {
  if (!claimed || !actual) return true;
  return textOverlap(claimed, actual) >= 0.5;
}

// ── Finding IDs in text ─────────────────────────────────────────────────────

const URL_ID_RE =
  /(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<>)\]]*?&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|i\.ytimg\.com\/vi\/)([A-Za-z0-9_-]{11})/gi;
const JSON_ID_RE = /"(?:videoId|youtubeId)"\s*:\s*"([A-Za-z0-9_-]{11})"/g;

export function extractVideoIds(text: string): string[] {
  const ids = new Set<string>();
  for (const re of [URL_ID_RE, JSON_ID_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) ids.add(m[1]);
  }
  return [...ids];
}

// ── Sanitising a finished reply ─────────────────────────────────────────────

export interface LinkReport {
  found: number;
  verified: number;
  corrected: number;
  removed: number;
  restricted: number;
  unchecked: number;
}

export interface SanitizeOptions {
  verify?: Verifier;
  signal?: AbortSignal;
  /** IDs whose statistics were retrieved from YouTube this turn (stats on other IDs are stripped). */
  groundedIds?: Set<string>;
  maxChecks?: number;
}

const UI_FENCE_RE = /```(ui|senko-ui|json-ui)[ \t]*\r?\n([\s\S]*?)```/gi;
const STAT_FIELDS = ["views", "likes", "publishedAt", "duration"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function videoIdOf(entry: Obj): string | undefined {
  for (const k of ["videoId", "youtubeId", "url", "videoUrl", "link", "href"]) {
    const v = entry[k];
    if (typeof v === "string") {
      const id = extractYouTubeVideoId(v);
      if (id) return id;
    }
  }
  return undefined;
}

export async function sanitizeYouTubeInReply(
  text: string,
  opts: SanitizeOptions = {}
): Promise<{ text: string; report: LinkReport }> {
  const report: LinkReport = { found: 0, verified: 0, corrected: 0, removed: 0, restricted: 0, unchecked: 0 };
  const allIds = extractVideoIds(text);
  if (!allIds.length) return { text, report };
  const verify = opts.verify ?? verifyYouTubeVideo;
  const grounded = opts.groundedIds ?? new Set<string>();
  const max = opts.maxChecks ?? 24;

  const checks = new Map<string, VideoCheck>();
  const toCheck = allIds.slice(0, max);
  const results = await mapLimit(toCheck, 5, (id) => verify(id, opts.signal).catch((e): VideoCheck => {
    if (opts.signal?.aborted) throw e;
    return { id, status: "unchecked", reason: "The check failed." };
  }));
  results.forEach((c) => checks.set(c.id, c));
  for (const id of allIds.slice(max)) checks.set(id, { id, status: "unchecked", reason: "Too many links to check at once." });

  report.found = allIds.length;
  const counted = new Set<string>();
  const count = (id: string, kind: keyof LinkReport) => {
    if (counted.has(id + kind)) return;
    counted.add(id + kind);
    report[kind]++;
  };

  // 1. Structured video entries inside ```ui blocks.
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObj(node)) return node;
    const out: Obj = { ...node };
    for (const [k, v] of Object.entries(out)) out[k] = walk(v);
    if (Array.isArray(out.videos)) {
      const original = out.videos as unknown[];
      const kept: Obj[] = [];
      for (const raw of original) {
        if (!isObj(raw)) continue;
        const entry = { ...raw };
        const id = videoIdOf(entry);
        if (!id) {
          // No resolvable video: keep the card but never present it as verified.
          entry.verification = "unchecked";
          for (const f of STAT_FIELDS) delete entry[f];
          delete entry.thumbnailUrl;
          kept.push(entry);
          continue;
        }
        const c = checks.get(id) ?? { id, status: "unchecked" as const, reason: "Not checked." };
        if (c.status === "not_found") {
          count(id, "removed");
          continue;
        }
        entry.videoId = id;
        entry.url = canonicalWatchUrl(id);
        entry.thumbnailUrl = thumbnailFor(id);
        entry.verificationNote = c.reason;
        if (c.status === "verified") {
          const claimedTitle = typeof entry.title === "string" ? entry.title : undefined;
          const claimedChannel = typeof entry.channel === "string" ? entry.channel : undefined;
          const ok = titleMatches(claimedTitle, c.title) && channelMatches(claimedChannel, c.channel);
          if (!ok) {
            entry.title = c.title;
            if (c.channel) entry.channel = c.channel;
            delete entry.description;
            entry.verification = "corrected";
            count(id, "corrected");
          } else {
            entry.verification = "verified";
            count(id, "verified");
          }
        } else if (c.status === "restricted") {
          entry.verification = "restricted";
          count(id, "restricted");
        } else {
          entry.verification = "unchecked";
          count(id, "unchecked");
        }
        if (!grounded.has(id)) for (const f of STAT_FIELDS) delete entry[f]; // numbers not retrieved this turn
        kept.push(entry);
      }
      out.videos = kept;
      if (kept.length < original.length || kept.some((e) => e.verification !== "verified")) {
        if (out.dataStatus === "live") out.dataStatus = "curated";
      }
    }
    return out;
  };

  let result = text.replace(UI_FENCE_RE, (full, lang: string, body: string) => {
    if (!extractVideoIds(body).length) return full;
    const parsed = parseTolerantJSON(body);
    if (!parsed) return full;
    const fixed = walk(parsed);
    const json = JSON.stringify(fixed);
    return "```" + lang + "\n" + rewriteUrls(json, checks, "json") + "\n```";
  });

  // 2. Everything else (prose, markdown links, bare URLs).
  const fences: string[] = [];
  result = result.replace(UI_FENCE_RE, (m) => {
    fences.push(m);
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });
  result = rewriteUrls(result, checks, "markdown", (id, kind) => count(id, kind));
  result = result.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => fences[Number(i)]);

  // Count IDs that only appeared in prose.
  for (const id of allIds) {
    const c = checks.get(id)!;
    if (![...counted].some((x) => x.startsWith(id))) {
      count(id, c.status === "verified" ? "verified" : c.status === "not_found" ? "removed" : c.status === "restricted" ? "restricted" : "unchecked");
    }
  }

  const notes: string[] = [];
  if (report.verified) notes.push(`${report.verified} verified`);
  if (report.corrected) notes.push(`${report.corrected} corrected to the real title/creator`);
  if (report.removed) notes.push(`${report.removed} removed (video not found)`);
  if (report.restricted) notes.push(`${report.restricted} private/embed-restricted (not verified)`);
  if (report.unchecked) notes.push(`${report.unchecked} could not be checked`);
  if (report.removed || report.corrected || report.restricted || report.unchecked || report.verified) {
    result = `${result.trimEnd()}\n\n> **YouTube link check:** ${notes.join(" · ")}.`;
  }
  return { text: result, report };
}

function rewriteUrls(
  input: string,
  checks: Map<string, VideoCheck>,
  mode: "json" | "markdown",
  onKind?: (id: string, kind: keyof LinkReport) => void
): string {
  const urlPart = String.raw`(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<>)\]\\]*?&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})[^\s"'<>)\]\\]*`;

  if (mode === "markdown") {
    // [label](url) with a dead video: keep the words, drop the link.
    input = input.replace(new RegExp(String.raw`\[([^\]\n]*)\]\((${urlPart})\)`, "gi"), (full, label: string, _url: string, id: string) => {
      const c = checks.get(id);
      if (!c) return full;
      if (c.status === "not_found") {
        onKind?.(id, "removed");
        return `${label || "Video"} _(not found on YouTube; link removed)_`;
      }
      return `[${label}](${canonicalWatchUrl(id)})${c.status === "verified" ? "" : c.status === "restricted" ? " _(private/embed-restricted; not verified)_" : " _(could not be verified)_"}`;
    });
  }
  return input.replace(new RegExp(urlPart, "gi"), (full, id: string) => {
    const c = checks.get(id);
    if (!c) return full;
    if (c.status === "not_found") {
      onKind?.(id, "removed");
      return mode === "json" ? "" : "_(removed: video not found)_";
    }
    // Leave thumbnails alone; canonicalise real watch links.
    if (/ytimg\.com/i.test(full)) return full;
    return canonicalWatchUrl(id);
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

export type YouTubeSort = "relevance" | "views" | "date";
export type YouTubePeriod = "any" | "hour" | "today" | "week" | "month" | "year";

export interface YouTubeSearchOptions {
  query: string;
  sort?: YouTubeSort;
  period?: YouTubePeriod;
  limit?: number;
}

export interface YouTubeResult {
  videoId: string;
  title: string;
  channel: string;
  channelUrl?: string;
  views?: string;
  publishedAt?: string;
  duration?: string;
  description?: string;
  url: string;
  thumbnailUrl: string;
  verification: "verified" | "restricted" | "unchecked";
  verificationNote: string;
  /** Position on the retrieved results page (1-based). */
  rank: number;
}

/** YouTube's `sp` search-filter parameter (protobuf, base64). */
export function searchFilterParam(sort: YouTubeSort = "relevance", period: YouTubePeriod = "any"): string {
  const sortByte = sort === "views" ? 3 : sort === "date" ? 2 : 0;
  const periodByte = { any: 0, hour: 1, today: 2, week: 3, month: 4, year: 5 }[period];
  const filter: number[] = [];
  if (periodByte) filter.push(0x08, periodByte);
  filter.push(0x10, 0x01); // type = video
  const bytes: number[] = [];
  if (sortByte) bytes.push(0x08, sortByte);
  bytes.push(0x12, filter.length, ...filter);
  return Buffer.from(bytes).toString("base64");
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseSearchResults(html: string, limit: number): Omit<YouTubeResult, "verification" | "verificationNote" | "rank">[] {
  const m = /var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const out: Omit<YouTubeResult, "verification" | "verificationNote" | "rank">[] = [];
  const seen = new Set<string>();
  const text = (t: Json | undefined) => (t?.simpleText as string) || (t?.runs as Json[] | undefined)?.map((r) => r.text).join("") || "";
  const visit = (node: unknown) => {
    if (out.length >= limit || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const rec = node as Json;
    if (rec.videoRenderer && typeof rec.videoRenderer === "object") {
      const v = rec.videoRenderer as Json;
      const id = typeof v.videoId === "string" ? v.videoId : "";
      const title = text(v.title);
      if (ID_RE.test(id) && title && !seen.has(id)) {
        seen.add(id);
        const channelRun = (v.ownerText?.runs?.[0] ?? v.longBylineText?.runs?.[0]) as Json | undefined;
        const browse = channelRun?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl as string | undefined;
        out.push({
          videoId: id,
          title,
          channel: channelRun?.text || text(v.ownerText) || "Unknown channel",
          channelUrl: browse ? `https://www.youtube.com${browse}` : undefined,
          views: text(v.viewCountText) || text(v.shortViewCountText) || undefined,
          publishedAt: text(v.publishedTimeText) || undefined,
          duration: text(v.lengthText) || undefined,
          description: (v.detailedMetadataSnippets?.[0]?.snippetText ? text(v.detailedMetadataSnippets[0].snippetText) : text(v.descriptionSnippet)) || undefined,
          url: canonicalWatchUrl(id),
          thumbnailUrl: thumbnailFor(id),
        });
      }
      return;
    }
    for (const v of Object.values(rec)) visit(v);
  };
  visit(data);
  return out;
}

export interface SearchOutcome {
  ok: boolean;
  results: YouTubeResult[];
  /** How the list was obtained, for display ("YouTube search, sorted by view count, past week"). */
  source: string;
  /** Results dropped because YouTube reported them as not found. */
  dropped: number;
  error?: string;
}

export async function searchYouTube(
  opts: YouTubeSearchOptions,
  ctx: { signal?: AbortSignal; verify?: Verifier; fetchHtml?: (url: string, signal?: AbortSignal) => Promise<string> } = {}
): Promise<SearchOutcome> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 15));
  const sort = opts.sort ?? "relevance";
  const period = opts.period ?? "any";
  const source = `YouTube search results for "${opts.query}"${sort === "views" ? ", sorted by view count" : sort === "date" ? ", newest first" : ""}${period !== "any" ? ` (${period === "today" ? "uploaded today" : period === "hour" ? "uploaded in the past hour" : `uploaded in the past ${period}`})` : ""}`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(opts.query)}&sp=${encodeURIComponent(searchFilterParam(sort, period))}&hl=en&gl=US`;

  const fetchHtml =
    ctx.fetchHtml ??
    (async (u: string, signal?: AbortSignal) => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await fetch(u, {
          signal: ctl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: "CONSENT=YES+1; SOCS=CAI",
          },
        });
        if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    });

  let html: string;
  try {
    html = await fetchHtml(url, ctx.signal);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    return { ok: false, results: [], source, dropped: 0, error: `Could not reach YouTube search (${e instanceof Error ? e.message : "network error"}).` };
  }
  const parsed = parseSearchResults(html, limit + 4);
  if (!parsed.length) {
    return { ok: false, results: [], source, dropped: 0, error: "YouTube returned no readable results (its page format may have changed, or a consent/robot page was shown)." };
  }

  const verify = ctx.verify ?? verifyYouTubeVideo;
  const checks = await mapLimit(parsed, 5, (p) => verify(p.videoId, ctx.signal).catch((): VideoCheck => ({ id: p.videoId, status: "unchecked", reason: "The check failed." })));
  const results: YouTubeResult[] = [];
  let dropped = 0;
  parsed.forEach((p, i) => {
    const c = checks[i];
    if (c.status === "not_found") {
      dropped++;
      return;
    }
    if (c.status === "verified" && !titleMatches(p.title, c.title)) {
      dropped++; // the page's title contradicts YouTube's own record: don't present it
      return;
    }
    if (results.length >= limit) return;
    results.push({
      ...p,
      verification: c.status === "verified" ? "verified" : c.status === "restricted" ? "restricted" : "unchecked",
      verificationNote: c.reason,
      rank: results.length + 1,
    });
  });
  return { ok: results.length > 0, results, source, dropped, error: results.length ? undefined : "No retrievable videos passed verification." };
}
