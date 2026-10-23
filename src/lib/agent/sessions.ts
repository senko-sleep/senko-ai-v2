// Persistent browser sessions: one isolated browser context per chat.
//
// - Stays open between messages (tabs, page, video, cookies, logins all stay alive).
// - State (cookies/localStorage, tab URLs, scroll position, video time) is saved to the
//   database so a server restart or memory eviction can restore it.
// - Broadcasts live-view frames, cursor moves, steps and logs to subscribers.
// - The only automatic shutdowns are real resource limits (MAX_LIVE_SESSIONS / low memory);
//   evicted sessions are saved first and restore when you come back, and the UI is told why.
import os from "node:os";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { SCREEN, browserMode, desktopUserAgent, getBrowser, isHeaded } from "./browser";
import { isAdHost, isPrivateUrl } from "./safety";
import { json, newId, q, q1, toBuffer } from "@/lib/server/db";

export type SessionStatus = "active" | "restoring" | "suspended" | "closed";

export interface TabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export type BusEvent =
  | { type: "status"; status: SessionStatus; tabs: TabInfo[]; takeover: boolean; live: LiveInfo; running: boolean }
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "cursor"; x: number; y: number; kind: "move" | "click"; box?: { x: number; y: number; w: number; h: number } | null; width: number; height: number }
  | { type: "log"; text: string; level: "info" | "warn" | "error"; at: number }
  | { type: "plan"; steps: string[] }
  | { type: "step"; id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string; at: number; shotId?: string }
  | { type: "shot"; id: string; label: string; at: number };

export interface LiveInfo {
  /** "vnc" when a VNC stream of the real screen is available, else screenshot streaming. */
  mode: "vnc" | "screencast";
  audio: boolean;
  headed: boolean;
  browser?: string;
}

interface SavedTab {
  url: string;
  title: string;
  scrollY?: number;
  videoTime?: number;
}

const MAX_LIVE = Math.max(1, Number(process.env.MAX_LIVE_SESSIONS || 3));
const LOW_MEMORY_MB = Number(process.env.LOW_MEMORY_MB || 250);
// Live view frame rate. 30 keeps video watchable; Chrome only sends frames when the page
// changes, so a still page costs almost nothing. LIVE_QUALITY trades sharpness for bandwidth.
const FPS = Math.min(60, Math.max(1, Number(process.env.LIVE_FPS || 30)));
const QUALITY = Math.min(95, Math.max(20, Number(process.env.LIVE_QUALITY || 60)));

export function liveInfo(): LiveInfo {
  const m = browserMode();
  return {
    mode: process.env.VNC_PORT && isHeaded() ? "vnc" : "screencast",
    audio: !!process.env.AUDIO_SOURCE && isHeaded(),
    headed: !!m?.headed,
    browser: m?.channel,
  };
}

// Runs in every page: keep navigation in the same tab and remember that the
// agent's own clicks shouldn't spawn pop-ups.
const INIT_SCRIPT = () => {
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[target]");
      if (a && a.getAttribute("target") !== "_self") a.setAttribute("target", "_self");
    },
    true
  );
};

export class BrowserSession {
  readonly chatId: string;
  readonly ownerId: string;
  status: SessionStatus = "restoring";
  context!: BrowserContext;
  pages: Page[] = [];
  activeIndex = 0;
  takeover = false;
  running = false;
  lastUsed = Date.now();
  private subs = new Set<(e: BusEvent) => void>();
  private cdp: CDPSession | null = null;
  private castPage: Page | null = null;
  private lastFrameAt = 0;
  private lastFrame: { data: string; width: number; height: number } | null = null;
  private lastCursor: Extract<BusEvent, { type: "cursor" }> | null = null;
  private expectingTab = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private logs: Extract<BusEvent, { type: "log" }>[] = [];
  /** Steps/plan of the current or last agent run, replayed to new subscribers. */
  replay: BusEvent[] = [];

  constructor(chatId: string, ownerId: string) {
    this.chatId = chatId;
    this.ownerId = ownerId;
  }

  // ---- lifecycle -------------------------------------------------------------

