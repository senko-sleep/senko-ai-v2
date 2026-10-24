// Persistent browser sessions: one isolated browser context per chat.
//
// - Stays open between messages (tabs, page, video, cookies, logins all stay alive).
// - State (cookies/localStorage, tab URLs, scroll position, video time) is saved to the
//   database so a server restart or memory eviction can restore it.
// - Broadcasts live-view frames, cursor moves, steps and logs to subscribers.
// - The only automatic shutdowns are real resource limits (MAX_LIVE_SESSIONS / low memory);
//   evicted sessions are saved first and restore when you come back, and the UI is told why.
import type { Browser, BrowserContext, CDPSession, Cookie, Frame, Page } from "playwright";
import { randomUUID } from "node:crypto";
import { SCREEN, browserMode, browserProxy, desktopUserAgent, freeMemoryMB, getBrowser, isHeaded, isLowMemoryHost, releaseManagedBrowserSession, restartBrowser, selectBrowserbaseLivePage } from "./browser";
import { isGoogleHost } from "./google-gate";
import { TimeoutError, orTimeout, withTimeout } from "./timeouts";
import { isAdHost, isPrivateUrl } from "./safety";
import { json, newId, q, q1, toBuffer } from "@/lib/server/db";
import { INPUT_PROTOCOL_VERSION, type BrowserInput } from "@/lib/live-input";
import { createFramePublisher } from "./frame-publisher";

export type SessionStatus = "active" | "restoring" | "suspended" | "closed";

export interface TabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export type BusEvent =
  | { type: "reset"; epoch?: number }
  | { type: "status"; status: SessionStatus; tabs: TabInfo[]; takeover: boolean; live: LiveInfo; running: boolean; control: number; epoch: number; sessionId: string }
  | { type: "frame"; data: string; width: number; height: number; epoch?: number }
  | { type: "cursor"; x: number; y: number; kind: "move" | "click"; box?: { x: number; y: number; w: number; h: number } | null; width: number; height: number }
  | { type: "log"; text: string; level: "info" | "warn" | "error"; at: number }
  | { type: "plan"; steps: string[] }
  | { type: "step"; id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string; at: number; shotId?: string }
  | { type: "shot"; id: string; label: string; at: number }
  /** Sound from the active tab: Opus/WebM chunks of the playing media element (seq 0 starts a stream). */
  | { type: "audio"; id: string; seq?: number; data?: string; end?: boolean }
  /** The CSS cursor the page shows under your mouse (hand over links, I-beam over text). */
  | { type: "pointer"; cursor: string };

type AudioMessage = { id: string; seq?: number; data?: string; end?: boolean };

