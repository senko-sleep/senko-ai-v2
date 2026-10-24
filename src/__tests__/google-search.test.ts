import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TtlCache,
  googleAvailable,
  googleRetryIn,
  isGoogleSorryUrl,
  looksLikeGoogleCaptcha,
  paceGoogle,
  parseResultsUrl,
  reportGoogleCaptcha,
  reportGoogleOk,
  resetGoogleGate,
} from "@/lib/agent/google-gate";
import { runSearch, type SearchSession } from "@/lib/agent/web-search";

beforeEach(() => {
  resetGoogleGate();
  process.env.GOOGLE_MIN_GAP_MS = "0";
  process.env.GOOGLE_GAP_JITTER_MS = "0";
  process.env.GOOGLE_CAPTCHA_WAIT_MS = "5000";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.GOOGLE_MIN_GAP_MS;
  delete process.env.GOOGLE_GAP_JITTER_MS;
  delete process.env.GOOGLE_CAPTCHA_WAIT_MS;
});

describe("Google gate", () => {
  it("spaces requests out, one at a time", async () => {
    process.env.GOOGLE_MIN_GAP_MS = "40";
    const times: number[] = [];
    await Promise.all([1, 2, 3].map(() => paceGoogle().then(() => times.push(Date.now()))));
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(35);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(35);
  });

  it("lets a scraper skip Google instead of waiting too long", async () => {
    process.env.GOOGLE_MIN_GAP_MS = "10000";
    expect(await paceGoogle()).toBe(true);
    expect(await paceGoogle({ maxWaitMs: 100 })).toBe(false);
  });

  it("backs off after a robot check, longer each time, and comes back after a success", () => {
    const now = Date.now();
    const first = reportGoogleCaptcha("browser", now);
    expect(googleAvailable("browser", now + first - 1)).toBe(false);
    expect(googleAvailable("browser", now + first + 1)).toBe(true);
    const second = reportGoogleCaptcha("browser", now);
    expect(second).toBe(first * 2);
    reportGoogleOk("browser");
    expect(googleAvailable("browser")).toBe(true);
    // The scrapers stay paused: they share the IP that was flagged.
    expect(googleAvailable("http", now + 1000)).toBe(false);
  });

  it("a blocked scraper pauses the scrapers but not the browser", () => {
    reportGoogleCaptcha("http");
    expect(googleAvailable("http")).toBe(false);
    expect(googleAvailable("browser")).toBe(true);
  });

  it("recognises robot checks narrowly and parses result URLs", () => {
    expect(isGoogleSorryUrl("https://www.google.com/sorry/index?continue=x")).toBe(true);
    expect(isGoogleSorryUrl("https://www.google.co.uk/search?q=sorry")).toBe(false);
    expect(looksLikeGoogleCaptcha("Our systems have detected unusual traffic from your computer network.")).toBe(true);
    expect(looksLikeGoogleCaptcha("How to prove you're not a robot — reCAPTCHA explained")).toBe(false);
    expect(parseResultsUrl("https://www.google.com/search?q=red+fox&udm=2&safe=off")).toEqual({ engine: "google", kind: "images", query: "red fox" });
    expect(parseResultsUrl("https://www.bing.com/search?q=red%20fox")).toEqual({ engine: "bing", kind: "web", query: "red fox" });
    expect(parseResultsUrl("https://example.com/search?q=x")).toBeNull();
  });
});

describe("TtlCache", () => {
  it("expires entries, caps size and shares in-flight loads", async () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1, 0);
    expect(cache.get("a", 500)).toBe(1);
    expect(cache.get("a", 2000)).toBeUndefined();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    const load = vi.fn(async () => 7);
    const [x, y] = await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)]);
    expect([x, y]).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.getOrLoad("k", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    // Results the caller doesn't want kept (e.g. empty) are not cached.
    const empty = vi.fn(async () => 0);
    await cache.getOrLoad("e", empty, (v) => v > 0);
    await cache.getOrLoad("e", empty, (v) => v > 0);
    expect(empty).toHaveBeenCalledTimes(2);
  });
});

