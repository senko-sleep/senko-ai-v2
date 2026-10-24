// How the agent searches: Google first, as gently as possible.
//
// 1. Results already on screen for the same query are reused (no reload).
// 2. Results visited earlier in this tab are reopened from its history (no new search).
// 3. Otherwise Google is asked, paced with every other Google request from this server.
// 4. A robot check is handed to the user in the live view; the task continues by itself as
//    soon as it's solved. Nobody watching, or not solved in time: Bing answers this time,
//    Google cools down, and the agent returns to Google once the cooldown ends.
import type { BrowserContext, Page } from "playwright";
import { safeParams, type SafeSearch } from "@/lib/content-policy";
import {
  googleAvailable,
  googleRetryIn,
  isGoogleSorryUrl,
  looksLikeGoogleCaptcha,
  normalizeQuery,
  paceGoogle,
  parseResultsUrl,
  reportGoogleCaptcha,
  reportGoogleOk,
  type SearchEngine,
  type SearchKind,
} from "./google-gate";
import { orTimeout, sleep, withTimeout } from "./timeouts";

export const SEARCH_URLS: Record<SearchEngine, Record<SearchKind, (q: string, l: SafeSearch) => string>> = {
  google: {
    web: (q, l) => `https://www.google.com/search?q=${encodeURIComponent(q)}&${safeParams.google(l)}`,
    images: (q, l) => `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=2&${safeParams.google(l)}`,
  },
  bing: {
    web: (q, l) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&${safeParams.bing(l)}`,
    images: (q, l) => `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&${safeParams.bingImages(l)}`,
  },
};

/** What the search needs from the browser session (kept small so it's easy to test). */
export interface SearchSession {
  context: BrowserContext;
  takeover: boolean;
  active(): Page;
  log(text: string, level?: "info" | "warn" | "error"): void;
  setTakeover(on: boolean): void;
  viewerCount(): number;
}

export interface SearchOptions {
  query: string;
  kind: SearchKind;
  /** The engine the user named; Google otherwise. */
  engine?: SearchEngine;
  level?: SafeSearch;
  signal: AbortSignal;
  status?: (text: string) => void;
}

export interface SearchOutcome {
  ok: boolean;
  engine: SearchEngine;
  result: string;
  /** No request was sent: the results were already open or came back from history. */
  reused: boolean;
}

const CAPTCHA_WAIT_MS = () => Math.max(0, Number(process.env.GOOGLE_CAPTCHA_WAIT_MS ?? 5 * 60_000));
const fmtMin = (ms: number) => (ms < 90_000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60_000)} min`);
const label = (engine: SearchEngine, kind: SearchKind) => `${engine === "google" ? "Google" : "Bing"}${kind === "images" ? " Images" : ""}`;

function sameSearch(url: string, kind: SearchKind, query: string, engine?: SearchEngine) {
  const r = parseResultsUrl(url);
  return !!r && r.kind === kind && normalizeQuery(r.query) === normalizeQuery(query) && (!engine || r.engine === engine);
}

/** Is the robot check showing on this page? Bounded, so a hung page can't stall the caller. */
export async function onGoogleCaptcha(p: Page): Promise<boolean> {
  if (isGoogleSorryUrl(p.url())) return true;
  if (!/google\./i.test(p.url())) return false;
  const text = await withTimeout(
    p.evaluate(() => `${document.querySelector("#captcha-form") ? 'id="captcha-form" ' : ""}${(document.body?.innerText || "").slice(0, 1500)}`),
    3000,
    "",
  );
  return looksLikeGoogleCaptcha(text);
}

/** Reopen an earlier results page from this tab's history (served from the browser's cache when possible). */
async function fromHistory(ctx: BrowserContext, p: Page, kind: SearchKind, query: string, engine: SearchEngine): Promise<boolean> {
  let cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  try {
    cdp = await withTimeout(ctx.newCDPSession(p), 5000, null);
    if (!cdp) return false;
    const history = await withTimeout(
      cdp.send("Page.getNavigationHistory") as Promise<{ currentIndex: number; entries: { id: number; url: string }[] }>,
      3000,
      null,
    );
    if (!history) return false;
    // Nearest earlier entry first.
    for (let i = history.currentIndex - 1; i >= 0; i--) {
      const entry = history.entries[i];
      if (!sameSearch(entry.url, kind, query, engine) || isGoogleSorryUrl(entry.url)) continue;
      await orTimeout(cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }), 5000, "reopening earlier results");
      await p.waitForURL((u) => sameSearch(u.href, kind, query, engine), { timeout: 15_000, waitUntil: "domcontentloaded" });
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (cdp) await withTimeout(cdp.detach(), 3000, undefined);
  }
}

async function acceptGoogleConsent(p: Page) {
  if (!/consent\.google\./.test(p.url())) return;
  await p.getByRole("button", { name: /reject all|accept all/i }).first().click({ timeout: 4000 }).catch(() => {});
  await p.waitForURL(/google\.[a-z.]+\/search/, { timeout: 8000 }).catch(() => {});
}

/**
 * Google showed a robot check. With someone watching the live view, hand them the browser and
 * wait for the check to clear, then take control back and carry on. Returns true when solved.
 */
