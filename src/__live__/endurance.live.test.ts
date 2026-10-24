// Endurance run for the agent's browser: many back-to-back realistic actions on one session
// (Google searches incl. repeats, clicking results, scrolling, tabs, back), plus injected
// faults (a frozen tab, a crashed tab, a tab flood, many session open/close cycles).
//
//   npx vitest run --config vitest.live.config.ts src/__live__/endurance.live.test.ts
//   ENDURANCE_CYCLES=20 ... (default 10)
//
// Uses a local Chrome and an in-memory database only (never .env.local, cloud browsers or a
// real DB). Real Google searches are paced like production, so a run takes a few minutes.
import { expect, it } from "vitest";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Page } from "playwright";

process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.BROWSERBASE_API_KEY;
delete process.env.STEEL_API_KEY;
delete process.env.BROWSERLESS_TOKEN;
delete process.env.BROWSER_CDP_URL;
process.env.BROWSER_PROVIDER = "local";
process.env.BROWSER_HEALTH_INTERVAL_MS = "2000";
process.env.MAX_TABS_PER_SESSION = "6";

const CYCLES = Number(process.env.ENDURANCE_CYCLES || 10);
const QUERIES = ["red fox habitat", "how do tides work", "best hiking trails colorado", "red fox habitat", "python list comprehension", "how do tides work"];

const ms = (t0: number) => Date.now() - t0;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

