import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const db = vi.hoisted(() => ({ q: vi.fn(async () => []), q1: vi.fn(async () => null) }));
vi.mock("@/lib/server/db", () => ({ json: (v: unknown, d: unknown) => v ?? d, newId: () => "id", q: db.q, q1: db.q1, toBuffer: vi.fn() }));
vi.mock("@/lib/agent/browser", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent/browser")>()),
  freeMemoryMB: () => 10_000,
  restartBrowser: vi.fn(async () => {}),
  selectBrowserbaseLivePage: async () => false,
}));
import { BrowserSession } from "@/lib/agent/sessions";

const never = <T,>() => new Promise<T>(() => {});

/** A fake tab. `hung` makes every call into the page never answer, like a frozen renderer. */
function fakePage(url: string, opts: { hung?: boolean; title?: string } = {}) {
  const ee = new EventEmitter();
  let closed = false;
  const page = Object.assign(ee, {
    hung: !!opts.hung,
    url: () => url,
    title: () => (page.hung ? never<string>() : Promise.resolve(opts.title ?? url)),
    evaluate: vi.fn(() => (page.hung ? never() : Promise.resolve(1))),
    isClosed: () => closed,
    close: vi.fn(async () => {
      closed = true;
      ee.emit("close");
    }),
    goto: vi.fn(async (u: string) => {
      url = u;
      return null;
    }),
    bringToFront: async () => {},
    mouse: { wheel: vi.fn(() => (page.hung ? never<void>() : Promise.resolve())), click: vi.fn(async () => {}), move: vi.fn(async () => {}), up: vi.fn(async () => {}) },
    setViewportSize: async () => {},
    mainFrame: () => ({}),
    viewportSize: () => ({ width: 1280, height: 800 }),
  });
  return page;
}
type FakePage = ReturnType<typeof fakePage>;

function session(pages: FakePage[]) {
  const s = new BrowserSession("chat", "owner");
  const context = {
    newPage: vi.fn(async () => {
      const p = fakePage("about:blank");
      return p;
    }),
    storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
    newCDPSession: vi.fn(),
  };
  const internals = s as unknown as { context: unknown; status: string; adopt(p: FakePage): void };
  internals.context = context;
  internals.status = "active";
  for (const p of pages) internals.adopt(p);
  return { s, context };
}