  async start(saved: { storage?: unknown; tabs?: SavedTab[]; activeIndex?: number } | null) {
    this.status = saved ? "restoring" : "active";
    this.emitStatus();
    const browser = await getBrowser();
    const headed = isHeaded();
    this.context = await browser.newContext({
      viewport: headed ? null : SCREEN,
      userAgent: desktopUserAgent(browser),
      locale: "en-US",
      colorScheme: "dark",
      acceptDownloads: false, // never download files
      storageState: saved?.storage ? (saved.storage as never) : undefined,
    });
    await this.context.addInitScript(INIT_SCRIPT);
    await this.context.route("**/*", (route) => {
      const url = route.request().url();
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        /* data: etc */
      }
      if (host && isAdHost(host)) return route.abort("blockedbyclient");
      if (isPrivateUrl(url)) {
        if (route.request().isNavigationRequest()) this.log(`Blocked private network address ${host}`, "warn");
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    this.context.on("page", (p) => void this.onNewPage(p));

    const tabs = saved?.tabs?.filter((t) => t.url && t.url !== "about:blank") || [];
    if (tabs.length) {
      this.log(`Restoring ${tabs.length} tab${tabs.length > 1 ? "s" : ""} from the saved session…`);
      for (const t of tabs) {
        const p = await this.newTabInternal();
        await p.goto(t.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e) => this.log(`Couldn't reopen ${t.url}: ${String(e).split("\n")[0]}`, "warn"));
        await p
          .evaluate(
            ({ y, v }) => {
              if (y) window.scrollTo(0, y);
              const vid = document.querySelector("video");
              if (vid && v) vid.currentTime = v;
            },
            { y: t.scrollY || 0, v: t.videoTime || 0 }
          )
          .catch(() => {});
      }
      this.activeIndex = Math.min(saved?.activeIndex ?? 0, this.pages.length - 1);
      await this.pages[this.activeIndex]?.bringToFront().catch(() => {});
    } else {
      await this.newTabInternal();
    }
    this.status = "active";
    await this.persist();
    this.saveTimer = setInterval(() => void this.persist().catch(() => {}), 60_000);
    this.emitStatus();
    if (this.subs.size) await this.startCast();
  }

  private async newTabInternal(): Promise<Page> {
    this.expectingTab = true;
    const p = await this.context.newPage();
    this.expectingTab = false;
    if (!this.pages.includes(p)) this.adopt(p);
    this.activeIndex = this.pages.indexOf(p);
    return p;
  }

  private adopt(p: Page) {
    this.pages.push(p);
    p.on("close", () => {
      const i = this.pages.indexOf(p);
      if (i === -1) return;
      this.pages.splice(i, 1);
      if (this.activeIndex >= this.pages.length) this.activeIndex = Math.max(0, this.pages.length - 1);
      if (this.castPage === p) void this.startCast();
      this.emitStatus();
    });
    p.on("framenavigated", (f) => {
      if (f !== p.mainFrame()) return;
      this.emitStatus();
      this.schedulePersist();
    });
    p.on("dialog", (d) => {
      this.log(`Dismissed a page dialog: "${d.message().slice(0, 80)}"`);
      void d.dismiss().catch(() => {});
    });
    p.on("download", (d) => {
      this.log(`Blocked a download (${d.suggestedFilename()})`, "warn");
      void d.cancel().catch(() => {});
    });
  }

  private async onNewPage(p: Page) {
    if (this.pages.includes(p)) return;
    if (this.expectingTab) {
      this.adopt(p);
      return;
    }
    // Unexpected tab/pop-up (ads, redirects): close it, unless the user opened it during takeover.
    if (this.takeover) {
      this.adopt(p);
      this.activeIndex = this.pages.indexOf(p);
      await this.startCast();
      this.emitStatus();
      return;
    }
    await p.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    this.log(`Closed an unexpected pop-up${p.url() && p.url() !== "about:blank" ? ` (${hostOf(p.url())})` : ""}`);
    await p.close().catch(() => {});
  }

  async close(reason: "closed" | "suspended" = "closed") {
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (reason === "suspended") await this.persist().catch(() => {});
    this.status = reason;
    this.emitStatus();
    await this.stopCast();
    await this.context?.close().catch(() => {});
    if (reason === "closed") {
      await q("UPDATE browser_sessions SET status = 'closed', storage = NULL, tabs = '[]', updated_at = now() WHERE chat_id = $1", [this.chatId]);
    } else {
      await q("UPDATE browser_sessions SET status = 'suspended', updated_at = now() WHERE chat_id = $1", [this.chatId]);
    }
  }

  // ---- tabs ------------------------------------------------------------------

  active(): Page {
    const p = this.pages[this.activeIndex];
    if (!p) throw new Error("This session has no open tabs.");
    return p;
  }

  isActive() {
    return this.status === "active" && this.pages.some((p) => p.url() !== "about:blank");
  }

  async tabs(): Promise<TabInfo[]> {
    return Promise.all(
      this.pages.map(async (p, i) => ({
        index: i,
        title: (await p.title().catch(() => "")) || hostOf(p.url()) || "New tab",
        url: p.url(),
        active: i === this.activeIndex,
      }))
    );
  }

  async openTab(url?: string): Promise<Page> {
    const p = await this.newTabInternal();
    if (url) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await p.bringToFront().catch(() => {});
    await this.startCast();
    this.emitStatus();
    return p;
  }

  async switchTab(index: number) {
    if (index < 0 || index >= this.pages.length) throw new Error(`There is no tab ${index + 1} (${this.pages.length} open).`);
    this.activeIndex = index;
    await this.active().bringToFront().catch(() => {});
    await this.startCast();
    this.emitStatus();
  }

  async closeTab(index: number) {
    const p = this.pages[index];
    if (!p) throw new Error(`There is no tab ${index + 1}.`);
    if (this.pages.length === 1) await this.newTabInternal();
    await p.close();
    await this.startCast();
    this.emitStatus();
  }

  // ---- persistence ---------------------------------------------------------------

  private persistSoon: ReturnType<typeof setTimeout> | null = null;
  schedulePersist() {
    if (this.persistSoon) clearTimeout(this.persistSoon);
    this.persistSoon = setTimeout(() => void this.persist().catch(() => {}), 4000);
  }

  async persist() {
    if (!this.context || this.status === "closed") return;
    const storage = await this.context.storageState().catch(() => null);
    const tabs: SavedTab[] = [];
    for (const p of this.pages) {
      const info = await p
        .evaluate(() => {
          const v = document.querySelector("video");
          return { scrollY: window.scrollY, videoTime: v ? v.currentTime : 0 };
        })
        .catch(() => ({ scrollY: 0, videoTime: 0 }));
      tabs.push({ url: p.url(), title: await p.title().catch(() => ""), ...info });
    }
    await q(
      `INSERT INTO browser_sessions (chat_id, owner_id, status, storage, tabs, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (chat_id) DO UPDATE SET status = EXCLUDED.status, storage = EXCLUDED.storage, tabs = EXCLUDED.tabs, updated_at = now()`,
      [this.chatId, this.ownerId, this.status === "restoring" ? "active" : this.status, storage ? JSON.stringify(storage) : null, JSON.stringify({ tabs, activeIndex: this.activeIndex })]
    );
  }

  // ---- events / live view ----------------------------------------------------------

  subscribe(fn: (e: BusEvent) => void): () => void {
    this.subs.add(fn);
    void this.tabs().then((tabs) => fn({ type: "status", status: this.status, tabs, takeover: this.takeover, live: liveInfo(), running: this.running }));
    for (const l of this.logs.slice(-20)) fn(l);
    for (const e of this.replay) fn(e);
    if (this.lastFrame) fn({ type: "frame", ...this.lastFrame });
    // Show the agent's cursor where it was last, so it never "disappears" on reconnect.
    if (this.lastCursor) fn(this.lastCursor);
    if (this.status === "active") void this.startCast();
    return () => {
      this.subs.delete(fn);
      if (!this.subs.size && !this.running) void this.stopCast();
    };
  }

  emit(e: BusEvent) {
    if (e.type === "plan" || e.type === "step" || e.type === "shot") this.replay.push(e);
    if (e.type === "cursor") this.lastCursor = { ...e, kind: "move" };
    for (const fn of this.subs) {
      try {
        fn(e);
      } catch {
        /* subscriber gone */
      }
    }
  }

  log(text: string, level: "info" | "warn" | "error" = "info") {
    const e = { type: "log" as const, text, level, at: Date.now() };
    this.logs.push(e);
    if (this.logs.length > 100) this.logs.shift();
    this.emit(e);
  }

  emitStatus() {
    if (!this.subs.size) return;
    void this.tabs().then((tabs) =>
      this.emit({ type: "status", status: this.status, tabs, takeover: this.takeover, live: liveInfo(), running: this.running })
    );
  }

  /** Viewport size of the active page in CSS pixels. */
  viewport() {
    return this.pages[this.activeIndex]?.viewportSize() || SCREEN;
  }

  async startCast() {
    const p = this.pages[this.activeIndex];
    if (!p || (!this.subs.size && !this.running)) return;
    if (this.castPage === p && this.cdp) return;
    await this.stopCast();
    try {
      this.castPage = p;
      this.cdp = await this.context.newCDPSession(p);
      const minGap = 1000 / FPS;
      this.cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
        this.cdp?.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
        const now = Date.now();
        if (now - this.lastFrameAt < minGap) return;
        this.lastFrameAt = now;
        this.lastFrame = { data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight };
        this.emit({ type: "frame", ...this.lastFrame });
      });
      await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: QUALITY, maxWidth: SCREEN.width, maxHeight: SCREEN.height, everyNthFrame: 1 });
    } catch {
      this.cdp = null;
      this.castPage = null;
    }
  }

  async stopCast() {
    const c = this.cdp;
    this.cdp = null;
    this.castPage = null;
    if (c) {
      await c.send("Page.stopScreencast").catch(() => {});
      await c.detach().catch(() => {});
    }
  }

  // ---- screenshots / page reading ------------------------------------------------------

  async screenshot(quality = 70): Promise<Buffer> {
    return this.active().screenshot({ type: "jpeg", quality, timeout: 15_000 });
  }

  /** Save a screenshot to the timeline (DB) and announce it. */
  async recordShot(label: string, buf?: Buffer): Promise<string | undefined> {
    try {
      const data = buf || (await this.screenshot(60));
      const id = newId("s_");
      await q("INSERT INTO screenshots (id, chat_id, label, url, data) VALUES ($1, $2, $3, $4, $5)", [
        id,
        this.chatId,
        label.slice(0, 200),
        this.pages[this.activeIndex]?.url() || "",
        data,
      ]);
      const keep = Number(process.env.SCREENSHOT_HISTORY || 300);
      await q(
        "DELETE FROM screenshots WHERE chat_id = $1 AND seq <= (SELECT seq FROM screenshots WHERE chat_id = $1 ORDER BY seq DESC OFFSET $2 LIMIT 1)",
        [this.chatId, keep]
      );
      this.emit({ type: "shot", id, label, at: Date.now() });
      return id;
    } catch {
      return undefined;
    }
  }

  async pageContext(withScreenshot: boolean) {
    const p = this.active();
    const text = await p
      .evaluate(() => (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 5000))
      .catch(() => "");
    const tabs = (await this.tabs()).map((t) => `${t.index + 1}. ${t.title}${t.active ? " (active)" : ""}`).join(" | ");
    const screenshot = withScreenshot ? (await this.screenshot(60).catch(() => null))?.toString("base64") : undefined;
    return { url: p.url(), title: await p.title().catch(() => ""), text, tabs, screenshot };
  }

  // ---- user takeover input -----------------------------------------------------------------

  setTakeover(on: boolean) {
    this.takeover = on;
    this.log(on ? "You took control of the browser." : "Control handed back to the agent.");
    this.emitStatus();
  }

  async input(ev: InputEvent) {
    this.lastUsed = Date.now();
    const p = this.active();
    switch (ev.type) {
      case "click":
        await p.mouse.click(ev.x, ev.y, { button: ev.button || "left", clickCount: ev.double ? 2 : 1 });
        break;
      case "move":
        await p.mouse.move(ev.x, ev.y);
        break;
      case "wheel":
        await p.mouse.move(ev.x ?? SCREEN.width / 2, ev.y ?? SCREEN.height / 2);
        await p.mouse.wheel(ev.dx || 0, ev.dy || 0);
        break;
      case "key":
        await p.keyboard.press(ev.key);
        break;
      case "text":
        await p.keyboard.insertText(ev.text);
        break;
      case "nav":
        if (ev.action === "back") await p.goBack({ timeout: 15_000 }).catch(() => {});
        if (ev.action === "forward") await p.goForward({ timeout: 15_000 }).catch(() => {});
        if (ev.action === "reload") await p.reload({ timeout: 30_000 }).catch(() => {});
        break;
      case "goto": {
        const url = /^https?:\/\//i.test(ev.url) ? ev.url : `https://${ev.url}`;
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        break;
      }
    }
  }
}