export async function handOffGoogleCaptcha(s: SearchSession, signal: AbortSignal, status?: (t: string) => void): Promise<boolean> {
  const cooldown = reportGoogleCaptcha("browser");
  const wait = CAPTCHA_WAIT_MS();
  if (!wait || s.viewerCount() === 0) {
    s.log(`Google asked for a robot check. Nobody is watching the browser to solve it, so I'm using Bing for ${fmtMin(cooldown)} before going back to Google.`, "warn");
    return false;
  }
  const hadControl = s.takeover;
  s.setTakeover(true);
  s.log("Google wants to confirm you're not a robot. Please solve the check in the browser view; I'll continue by myself as soon as it's done.", "warn");
  const deadline = Date.now() + wait;
  let solved = false;
  try {
    while (!signal.aborted && Date.now() < deadline) {
      status?.(`Waiting for you to solve Google's robot check in the browser view (${fmtMin(deadline - Date.now())} left)…`);
      await sleep(1500, signal);
      if (signal.aborted) break;
      let page: Page;
      try {
        page = s.active();
      } catch {
        continue; // tab being replaced
      }
      if (!(await onGoogleCaptcha(page))) {
        solved = true;
        break;
      }
    }
  } finally {
    // A user who pressed "Take control" aborted the run: the browser stays theirs.
    if (!signal.aborted && !hadControl) s.setTakeover(false);
  }
  if (solved) {
    reportGoogleOk("browser");
    s.log("Robot check done, thanks! Continuing the task.");
  } else if (!signal.aborted) {
    s.log(`The robot check wasn't solved in time, so I'm using Bing for now and will return to Google in ~${fmtMin(googleRetryIn("browser"))}.`, "warn");
  }
  return solved;
}

async function openResults(p: Page, engine: SearchEngine, kind: SearchKind, query: string, level: SafeSearch) {
  await p.goto(SEARCH_URLS[engine][kind](query, level), { waitUntil: "domcontentloaded", timeout: 45_000 });
}

async function describeResults(p: Page, engine: SearchEngine, kind: SearchKind, query: string, how: string) {
  if (kind !== "images") return `${how} ${label(engine, kind)} results for "${query}".`;
  const count = await withTimeout(p.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 60 || i.width > 60).length), 3000, 0);
  return `${how} ${label(engine, kind)} for "${query}"${count ? ` (${count} images on screen)` : ""}.`;
}

/** Run a search in the active tab. Never throws for a robot check; navigation errors propagate. */
export async function runSearch(s: SearchSession, opts: SearchOptions): Promise<SearchOutcome> {
  const { query, kind, signal, status } = opts;
  const level = opts.level ?? "off";
  const wanted: SearchEngine = opts.engine ?? "google";
  let p = s.active();

  // 1. Already showing these results: nothing to send.
  const here = parseResultsUrl(p.url());
  if (here && sameSearch(p.url(), kind, query) && (here.engine === wanted || (wanted === "google" && !googleAvailable("browser")))) {
    return { ok: true, engine: here.engine, reused: true, result: `Already on the ${label(here.engine, kind)} results for "${query}" (no new search sent).` };
  }

  // Google is cooling down after a robot check: Bing answers until the cooldown ends.
  let engine: SearchEngine = wanted;
  let note = "";
  if (engine === "google" && !googleAvailable("browser")) {
    engine = "bing";
    note = ` Google is paused for ~${fmtMin(googleRetryIn("browser"))} after a robot check, so Bing answered this time; Google is used again after that.`;
  }

  // 2. Seen earlier in this tab: go back to them.
  if (await fromHistory(s.context, p, kind, query, engine)) {
    return { ok: true, engine, reused: true, result: (await describeResults(p, engine, kind, query, "Went back to the earlier")) + " (reused, no new search sent)" + note };
  }

  if (engine === "bing") {
    await openResults(p, "bing", kind, query, level);
    return { ok: true, engine, reused: false, result: (await describeResults(p, "bing", kind, query, "Opened")) + note };
  }

  // 3. Ask Google, spaced out with every other Google request from this server.
  const ready = await paceGoogle({
    signal,
    onWait: (ms) => { if (ms > 1500) status?.(`Spacing out Google searches (${fmtMin(ms)})…`); },
  });
  if (!ready) return { ok: false, engine, reused: false, result: "Search cancelled." };
  await openResults(p, "google", kind, query, level);
  await acceptGoogleConsent(p);

  // 4. Robot check.
  if (await onGoogleCaptcha(p)) {
    if (await handOffGoogleCaptcha(s, signal, status)) {
      p = s.active();
      if (!sameSearch(p.url(), kind, query, "google")) {
        await openResults(p, "google", kind, query, level).catch(() => {});
      }
      return { ok: true, engine: "google", reused: false, result: (await describeResults(p, "google", kind, query, "After you solved the robot check, opened")) };
    }
    if (signal.aborted) return { ok: false, engine: "google", reused: false, result: "Search cancelled." };
    p = s.active();
    await openResults(p, "bing", kind, query, level);
    return {
      ok: true,
      engine: "bing",
      reused: false,
      result: `${await describeResults(p, "bing", kind, query, "Google showed a robot check, so I opened")} Google is used again in ~${fmtMin(googleRetryIn("browser"))}. Mention this briefly in the answer.`,
    };
  }
  reportGoogleOk("browser");
  return { ok: true, engine: "google", reused: false, result: await describeResults(p, "google", kind, query, "Opened") };
}
