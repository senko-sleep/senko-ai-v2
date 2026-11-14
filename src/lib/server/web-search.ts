// Real web search for the chat: asks several engines, keeps only what they returned, and
// ranks it the way metasearch engines do (reciprocal rank fusion across engines).
//
// Providers, best first:
//   browser  the chat's live Chromium (only when it's open and no agent is driving it)
//   proxy    SEARCH_API_URL, when configured (hosts whose IPs engines block)
//   google   Programmable Search JSON API keys (plain-HTML Google needs JavaScript now)
//   bing     HTML results, paged 10 at a time
//   ddg      DuckDuckGo HTML results, paged through its "Next" form
// When one engine returns little or nothing that matches, the others fill in. Nothing is
// invented: every title, snippet and URL comes from an engine's answer, and links that
// don't resolve are dropped.
import type { Page } from "playwright";
import { safeParams, type SafeSearch } from "@/lib/content-policy";
import { categorize, hostOf, queryTerms, relevance } from "@/lib/search/classify";
import type { SearchCategory, WebResult } from "@/lib/search/types";
import { cseAvailable, cseWebSearch } from "./google-cse";
import { assertPublicHttpUrl } from "./net-guard";

export interface RawResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ProviderAnswer {
  engine: string;
  results: RawResult[];
}

export interface Provider {
  name: string;
  /** The results, or the results plus the engine that actually answered (Chromium runs Google or Bing). */
  run(query: string, want: number, safe: SafeSearch, signal: AbortSignal): Promise<RawResult[] | ProviderAnswer>;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── HTML helpers ──

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Bing wraps result links as bing.com/ck/a?...&u=a1<base64url>. */
export function unwrapBingUrl(href: string): string {
  const raw = decodeEntities(href);
  try {
    const u = new URL(raw);
    if (!/(^|\.)bing\.com$/i.test(u.hostname) || !u.pathname.startsWith("/ck/")) return raw;
    const enc = u.searchParams.get("u");
    if (!enc?.startsWith("a1")) return raw;
    const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const out = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
    return /^https?:\/\//i.test(out) ? out : raw;
  } catch {
    return raw;
  }
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<url>. */
export function unwrapDdgUrl(href: string): string {
  const raw = decodeEntities(href);
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw, "https://duckduckgo.com");
    return u.searchParams.get("uddg") || u.href;
  } catch {
    return raw;
  }
}

const ENGINE_HOST = /(^|\.)(?:bing\.com|duckduckgo\.com|google\.[a-z.]+|msn\.com\/en-us\/search)$/i;

function clean(r: RawResult): RawResult | null {
  const title = r.title.trim();
  if (!title || !/^https?:\/\//i.test(r.url)) return null;
  const host = hostOf(r.url);
  if (!host || ENGINE_HOST.test(host)) return null;
  return { title: title.slice(0, 200), url: r.url, snippet: r.snippet.trim().slice(0, 400) };
}

export function parseBing(html: string): RawResult[] {
  const out: RawResult[] = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const body = block.split(/<\/li>\s*<li class="(?:b_algo|b_ans|b_pag)/)[0].replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/g, "");
    const h2 = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    if (!h2) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(body) || /<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i.exec(body);
    const snippet = p ? stripTags(p[1]).replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4}\s*·\s*/, "") : "";
    const r = clean({ url: unwrapBingUrl(h2[1]), title: stripTags(h2[2]), snippet });
    if (r) out.push(r);
  }
  return out;
}

export function parseDdg(html: string): RawResult[] {
  const out: RawResult[] = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/result--ad\b/.test(block.slice(0, 200))) continue;
    const a = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    const s = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block);
    const url = unwrapDdgUrl(a[1]);
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;
    const r = clean({ url, title: stripTags(a[2]), snippet: s ? stripTags(s[1]) : "" });
    if (r) out.push(r);
  }
  return out;
}

/** The hidden fields of DuckDuckGo's "Next" form, to fetch the following page. */
export function ddgNextForm(html: string): URLSearchParams | null {
  const form = /<div class="nav-link">\s*<form[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form || !/value="Next"/i.test(form[1])) return null;
  const p = new URLSearchParams();
  for (const m of form[1].matchAll(/<input[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name && !/type="submit"/i.test(m[0])) p.set(name, decodeEntities(value));
  }
  return p.has("q") ? p : null;
}

async function getText(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<string> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, signal, redirect: "follow" });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.text();
}

// ── Providers ──