export type InputEvent =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "move"; x: number; y: number }
  | { type: "wheel"; dx?: number; dy?: number; x?: number; y?: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "nav"; action: "back" | "forward" | "reload" }
  | { type: "goto"; url: string };

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---- manager ------------------------------------------------------------------------------

class SessionManager {
  private live = new Map<string, BrowserSession>();
  private starting = new Map<string, Promise<BrowserSession>>();

  get(chatId: string): BrowserSession | undefined {
    const s = this.live.get(chatId);
    if (s) s.lastUsed = Date.now();
    return s;
  }

  /** Status for the UI, from memory or the database. */
  async status(chatId: string): Promise<{ status: SessionStatus; tabs: TabInfo[] }> {
    const s = this.live.get(chatId);
    if (s) return { status: s.status, tabs: await s.tabs() };
    if (this.starting.has(chatId)) return { status: "restoring", tabs: [] };
    const row = await q1<{ status: string; tabs: unknown }>("SELECT status, tabs FROM browser_sessions WHERE chat_id = $1", [chatId]);
    if (!row || row.status === "closed") return { status: "closed", tabs: [] };
    const saved = json<{ tabs?: SavedTab[] }>(row.tabs, {});
    // Saved but not in memory (server restarted, or evicted for memory): it restores on next use.
    return {
      status: "suspended",
      tabs: (saved.tabs || []).map((t, i) => ({ index: i, title: t.title || hostOf(t.url), url: t.url, active: false })),
    };
  }

