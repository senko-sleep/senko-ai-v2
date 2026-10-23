// One shared browser process for the whole server; each chat session gets its own
// isolated context (cookies, storage, tabs).
//
// On the server (Docker): real Google Chrome, headed, on the Xvfb virtual display
// (DISPLAY is set), so H.264/AAC video plays and the screen can be streamed over VNC.
// Locally (no DISPLAY): headless, preferring a full browser (Chrome/Edge) because the
// stripped "headless shell" is blocked by sites like Crunchyroll.
import type { Browser } from "playwright";

const g = globalThis as unknown as { __agentBrowser?: Promise<Browser>; __agentBrowserMode?: BrowserMode };

export interface BrowserMode {
  headed: boolean;
  channel: string;
}

export const SCREEN = {
  width: Number(process.env.SCREEN_WIDTH || 1280),
  height: Number(process.env.SCREEN_HEIGHT || 800),
};

export function isHeaded(): boolean {
  return process.platform === "linux" && !!process.env.DISPLAY && process.env.BROWSER_HEADLESS !== "1";
}

async function launch(): Promise<Browser> {
  if (process.env.VERCEL) {
    throw new Error("Live browser agent is not available in Vercel serverless environment (requires Docker or local server with Chrome).");
  }
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    throw new Error(`Playwright could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
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
        g.__agentBrowser = undefined;
      });
      return b;
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  throw new Error(`Couldn't start a browser.\n${errors.join("\n")}`);
}

export async function getBrowser(): Promise<Browser> {
  if (!g.__agentBrowser) {
    g.__agentBrowser = launch().catch((e) => {
      g.__agentBrowser = undefined;
      throw e;
    });
  }
  const b = await g.__agentBrowser;
  if (!b.isConnected()) {
    g.__agentBrowser = undefined;
    return getBrowser();
  }
  return b;
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