export const bingProvider: Provider = {
  name: "bing",
  async run(query, want, safe, signal) {
    const out: RawResult[] = [];
    const seen = new Set<string>();
    for (let first = 1; out.length < want && first <= 41; first += 10) {
      const html = await getText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&${safeParams.bing(safe)}&setlang=en&first=${first}`, signal, {
        headers: { Referer: "https://www.bing.com/" },
      });
      const page = parseBing(html).filter((r) => !seen.has(r.url) && seen.add(r.url));
      if (!page.length) break;
      out.push(...page);
    }
    return out;
  },
};

export const ddgProvider: Provider = {
  name: "duckduckgo",
  async run(query, want, safe, signal) {
    const kp = safeParams.ddg(safe).split("=")[1];
    let html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kp=${kp}`, signal, { headers: { Referer: "https://duckduckgo.com/" } });
    const out = parseDdg(html);
    for (let i = 0; i < 3 && out.length < want; i++) {
      const next = ddgNextForm(html);
      if (!next) break;
      next.set("kp", kp);
      html = await getText("https://html.duckduckgo.com/html/", signal, {
        method: "POST",
        body: next.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: "https://html.duckduckgo.com/" },
      });
      const more = parseDdg(html).filter((r) => !out.some((o) => o.url === r.url));
      if (!more.length) break;
      out.push(...more);
    }
    return out;
  },
};

export const googleApiProvider: Provider = {
  name: "google",
  async run(query, want, safe, signal) {
    if (!cseAvailable()) return [];
    const out: RawResult[] = [];
    for (let start = 1; out.length < want && start <= 21; start += 10) {
      const items = await cseWebSearch(query, { start, safe: safe === "off" ? "off" : "active", signal });
      if (!items.length) break;
      out.push(...items.map((i) => ({ title: i.title || "", url: i.link, snippet: (i.snippet || "").replace(/\s+/g, " ") })));
    }
    return out.map(clean).filter((r): r is RawResult => !!r);
  },
};

export const proxyProvider: Provider = {
  name: "proxy",
  async run(query, _want, safe, signal) {
    const base = process.env.SEARCH_API_URL;
    // The proxy can't apply SafeSearch, so it only answers when SafeSearch is off.
    if (!base || safe !== "off") return [];
    const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&safe=${safe}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { title?: string; url?: string; snippet?: string }[] };
    return (data.results || [])
      .map((r) =>
        clean({
          // Its titles sometimes carry the display URL glued on ("Rust Bookhttps://doc.rust-lang.org › book").
          title: decodeEntities(r.title || "").replace(/\s*https?:\/\/\S.*$/, ""),
          url: unwrapBingUrl(r.url || ""),
          snippet: decodeEntities(r.snippet || ""),
        }),
      )
      .filter((r): r is RawResult => !!r);
  },
};

/** Reads the organic results off a Google or Bing results page open in Chromium. */
export async function readResultsPage(p: Page): Promise<RawResult[]> {
  const rows = await p.evaluate(() => {
    const out: { title: string; url: string; snippet: string }[] = [];
    const isBing = /bing\.com$/.test(location.hostname);
    if (isBing) {
      for (const li of document.querySelectorAll("li.b_algo")) {
        const a = li.querySelector("h2 a") as HTMLAnchorElement | null;
        if (!a) continue;
        const snip = li.querySelector(".b_caption p, p") as HTMLElement | null;
        out.push({ title: a.innerText, url: a.href, snippet: snip?.innerText || "" });
      }
      return out;
    }
    for (const h3 of document.querySelectorAll("#search a h3, #rso a h3")) {
      const a = h3.closest("a") as HTMLAnchorElement | null;
      if (!a?.href) continue;
      const block = a.closest("[data-hveid], .g, .MjjYud") as HTMLElement | null;
      const snip = block?.querySelector("[data-sncf], .VwiC3b, [style*='-webkit-line-clamp']") as HTMLElement | null;
      out.push({ title: (h3 as HTMLElement).innerText, url: a.href, snippet: snip?.innerText || "" });
    }
    return out;
  });
  return rows.map((r) => clean({ ...r, url: r.url.includes("bing.com/ck/") ? unwrapBingUrl(r.url) : r.url })).filter((r): r is RawResult => !!r);
}

type RunSearchSession = Parameters<typeof import("@/lib/agent/web-search").runSearch>[0];

/**
 * Runs the search in a Chromium page the way a person would (Google, or Bing after a robot
 * check), reads the results off the page, and opens the next results page while more are wanted.
 */