  /** Get the live session, restoring it from the database (or creating it) if needed. */
  async open(chatId: string, ownerId: string, opts: { fresh?: boolean } = {}): Promise<BrowserSession> {
    if (opts.fresh) await this.close(chatId);
    const existing = this.live.get(chatId);
    if (existing && existing.status !== "closed" && existing.status !== "suspended") {
      existing.lastUsed = Date.now();
      return existing;
    }
    const pending = this.starting.get(chatId);
    if (pending) return pending;

    const p = (async () => {
      await this.makeRoom(chatId);
      const row = opts.fresh
        ? null
        : await q1<{ status: string; storage: unknown; tabs: unknown }>("SELECT status, storage, tabs FROM browser_sessions WHERE chat_id = $1 AND owner_id = $2", [chatId, ownerId]);
      const saved =
        row && row.status !== "closed"
          ? { storage: json(row.storage, null), ...json<{ tabs?: SavedTab[]; activeIndex?: number }>(row.tabs, {}) }
          : null;
      const s = new BrowserSession(chatId, ownerId);
      this.live.set(chatId, s);
      try {
        await s.start(saved);
      } catch (e) {
        this.live.delete(chatId);
        throw e;
      }
      return s;
    })();
    this.starting.set(chatId, p);
    try {
      return await p;
    } finally {
      this.starting.delete(chatId);
    }
  }