it("stays fast and responsive through a long run of consecutive tasks", async () => {
  const { sessions } = await import("@/lib/agent/sessions");
  const { runSearch } = await import("@/lib/agent/web-search");
  const { getBrowser } = await import("@/lib/agent/browser");
  const { googleRetryIn } = await import("@/lib/agent/google-gate");

  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const timings: Record<string, number[]> = {};
  const record = (k: string, v: number) => (timings[k] ??= []).push(v);
  const log = (...a: unknown[]) => console.log("[endurance]", ...a);
  const engines: Record<string, number> = {};
  let reused = 0;
  let googleRequests = 0;

  // Like the agent loop: if the browser had to be restarted, reopen the chat's session.
  let restarts = 0;
  let s = await sessions.open("endurance", "o_endurance");
  const tap = (x: typeof s) => {
    // Show the session's own log (recoveries, closed tabs, robot checks) in the test output.
    const origLog = x.log.bind(x);
    x.log = (text, level) => { console.log(`[session ${level || "info"}] ${text}`); origLog(text, level); };
    return x;
  };
  tap(s);
  const live = async () => {
    if (s.status === "suspended" || s.status === "closed") {
      restarts++;
      log("browser was restarted; reopening the session");
      s = tap(await sessions.open("endurance", "o_endurance"));
    }
    return s;
  };
  // Report any step that is stuck (a hang must never go unnoticed).
  let phase = "start";
  let phaseAt = Date.now();
  const setPhase = (p: string) => { phase = p; phaseAt = Date.now(); };
  const stuck = setInterval(() => { if (Date.now() - phaseAt > 20_000) log(`STUCK ${Math.round((Date.now() - phaseAt) / 1000)}s in: ${phase}`); }, 10_000);
  // Act as a live viewer is NOT attached: a robot check should fall back to Bing, not wait.
  const ctl = new AbortController();
  const browser = await getBrowser();
  const heap0 = process.memoryUsage().heapUsed;

  // Clicks and scrolls go through the session's input queue: the same path as your own
  // clicks in the live view.
  const input = (ev: Parameters<typeof s.input>[0]) =>
    s.inputBatch([ev], s.viewEpoch, s.controlVersion).then(() => true, (e) => { log(`input ${ev.type} failed: ${String(e).slice(0, 100)}`); return false; });
  const clickFirstResult = async (p: Page) => {
    const link = p.locator("#search a:has(h3), #b_results li.b_algo h2 a").first();
    if (!(await link.count())) return false;
    await link.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await link.boundingBox();
    if (!box || box.y < 0) return false;
    const ok = await input({ type: "click", x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 });
    await p.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    return ok;
  };

  for (let i = 0; i < CYCLES; i++) {
    const q = QUERIES[i % QUERIES.length];
    await live();
    setPhase(`cycle ${i + 1} search`);
    let t = Date.now();
    const r = await runSearch(s, { query: q, kind: i % 4 === 3 ? "images" : "web", signal: ctl.signal });
    record("search", ms(t));
    engines[r.engine] = (engines[r.engine] || 0) + 1;
    if (r.reused) reused++;
    else if (r.engine === "google") googleRequests++;
    log(`cycle ${i + 1}: ${r.result.slice(0, 110)} (${ms(t)}ms)`);

    setPhase(`cycle ${i + 1} click`);
    t = Date.now();
    const clicked = await clickFirstResult(s.active()).catch(() => false);
    record("click+load", ms(t));

    setPhase(`cycle ${i + 1} scroll`);
    await live();
    t = Date.now();
    for (let k = 0; k < 6; k++) {
      await input({ type: "wheel", x: 640, y: 400, dx: 0, dy: 500 });
      await new Promise((r) => setTimeout(r, 60));
    }
    record("scroll", ms(t));

    setPhase(`cycle ${i + 1} new tab`);
    t = Date.now();
    await s.openTab(i % 2 ? "https://en.wikipedia.org/wiki/Special:Random" : "https://example.com/");
    record("new tab", ms(t));
    setPhase(`cycle ${i + 1} switch tabs`);
    t = Date.now();
    await s.switchTab(0);
    await s.switchTab(s.pages.length - 1);
    await s.switchTab(0);
    record("switch tabs", ms(t));

    if (clicked) {
      setPhase(`cycle ${i + 1} back`);
      t = Date.now();
      await s.active().goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
      record("back", ms(t));
    }

    // Responsiveness probe: how fast does the active tab answer right now?
    setPhase(`cycle ${i + 1} probe`);
    t = Date.now();
    expect(await s.responsive(s.active(), 5000)).toBe(true);
    record("probe", ms(t));
    t = Date.now();
    await s.tabs();
    record("tab list", ms(t));
    expect(s.pages.length).toBeLessThanOrEqual(6);
  }

  // ---- fault 1: a tab whose page script never returns (frozen renderer) ----------------
  setPhase("fault: frozen tab");
  await live();
  await s.switchTab(0);
  const frozen = s.active();
  const frozenUrl = frozen.url();
  void frozen.evaluate(() => { for (;;) { /* hang the renderer */ } }).catch(() => {});
  let t = Date.now();
  await expect.poll(() => s.pages.includes(frozen), { timeout: 60_000, interval: 500 }).toBe(false);
  const frozenRecovery = ms(t);
  await expect.poll(() => s.responsive(s.active(), 3000), { timeout: 30_000 }).toBe(true);
  log(`frozen tab replaced after ${frozenRecovery}ms (reopened ${s.active().url().slice(0, 60)}, was ${frozenUrl.slice(0, 60)})`);

  setPhase("fault: crashed tab");
  // ---- fault 2: a crashed tab ----------------------------------------------------------
  const crashing = s.active();
  const cdp = await s.context.newCDPSession(crashing);
  t = Date.now();
  void cdp.send("Page.crash").catch(() => {});
  await expect.poll(() => s.pages.includes(crashing), { timeout: 30_000, interval: 250 }).toBe(false);
  const crashRecovery = ms(t);
  await expect.poll(() => s.responsive(s.active(), 3000), { timeout: 30_000 }).toBe(true);
  log(`crashed tab replaced after ${crashRecovery}ms`);

  setPhase("fault: tab flood");
  // ---- fault 3: tab flood ---------------------------------------------------------------
  for (let k = 0; k < 12; k++) await s.openTab("https://example.com/?flood=" + k);
  await expect.poll(() => s.pages.length, { timeout: 15_000 }).toBeLessThanOrEqual(6);
  log(`after opening 12 more tabs: ${s.pages.length} open (cap 6)`);

  setPhase("fault: session churn");
  // ---- fault 4: many sessions opened and closed (listener / timer leaks) ----------------
  const listeners0 = (browser as unknown as { listenerCount(e: string): number }).listenerCount("disconnected");
  for (let k = 0; k < 15; k++) {
    const other = await sessions.open(`endurance-${k}`, "o_endurance");
    await other.openTab("https://example.com/");
    await sessions.close(`endurance-${k}`);
  }
  const listeners1 = (browser as unknown as { listenerCount(e: string): number }).listenerCount("disconnected");
  log(`browser "disconnected" listeners before/after 15 open+close cycles: ${listeners0} -> ${listeners1}`);
  expect(listeners1).toBe(listeners0);

  // Still fast after all of that?
  t = Date.now();
  await s.openTab("https://example.com/");
  const lateNewTab = ms(t);
  t = Date.now();
  expect(await s.responsive(s.active(), 5000)).toBe(true);
  const lateProbe = ms(t);

  clearInterval(stuck);
  lag.disable();
  const heap1 = process.memoryUsage().heapUsed;
  const summary = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95), max: Math.max(...v) }]));
  console.table(summary);
  log(`searches: ${CYCLES}, engines: ${JSON.stringify(engines)}, reused without a request: ${reused}, Google requests sent: ${googleRequests}, Google cooldown left: ${Math.round(googleRetryIn("browser") / 1000)}s, browser restarts: ${restarts}`);
  log(`event loop delay: p50 ${Math.round(lag.percentile(50) / 1e6)}ms, p99 ${Math.round(lag.percentile(99) / 1e6)}ms, max ${Math.round(lag.max / 1e6)}ms`);
  log(`server heap: ${Math.round(heap0 / 1e6)}MB -> ${Math.round(heap1 / 1e6)}MB; tabs open: ${s.pages.length}; late new tab ${lateNewTab}ms, late probe ${lateProbe}ms`);

  // Late actions are as fast as early ones (no slow-down after extended use).
  expect(lateProbe).toBeLessThan(1000);
  expect(pct(timings.probe, 95)).toBeLessThan(1000);
  expect(lag.percentile(99) / 1e6).toBeLessThan(250);

  await sessions.close("endurance");
}, 30 * 60_000);
