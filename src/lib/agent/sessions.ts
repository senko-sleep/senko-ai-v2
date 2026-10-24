// Persistent browser sessions: one isolated browser context per chat.
//
// - Stays open between messages (tabs, page, video, cookies, logins all stay alive).
// - State (cookies/localStorage, tab URLs, scroll position, video time) is saved to the
//   database so a server restart or memory eviction can restore it.
// - Broadcasts live-view frames, cursor moves, steps and logs to subscribers.
// - The only automatic shutdowns are real resource limits (MAX_LIVE_SESSIONS / low memory);
//   evicted sessions are saved first and restore when you come back, and the UI is told why.
import type { BrowserContext, CDPSession, Frame, Page } from "playwright";
import { randomUUID } from "node:crypto";
import { SCREEN, browserMode, browserProxy, desktopUserAgent, freeMemoryMB, getBrowser, isHeaded, isLowMemoryHost, releaseManagedBrowserSession, selectBrowserbaseLivePage } from "./browser";
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
    browser.on("disconnected", () => {
      if (this.status === "closed" || this.status === "suspended") return;
      this.status = "suspended";
      this.emitStatus();
      void this.persist().catch(() => {});
    });
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
      await this.pages[this.activeIndex]?.bringToFront().catch(() => {});
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
      await this.pages[this.activeIndex]?.bringToFront().catch(() => {});
    } else {
      await this.newTabInternal();
    }
    this.status = "active";
    await selectBrowserbaseLivePage(this.active().url());
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
    if (this.viewportOverride) void p.setViewportSize(this.viewportOverride).catch(() => {});
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
    if (this.persistSoon) clearTimeout(this.persistSoon);
    this.controlGeneration++;
    if (reason === "suspended") await this.persist().catch(() => {});
    this.status = reason;
    this.emitStatus();
    await this.stopCast();
    await this.context?.close().catch(() => {});
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
    await selectBrowserbaseLivePage(p.url());
    await this.startCast();
    this.emitStatus();
    return p;
  }

  async switchTab(index: number) {
    if (index < 0 || index >= this.pages.length) throw new Error(`There is no tab ${index + 1} (${this.pages.length} open).`);
    this.activeIndex = index;
    await this.active().bringToFront().catch(() => {});
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
      cdp = await this.context.newCDPSession(p);
      if (generation !== this.castGeneration || !this.subs.size) { await cdp.detach().catch(() => {}); return; }
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
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: QUALITY(),
        // A ceiling, not a fixed size: frames match the page, which follows the panel.
        maxWidth: Math.round(Math.max(SCREEN.width, 2560) * SCALE()),
        maxHeight: Math.round(Math.max(SCREEN.height, 1600) * SCALE()),
        everyNthFrame: 1,
      });
    } catch {
      if (this.cdp === cdp) { this.publisher?.dispose(); this.publisher = null; this.cdp = null; this.castPage = null; }
      await cdp?.detach().catch(() => {});
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
          await this.applyInput(event);
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