export interface LiveInfo {
  inputProtocol: number;
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

interface SavedSession {
  storage?: unknown;
  tabs?: SavedTab[];
  activeIndex?: number;
  browserbaseSessionId?: string;
}

// Managed browser plans often cap concurrent sessions. Keep one live chat session
// by default when any cloud provider is configured; paid users can raise the limit.
const HAS_MANAGED_BROWSER = !!(process.env.BROWSERBASE_API_KEY || process.env.BROWSERLESS_TOKEN || process.env.STEEL_API_KEY);
const MAX_LIVE = Math.max(1, Number(process.env.MAX_LIVE_SESSIONS || (HAS_MANAGED_BROWSER || isLowMemoryHost() ? 1 : 3)));
const LOW_MEMORY_MB = Number(process.env.LOW_MEMORY_MB || (isLowMemoryHost() ? 80 : 250));
// A ceiling, not a timer that delays every captured frame. Viewers advertise their
// display rate; Chrome remains change-driven. Small hosts retain a conservative cap.
// The small-host limits only matter when Chromium encodes frames on THIS machine. A cloud
// browser (Browserbase/Steel/Browserless) encodes them itself; this server just relays them.
const LOCAL_CHANNELS = new Set(["custom", "chrome", "msedge", "chromium", "chromium-headless-shell"]);
const encodesHere = () => { const c = browserMode()?.channel; return !c || LOCAL_CHANNELS.has(c); };
const smallHost = () => isLowMemoryHost() && encodesHere();
const FPS_CAP = () => Math.min(240, Math.max(1, Number(process.env.LIVE_FPS) || (smallHost() ? 30 : 120)));
const QUALITY = () => Math.min(95, Math.max(20, Number(process.env.LIVE_QUALITY || (smallHost() ? 50 : 60))));
// Live view size relative to the real screen. Smaller frames encode much faster on weak CPUs.
const SCALE = () => Math.min(1, Math.max(0.3, Number(process.env.LIVE_SCALE || (smallHost() ? 0.75 : 1))));
// Each tab is a renderer process. Past this many, the least recently used background tab closes.
const MAX_TABS = () => Math.max(2, Number(process.env.MAX_TABS_PER_SESSION || (isLowMemoryHost() ? 4 : 8)));
// The active tab is probed this often; this many failed probes in a row means it is frozen.
const HEALTH_INTERVAL_MS = () => Math.max(2000, Number(process.env.BROWSER_HEALTH_INTERVAL_MS || 10_000));
const HEALTH_PROBE_MS = 5000;
const HEALTH_STRIKES = 3;
// One input event (click, key, scroll) that takes longer than this means the tab's input
// pipeline is stuck, even if its scripts still run. The tab is replaced so the queue moves on.
const INPUT_STALL_MS = () => Math.max(3000, Number(process.env.BROWSER_INPUT_STALL_MS || 15_000));
// Google's anti-abuse and preference cookies (never login cookies) carry over to a new chat's
// fresh browser, so its first search doesn't look like a brand-new robot to Google.
const GOOGLE_TRUST_COOKIES = new Set(["NID", "AEC", "SOCS", "CONSENT", "GOOGLE_ABUSE_EXEMPTION", "__Secure-ENID", "1P_JAR"]);
const gJar = globalThis as unknown as { __googleJar?: Map<string, Cookie[]> };
const googleJar = (gJar.__googleJar ??= new Map());

function googleTrustCookies(storage: unknown): Cookie[] {
  const cookies = (storage as { cookies?: Cookie[] } | null)?.cookies;
  if (!Array.isArray(cookies)) return [];
  const now = Date.now() / 1000;
  return cookies.filter((c) => GOOGLE_TRUST_COOKIES.has(c.name) && isGoogleHost(c.domain.replace(/^\./, "")) && (c.expires === -1 || c.expires > now));
}

export function liveInfo(): LiveInfo {
  const m = browserMode();
  return {
    inputProtocol: INPUT_PROTOCOL_VERSION,
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

// Runs in every frame: records the sound of the playing, audible media element as
// Opus/WebM and hands it to the server (__senkoAudio), which forwards the active tab's
// sound to viewers. A headless browser has no speakers, so this is how video sound
// reaches you. Cross-origin media without CORS can't be captured (browser rule).
const AUDIO_SCRIPT = () => {
  type Rec = { el: HTMLMediaElement; rec: MediaRecorder; id: string };
  const w = window as unknown as { __senkoAudioHooked?: boolean; __senkoAudio?: (m: unknown) => void; __senkoAudioRestart?: () => void };
  if (w.__senkoAudioHooked || typeof MediaRecorder === "undefined") return;
  w.__senkoAudioHooked = true;
  const MIME = "audio/webm;codecs=opus";
  let current: Rec | null = null;
  const send = (m: unknown) => { try { void w.__senkoAudio?.(m); } catch { /* binding not ready */ } };
  const stop = () => {
    const c = current;
    if (!c) return;
    current = null;
    try { if (c.rec.state !== "inactive") c.rec.stop(); } catch { /* already stopped */ }
    send({ id: c.id, end: true });
  };
  const audible = (el: HTMLMediaElement) => !el.paused && !el.muted && el.volume > 0;
  const start = (el: HTMLMediaElement) => {
    if (current?.el === el || !audible(el) || !MediaRecorder.isTypeSupported(MIME)) return;
    let stream: MediaStream;
    try {
      stream = (el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
    } catch {
      return; // cross-origin media
    }
    const begin = () => {
      const tracks = stream.getAudioTracks();
      if (!tracks.length || current?.el === el) return !!tracks.length;
      stop();
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: MIME, audioBitsPerSecond: 128_000 });
      const id = Math.random().toString(36).slice(2, 10);
      let n = 0;
      rec.ondataavailable = async (e) => {
        if (!e.data.size) return;
        const seq = n++;
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        send({ id, seq, data: btoa(bin) });
      };
      rec.start(100);
      current = { el, rec, id };
      return true;
    };
    if (!begin()) stream.addEventListener("addtrack", () => void begin(), { once: true });
  };
  w.__senkoAudioRestart = () => {
    const el = current?.el;
    if (el) { stop(); start(el); }
  };
  const media = (e: Event) => (e.target instanceof HTMLMediaElement ? e.target : null);
  document.addEventListener("playing", (e) => { const el = media(e); if (el) start(el); }, true);
  document.addEventListener("volumechange", (e) => {
    const el = media(e);
    if (!el) return;
    if (audible(el)) start(el);
    else if (current?.el === el) stop();
  }, true);
  for (const type of ["pause", "ended", "emptied"]) {
    document.addEventListener(type, (e) => { if (current && media(e) === current.el) stop(); }, true);
  }
};

// Runs in every frame: reports the page's cursor under the mouse, so the live view can
// show the same pointer a local browser would.
const POINTER_SCRIPT = () => {
  const w = window as unknown as { __senkoPointerHooked?: boolean; __senkoCursor?: (c: string) => void };
  if (w.__senkoPointerHooked) return;
  w.__senkoPointerHooked = true;
  let last = "";
  document.addEventListener("mousemove", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    let c = getComputedStyle(el).cursor.split(",").pop()!.trim();
    if (c === "auto") {
      const editable = el.closest("input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]),textarea,[contenteditable=''],[contenteditable=true]");
      c = editable ? "text" : "default";
    }
    if (c !== last) {
      last = c;
      try { void w.__senkoCursor?.(c); } catch { /* binding not ready */ }
    }
  }, { capture: true, passive: true });
};

export class BrowserSession {
  readonly sessionId = randomUUID();
  readonly chatId: string;
  readonly ownerId: string;
  status: SessionStatus = "restoring";
  context!: BrowserContext;
  pages: Page[] = [];
  activeIndex = 0;
  // An idle browser belongs to the user, including restored sessions.
  takeover = true;
  running = false;
  private agentLease: AbortSignal | null = null;
  viewEpoch = 0;
  lastUsed = Date.now();
  private subs = new Set<(e: BusEvent) => void>();
  private viewerRates = new Map<(e: BusEvent) => void, number>();
  private cdp: CDPSession | null = null;
  private castPage: Page | null = null;
  private publisher: ReturnType<typeof createFramePublisher<Extract<BusEvent, { type: "frame" }>>> | null = null;
  private castGeneration = 0;
  private castTask: Promise<void> = Promise.resolve();
  private lastFrame: { data: string; width: number; height: number; epoch?: number } | null = null;
  private lastCursor: Extract<BusEvent, { type: "cursor" }> | null = null;
  private expectingTab = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private logs: Extract<BusEvent, { type: "log" }>[] = [];
  private inputTask: Promise<void> = Promise.resolve();
  private queuedInputs = 0;
  private controlGeneration = 0;
  private browserbaseSessionId?: string;
  get controlVersion() { return this.controlGeneration; }
  private heldButtons = new Map<"left" | "right" | "middle", Page>();
  private browser: Browser | null = null;
  private onBrowserGone: (() => void) | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthStrikes = 0;
  private healthChecking = false;
  /** Last known tab titles, used when a tab is too busy to answer. */
  private titles = new WeakMap<Page, string>();
  /** When each tab was last in front, to pick which background tab to close first. */
  private lastFront = new WeakMap<Page, number>();
  private recovering = new Set<Page>();
  /** Recent input events that timed out, per tab. */
  private inputStalls = new WeakMap<Page, number>();
  /** When each address last had to be recovered (to stop a crash loop). */
  private recoveries = new Map<string, number[]>();
  private persisting: Promise<void> | null = null;
  private persistAgain = false;
  /** Steps/plan of the current or last agent run, replayed to new subscribers. */
  replay: BusEvent[] = [];