describe("browser session resilience", () => {
  it("lists tabs even when one tab is frozen, using its last known title", async () => {
    const ok = fakePage("https://a.test/", { title: "Alpha" });
    const frozen = fakePage("https://b.test/", { title: "Bravo" });
    const { s } = session([ok, frozen]);
    await s.tabs();
    frozen.hung = true;
    const started = Date.now();
    const tabs = await s.tabs();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(tabs.map((t) => t.title)).toEqual(["Alpha", "Bravo"]);
  });

  it("saving never piles up: concurrent saves share one run, and a frozen tab doesn't block it", async () => {
    const frozen = fakePage("https://b.test/", { hung: true });
    const { s, context } = session([fakePage("https://a.test/"), frozen]);
    db.q.mockClear();
    const started = Date.now();
    await Promise.all([s.persist(), s.persist(), s.persist(), s.persist()]);
    expect(Date.now() - started).toBeLessThan(5000);
    // One save, plus one follow-up for the calls that arrived while it ran.
    expect(context.storageState).toHaveBeenCalledTimes(2);
    expect(db.q).toHaveBeenCalledTimes(2);
    const sql = String((db.q.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain("COALESCE(EXCLUDED.storage, browser_sessions.storage)");
  }, 15_000);

  it("replaces a crashed tab with a fresh one at the same address and position", async () => {
    const a = fakePage("https://a.test/");
    const b = fakePage("https://b.test/page");
    const c = fakePage("https://c.test/");
    const { s } = session([a, b, c]);
    await s.switchTab(1);
    b.emit("crash");
    await vi.waitFor(() => expect(b.close).toHaveBeenCalled());
    await vi.waitFor(() => expect(s.pages[1]).not.toBe(b));
    const fresh = s.pages[1] as unknown as FakePage;
    expect(s.pages).toHaveLength(3);
    expect(s.pages[0]).toBe(a);
    expect(s.pages[2]).toBe(c);
    expect(s.activeIndex).toBe(1);
    await vi.waitFor(() => expect(fresh.goto).toHaveBeenCalledWith("https://b.test/page", expect.anything()));
  });

  it("the health check replaces a frozen active tab after repeated failed probes", async () => {
    const frozen = fakePage("https://slow.test/", { hung: true });
    const { s } = session([frozen]);
    const internals = s as unknown as { responsive(p: unknown, ms?: number): Promise<boolean> };
    internals.responsive = (p: unknown) => (p === frozen ? Promise.resolve(false) : Promise.resolve(true));
    await s.checkHealth();
    await s.checkHealth();
    expect(frozen.close).not.toHaveBeenCalled();
    await s.checkHealth();
    expect(frozen.close).toHaveBeenCalled();
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0]).not.toBe(frozen);
  });

  it("a single slow input on a live page is skipped without reloading it", async () => {
    process.env.BROWSER_INPUT_STALL_MS = "3000";
    try {
      const slow = fakePage("https://heavy.test/");
      const { s } = session([slow]);
      slow.mouse.wheel.mockImplementationOnce(() => never<void>()); // input stalls, scripts still run
      const err = await s.inputBatch([{ type: "wheel", x: 10, y: 10, dx: 0, dy: 300 }]).catch((e: Error) => e);
      expect(String(err)).toMatch(/skipped/);
      expect(slow.close).not.toHaveBeenCalled();
      await s.inputBatch([{ type: "wheel", x: 10, y: 10, dx: 0, dy: 300 }], s.viewEpoch, s.controlVersion);
      expect(slow.mouse.wheel).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.BROWSER_INPUT_STALL_MS;
    }
  }, 15_000);

  it("a stuck input event replaces the tab instead of blocking every later input", async () => {
    process.env.BROWSER_INPUT_STALL_MS = "3000";
    try {
      const stuck = fakePage("https://heavy.test/");
      const { s } = session([stuck]);
      stuck.hung = true; // scripts and input no longer answer
      const started = Date.now();
      const first = s.inputBatch([{ type: "wheel", x: 10, y: 10, dx: 0, dy: 300 }]).catch((e: unknown) => e);
      await first;
      expect(Date.now() - started).toBeLessThan(8000);
      expect(stuck.close).toHaveBeenCalled();
      // The queue keeps working on the fresh tab.
      const fresh = s.active() as unknown as FakePage;
      expect(fresh).not.toBe(stuck);
      await s.inputBatch([{ type: "wheel", x: 10, y: 10, dx: 0, dy: 300 }], s.viewEpoch, s.controlVersion);
      expect(fresh.mouse.wheel).toHaveBeenCalled();
    } finally {
      delete process.env.BROWSER_INPUT_STALL_MS;
    }
  }, 15_000);

  it("closes the least recently used background tab past the tab limit", async () => {
    process.env.MAX_TABS_PER_SESSION = "3";
    try {
      const tabs = [fakePage("https://1.test/"), fakePage("https://2.test/"), fakePage("https://3.test/")];
      const { s } = session(tabs);
      await s.switchTab(0);
      await s.switchTab(2);
      await s.switchTab(1);
      await s.openTab("https://4.test/");
      await vi.waitFor(() => expect(s.pages).toHaveLength(3));
      // Tab 1 was in front longest ago (tab 3 and 2 were looked at later).
      expect(tabs[0].close).toHaveBeenCalled();
      expect(tabs[1].close).not.toHaveBeenCalled();
      expect(s.active().url()).toBe("https://4.test/");
    } finally {
      delete process.env.MAX_TABS_PER_SESSION;
    }
  });

  it("removes its listener from the shared browser when it closes (no leak across chats)", async () => {
    const browser = new EventEmitter();
    const { s } = session([fakePage("https://a.test/")]);
    const internals = s as unknown as { browser: unknown; onBrowserGone: () => void; context: { close: () => Promise<void> } };
    internals.browser = browser;
    internals.onBrowserGone = () => {};
    internals.context.close = async () => {};
    browser.on("disconnected", internals.onBrowserGone);
    expect(browser.listenerCount("disconnected")).toBe(1);
    await s.close("suspended");
    expect(browser.listenerCount("disconnected")).toBe(0);
  });

  it("stops its timers when the browser disconnects", async () => {
    vi.useFakeTimers();
    try {
      const { s } = session([fakePage("https://a.test/")]);
      const internals = s as unknown as { saveTimer: unknown; healthTimer: unknown; browserLost(): void };
      const save = setInterval(() => {}, 60_000);
      const health = setInterval(() => {}, 10_000);
      internals.saveTimer = save;
      internals.healthTimer = health;
      const cleared = vi.spyOn(globalThis, "clearInterval");
      internals.browserLost();
      expect(s.status).toBe("suspended");
      expect(cleared).toHaveBeenCalledWith(save);
      expect(cleared).toHaveBeenCalledWith(health);
      expect(internals.saveTimer).toBeNull();
      expect(internals.healthTimer).toBeNull();
      cleared.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
