// One shared browser process for the whole server; each chat session gets its own
// isolated context (cookies, storage, tabs).
//
// On the server (Docker): real Google Chrome, headed, on the Xvfb virtual display
// (DISPLAY is set), so H.264/AAC video plays and the screen can be streamed over VNC.
// Locally (no DISPLAY): headless, preferring a full browser (Chrome/Edge) because the
// stripped "headless shell" is blocked by sites like Crunchyroll.
import fs from "node:fs";
import os from "node:os";
import type { Browser } from "playwright";

function readNum(file: string): number | null {
  try {
    const v = fs.readFileSync(file, "utf8").trim();
    const n = Number(v);
    return v && v !== "max" && Number.isFinite(n) && n > 0 && n < 2 ** 50 ? n : null;
  } catch {
    return null;
  }
}

/** Memory limit of this container in MB (cgroup), or the machine's RAM outside containers. */
export function memoryLimitMB(): number {
  const limit = readNum("/sys/fs/cgroup/memory.max") ?? readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const total = os.totalmem();
  return Math.round(Math.min(limit ?? total, total) / 1024 / 1024);
}

/** Free memory in MB, container-aware (os.freemem() reports the whole host inside Docker). */
export function freeMemoryMB(): number {
  const limit = readNum("/sys/fs/cgroup/memory.max") ?? readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const used = readNum("/sys/fs/cgroup/memory.current") ?? readNum("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  if (limit && used && limit < os.totalmem()) return Math.round((limit - used) / 1024 / 1024);
  return Math.round(os.freemem() / 1024 / 1024);
}

/** Small hosts: run a local Chrome as lean as possible. */
export function isLowMemoryHost(): boolean {
  return process.env.LOW_MEMORY_MODE === "1" || (process.env.LOW_MEMORY_MODE !== "0" && memoryLimitMB() < 1536);
}

const g = globalThis as unknown as {
  __agentBrowser?: Promise<Browser>;
  __agentBrowserMode?: BrowserMode;
  __remoteKeepalive?: ReturnType<typeof setInterval>;
  __browserbaseLiveViewUrl?: string;
  __browserbaseSessionId?: string;
  __browserbaseReconnectSessionId?: string;
  __browserbaseLivePageId?: string;
  __wasiPlatform?: boolean;
};
let steelSessionIdFromBrowser: string | null = null;

export interface BrowserMode {
  headed: boolean;
  channel: string;
  liveViewUrl?: string;
  sessionId?: string;
}

export const SCREEN = {
  width: Number(process.env.SCREEN_WIDTH || 1280),
  height: Number(process.env.SCREEN_HEIGHT || 800),
};

export function isHeaded(): boolean {
  return process.platform === "linux" && !!process.env.DISPLAY && process.env.BROWSER_HEADLESS !== "1";
}

/** Clear the shared browser slot if it still holds `b`. True when it did (or the slot was empty). */
async function forgetBrowser(b: Browser): Promise<boolean> {
  const slot = g.__agentBrowser;
  if (!slot) return true;
  const current = await slot.catch(() => null);
  if (current !== b && current !== null) return false;
  if (g.__agentBrowser === slot) g.__agentBrowser = undefined;
  return true;
}

function markRemoteBrowser(b: Browser, provider: string, onDisconnect?: () => void) {
  g.__agentBrowserMode = {
    headed: false,
    channel: provider,
    liveViewUrl: provider === "Browserbase" ? g.__browserbaseLiveViewUrl : undefined,
    sessionId: provider === "Browserbase" ? g.__browserbaseSessionId : undefined,
  };
  console.log(`[browser] connected to ${provider} Chromium v${b.version()}`);
  // Remote browser providers close CDP sessions that sit completely idle. A
  // single lightweight command every four minutes preserves the user's open tab.
  // The timer belongs to this browser, so a replaced browser's timer always stops.
  const keepalive = setInterval(() => {
    try {
      const page = b.contexts().flatMap((context) => context.pages()).find((p) => !p.isClosed());
      if (page) void page.evaluate(() => undefined).catch(() => {});
    } catch {
      /* the connection is already gone */
    }
  }, 4 * 60_000);
  keepalive.unref?.();
  g.__remoteKeepalive = keepalive;
  b.on("disconnected", async () => {
    clearInterval(keepalive);
    if (g.__remoteKeepalive === keepalive) g.__remoteKeepalive = undefined;
    // Release the provider session even when a replacement browser is already running.
    void onDisconnect?.();
    // A replacement may already be starting (restartBrowser): leave its state alone.
    if (!(await forgetBrowser(b))) return;
    g.__browserbaseLiveViewUrl = undefined;
    g.__browserbaseSessionId = undefined;
    g.__browserbaseLivePageId = undefined;
    g.__agentBrowserMode = undefined;
  });
}

/**
 * Where the cloud browser runs, from AGENT_HOST_REGION (a Vercel-style code such as sfo1, the
 * region the user chose so sites under state age-verification laws don't geoblock it).
 * BROWSER_REGION overrides with a provider's own region name.
 */
function managedRegion(provider: "browserbase" | "steel"): string | undefined {
  const own = process.env.BROWSER_REGION?.trim();
  if (own) return own;
  const code = (process.env.AGENT_HOST_REGION || "").trim().toLowerCase();
  if (!code) return undefined;
  const area = /^(sfo|pdx|sea|lax)/.test(code) ? "west" : /^(iad|cle|bos|ewr)/.test(code) ? "east" : /^(fra|cdg|lhr|arn|dub|ams)/.test(code) ? "eu" : /^(hnd|sin|icn|syd|bom|kix|hkg)/.test(code) ? "ap" : null;
  if (!area) return undefined;
  return provider === "browserbase"
    ? { west: "us-west-2", east: "us-east-1", eu: "eu-central-1", ap: "ap-southeast-1" }[area]
    : undefined; // Steel now runs only in iad (Virginia); it rejects any other region.
}

/** POST a session create with a region; if the provider rejects the option, create one without it. */
async function createWithRegion(url: string, headers: Record<string, string>, body: Record<string, unknown>, region: string | undefined) {
  const post = (b: Record<string, unknown>) => fetch(url, { method: "POST", headers, body: JSON.stringify(b), signal: AbortSignal.timeout(30_000) });
  const first = await post(region ? { ...body, region } : body);
  if (region && first.status >= 400 && first.status < 500 && first.status !== 401 && first.status !== 429) {
    console.warn(`[browser] ${new URL(url).hostname} rejected region "${region}" (HTTP ${first.status}); using its default region`);
    return post(body);
  }
  return first;
}

async function releaseSteelSession(apiKey: string, sessionId: string) {
  await fetch(`https://api.steel.dev/v1/sessions/${encodeURIComponent(sessionId)}/release`, {
    method: "POST",
    headers: { "steel-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function connectBrowserbase(chromium: (typeof import("playwright"))["chromium"], apiKey: string, reconnectSessionId?: string): Promise<Browser> {
  const configuredTimeout = Number(process.env.BROWSERBASE_SESSION_TIMEOUT_SECONDS || 3600);
  const timeout = Math.min(21_600, Math.max(60, Number.isFinite(configuredTimeout) ? configuredTimeout : 3600));
  let session: { id?: string; connectUrl?: string };
  if (reconnectSessionId) {
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(reconnectSessionId)}`, {
      headers: { "X-BB-API-Key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Browserbase reconnect returned HTTP ${response.status}`);
    const existing = (await response.json()) as { id?: string; status?: string; connectUrl?: string };
    if (existing.status !== "RUNNING") throw new Error(`Browserbase session is ${existing.status || "unavailable"}`);
    session = existing;
  } else {
    const created = await createWithRegion(
      "https://api.browserbase.com/v1/sessions",
      { "X-BB-API-Key": apiKey, "content-type": "application/json" },
      { timeout, keepAlive: true, browserSettings: { viewport: SCREEN, recordSession: true, logSession: true }, userMetadata: { application: "senko-ai" } },
      managedRegion("browserbase"),
    );
    if (!created.ok) throw new Error(`Browserbase session create returned HTTP ${created.status}`);
    session = (await created.json()) as { id?: string; connectUrl?: string };
  }
  if (!session.id || !session.connectUrl) throw new Error("Browserbase returned an incomplete session");
  try {
    // Fetch the first-party interactive Live View alongside the CDP connection.
    // It displays and controls the remote browser directly, without a screenshot loop.
    const liveViewPromise = fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(session.id)}/debug`, {
      headers: { "X-BB-API-Key": apiKey },
      signal: AbortSignal.timeout(5_000),
    }).then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { debuggerUrl?: string; debuggerFullscreenUrl?: string; pages?: Array<{ id?: string; debuggerUrl?: string; url?: string }> };
      const raw = data.debuggerUrl || data.debuggerFullscreenUrl;
      if (!raw) return null;
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (host === "browserbase.com" || host.endsWith(".browserbase.com")) ? url.toString() : null;
    }).catch(() => null);
    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
    g.__browserbaseLiveViewUrl = await liveViewPromise || undefined;
    g.__browserbaseSessionId = session.id;
    g.__browserbaseLivePageId = undefined;
    return browser;
  } catch (error) {
    if (!reconnectSessionId) {
      await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(session.id)}`, {
        method: "POST",
        headers: { "X-BB-API-Key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ status: "REQUEST_RELEASE" }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    throw error;
  }
}

async function connectBrowserless(chromium: (typeof import("playwright"))["chromium"], token: string): Promise<Browser> {
  const endpoint = new URL(process.env.BROWSERLESS_CDP_ENDPOINT?.trim() || "wss://production-sfo.browserless.io");
  endpoint.searchParams.set("token", token);
  endpoint.searchParams.set("timeout", String(Math.max(60_000, Number(process.env.BROWSERLESS_TIMEOUT_MS) || 3_600_000)));
  try {
    return await chromium.connectOverCDP(endpoint.toString(), { timeout: 30_000 });
  } catch (e) {
    // Plans cap the session length (the free plan at ~2 minutes) and answer 400 to longer ones.
    if (!/\b400 Bad Request\b/.test(String(e))) throw e;
    endpoint.searchParams.set("timeout", "120000");
    console.warn("[browser] Browserless refused a long session; using its plan's 2-minute limit");
    return chromium.connectOverCDP(endpoint.toString(), { timeout: 30_000 });
  }
}

async function connectSteel(chromium: (typeof import("playwright"))["chromium"], apiKey: string): Promise<Browser> {
  const configuredTimeout = Number(process.env.STEEL_SESSION_TIMEOUT_MS || 900_000);
  const timeout = Math.min(3_600_000, Math.max(60_000, Number.isFinite(configuredTimeout) ? configuredTimeout : 900_000));
  const created = await createWithRegion(
    "https://api.steel.dev/v1/sessions",
    { "steel-api-key": apiKey, "content-type": "application/json" },
    { timeout, dimensions: SCREEN },
    managedRegion("steel"),
  );
  if (!created.ok) throw new Error(`Steel session create returned HTTP ${created.status}`);
  const session = (await created.json()) as { id?: string; websocketUrl?: string };
  if (!session.id) throw new Error("Steel returned an incomplete session");
  const endpoint = new URL(session.websocketUrl || "wss://connect.steel.dev");
  endpoint.searchParams.set("apiKey", apiKey);
  endpoint.searchParams.set("sessionId", session.id);
  try {
    const browser = await chromium.connectOverCDP(endpoint.toString(), { timeout: 30_000 });
    steelSessionIdFromBrowser = session.id;
    return browser;
  } catch (error) {
    await releaseSteelSession(apiKey, session.id);
    throw error;
  }
}

async function launch(browserbaseSessionId?: string): Promise<Browser> {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const browserlessToken = process.env.BROWSERLESS_TOKEN?.trim();
  const steelApiKey = process.env.STEEL_API_KEY?.trim();
  if (process.env.VERCEL && !apiKey && !browserlessToken && !steelApiKey && !process.env.BROWSER_CDP_URL) {
    throw new Error(
      "This Vercel deploy can't run a local browser. Configure BROWSERBASE_API_KEY, BROWSERLESS_TOKEN, or STEEL_API_KEY."
    );
  }
  let chromium;
  const wasiHost = (process.platform as string) === "wasi" || g.__wasiPlatform;
  try {
    // Wasmer's EdgeJS runtime currently identifies as WASI and omits HOME.
    // Playwright rejects WASI before opening a remote CDP connection, despite
    // the app only using its WebSocket client (not launching a local browser).
    // Give it a temp cache/home and the Linux Node compatibility path for CDP.
    if ((process.platform as string) === "wasi") {
      process.env.HOME ||= "/tmp";
      process.env.XDG_CACHE_HOME ||= "/tmp/.cache";
      g.__wasiPlatform = true;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    } else if (!process.env.HOME && !process.env.USERPROFILE) {
      process.env.HOME = process.platform === "win32" ? os.tmpdir() : "/tmp";
    }
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    throw new Error(`Playwright could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Explicit CDP endpoints override the managed provider chain.
  const cdp = (process.env.BROWSER_CDP_URL || "").trim();
  if (cdp) {
    const b = await chromium.connectOverCDP(cdp, { timeout: 15_000 });
    markRemoteBrowser(b, "remote Chromium");
    return b;
  }

  const failures: string[] = [];
  const providers: Array<{ name: string; key?: string; connect: (key: string) => Promise<Browser>; released?: (key: string) => () => void }> = [];
  if (apiKey) providers.push({ name: "Browserbase", key: apiKey, connect: (key) => connectBrowserbase(chromium, key, browserbaseSessionId) });
  if (steelApiKey) {
    providers.push({
      name: "Steel",
      key: steelApiKey,
      connect: (key) => connectSteel(chromium, key),
      released: (key) => {
        // Steel's session id is attached to the CDP URL but is never logged. It's captured
        // now (right after connecting), so a later replacement's session is never released.
        const id = steelSessionIdFromBrowser;
        return () => {
          if (id) void releaseSteelSession(key, id);
        };
      },
    });
  }
  // Last by default: its free plan ends every session after ~2 minutes.
  if (browserlessToken) providers.push({ name: "Browserless", key: browserlessToken, connect: (key) => connectBrowserless(chromium, key) });
  // BROWSER_PROVIDERS="browserless,steel,browserbase" picks the order (names are case-insensitive).
  const order = (process.env.BROWSER_PROVIDERS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (order.length) providers.sort((a, b) => (order.indexOf(a.name.toLowerCase()) + 1 || 99) - (order.indexOf(b.name.toLowerCase()) + 1 || 99));

  const connectManaged = async (): Promise<Browser | null> => {
    for (const provider of providers) {
      try {
        const b = await provider.connect(provider.key!);
        markRemoteBrowser(b, provider.name, provider.released?.(provider.key!));
        return b;
      } catch {
        failures.push(provider.name);
        console.warn(`[browser] ${provider.name} unavailable (${failures.length === 1 ? "connection failed" : "provider unavailable"}); trying the next browser provider`);
      }
    }
    return null;
  };

  // A Chromium on this machine is preferred wherever one can run (the agent computer,
  // Docker, your PC): it streams our own live view with the agent's cursor and honours
  // AGENT_HOST_REGION / BROWSER_PROXY_URL. Managed providers are the fallback, or come
  // first with BROWSER_PROVIDER=managed and on hosts that can't launch Chromium.
  const canLaunchLocally = !process.env.VERCEL && !wasiHost;
  const preferLocal = process.env.BROWSER_PROVIDER === "local" || (process.env.BROWSER_PROVIDER !== "managed" && canLaunchLocally);
  if (!preferLocal) {
    const managed = await connectManaged();
    if (managed) return managed;
  }

  const headed = isHeaded();
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=Translate,MediaRouter",
    ...(isLowMemoryHost()
      ? [
          "--renderer-process-limit=2",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-default-apps",
          "--disable-sync",
          "--mute-audio",
          "--js-flags=--max-old-space-size=192",
          "--disable-features=Translate,MediaRouter,OptimizationHints,site-per-process,IsolateOrigins",
        ]
      : []),
    ...(headed ? ["--kiosk", `--window-size=${SCREEN.width},${SCREEN.height}`, "--window-position=0,0", "--start-fullscreen"] : []),
  ];
  const attempts: [string, () => Promise<Browser>][] = [];
  if (process.env.BROWSER_PATH) {
    attempts.push(["custom", () => chromium.launch({ headless: !headed, executablePath: process.env.BROWSER_PATH, args })]);
  }
  attempts.push(
    ["chrome", () => chromium.launch({ headless: !headed, channel: "chrome", args })], // real Google Chrome (codecs)
    ["msedge", () => chromium.launch({ headless: !headed, channel: "msedge", args })],
    ["chromium", () => chromium.launch({ headless: !headed, channel: "chromium", args })],
    ["chromium-headless-shell", () => chromium.launch({ headless: true, args })]
  );
  const errors: string[] = [];
  for (const [name, attempt] of attempts) {
    try {
      const b = await attempt();
      g.__agentBrowserMode = { headed: headed && name !== "chromium-headless-shell", channel: name };
      console.log(`[browser] launched ${name} (${g.__agentBrowserMode.headed ? "headed on " + process.env.DISPLAY : "headless"}) v${b.version()}`);
      b.on("disconnected", () => {
        void forgetBrowser(b);
      });
      return b;
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  if (preferLocal) {
    const managed = await connectManaged();
    if (managed) return managed;
  }
  throw new Error(`Couldn't start a browser.\n${errors.join("\n")}`);
}

/**
 * BROWSER_PROXY_URL routes the agent's browser through a proxy / VPN exit, e.g.
 * "http://user:pass@host:8080" or "socks5://host:1080", so sites see it in that location.
 */
export function browserProxy(): { server: string; username?: string; password?: string } | undefined {
  const raw = (process.env.BROWSER_PROXY_URL || "").trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    console.warn("[browser] BROWSER_PROXY_URL is not a valid URL; ignoring it");
    return undefined;
  }
}

export async function getBrowser(browserbaseSessionId?: string): Promise<Browser> {
  if (!g.__agentBrowser) {
    g.__agentBrowser = launch(browserbaseSessionId).catch((e) => {
      g.__agentBrowser = undefined;
      throw e;
    });
  }
  const pending = g.__agentBrowser;
  const b = await pending;
  if (!b.isConnected()) {
    // Only clear the slot we read: a concurrent caller may already have started a new launch.
    if (g.__agentBrowser === pending) g.__agentBrowser = undefined;
    return getBrowser();
  }
  return b;
}

/**
 * Throw away a browser that stopped answering (its tabs can't even be replaced). Sessions on
 * it are told through their "disconnected" handlers, save what they can, and restore on a
 * fresh browser next time they're used.
 */
export async function restartBrowser(reason: string): Promise<void> {
  const pending = g.__agentBrowser;
  g.__agentBrowser = undefined;
  g.__agentBrowserMode = undefined;
  if (!pending) return;
  const b = await pending.catch(() => null);
  if (!b) return;
  console.warn(`[browser] restarting the browser: ${reason}`);
  // close() kills a local Chrome; on a remote provider it drops the CDP connection.
  await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
}

/** Release the current managed Browserbase session when a user explicitly closes the browser. */
export async function releaseManagedBrowserSession(sessionId = g.__browserbaseSessionId) {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!sessionId || !apiKey) return;
  await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
  g.__browserbaseSessionId = undefined;
  g.__browserbaseLivePageId = undefined;
  g.__browserbaseLiveViewUrl = undefined;
  g.__agentBrowserMode = undefined;
}

/** Point the embedded Live View at the active page, not an unused blank startup tab. */
export async function selectBrowserbaseLivePage(pageUrl: string): Promise<boolean> {
  const sessionId = g.__browserbaseSessionId;
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!sessionId || !apiKey || browserMode()?.channel !== "Browserbase") return false;
  try {
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}/debug`, {
      headers: { "X-BB-API-Key": apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      debuggerUrl?: string;
      pages?: Array<{ id?: string; debuggerUrl?: string; url?: string }>;
    };
    const active = [...(data.pages || [])].reverse().find((page) => page.url === pageUrl && page.debuggerUrl);
    const raw = active?.debuggerUrl || data.debuggerUrl;
    if (!raw) return false;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "browserbase.com" && !host.endsWith(".browserbase.com"))) return false;
    if (active?.id && active.id === g.__browserbaseLivePageId && g.__browserbaseLiveViewUrl === url.toString()) return false;
    g.__browserbaseLivePageId = active?.id;
    g.__browserbaseLiveViewUrl = url.toString();
    if (g.__agentBrowserMode?.channel === "Browserbase") g.__agentBrowserMode.liveViewUrl = g.__browserbaseLiveViewUrl;
    return true;
  } catch {
    return false;
  }
}

export function browserMode(): BrowserMode | undefined {
  return g.__agentBrowserMode;
}

/** A normal desktop Chrome user agent (sites often block "HeadlessChrome"). */
export function desktopUserAgent(browser: Browser): string {
  const v = browser.version().split(".")[0] || "140";
  const os = process.platform === "linux" ? "X11; Linux x86_64" : "Windows NT 10.0; Win64; x64";
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
}