async function searchInChromium(s: RunSearchSession, query: string, want: number, safe: SafeSearch, signal: AbortSignal, via: string): Promise<ProviderAnswer> {
  const { runSearch, SEARCH_URLS } = await import("@/lib/agent/web-search");
  const outcome = await runSearch(s, { query, kind: "web", level: safe, signal });
  if (!outcome.ok) return { engine: via, results: [] };
  const p = s.active();
  await p.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  const out = await readResultsPage(p);
  for (let page = 1; page < 3 && out.length < want && !signal.aborted; page++) {
    const base = SEARCH_URLS[outcome.engine].web(query, safe);
    const next = outcome.engine === "google" ? `${base}&start=${page * 10}` : `${base}&first=${page * 10 + 1}`;
    await p.goto(next, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    const more = (await readResultsPage(p).catch(() => [])).filter((r) => !out.some((o) => o.url === r.url));
    if (!more.length) break;
    out.push(...more);
  }
  return { engine: `${outcome.engine} (${via})`, results: out };
}

/** Search in the chat's open browser (what the user sees in the live view). */
export function browserProvider(chatId: string): Provider {
  return {
    name: "browser",
    async run(query, want, safe, signal) {
      const { sessions } = await import("@/lib/agent/sessions");
      const s = sessions.get(chatId);
      if (!s?.isActive() || s.running) return [];
      return searchInChromium(s, query, want, safe, signal, "live browser");
    },
  };
}

/**
 * A private, throwaway Chromium window on the app's shared browser (no cookies or history
 * kept). Used when the chat has no live browser open. SENKO_SEARCH_BROWSER=0 turns it off.
 */
export const chromiumProvider: Provider = {
  name: "chromium",
  async run(query, want, safe, signal) {
    if (process.env.SENKO_SEARCH_BROWSER === "0") return [];
    const { getBrowser, desktopUserAgent } = await import("@/lib/agent/browser");
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: desktopUserAgent(browser), locale: "en-US", viewport: { width: 1280, height: 900 } });
    const close = () => context.close().catch(() => {});
    signal.addEventListener("abort", close, { once: true });
    try {
      const page = await context.newPage();
      const s: RunSearchSession = {
        context,
        takeover: false,
        active: () => page,
        log: () => {},
        setTakeover: () => {},
        // Nobody watches this window: a Google robot check sends the search to Bing.
        viewerCount: () => 0,
      };
      return await searchInChromium(s, query, want, safe, signal, "Chromium");
    } finally {
      signal.removeEventListener("abort", close);
      await close();
    }
  },
};

// ── Merge, filter, verify ──

export interface SearchOptions {
  safe: SafeSearch;
  count: number;
  signal?: AbortSignal;
  /** The chat, to use its live browser when one is open. */
  chatId?: string;
  /** Tests: replace the provider list. */
  providers?: Provider[];
  /** Tests: skip the network link check. */
  checkLinks?: boolean;
  onProgress?: (text: string) => void;
}

export interface SearchRun {
  results: WebResult[];
  engines: string[];
  attempts: { engine: string; count: number; relevant: number; ms: number; error?: string }[];
  /** Adult results hidden because SafeSearch is on. */
  hiddenAdult: number;
}

const PROVIDER_MS = 12_000;
/** Chromium may need to start first. */
const BROWSER_MS = 25_000;
/** Share of the query's words a result needs to count as a match: short queries need every word. */
/** The query asks for websites, not information ("anime sites", "a site to read manga"). */
const SITE_QUERY = /\b(?:web\s?)?sites?\b|\bwebpages?\b/i;
export const matchNeeded = (terms: string[]) => (terms.length <= 2 ? 0.75 : 0.5);

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(?:utm_|ref$|fbclid|gclid|si$)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}

export function defaultProviders(chatId?: string): Provider[] {
  const list: Provider[] = [];
  // The chat's own browser when it's open, otherwise a private Chromium window.
  if (chatId) list.push(browserProvider(chatId));
  list.push(chromiumProvider);
  list.push(googleApiProvider, bingProvider, ddgProvider);
  if (process.env.SEARCH_API_URL) list.push(proxyProvider);
  return list;
}

/**
 * Asks every provider at once (each with its own timeout), then fuses the answers. Results
 * that don't match the query are left out; if the engines found nothing that matches, the
 * best partial matches are kept rather than showing nothing.
 */
