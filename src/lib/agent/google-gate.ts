// Google traffic control, shared by everything in this server process that talks to Google:
// the agent's real browser ("browser") and the plain-HTTP result scrapers ("http").
//
// Google rate-limits by IP. Both channels leave from the same IP, so a burst from either one
// can put a robot check in front of the other. This module:
// - spaces Google requests out (one at a time, a few seconds apart, with jitter),
// - backs off after a robot check (5 min, doubling up to 1 h), so the block isn't extended
//   by more requests while it's in force, and returns to Google when the cooldown ends,
// - recognises Google's robot-check pages and result URLs.

export type GoogleChannel = "browser" | "http";

interface GateState {
  last: number;
  queue: Promise<unknown>;
  blockedUntil: Record<GoogleChannel, number>;
  strikes: number;
}

const g = globalThis as unknown as { __googleGate?: GateState };
const state: GateState = (g.__googleGate ??= { last: 0, queue: Promise.resolve(), blockedUntil: { browser: 0, http: 0 }, strikes: 0 });

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
/** Minimum gap between two Google requests from this server. */
const minGap = () => num(process.env.GOOGLE_MIN_GAP_MS, 4000);
const jitter = () => num(process.env.GOOGLE_GAP_JITTER_MS, 2000);
const baseCooldown = () => num(process.env.GOOGLE_COOLDOWN_MS, 5 * 60_000);
const maxCooldown = () => num(process.env.GOOGLE_MAX_COOLDOWN_MS, 60 * 60_000);

export function googleAvailable(channel: GoogleChannel, now = Date.now()): boolean {
  return now >= state.blockedUntil[channel];
}

/** Milliseconds until Google is used again on this channel (0 = now). */
export function googleRetryIn(channel: GoogleChannel, now = Date.now()): number {
  return Math.max(0, state.blockedUntil[channel] - now);
}

/**
 * Google answered with a robot check. Stop sending it traffic for a while (longer each time
 * it happens again). A check in the real browser also pauses the HTTP scrapers (same IP); a
 * blocked scraper doesn't stop the browser, which carries cookies and usually still passes.
 */
export function reportGoogleCaptcha(channel: GoogleChannel, now = Date.now()): number {
  state.strikes = Math.min(state.strikes + 1, 8);
  const ms = Math.min(maxCooldown(), baseCooldown() * 2 ** (state.strikes - 1));
  state.blockedUntil.http = Math.max(state.blockedUntil.http, now + ms);
  if (channel === "browser") state.blockedUntil.browser = Math.max(state.blockedUntil.browser, now + ms);
  return ms;
}

/** Google served real results (or the user solved the check): the browser can use it again. */
export function reportGoogleOk(channel: GoogleChannel) {
  if (channel !== "browser") return;
  state.strikes = 0;
  state.blockedUntil.browser = 0;
}

/**
 * Wait for this request's turn. Requests are serialised and spaced `GOOGLE_MIN_GAP_MS` apart.
 * With `maxWaitMs`, a caller that would wait longer gets `false` right away (and keeps no slot),
 * so a scraper can use another engine instead of stalling a reply.
 */
export function paceGoogle(opts: { signal?: AbortSignal; maxWaitMs?: number; onWait?: (ms: number) => void } = {}): Promise<boolean> {
  const turn = state.queue.then(async () => {
    if (opts.signal?.aborted) return false;
    const wait = state.last + minGap() + Math.random() * jitter() - Date.now();
    if (opts.maxWaitMs !== undefined && wait > opts.maxWaitMs) return false;
    if (wait > 0) {
      opts.onWait?.(wait);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait);
        opts.signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    }
    if (opts.signal?.aborted) return false;
    state.last = Date.now();
    return true;
  });
  state.queue = turn.catch(() => {});
  return turn;
}

/** For tests. */
export function resetGoogleGate() {
  state.last = 0;
  state.queue = Promise.resolve();
  state.blockedUntil = { browser: 0, http: 0 };
  state.strikes = 0;
}

// ---- recognising Google pages ------------------------------------------------------------

export function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(host);
}

/** Google's robot-check interstitial (www.google.com/sorry/index?continue=...). */
export function isGoogleSorryUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isGoogleHost(u.hostname) && u.pathname.startsWith("/sorry");
  } catch {
    return false;
  }
}

/** Page text / HTML of Google's robot check. Narrow on purpose: results *about* captchas must not match. */
export function looksLikeGoogleCaptcha(text: string): boolean {
  return /unusual traffic from your computer network|id="captcha-form"|our systems have detected unusual traffic/i.test(text);
}

export type SearchKind = "web" | "images";
export type SearchEngine = "google" | "bing";

/** If `url` is a Google or Bing results page, which engine, kind and query it shows. */
export function parseResultsUrl(url: string): { engine: SearchEngine; kind: SearchKind; query: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const query = u.searchParams.get("q");
    if (!query) return null;
    if (isGoogleHost(host) && u.pathname === "/search") {
      const images = u.searchParams.get("udm") === "2" || u.searchParams.get("tbm") === "isch";
      return { engine: "google", kind: images ? "images" : "web", query };
    }
    if (/(^|\.)bing\.com$/.test(host)) {
      if (u.pathname === "/search") return { engine: "bing", kind: "web", query };
      if (u.pathname.startsWith("/images/search")) return { engine: "bing", kind: "images", query };
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

// ---- small result cache ----------------------------------------------------------------------

/** A size-capped map whose entries expire, with in-flight de-duplication of identical lookups. */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();
  constructor(private ttlMs: number, private max = 200) {}

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU order.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now = Date.now()) {
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  /** Cached value, or the result of `load` (shared by concurrent callers). `keep` decides what's cached. */
  async getOrLoad(key: string, load: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const job = load().then((value) => {
      if (keep(value)) this.set(key, value);
      return value;
    });
    this.inflight.set(key, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(key);
    }
  }

  get size() {
    return this.map.size;
  }
}