  constructor(chatId: string, ownerId: string) {
    this.chatId = chatId;
    this.ownerId = ownerId;
  }

  // ---- lifecycle -------------------------------------------------------------

  async start(saved: SavedSession | null) {
    this.status = saved ? "restoring" : "active";
    this.emitStatus();
    const browser = await getBrowser(saved?.browserbaseSessionId);
    this.browserbaseSessionId = browserMode()?.channel === "Browserbase" ? browserMode()?.sessionId : undefined;
    // One listener per session, removed again when the session ends: the browser is shared
    // by every chat, so leftover listeners would keep every closed session in memory.
    this.browser = browser;
    this.onBrowserGone = () => this.browserLost();
    browser.on("disconnected", this.onBrowserGone);
    const reconnecting = !!saved?.browserbaseSessionId && browserMode()?.sessionId === saved.browserbaseSessionId;
    const existingContexts = reconnecting ? browser.contexts() : [];
    const matchingSavedUrls = new Set((saved?.tabs || []).map((tab) => tab.url));
    const existingContext = reconnecting
      ? existingContexts.find((context) => context.pages().some((page) => matchingSavedUrls.has(page.url()))) || existingContexts.find((context) => context.pages().length > 0)
      : undefined;
    const headed = isHeaded();
    this.context = existingContext || await browser.newContext({
      viewport: headed ? null : SCREEN,
      userAgent: desktopUserAgent(browser),
      locale: "en-US",
      colorScheme: "dark",
      acceptDownloads: false, // never download files
      proxy: browserProxy(),
      storageState: saved?.storage ? (saved.storage as never) : undefined,
    });
    if (!existingContext && !saved?.storage) await this.seedGoogleCookies();
    const remoteSessionId = this.browserbaseSessionId;
    if (remoteSessionId) {
      await q(
        `INSERT INTO browser_sessions (chat_id, owner_id, status, storage, tabs, updated_at)
         VALUES ($1, $2, 'restoring', $3, $4, now())
         ON CONFLICT (chat_id) DO UPDATE SET status = 'restoring', tabs = EXCLUDED.tabs, updated_at = now()`,
        [this.chatId, this.ownerId, saved?.storage ? JSON.stringify(saved.storage) : null, JSON.stringify({ tabs: saved?.tabs || [], activeIndex: saved?.activeIndex || 0, browserbaseSessionId: remoteSessionId })]
      );
    }
    if (reconnecting) {
      // Reattach to the existing cloud Chrome after a Wasmer worker restart.
      // Keep its live tabs instead of replaying stale URLs into a second context.
      this.pages = this.context.pages();
      for (const page of this.pages) this.adopt(page);
    }
    // Playwright waits 30s by default; a stuck click/press should fail fast so the agent moves on.
    // Page loads pass their own longer timeouts.
    this.context.setDefaultTimeout(10_000);
    if (reconnecting) await this.context.unrouteAll({ behavior: "wait" }).catch(() => {});
    await this.context.addInitScript(INIT_SCRIPT);
    await this.context
      .exposeBinding("__senkoAudio", (source, m: AudioMessage) => this.onAudio(source.page, source.frame, m))
      .catch(() => { /* already exposed on a reattached context */ });
    await this.context.addInitScript(AUDIO_SCRIPT);
    await this.context
      .exposeBinding("__senkoCursor", (source, cursor: string) => {
        if (source.page === this.pages[this.activeIndex] && typeof cursor === "string" && cursor.length < 40) this.emit({ type: "pointer", cursor });
      })
      .catch(() => {});
    await this.context.addInitScript(POINTER_SCRIPT);
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
    if (reconnecting && this.pages.length) {
      this.activeIndex = Math.min(saved?.activeIndex ?? 0, this.pages.length - 1);
      await this.front(this.pages[this.activeIndex]);
    } else if (tabs.length) {
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
      await this.front(this.pages[this.activeIndex]);
    } else {
      await this.newTabInternal();
    }
    this.status = "active";
    await selectBrowserbaseLivePage(this.active().url());
    await this.persist();
    this.saveTimer = setInterval(() => void this.persist().catch(() => {}), 60_000);
    this.saveTimer.unref?.();
    this.healthTimer = setInterval(() => void this.checkHealth(), HEALTH_INTERVAL_MS());
    this.healthTimer.unref?.();
    this.emitStatus();
    if (this.subs.size) await this.startCast();
  }