export async function searchWeb(query: string, opts: SearchOptions): Promise<SearchRun> {
  const want = Math.max(1, Math.min(opts.count, 30));
  const providers = opts.providers ?? defaultProviders(opts.chatId);
  const terms = queryTerms(query);
  const MATCH = matchNeeded(terms);
  const attempts: SearchRun["attempts"] = [];

  const answers = await Promise.all(
    providers.map(async (p): Promise<ProviderAnswer> => {
      const t = Date.now();
      const ms = p.name === "browser" || p.name === "chromium" ? BROWSER_MS : PROVIDER_MS;
      const sig = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
      try {
        const got = await p.run(query, want + 5, opts.safe, sig);
        const { engine, results } = Array.isArray(got) ? { engine: p.name, results: got } : got;
        attempts.push({ engine, count: results.length, relevant: results.filter((r) => relevance(terms, r, categorize(r.url, r.title, r.snippet)) >= MATCH).length, ms: Date.now() - t });
        return { engine, results };
      } catch (e) {
        attempts.push({ engine: p.name, count: 0, relevant: 0, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) });
        return { engine: p.name, results: [] };
      }
    }),
  );

  // Reciprocal rank fusion: a page several engines rank high comes first.
  const fused = new Map<string, { r: RawResult; score: number; engines: string[]; match: number }>();
  answers.forEach((a, pi) => {
    a.results.forEach((r, rank) => {
      const key = urlKey(r.url);
      const prev = fused.get(key);
      const add = 1 / (60 + rank) + (providers.length - pi) * 1e-4;
      if (prev) {
        prev.score += add;
        if (!prev.engines.includes(a.engine)) prev.engines.push(a.engine);
        if (!prev.r.snippet && r.snippet) prev.r = { ...prev.r, snippet: r.snippet };
      } else {
        fused.set(key, { r, score: add, engines: [a.engine], match: relevance(terms, r, categorize(r.url, r.title, r.snippet)) });
      }
    });
  });

  let ranked = [...fused.values()].sort((a, b) => b.score - a.score);
  const matching = ranked.filter((x) => x.match >= MATCH);
  // Mostly matches: drop the rest. Hardly any: keep partial matches too, still in engine order.
  // Hardly any: keep partial matches and pages two engines agree on (e.g. "Friday Night Funkin'" for "fnf").
  // Never a page that only shares one word of a longer query (the "Friday" film for "friday night funkin fan art").
  ranked = matching.length >= Math.min(3, ranked.length) ? matching : ranked.filter((x) => x.match >= MATCH * 0.67 || (x.engines.length > 1 && x.match > 0));

  // "hentai websites" asks for sites of that kind: an encyclopedia article *about* hentai
  // matches every word but isn't one. Keep wiki pages only if there's nothing else.
  if (SITE_QUERY.test(query)) {
    const sites = ranked.filter((x) => categorize(x.r.url, x.r.title, x.r.snippet) !== "wiki");
    if (sites.length) ranked = sites;
  }

  let hiddenAdult = 0;
  const results: WebResult[] = [];
  for (const x of ranked) {
    const category: SearchCategory = categorize(x.r.url, x.r.title, x.r.snippet);
    if (opts.safe !== "off" && category === "adult") {
      hiddenAdult++;
      continue;
    }
    results.push({ ...x.r, source: hostOf(x.r.url), engines: x.engines, category, link: "unchecked" });
  }

  // Check links, keep the ones that work (sites that block bots stay, marked unchecked).
  let final = results.slice(0, want + 8);
  if (opts.checkLinks !== false && final.length) {
    opts.onProgress?.(`Checking ${final.length} links`);
    const checked = await Promise.all(final.map(async (r) => ({ r, state: await checkLink(r.url, opts.signal) })));
    final = checked.filter((c) => c.state !== "broken").map((c) => ({ ...c.r, link: c.state === "ok" ? "ok" : "unchecked" }));
  }

  const engines = answers.filter((a) => a.results.length).map((a) => a.engine);
  return { results: final.slice(0, want), engines, attempts, hiddenAdult };
}

/** "ok" answered, "broken" doesn't exist (bad host, 404/410), "blocked" the site wouldn't say. */
export async function checkLink(url: string, signal?: AbortSignal): Promise<"ok" | "broken" | "blocked"> {
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return "broken";
  }
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  try {
    let res = await fetch(url, { method: "HEAD", headers: HEADERS, redirect: "follow", signal: sig });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", headers: { ...HEADERS, Range: "bytes=0-0" }, redirect: "follow", signal: sig });
      res.body?.cancel().catch(() => {});
    }
    if (res.status === 404 || res.status === 410) return "broken";
    return res.ok ? "ok" : "blocked";
  } catch (e) {
    // DNS/TLS failure = the site isn't there; a timeout just means slow.
    const msg = String((e as { cause?: { code?: string } })?.cause?.code || (e as Error)?.message || "");
    return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT_|ERR_TLS/i.test(msg) ? "broken" : "blocked";
  }
}