/** A fake tab: Google answers with a robot check while `captcha` is on. */
function fakeBrowser(opts: { captcha?: boolean; viewers?: number; history?: string[] } = {}) {
  let url = "about:blank";
  const state = { captcha: !!opts.captcha, gotos: [] as string[] };
  const page = {
    url: () => url,
    goto: vi.fn(async (next: string) => {
      state.gotos.push(next);
      url = next.includes("google.com") && state.captcha ? "https://www.google.com/sorry/index?continue=" + encodeURIComponent(next) : next;
      return null;
    }),
    evaluate: vi.fn(async () => (url.includes("/sorry/") ? 'id="captcha-form" unusual traffic from your computer network' : "results")),
    waitForURL: vi.fn(async () => {}),
    getByRole: () => ({ first: () => ({ click: async () => {} }) }),
  };
  const history = (opts.history || []).map((u, i) => ({ id: i + 1, url: u }));
  const cdp = {
    send: vi.fn(async (method: string, params?: { entryId: number }) => {
      if (method === "Page.getNavigationHistory") return { currentIndex: history.length, entries: [...history, { id: 99, url }] };
      if (method === "Page.navigateToHistoryEntry") url = history.find((h) => h.id === params!.entryId)!.url;
      return {};
    }),
    detach: async () => {},
  };
  const session: SearchSession & { takeoverLog: boolean[] } = {
    takeover: false,
    takeoverLog: [],
    context: { newCDPSession: async () => cdp } as never,
    active: () => page as never,
    log: vi.fn(),
    setTakeover(on: boolean) {
      this.takeover = on;
      this.takeoverLog.push(on);
    },
    viewerCount: () => opts.viewers ?? 0,
  };
  return { page, session, state, cdp, setUrl: (u: string) => (url = u) };
}

describe("agent web search", () => {
  const signal = new AbortController().signal;

  it("searches Google by default and reuses results already on screen", async () => {
    const { session, state } = fakeBrowser();
    const first = await runSearch(session, { query: "Red Fox", kind: "web", signal });
    expect(first).toMatchObject({ ok: true, engine: "google", reused: false });
    expect(state.gotos[0]).toMatch(/^https:\/\/www\.google\.com\/search\?q=Red%20Fox/);
    const again = await runSearch(session, { query: "red  fox", kind: "web", signal });
    expect(again).toMatchObject({ engine: "google", reused: true });
    expect(state.gotos).toHaveLength(1);
  });

  it("goes back to earlier results in the tab's history instead of searching again", async () => {
    const { session, state, setUrl } = fakeBrowser({ history: ["https://www.google.com/search?q=red+fox&safe=off"] });
    setUrl("https://en.wikipedia.org/wiki/Red_fox");
    const r = await runSearch(session, { query: "red fox", kind: "web", signal });
    expect(r).toMatchObject({ engine: "google", reused: true });
    expect(state.gotos).toHaveLength(0);
  });

  it("with nobody watching, a robot check falls back to Bing, then returns to Google after the cooldown", async () => {
    const { session, state } = fakeBrowser({ captcha: true });
    const r = await runSearch(session, { query: "red fox", kind: "web", signal });
    expect(r.engine).toBe("bing");
    expect(state.gotos.map((u) => new URL(u).hostname)).toEqual(["www.google.com", "www.bing.com"]);
    expect(googleRetryIn("browser")).toBeGreaterThan(0);
    // While Google cools down, the next search goes straight to Bing (no extra Google hit).
    await runSearch(session, { query: "grey wolf", kind: "web", signal });
    expect(state.gotos.map((u) => new URL(u).hostname)).toEqual(["www.google.com", "www.bing.com", "www.bing.com"]);
    // Cooldown over: Google again.
    resetGoogleGate();
    state.captcha = false;
    const back = await runSearch(session, { query: "arctic fox", kind: "web", signal });
    expect(back.engine).toBe("google");
  });

  it("hands a robot check to the viewer and continues by itself once it's solved", async () => {
    vi.useFakeTimers();
    const { session, state, setUrl } = fakeBrowser({ captcha: true, viewers: 1 });
    const job = runSearch(session, { query: "red fox", kind: "images", signal });
    await vi.advanceTimersByTimeAsync(10);
    expect(session.takeover).toBe(true);
    // The user solves it: Google redirects to the results.
    state.captcha = false;
    setUrl("https://www.google.com/search?q=red+fox&udm=2&safe=off");
    await vi.advanceTimersByTimeAsync(2000);
    const r = await job;
    expect(r).toMatchObject({ ok: true, engine: "google" });
    expect(session.takeoverLog).toEqual([true, false]);
    expect(googleAvailable("browser")).toBe(true);
  });

  it("leaves the browser with the user if they take control during the check", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const { session } = fakeBrowser({ captcha: true, viewers: 1 });
    const job = runSearch(session, { query: "red fox", kind: "web", signal: ctl.signal });
    await vi.advanceTimersByTimeAsync(10);
    ctl.abort("takeover");
    const r = await job;
    expect(r.ok).toBe(false);
    expect(session.takeoverLog).toEqual([true]);
  });
});