  /** A new chat starts with the owner's Google trust cookies (from a live session, or the newest saved one). */
  private async seedGoogleCookies() {
    let cookies = googleJar.get(this.ownerId);
    if (!cookies) {
      const row = await q1<{ storage: unknown }>(
        "SELECT storage FROM browser_sessions WHERE owner_id = $1 AND storage IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
        [this.ownerId]
      ).catch(() => null);
      cookies = googleTrustCookies(json(row?.storage, null));
    }
    if (cookies.length) await this.context.addCookies(cookies).catch(() => {});
  }

  /** The shared browser went away (crashed, restarted, provider timeout). Stop all background work. */
  private browserLost() {
    if (this.status === "closed" || this.status === "suspended") return;
    this.status = "suspended";
    this.stopTimers();
    this.detachBrowser();
    this.publisher?.dispose();
    this.publisher = null;
    this.cdp = null;
    this.castPage = null;
    this.emitStatus();
    // Tab URLs are still known locally; cookies keep their last saved copy (see persistOnce()).
    void this.persist().catch(() => {});
  }

  private stopTimers() {
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.persistSoon) clearTimeout(this.persistSoon);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.saveTimer = null;
    this.persistSoon = null;
    this.healthTimer = null;
  }

  private detachBrowser() {
    if (this.browser && this.onBrowserGone) this.browser.off("disconnected", this.onBrowserGone);
    this.onBrowserGone = null;
    this.browser = null;
  }

  /** Bring a tab to the front without ever waiting on a frozen one. */
  private async front(p: Page | undefined) {
    if (p) await withTimeout(p.bringToFront(), 5000, undefined);
  }

  /** Stop background work without touching the browser (the session is being forgotten). */
  release() {
    this.stopTimers();
    this.detachBrowser();
  }

  // ---- health: frozen and crashed tabs -------------------------------------------------

  /** Number of live viewers (someone who could solve a robot check). */
  viewerCount() {
    return this.subs.size;
  }

  /**
   * Does the tab's page still run script? A hung renderer never answers, so only silence (or a
   * crash) counts. An error such as "execution context was destroyed" just means the page is
   * navigating, which is alive.
   */
  async responsive(p: Page, ms = HEALTH_PROBE_MS): Promise<boolean> {
    if (p.isClosed()) return false;
    return withTimeout(
      p.evaluate(() => 1).then(
        () => true,
        (e) => !p.isClosed() && !/crash/i.test(String(e))
      ),
      ms,
      false
    );
  }

  /** Periodic check of the active tab, plus memory upkeep. Read-only unless something is wrong. */
  async checkHealth() {
    if (this.status !== "active" || this.healthChecking) return;
    this.healthChecking = true;
    try {
      const p = this.pages[this.activeIndex];
      if (p && !this.recovering.has(p)) {
        if (await this.responsive(p)) this.healthStrikes = 0;
        else if (++this.healthStrikes >= HEALTH_STRIKES) {
          this.healthStrikes = 0;
          await this.recoverPage(p, "stopped responding");
        }
      }
      // Low on memory: close the least recently used background tab (one per check).
      if (this.pages.length > 1 && freeMemoryMB() < LOW_MEMORY_MB) {
        await this.closeOldestBackgroundTab("the server is low on memory");
      }
    } finally {
      this.healthChecking = false;
    }
  }

