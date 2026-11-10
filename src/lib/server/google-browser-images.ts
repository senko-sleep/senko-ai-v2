// Google Images through the agent's real Chrome (the same browser and the same Google
// traffic gate the agent uses), for when the Custom Search API keys are out of quota.
//
// - One reusable browser context; its Google cookies are saved to disk so Google sees a
//   returning visitor rather than a fresh bot on every search.
// - Only images/fonts/media are blocked: the results page is all we need, and it's fast.
// - Respects the shared gate: no search while Google is cooling down after a robot check,
//   and a robot check here pauses Google for the agent too (it's the same IP).
// - Only where the agent itself runs a local Chrome: remote providers bill per session.
//   GOOGLE_IMAGES_BROWSER=1 forces it on, =0 turns it off.
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { desktopUserAgent, getBrowser, isLowMemoryHost } from "@/lib/agent/browser";
import { googleAvailable, isGoogleSorryUrl, looksLikeGoogleCaptcha, paceGoogle, reportGoogleCaptcha, reportGoogleOk } from "@/lib/agent/google-gate";

export interface BrowserImage {
  url: string;
  width: number;
  height: number;
  source?: string;
  title?: string;
}

const g = globalThis as unknown as { __googleImagesContext?: Promise<BrowserContext> | undefined };
const statePath = () => path.resolve(process.env.DATA_DIR && process.env.DATA_DIR !== ":memory:" ? process.env.DATA_DIR : ".data", "google-images-state.json");

export function browserImagesEnabled(): boolean {
  const flag = process.env.GOOGLE_IMAGES_BROWSER;
  if (flag === "0") return false;
  if (flag === "1") return true;
  if (process.env.VERCEL || process.env.SENKO_DISABLE_IMAGE_SCRAPE === "1") return false;
  // Same choice the agent makes (browser.ts): a local Chrome wherever one can run; managed
  // providers (billed per session) only where it can't — and then no image searches here.
  const wasi = (process.platform as string) === "wasi" || Boolean((globalThis as { __wasiPlatform?: boolean }).__wasiPlatform);
  const local = process.env.BROWSER_PROVIDER === "local" || (process.env.BROWSER_PROVIDER !== "managed" && !wasi);
  return local && !process.env.BROWSER_CDP_URL?.trim() && !isLowMemoryHost();
}

async function context(): Promise<BrowserContext> {
  if (!g.__googleImagesContext) {
    g.__googleImagesContext = (async () => {
      const browser = await getBrowser();
      const saved = await fs.readFile(statePath(), "utf8").then((t) => JSON.parse(t)).catch(() => undefined);
      const ctx = await browser.newContext({
        userAgent: desktopUserAgent(browser),
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
        storageState: saved,
      });
      await ctx.route("**/*", (route) => (["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue()));
      // The agent may restart the browser; start over with a fresh context next time.
      browser.once("disconnected", () => { g.__googleImagesContext = undefined; });
      return ctx;
    })().catch((e) => {
      g.__googleImagesContext = undefined;
      throw e;
    });
  }
  return g.__googleImagesContext;
}

async function saveState(ctx: BrowserContext) {
  const state = await ctx.storageState().catch(() => null);
  if (!state) return;
  await fs.mkdir(path.dirname(statePath()), { recursive: true }).catch(() => {});
  await fs.writeFile(statePath(), JSON.stringify(state)).catch(() => {});
}

const decode = (s: string) =>
  s.replace(/\\u003d/gi, "=").replace(/\\u0026/gi, "&").replace(/\\u0025/gi, "%").replace(/\\\//g, "/");

/**
 * Full-size images from a Google Images results page. Google embeds each result as
 * ["<image url>", height, width] next to the page it came from.
 */
export function parseGoogleImagesHtml(html: string): BrowserImage[] {
  const out: BrowserImage[] = [];
  const seen = new Set<string>();
  const re = /\["(https?:\/\/[^"]+?)",(\d+),(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = decode(m[1]);
    if (/gstatic\.com|encrypted-tbn|googleusercontent\.com\/(?:proxy|img)|google\.com\/(?:logos|images\/branding)/i.test(url)) continue;
    const height = Number(m[2]);
    const width = Number(m[3]);
    if (width < 150 || height < 150 || seen.has(url)) continue;
    seen.add(url);
    // The page the image is on usually follows within the next few hundred characters.
    const after = html.slice(re.lastIndex, re.lastIndex + 1500);
    const source = /"(https?:\/\/(?!encrypted-tbn|[^"]*gstatic)[^"]+?)"/.exec(after)?.[1];
    out.push({ url, width, height, source: source ? decode(source) : undefined });
  }
  return out;
}

/** One Google Images results page in the real browser. [] when unavailable, blocked or too slow. */
export async function googleImagesViaBrowser(query: string, opts: { safe?: "off" | "active"; signal?: AbortSignal; limit?: number } = {}): Promise<BrowserImage[]> {
  if (!browserImagesEnabled() || !googleAvailable("browser") || opts.signal?.aborted) return [];
  // Don't hold up an image search behind a long Google spacing wait: other engines cover it.
  if (!(await paceGoogle({ signal: opts.signal, maxWaitMs: 4000 }))) return [];
  let ctx: BrowserContext;
  try {
    ctx = await context();
  } catch (e) {
    console.warn(`[images] Google via browser unavailable: ${e instanceof Error ? e.message : e}`);
    return [];
  }
  const page = await ctx.newPage();
  const abort = () => void page.close().catch(() => {});
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2&hl=en&safe=${opts.safe ?? "off"}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
    // EU consent screen: accept once; the cookie is saved with the rest.
    if (/consent\.google\./.test(page.url())) {
      await page.getByRole("button", { name: /accept all|reject all/i }).first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForURL(/google\.[^/]+\/search/, { timeout: 8000 }).catch(() => {});
    }
    const html = await page.content();
    if (isGoogleSorryUrl(page.url()) || looksLikeGoogleCaptcha(html)) {
      const ms = reportGoogleCaptcha("browser");
      console.warn(`[images] Google showed a robot check; pausing Google for ${Math.round(ms / 60_000)} min`);
      return [];
    }
    reportGoogleOk("browser");
    const images = parseGoogleImagesHtml(html).slice(0, opts.limit ?? 60);
    void saveState(ctx);
    return images;
  } catch (e) {
    if (!opts.signal?.aborted) console.warn(`[images] Google via browser failed: ${e instanceof Error ? e.message : e}`);
    return [];
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    await page.close().catch(() => {});
  }
}