  async close(chatId: string) {
    const s = this.live.get(chatId);
    this.live.delete(chatId);
    if (s) await s.close("closed");
    else await q("UPDATE browser_sessions SET status = 'closed', storage = NULL, tabs = '[]' WHERE chat_id = $1", [chatId]);
  }

  /** Real limits only: too many live browsers, or the machine is low on memory. */
  private async makeRoom(forChat: string) {
    const lowMem = () => os.freemem() / 1024 / 1024 < LOW_MEMORY_MB;
    while (this.live.size >= MAX_LIVE || (lowMem() && this.live.size > 0)) {
      const victims = [...this.live.values()].filter((s) => s.chatId !== forChat && !s.running).sort((a, b) => a.lastUsed - b.lastUsed);
      const v = victims[0];
      if (!v) break;
      const why = lowMem()
        ? `the server is low on memory (${Math.round(os.freemem() / 1024 / 1024)} MB free)`
        : `only ${MAX_LIVE} browser sessions fit in memory at once (MAX_LIVE_SESSIONS)`;
      v.log(`Session paused because ${why}. It was saved and will restore when you return.`, "warn");
      this.live.delete(v.chatId);
      await v.close("suspended");
    }
  }

  liveCount() {
    return this.live.size;
  }

  /** Forget a session in memory WITHOUT closing it in the DB (simulates a server restart; used by tests). */
  async dropFromMemory(chatId: string) {
    const s = this.live.get(chatId);
    if (!s) return;
    await s.persist();
    this.live.delete(chatId);
    await s.context.close().catch(() => {});
  }
}

const g = globalThis as unknown as { __sessions?: SessionManager };
export const sessions = (g.__sessions ??= new SessionManager());

export async function screenshotData(chatId: string, ownerId: string, id: string): Promise<Buffer | null> {
  const row = await q1<{ data: unknown }>(
    "SELECT s.data FROM screenshots s JOIN chats c ON c.id = s.chat_id WHERE s.id = $1 AND s.chat_id = $2 AND c.owner_id = $3",
    [id, chatId, ownerId]
  );
  return row ? toBuffer(row.data) : null;
}