  /**
   * Replace a crashed or frozen tab with a fresh one at the same address and position. Anything
   * still waiting on the old tab fails right away instead of hanging, so a running task moves on.
   * If even a new tab can't be opened, the whole browser is restarted (the session restores).
   */
  async recoverPage(p: Page, why: string) {
    if (this.recovering.has(p) || this.status !== "active" || !this.pages.includes(p)) return;
    this.recovering.add(p);
    try {
      const url = p.url();
      const slot = this.pages.indexOf(p);
      const front = this.pages[this.activeIndex];
      this.log(`A tab${hostOf(url) ? ` (${hostOf(url)})` : ""} ${why}; reopening it.`, "warn");
      const fresh = await withTimeout(this.newTabInternal(), 15_000, null);
      if (!fresh) {
        this.log("The browser itself stopped responding; restarting it. Your tabs will be restored.", "warn");
        await this.restartBrowser(why);
        return;
      }
      await withTimeout(p.close({ runBeforeUnload: false }), 5000, undefined);
      // A tab that won't even close is dropped from the list; the browser reclaims it later.
      const stale = this.pages.indexOf(p);
      if (stale !== -1) this.pages.splice(stale, 1);
      const at = this.pages.indexOf(fresh);
      if (at !== -1 && slot !== -1) {
        this.pages.splice(at, 1);
        this.pages.splice(Math.min(slot, this.pages.length), 0, fresh);
      }
      this.activeIndex = Math.max(0, this.pages.indexOf(front === p || !this.pages.includes(front) ? fresh : front));
      // A page that keeps crashing or freezing the tab isn't reopened again and again.
      const now = Date.now();
      const recent = (this.recoveries.get(url) || []).filter((t) => now - t < 120_000);
      recent.push(now);
      this.recoveries.set(url, recent);
      if (this.recoveries.size > 50) this.recoveries.delete(this.recoveries.keys().next().value as string);
      if (recent.length > 2) {
        this.log(`${hostOf(url) || "That page"} keeps breaking the tab, so it was left closed. Open it again to retry.`, "warn");
      } else if (/^https?:/i.test(url)) {
        void fresh.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => this.log(`Couldn't reopen ${url}: ${String(e).split("\n")[0]}`, "warn"));
      }
      if (this.pages[this.activeIndex] === fresh) {
        await withTimeout(fresh.bringToFront(), 5000, undefined);
        this.resetView();
        await this.startCast();
      }
      this.emitStatus();
      this.schedulePersist();
    } finally {
      this.recovering.delete(p);
    }
  }

  /**
   * Replace `p` if the work about to run on it hasn't finished within `ms`. Closing the stuck
   * tab makes every pending call on it fail at once, so nothing waits on it forever.
   * Returns a function that cancels the watch when the work completes.
   */
  watchStall(p: Page | undefined, why: string, ms: number): () => void {
    if (!p) return () => {};
    const timer = setTimeout(() => void this.recoverPage(p, why), ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  }

  /** Throw away a browser that no longer answers at all; this session restores on next use. */
  private async restartBrowser(why: string) {
    const browser = this.browser;
    this.browserLost();
    if (browser) await restartBrowser(`a tab ${why} and no new tab could be opened`);
  }

  /** Close the background tab that has been out of sight the longest. */
  private async closeOldestBackgroundTab(why: string) {
    const front = this.pages[this.activeIndex];
    const victim = this.pages
      .filter((t) => t !== front && !this.recovering.has(t))
      .sort((a, b) => (this.lastFront.get(a) ?? 0) - (this.lastFront.get(b) ?? 0))[0];
    if (!victim) return;
    this.log(`Closed a background tab${hostOf(victim.url()) ? ` (${hostOf(victim.url())})` : ""} because ${why}.`);
    await withTimeout(victim.close({ runBeforeUnload: false }), 5000, undefined);
    const i = this.pages.indexOf(victim);
    if (i !== -1) this.pages.splice(i, 1);
    this.activeIndex = Math.max(0, this.pages.indexOf(front));
    this.emitStatus();
  }

  /** Keep the tab count under MAX_TABS (each tab is a whole renderer process). */
  private async enforceTabLimit() {
    for (let guard = 0; this.pages.length > MAX_TABS() && guard < 20; guard++) {
      await this.closeOldestBackgroundTab(`more than ${MAX_TABS()} tabs were open (MAX_TABS_PER_SESSION)`);
    }
  }

  private async newTabInternal(): Promise<Page> {
    this.expectingTab = true;
    const p = await this.context.newPage();
    this.expectingTab = false;
    if (!this.pages.includes(p)) this.adopt(p);
    this.activeIndex = this.pages.indexOf(p);
    this.lastFront.set(p, Date.now());
    void this.enforceTabLimit();
    return p;
  }

  private adopt(p: Page) {
    this.pages.push(p);
    if (this.viewportOverride) void p.setViewportSize(this.viewportOverride).catch(() => {});
    p.on("close", () => {
      const i = this.pages.indexOf(p);
      if (i === -1) return;
      this.pages.splice(i, 1);
      if (this.activeIndex >= this.pages.length) this.activeIndex = Math.max(0, this.pages.length - 1);
      if (this.castPage === p) void this.startCast();
      this.emitStatus();
    });
    // A crashed renderer never recovers by itself; every call into it would fail or hang.
    p.on("crash", () => {
      this.log(`A tab${hostOf(p.url()) ? ` (${hostOf(p.url())})` : ""} crashed.`, "warn");
      void this.recoverPage(p, "crashed");
    });
    p.on("domcontentloaded", () => {
      void withTimeout(p.title(), 2000, "").then((t) => { if (t) this.titles.set(p, t); });
    });
    p.on("framenavigated", (f) => {
      if (f !== p.mainFrame()) return;
      if (this.pages[this.activeIndex] === p) this.resetView();
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
      this.lastFront.set(p, Date.now());
      void this.enforceTabLimit();
      await this.startCast();
      this.emitStatus();
      return;
    }
    await p.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    this.log(`Closed an unexpected pop-up${p.url() && p.url() !== "about:blank" ? ` (${hostOf(p.url())})` : ""}`);
    await p.close().catch(() => {});
  }

  async close(reason: "closed" | "suspended" = "closed") {
    this.stopTimers();
    this.detachBrowser();
    this.controlGeneration++;
    if (reason === "suspended") await this.persist().catch(() => {});
    this.status = reason;
    this.emitStatus();
    await withTimeout(this.stopCast(), 5000, undefined);
    // A context with a hung tab can take a long time to close; don't hold the caller.
    if (this.context) await withTimeout(this.context.close(), 15_000, undefined);
    if (reason === "closed") {
      await releaseManagedBrowserSession(this.browserbaseSessionId);
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
    // A busy or frozen tab must not hold up the status of every other tab.
    return Promise.all(
      this.pages.map(async (p, i) => {
        const title = await withTimeout(p.title(), 1500, "");
        if (title) this.titles.set(p, title);
        return {
          index: i,
          title: title || this.titles.get(p) || hostOf(p.url()) || "New tab",
          url: p.url(),
          active: i === this.activeIndex,
        };
      })
    );
  }

  async openTab(url?: string): Promise<Page> {
    const p = await this.newTabInternal();
    if (url) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await this.front(p);
    await selectBrowserbaseLivePage(p.url());
    await this.startCast();
    this.emitStatus();
    return p;
  }

  async switchTab(index: number) {
    if (index < 0 || index >= this.pages.length) throw new Error(`There is no tab ${index + 1} (${this.pages.length} open).`);
    this.activeIndex = index;
    this.lastFront.set(this.pages[index], Date.now());
    await this.front(this.active());
    await selectBrowserbaseLivePage(this.active().url());
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

  /** Save cookies and tabs. Concurrent calls share one save (plus one follow-up), never pile up. */
  persist(): Promise<void> {
    if (this.persisting) {
      this.persistAgain = true;
      return this.persisting;
    }
    const run = (async () => {
      try {
        do {
          this.persistAgain = false;
          await this.persistOnce();
        } while (this.persistAgain);
      } finally {
        this.persisting = null;
      }
    })();
    this.persisting = run;
    return run;
  }

  private async persistOnce() {
    if (!this.context || this.status === "closed") return;
    // Every browser call is bounded: a frozen tab must not stall saving the others.
    const storage = await withTimeout(this.context.storageState(), 8000, null);
    const trust = googleTrustCookies(storage);
    if (trust.length) googleJar.set(this.ownerId, trust);
    const tabs: SavedTab[] = await Promise.all(
      this.pages.map(async (p) => {
        const [info, title] = await Promise.all([
          withTimeout(
            p.evaluate(() => {
              const v = document.querySelector("video");
              return { scrollY: window.scrollY, videoTime: v ? v.currentTime : 0 };
            }),
            2000,
            { scrollY: 0, videoTime: 0 }
          ),
          withTimeout(p.title(), 1500, ""),
        ]);
        return { url: p.url(), title: title || this.titles.get(p) || "", ...info };
      })
    );
    // A failed cookie read keeps the last saved cookies instead of wiping your logins.
    await q(
      `INSERT INTO browser_sessions (chat_id, owner_id, status, storage, tabs, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (chat_id) DO UPDATE SET status = EXCLUDED.status, storage = COALESCE(EXCLUDED.storage, browser_sessions.storage), tabs = EXCLUDED.tabs, updated_at = now()`,
      [this.chatId, this.ownerId, this.status === "restoring" ? "active" : this.status, storage ? JSON.stringify(storage) : null, JSON.stringify({ tabs, activeIndex: this.activeIndex, browserbaseSessionId: this.browserbaseSessionId })]
    );
  }

  // ---- events / live view ----------------------------------------------------------

  subscribe(fn: (e: BusEvent) => void, refreshRate = FPS_CAP()): () => void {
    this.subs.add(fn);
    this.viewerRates.set(fn, Math.min(FPS_CAP(), Math.max(1, Number.isFinite(refreshRate) ? refreshRate : FPS_CAP())));
    void this.tabs().then((tabs) => { if (this.subs.has(fn)) fn({ type: "status", status: this.status, tabs, takeover: this.takeover, live: liveInfo(), running: this.running, control: this.controlVersion, epoch: this.viewEpoch, sessionId: this.sessionId }); });
    for (const l of this.logs.slice(-20)) fn(l);
    for (const e of this.replay) fn(e);
    if (this.lastFrame) fn({ type: "frame", ...this.lastFrame });
    // Show the agent's cursor where it was last, so it never "disappears" on reconnect.
    if (this.lastCursor) fn(this.lastCursor);
    if (this.status === "active") void this.startCast();
    // A new viewer needs the stream header, so playing media restarts its recording.
    if (this.audio) this.restartAudio();
    return () => {
      this.subs.delete(fn);
      this.viewerRates.delete(fn);
      if (!this.subs.size) { void this.stopCast(); void this.releaseButtons(); }
    };
  }

  emit(e: BusEvent) {
    if (e.type === "plan" || e.type === "step" || e.type === "shot") {
      // Replay current step state, not every running/done transition forever.
      // Full task history and screenshots remain in their persisted records.
      const previous = e.type === "step" ? this.replay.findIndex(p => p.type === "step" && p.id === e.id)
        : e.type === "plan" ? this.replay.findIndex(p => p.type === "plan") : -1;
      if (previous >= 0) this.replay[previous] = e;
      else this.replay.push(e);
      if (this.replay.length > 256) this.replay.splice(this.replay[0].type === "plan" ? 1 : 0, this.replay.length - 256);
    }
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
      this.emit({ type: "status", status: this.status, tabs, takeover: this.takeover, live: liveInfo(), running: this.running, control: this.controlVersion, epoch: this.viewEpoch, sessionId: this.sessionId })
    );
  }

  // ---- sound ------------------------------------------------------------------------------

  private audio: { id: string; frame: Frame } | null = null;

  private onAudio(page: Page, frame: Frame, m: AudioMessage) {
    if (!m || typeof m.id !== "string") return;
    if (m.end) {
      if (this.audio?.id === m.id) {
        this.audio = null;
        this.emit({ type: "audio", id: m.id, end: true });
      }
      return;
    }
    if (page !== this.pages[this.activeIndex] || typeof m.data !== "string" || !this.subs.size) return;
    if (m.seq === 0) this.audio = { id: m.id, frame };
    if (this.audio?.id !== m.id) return;
    this.emit({ type: "audio", id: m.id, seq: m.seq, data: m.data });
  }

  /** Start the sound stream over (a fresh header), e.g. for a viewer that just joined or a tab switch. */
  private restartAudio(page = this.pages[this.activeIndex]) {
    if (!page) return;
    if (this.audio) {
      this.emit({ type: "audio", id: this.audio.id, end: true });
      this.audio = null;
    }
    // Sound is optional: it must never interrupt the picture or input.
    try {
      for (const frame of page.frames()) {
        void frame.evaluate(() => (window as unknown as { __senkoAudioRestart?: () => void }).__senkoAudioRestart?.()).catch(() => {});
      }
    } catch { /* page closing */ }
  }

  /** Coordinates queued for the previous document must never reach the next one. */
  private resetView() {
    this.controlGeneration++;
    this.lastFrame = null;
    this.lastCursor = null;
    this.publisher?.reset();
    void this.releaseButtons();
    this.emit({ type: "reset", epoch: ++this.viewEpoch });
  }

  private viewportOverride: { width: number; height: number } | null = null;

  /** Size the real page to the viewer's panel, so sites lay out for the space you see. */
  async setViewport(width: number, height: number) {
    if (isHeaded()) return; // a headed browser is sized by its window
    const size = { width: Math.round(Math.min(2560, Math.max(320, width))), height: Math.round(Math.min(1600, Math.max(240, height))) };
    const cur = this.viewportOverride;
    if (cur && cur.width === size.width && cur.height === size.height) return;
    this.viewportOverride = size;
    await Promise.all(this.pages.map((p) => p.setViewportSize(size).catch(() => {})));
  }

  /** Viewport size of the active page in CSS pixels. */
  viewport() {
    return this.pages[this.activeIndex]?.viewportSize() || SCREEN;
  }

  async startCast() {
    const p = this.pages[this.activeIndex];
    if (!p || !this.subs.size) return;
    // Always stream the active tab ourselves, including on managed browsers: an embedded
    // provider debugger page shows its own chrome and tab picker, not this tab or the cursor.
    if (this.castPage === p && this.cdp) return;
    const generation = ++this.castGeneration;
    const task = this.castTask.catch(() => {}).then(async () => {
      if (generation !== this.castGeneration) return;
      await this.detachCast();
      if (generation !== this.castGeneration || !this.subs.size) return;
      await this.openCast(p, generation);
    });
    this.castTask = task;
    await task;
  }

  private async openCast(p: Page, generation: number) {
    let cdp: CDPSession | null = null;
    try {
      // Bounded: the cast steps run in a chain, so one hung step would freeze every later
      // tab switch and viewer change.
      cdp = await orTimeout(this.context.newCDPSession(p), 10_000, "starting the live view");
      if (generation !== this.castGeneration || !this.subs.size) { await withTimeout(cdp.detach(), 3000, undefined); return; }
      this.castPage = p;
      this.cdp = cdp;
      this.lastFrame = null;
      this.lastCursor = null;
      await this.releaseButtons();
      if (generation !== this.castGeneration || !this.subs.size) { await this.detachCast(); return; }
      const epoch = ++this.viewEpoch;
      this.emit({ type: "reset", epoch });
      // The sound follows the tab you're looking at.
      this.restartAudio(p);
      const cast = cdp;
      const publisher = createFramePublisher<Extract<BusEvent, { type: "frame" }>>(frame => {
        if (this.cdp !== cast || frame.epoch !== this.viewEpoch) return;
        this.lastFrame = { data: frame.data, width: frame.width, height: frame.height, epoch: frame.epoch };
        this.emit(frame);
      }, () => Math.max(1, ...this.viewerRates.values()));
      this.publisher = publisher;
      cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
        // Acknowledge immediately: delaying an ACK stalls Chrome's capture pipeline.
        void cast.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
        if (this.cdp !== cast) return;
        publisher.push({ type: "frame", data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight, epoch: this.viewEpoch });
      });
      await orTimeout(cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: QUALITY(),
        // A ceiling, not a fixed size: frames match the page, which follows the panel.
        maxWidth: Math.round(Math.max(SCREEN.width, 2560) * SCALE()),
        maxHeight: Math.round(Math.max(SCREEN.height, 1600) * SCALE()),
        everyNthFrame: 1,
      }), 10_000, "starting the live view");
    } catch {
      if (this.cdp === cdp) { this.publisher?.dispose(); this.publisher = null; this.cdp = null; this.castPage = null; }
      if (cdp) await withTimeout(cdp.detach(), 3000, undefined);
    }
  }

  async stopCast() {
    const generation = ++this.castGeneration;
    await this.castTask.catch(() => {});
    if (generation === this.castGeneration) await this.detachCast();
  }

  private async detachCast() {
    this.publisher?.dispose();
    this.publisher = null;
    const c = this.cdp;
    this.cdp = null;
    this.castPage = null;
    if (c) {
      await withTimeout(c.send("Page.stopScreencast"), 3000, undefined);
      await withTimeout(c.detach(), 3000, undefined);
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
    const text = await withTimeout(
      p.evaluate(() => (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 5000)),
      10_000,
      ""
    );
    const tabs = (await this.tabs()).map((t) => `${t.index + 1}. ${t.title}${t.active ? " (active)" : ""}`).join(" | ");
    const screenshot = withScreenshot ? (await this.screenshot(60).catch(() => null))?.toString("base64") : undefined;
    return { url: p.url(), title: await withTimeout(p.title(), 1500, this.titles.get(p) || ""), text, tabs, screenshot };
  }

  // ---- user takeover input -----------------------------------------------------------------

  setTakeover(on: boolean, resetInput = false) {
    if (this.takeover === on && !resetInput) return;
    this.controlGeneration++;
    this.takeover = on;
    // Release a drag before handing control to the agent, even if the viewer vanished.
    if (!on || resetInput) void this.releaseButtons();
    this.log(on ? "You took control of the browser." : "Control handed back to the agent.");
    this.emitStatus();
  }

  /** Fence cleanup from an older/replaced run; it must never unlock a newer run. */
  beginAgent(signal: AbortSignal) {
    this.agentLease = signal;
    this.running = true;
    this.setTakeover(false);
    this.emitStatus();
  }

  endAgent(signal: AbortSignal) {
    if (this.agentLease !== signal) return;
    this.agentLease = null;
    this.running = false;
    this.setTakeover(true);
    this.emitStatus();
  }

  /** Serialize all viewers' batches at the browser, not just in each client's queue. */
  input(ev: InputEvent) { return this.inputBatch([ev]); }

  inputBatch(events: InputEvent[], expectedEpoch = this.viewEpoch, expectedControl = this.controlVersion) {
    if (this.queuedInputs + events.length > 512) return Promise.reject(new Error("Browser input queue is full."));
    this.queuedInputs += events.length;
    const generation = expectedControl;
    const page = this.pages[this.activeIndex];
    const task = this.inputTask.catch(() => {}).then(async () => {
      try {
        for (const event of events) {
          if (!this.takeover || generation !== this.controlGeneration || this.status !== "active" || page !== this.pages[this.activeIndex] || expectedEpoch !== this.viewEpoch) {
            throw new BrowserInputConflict("STALE_VIEW", "The browser view or ownership changed before this input was applied.", this.viewEpoch, this.controlVersion);
          }
          // A stuck event must never hold the queue: give up on it after INPUT_STALL_MS and
          // replace the tab (which also fails anything else still waiting on it).
          const work = this.applyInput(event);
          work.catch(() => {});
          try {
            await orTimeout(work, INPUT_STALL_MS(), "applying your input");
            this.inputStalls.delete(page);
          } catch (e) {
            if (e instanceof TimeoutError) {
              // First stall on a page whose scripts still run: drop just that event and keep
              // the page (and anything typed into it). A repeat, or a page that no longer
              // answers at all, gets a fresh tab.
              const strikes = (this.inputStalls.get(page) ?? 0) + 1;
              this.inputStalls.set(page, strikes);
              if (strikes < 2 && (await this.responsive(page, 3000))) {
                this.log("The page was slow to react to your input; skipped that one action.", "warn");
                throw new Error("The page was too slow to react, so that action was skipped. Try again.");
              }
              void this.recoverPage(page, "stopped reacting to input");
              throw new Error("The page stopped reacting to input, so its tab was reopened. Try again.");
            }
            throw e;
          }
        }
      } finally {
        this.queuedInputs -= events.length;
        if (generation !== this.controlGeneration || page !== this.pages[this.activeIndex] || expectedEpoch !== this.viewEpoch) await this.releaseButtons();
      }
    });
    this.inputTask = task;
    return task;
  }

  private async releaseButtons() {
    const held = [...this.heldButtons];
    this.heldButtons.clear();
    for (const [button, page] of held) await page.mouse.up({ button }).catch(() => {});
  }

  private async applyInput(ev: InputEvent) {
    this.lastUsed = Date.now();
    const p = this.active();
    switch (ev.type) {
      case "click":
        await p.mouse.click(ev.x, ev.y, { button: ev.button || "left", clickCount: ev.double ? 2 : 1 });
        break;
      case "move":
        await p.mouse.move(ev.x, ev.y);
        break;
      case "down":
      case "up": {
        await p.mouse.move(ev.x, ev.y);
        if (ev.type === "down") {
          this.heldButtons.set(ev.button, p);
          await p.mouse.down({ button: ev.button, clickCount: ev.clickCount || 1 });
        } else {
          await p.mouse.up({ button: ev.button, clickCount: ev.clickCount || 1 });
          this.heldButtons.delete(ev.button);
        }
        break;
      }
      case "wheel": {
        if (ev.x !== undefined && ev.y !== undefined) await p.mouse.move(ev.x, ev.y);
        await p.mouse.wheel(ev.dx || 0, ev.dy || 0);
        break;
      }
      case "key":
        await p.keyboard.press(ev.key);
        break;
      case "text":
        await p.keyboard.insertText(ev.text);
        break;
      case "nav":
        // Navigation starts now, but DNS/network/load completion must not hold the
        // input queue hostage. The user can scroll, type or supersede it immediately.
        if (ev.action === "back") void p.goBack({ waitUntil: "commit", timeout: 15_000 }).catch(() => {});
        if (ev.action === "forward") void p.goForward({ waitUntil: "commit", timeout: 15_000 }).catch(() => {});
        if (ev.action === "reload") void p.reload({ waitUntil: "commit", timeout: 30_000 }).catch(() => {});
        break;
      case "goto": {
        const url = /^https?:\/\//i.test(ev.url) ? ev.url : `https://${ev.url}`;
        void p.goto(url, { waitUntil: "commit", timeout: 45_000 }).catch(e => {
          if (!String(e).includes("ERR_ABORTED")) this.log(`Navigation failed: ${String(e).split("\n")[0]}`, "warn");
        });
        break;
      }
    }
  }

}

export type InputEvent = BrowserInput;

export class BrowserInputConflict extends Error {
  constructor(public code: "STALE_VIEW", message: string, public epoch: number, public control?: number) { super(message); }
}

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
    const saved = json<SavedSession>(row.tabs, {});
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
          ? { storage: json(row.storage, null), ...json<SavedSession>(row.tabs, {}) }
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
    const lowMem = () => freeMemoryMB() < LOW_MEMORY_MB;
    while (this.live.size >= MAX_LIVE || (lowMem() && this.live.size > 0)) {
      const victims = [...this.live.values()].filter((s) => s.chatId !== forChat && !s.running).sort((a, b) => a.lastUsed - b.lastUsed);
      const v = victims[0];
      if (!v) break;
      const why = lowMem()
        ? `the server is low on memory (${freeMemoryMB()} MB free)`
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
    s.release();
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
