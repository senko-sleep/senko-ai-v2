import type { Page } from "playwright";
import type { ChatVideo } from "@/lib/chat-video";

export type { ChatVideo };

interface Candidate extends ChatVideo {
  score: number;
}

const MEDIA_FILE = /\.(?:mp4|m4v|webm|mov|ogv)(?:[?#]|$)/i;
const HLS = /\.m3u8(?:[?#]|$)|mpegurl/i;
// Pieces of a stream, not something to play on its own.
const SEGMENT = /\.(?:ts|m4s|aac)(?:[?#]|$)|\/seg[-_]?\d|init\.mp4|chunk[-_]?\d|fragment/i;
// Players that are meant to be embedded in an <iframe>.
const EMBED = /(?:youtube(?:-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/|dailymotion\.com\/embed\/|streamable\.com\/[eo]\/|redgifs\.com\/ifr\/|gfycat\.com\/ifr\/|\/embed\/|\/player\/|\/embedframe)/i;

/** The YouTube embed for a watch / shorts / youtu.be link, if it is one. */
export function youtubeEmbed(url: string): string | null {
  const id =
    /[?&]v=([\w-]{11})/.exec(url)?.[1] ||
    /youtu\.be\/([\w-]{11})/.exec(url)?.[1] ||
    /youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url)?.[1];
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/** Rank what a page offers; the best playable video first, duplicates removed. */
export function rankVideos(found: Candidate[]): ChatVideo[] {
  const seen = new Set<string>();
  return found
    .filter((c) => /^https?:\/\//i.test(c.src) && !SEGMENT.test(c.src))
    .sort((a, b) => b.score - a.score)
    .filter((c) => (seen.has(c.src) ? false : (seen.add(c.src), true)))
    .map(({ score: _score, ...v }) => v);
}

export function kindOf(src: string): ChatVideo["kind"] | null {
  if (HLS.test(src)) return "hls";
  if (MEDIA_FILE.test(src)) return "file";
  if (EMBED.test(src)) return "embed";
  return null;
}

/**
 * Every video on the current page the chat could play, best first: the player the user
 * sees (largest / playing), the page's declared video (og:video), then media files and
 * streams the page loaded (for players that only expose a blob: URL).
 */
export async function findPageVideos(page: Page): Promise<ChatVideo[]> {
  const pageUrl = page.url();
  const yt = youtubeEmbed(pageUrl);
  if (yt) return [{ src: yt, kind: "embed", pageUrl, title: await page.title().catch(() => undefined) }];

  const raw = await page.evaluate(() => {
    const out: { src: string; poster?: string; title?: string; score: number; hint?: string }[] = [];
    const abs = (u: string | null | undefined) => {
      try { return u ? new URL(u, location.href).href : ""; } catch { return ""; }
    };
    const title = document.title;
    const vw = innerWidth, vh = innerHeight;
    for (const v of Array.from(document.querySelectorAll("video"))) {
      const r = v.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
      const area = Math.min(1, (r.width * r.height) / (vw * vh));
      const base = (visible ? 50 : 10) + area * 40 + (!v.paused ? 30 : 0) + (v.duration > 3 ? 10 : 0);
      const poster = abs(v.poster) || undefined;
      const srcs = [v.currentSrc, v.src, ...Array.from(v.querySelectorAll("source")).map((s) => s.getAttribute("src"))];
      for (const s of srcs) {
        const u = abs(s);
        if (u && !u.startsWith("blob:")) out.push({ src: u, poster, title, score: base + 20, hint: "video" });
      }
      // Also check a data attribute some players keep the real file in.
      for (const attr of ["data-src", "data-video", "data-mp4", "data-hls"]) {
        const u = abs(v.getAttribute(attr));
        if (u) out.push({ src: u, poster, title, score: base + 10, hint: "video" });
      }
    }
    for (const f of Array.from(document.querySelectorAll("iframe"))) {
      const r = f.getBoundingClientRect();
      const u = abs(f.getAttribute("src"));
      if (u && r.width >= 200 && r.height >= 120) out.push({ src: u, title, score: 40 + Math.min(1, (r.width * r.height) / (vw * vh)) * 40, hint: "iframe" });
    }
    for (const sel of ['meta[property="og:video:secure_url"]', 'meta[property="og:video:url"]', 'meta[property="og:video"]', 'meta[name="twitter:player:stream"]', 'meta[itemprop="contentUrl"]']) {
      const u = abs(document.querySelector(sel)?.getAttribute("content"));
      if (u) out.push({ src: u, title, score: 70, poster: abs(document.querySelector('meta[property="og:image"]')?.getAttribute("content")) || undefined });
    }
    for (const sel of ['meta[name="twitter:player"]', 'meta[property="og:video:iframe"]']) {
      const u = abs(document.querySelector(sel)?.getAttribute("content"));
      if (u) out.push({ src: u, title, score: 35, hint: "iframe" });
    }
    // Media the page fetched: catches players that feed the <video> through a blob: URL.
    for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      if (/\.m3u8(?:[?#]|$)/i.test(e.name)) out.push({ src: e.name, title, score: /master|index|playlist/i.test(e.name) ? 65 : 60 });
      else if (/\.(?:mp4|webm|m4v|mov)(?:[?#]|$)/i.test(e.name) && (e.initiatorType === "video" || e.initiatorType === "xmlhttprequest" || e.initiatorType === "fetch" || e.initiatorType === "other")) out.push({ src: e.name, title, score: 55 });
    }
    return out;
  });

  const candidates: Candidate[] = [];
  for (const c of raw) {
    const kind =
      c.hint === "iframe" ? (youtubeEmbed(c.src) || EMBED.test(c.src) ? "embed" : null)
      // A <video> source plays even without a file extension (e.g. /get_file/123/).
      : c.hint === "video" ? (HLS.test(c.src) ? "hls" : "file")
      : kindOf(c.src);
    if (!kind) continue;
    const src = kind === "embed" ? youtubeEmbed(c.src) || c.src : c.src;
    // Direct files play most reliably in the chat; embeds depend on the other site.
    const score = c.score + (kind === "file" ? 8 : kind === "hls" ? 5 : 0);
    candidates.push({ src, kind, pageUrl, poster: c.poster, title: c.title || undefined, score });
  }
  return rankVideos(candidates);
}
