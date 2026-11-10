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

// ---- universal bot-verification / challenge detection ----------------------------------------

export type BotChallengeProvider = "google" | "cloudflare" | "datadome" | "perimeterx" | "captcha";

export interface BotChallengeInfo {
  provider: BotChallengeProvider;
  host: string;
  url: string;
  title: string;
  /** True when the challenge may auto-resolve via a JS check within a few seconds. */
  autoResolvable: boolean;
  /** Human-readable explanation shown in the live operator UI. */
  summary: string;
}

export interface ChallengeProbeInput {
  url: string;
  title: string;
  bodyText: string;
  hasChallengeWidget?: boolean;
  challengeProviderHint?: BotChallengeProvider | "";
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname || "this site";
  } catch {
    return "this site";
  }
}

/**
 * Pure classifier that determines whether a page is currently gated by a bot-verification /
 * CAPTCHA / security interstitial. Designed to avoid false positives on regular articles or
 * documentation pages that merely mention CAPTCHAs or Cloudflare.
 */
export function classifyBotChallenge(input: ChallengeProbeInput): BotChallengeInfo | null {
  const url = input.url || "";
  const title = (input.title || "").trim();
  const body = (input.bodyText || "").trim();
  const host = safeHostname(url);

  // 1. Google /sorry robot check
  if (isGoogleSorryUrl(url) || (isGoogleHost(host) && looksLikeGoogleCaptcha(body))) {
    return {
      provider: "google",
      host,
      url,
      title: title || "Google Robot Check",
      autoResolvable: false,
      summary: `Google requested human verification on ${host}. Complete the check in the live browser to continue.`,
    };
  }

  // Long content pages (> 2400 chars of visible text) are real pages, not interstitial gates.
  const isShortInterstitial = body.length < 2400;
  if (!isShortInterstitial && !input.hasChallengeWidget) return null;

  // 2. Cloudflare Turnstile / Managed Challenge interstitial
  const cfTitle = /^(just a moment\.{0,3}|attention required!?.*cloudflare)$/i.test(title);
  const cfBody =
    /verify you are human by completing the action below|checking if the site connection is secure|enable javascript and cookies to continue|ray id:? [0-9a-f]{8,}|performance & security by cloudflare/i.test(
      body,
    );
  if (
    (!input.challengeProviderHint || input.challengeProviderHint === "cloudflare") &&
    isShortInterstitial && (cfTitle || cfBody)
  ) {
    const interactive =
      Boolean(input.hasChallengeWidget) || /verify you are human|complete the action below|attention required/i.test(body + " " + title);
    return {
      provider: "cloudflare",
      host,
      url,
      title: title || "Cloudflare Security Check",
      autoResolvable: !interactive,
      summary: `Cloudflare security verification on ${host}. Click the verification checkbox in the live browser to continue.`,
    };
  }

  // 3. PerimeterX / HUMAN ("Press & Hold")
  if (
    isShortInterstitial &&
    (input.challengeProviderHint === "perimeterx" ||
      /press & hold to confirm you are (a )?human|please verify you are a human[\s\S]*reference id/i.test(body) ||
      /^(robot or human\??|access to this page has been denied)/i.test(title))
  ) {
    return {
      provider: "perimeterx",
      host,
      url,
      title: title || "Human Verification",
      autoResolvable: false,
      summary: `Human verification required on ${host} (Press & Hold / security check). Complete it in the live browser to resume.`,
    };
  }

  // 4. DataDome interstitial
  if (
    isShortInterstitial &&
    (input.challengeProviderHint === "datadome" ||
      /protected by datadome|your(s)? browser or network behavior has triggered our security/i.test(body))
  ) {
    return {
      provider: "datadome",
      host,
      url,
      title: title || "Security Verification",
      autoResolvable: false,
      summary: `Security verification required on ${host}. Complete the verification check in the live browser to resume.`,
    };
  }

  // 5. Generic CAPTCHA / "Are you a bot?" interstitial gate
  const gateTitle =
    /^(are you a (robot|bot|human)\??|verify you are human|security verification|human verification|bot verification|pardon our interruption|one more step)\b/i.test(
      title,
    );
  const gateBody =
    /verify you are (a )?human|confirm you('re| are) not a (robot|bot)|complete the security check to access|please solve this captcha/i.test(
      body,
    );
  if (isShortInterstitial && ((gateTitle && gateBody) || (gateBody && input.hasChallengeWidget))) {
    return {
      provider: "captcha",
      host,
      url,
      title: title || "Verification Required",
      autoResolvable: false,
      summary: `Verification challenge detected on ${host}. Complete the check in the live browser and Senko will resume automatically.`,
    };
  }

  return null;
}

/**
 * Inspects a live Playwright page (bounded by a short timeout) to determine if a bot-verification
 * challenge is currently blocking the page.
 */
export async function detectPageBotChallenge(page: {
  url(): string;
  evaluate(fn: () => unknown): Promise<unknown>;
}): Promise<BotChallengeInfo | null> {
  const url = page.url();
  if (!url || url === "about:blank" || url.startsWith("data:")) return null;
  if (isGoogleSorryUrl(url)) {
    return classifyBotChallenge({ url, title: "Google Robot Check", bodyText: 'id="captcha-form"' });
  }
  try {
    const probe = (await Promise.race([
      page.evaluate(() => {
        const title = document.title || "";
        const bodyText = (document.body?.innerText || "").slice(0, 3000);
        const cfWidget = Boolean(
          document.querySelector(
            '#challenge-running, #cf-challenge-running, .cf-turnstile, [name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com"]',
          ),
        );
        const pxWidget = Boolean(document.querySelector('#px-captcha, iframe[src*="px-cloud"], iframe[src*="perimeterx"]'));
        const ddWidget = Boolean(document.querySelector('iframe[src*="captcha-delivery.com"], iframe[src*="datadome"]'));
        const captchaWidget = Boolean(
          document.querySelector(
            '#captcha-form, .g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
          ),
        );
        const hasChallengeWidget = cfWidget || pxWidget || ddWidget || captchaWidget;
        const challengeProviderHint: "cloudflare" | "perimeterx" | "datadome" | "captcha" | "" = cfWidget
          ? "cloudflare"
          : pxWidget
            ? "perimeterx"
            : ddWidget
              ? "datadome"
              : captchaWidget
                ? "captcha"
                : "";
        return { title, bodyText, hasChallengeWidget, challengeProviderHint };
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ])) as {
      title: string;
      bodyText: string;
      hasChallengeWidget?: boolean;
      challengeProviderHint?: BotChallengeProvider | "";
    } | null;
    if (!probe) return null;
    return classifyBotChallenge({ url, ...probe });
  } catch {
    return null;
  }
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
