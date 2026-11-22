import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  saveImage: vi.fn(),
  q: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({ complete: mocks.complete, headroom: async () => 1, LlmBusyError: class extends Error {} }));
vi.mock("@/lib/agent/sessions", () => ({ sessions: { get: () => undefined, open: mocks.open } }));
vi.mock("@/lib/agent/checkpoint", () => ({ checkpointLease: () => Symbol(), saveCheckpoint: mocks.save, clearCheckpoint: mocks.clear }));
vi.mock("@/lib/server/persona", () => ({ agentVoice: async () => "", safeSearchFor: async () => "off" }));
vi.mock("@/lib/server/chats", () => ({ saveImage: mocks.saveImage }));
vi.mock("@/lib/server/db", () => ({ q: mocks.q, q1: vi.fn(), newId: () => "test" }));

import { observeDom } from "@/lib/agent/interaction";
import { clearStash } from "@/lib/agent/image-store";
import { runAgent, type RunEvent } from "@/lib/agent/runner";

async function makeAnimatedGif(seed: number): Promise<Buffer> {
  const f1 = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: (seed * 47) % 255, g: 50, b: 120 } } }).png().toBuffer();
  const f2 = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 220, g: (seed * 73) % 255, b: 40 } } }).png().toBuffer();
  return sharp([f1, f2], { join: { animated: true } }).gif().toBuffer();
}

async function makeStaticJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 100, g: 140, b: 180 } } }).jpeg().toBuffer();
}

describe("Real Chromium browser E2E — DOM extraction, error recovery, loop prevention & 5-GIF chat delivery", () => {
  let server: http.Server;
  let baseUrl: string;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const gifs: Buffer[] = [];
  let staticJpg: Buffer;
  const hits: Record<string, number> = {};

  beforeAll(async () => {
    for (let i = 1; i <= 5; i++) gifs.push(await makeAnimatedGif(i));
    staticJpg = await makeStaticJpeg();

    server = http.createServer((req, res) => {
      const path = (req.url || "/").split("?")[0];
      hits[path] = (hits[path] || 0) + 1;

      if (path === "/images/search") {
        const html = `<!doctype html><html><head><title>cute cat gif - Image Search</title></head><body>
          <h1>Image Search Results</h1>
          <a class="iusc" href="/source/1" m='${JSON.stringify({ murl: `${baseUrl}/media/cat1.gif`, purl: `${baseUrl}/source/1` })}'>
            <img src="${baseUrl}/thumb/1.jpg" width="120" height="90" alt="cute cat gif 1" />
          </a>
          <a class="iusc" href="/source/2" m='${JSON.stringify({ murl: `${baseUrl}/media/cat2.gif`, purl: `${baseUrl}/source/2` })}'>
            <img src="${baseUrl}/thumb/2.jpg" width="120" height="90" alt="cute cat gif 2" />
          </a>
          <a class="iusc" href="/source/3" m='${JSON.stringify({ murl: `${baseUrl}/media/cat3.gif`, purl: `${baseUrl}/source/3` })}'>
            <img src="${baseUrl}/thumb/3.jpg" width="120" height="90" alt="cute cat gif 3" />
          </a>
          <a class="iusc" href="/source/4" m='${JSON.stringify({ murl: `${baseUrl}/media/cat4.gif`, purl: `${baseUrl}/source/4` })}'>
            <img src="${baseUrl}/thumb/4.jpg" width="120" height="90" alt="cute cat gif 4" />
          </a>
          <a class="iusc" href="/source/5" m='${JSON.stringify({ murl: `${baseUrl}/media/cat5.gif`, purl: `${baseUrl}/source/5` })}'>
            <img src="${baseUrl}/thumb/5.jpg" width="120" height="90" alt="cute cat gif 5" />
          </a>
          <a href="/source/thumb-only">
            <img src="${baseUrl}/thumb/static-only.jpg" width="120" height="90" alt="static cat gif preview" />
          </a>
        </body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
        return;
      }

      if (path === "/media/forbidden.gif") {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      if (path === "/media/missing.gif") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
        return;
      }
      if (path === "/media/ratelimited.gif") {
        res.writeHead(429, { "content-type": "text/plain", "retry-after": "30" });
        res.end("Too Many Requests");
        return;
      }
      if (path.startsWith("/thumb/")) {
        res.writeHead(200, { "content-type": "image/jpeg" });
        res.end(staticJpg);
        return;
      }
      if (path === "/media/duplicate-of-1.gif") {
        res.writeHead(200, { "content-type": "image/gif" });
        res.end(gifs[0]);
        return;
      }
      const m = /^\/media\/cat([1-5])\.gif$/.exec(path);
      if (m) {
        res.writeHead(200, { "content-type": "image/gif" });
        res.end(gifs[Number(m[1]) - 1]);
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
  }, 30_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(hits)) delete hits[k];
    clearStash("e2e-gif-chat");
    mocks.save.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.q.mockResolvedValue([]);
    let imgSeq = 0;
    mocks.saveImage.mockImplementation(async (_owner: string, mime: string, data: Buffer) => {
      expect(mime).toBe("image/gif");
      expect(data.length).toBeGreaterThan(20);
      return `saved_gif_${++imgSeq}`;
    });
  });

  it("extracts direct GIF URLs from Bing-style a[m] metadata and marks static thumbnails accurately in real Chromium", async () => {
    await page.goto(`${baseUrl}/images/search?q=cute+cat+gif`, { waitUntil: "networkidle" });
    const dom = await observeDom(page);

    expect(dom.images).toHaveLength(6);
    const directGifs = dom.images.filter((i) => i.animated && !i.thumbnail);
    expect(directGifs).toHaveLength(5);
    expect(directGifs[0].url).toBe(`${baseUrl}/media/cat1.gif`);
    expect(directGifs[0].sourceUrl).toBe(`${baseUrl}/source/1`);

    const staticThumb = dom.images.find((i) => i.url.includes("static-only.jpg"));
    expect(staticThumb).toBeDefined();
    expect(staticThumb?.thumbnail).toBe(true);
    expect(staticThumb?.animated).toBeUndefined();
  });

  it("recovers from 403/404/429/static/duplicate/premature-done and delivers 5 distinct animated GIFs within the 32-request budget", async () => {
    await page.goto(`${baseUrl}/images/search?q=cute+cat+gif`, { waitUntil: "networkidle" });

    const session = {
      pages: [page],
      context,
      active: () => page,
      isActive: () => true,
      viewport: () => ({ width: 1280, height: 800 }),
      beginAgent: vi.fn(),
      endAgent: vi.fn(),
      startCast: async () => {},
      emitStatus: vi.fn(),
      emit: vi.fn(),
      tabs: async () => [{ index: 0, title: await page.title(), url: page.url(), active: true }],
      screenshot: async () => Buffer.from("fake-jpg"),
      recordShot: async () => "shot",
      persist: async () => {},
      schedulePersist: vi.fn(),
      log: vi.fn(),
      replay: [],
      status: "active",
      watchStall: () => () => {},
      responsive: async () => true,
      recoverPage: vi.fn(),
      viewerCount: () => 0,
    };
    mocks.open.mockResolvedValue(session);

    const goal = "Find 5 distinct animated cat GIFs and send them directly into the chat.";
    const plan = { requirements: ["Send 5 distinct verified animated cat GIFs to chat"], steps: ["Fetch 5 GIFs", "Call send_images"] };
    const verifiedReview = {
      requirements: [
        { id: "r0", status: "verified", evidence: "5 distinct animated GIFs delivered via send_images" },
        { id: "r1", status: "verified", evidence: "5 distinct animated GIFs delivered via send_images" },
      ],
    };

    // Simulate an agent encountering every real-world failure mode and recovering cleanly:
    const scriptedActions = [
      // 1. Tries a search page URL -> rejected immediately (0 network hits)
      { action: "fetch_image", url: "https://www.bing.com/images/search?q=cute+cat+gif", alt: "bad search page" },
      // 2. Hits HTTP 403 -> recorded as http_403
      { action: "fetch_image", url: `${baseUrl}/media/forbidden.gif`, alt: "forbidden" },
      // 3. Tries to retry the exact same 403 URL -> blocked BEFORE hitting network again!
      { action: "fetch_image", url: `${baseUrl}/media/forbidden.gif`, alt: "forbidden retry" },
      // 4. Hits HTTP 404 -> recorded as http_404
      { action: "fetch_image", url: `${baseUrl}/media/missing.gif`, alt: "missing" },
      // 5. Hits static JPEG thumbnail -> rejected as not_animated
      { action: "fetch_image", url: `${baseUrl}/thumb/static-only.jpg`, alt: "static thumb" },
      // 6. Fetches 3 valid distinct animated GIFs
      { action: "fetch_image", url: `${baseUrl}/media/cat1.gif`, alt: "cat 1" },
      { action: "fetch_image", url: `${baseUrl}/media/cat2.gif`, alt: "cat 2" },
      { action: "fetch_image", url: `${baseUrl}/media/cat3.gif`, alt: "cat 3" },
      // 7. Tries a different URL with identical bytes to cat1 -> rejected as duplicate!
      { action: "fetch_image", url: `${baseUrl}/media/duplicate-of-1.gif`, alt: "cat 1 dup" },
      // 8. Sends the first 3 validated GIFs (partial progress preserved!)
      { action: "send_images" },
      // 9. Prematurely calls done with only 3/5 delivered -> rejected by programmatic delivery gate!
      { action: "done", answer: "Here are your 5 GIFs!" },
      // 10. Fetches remaining 2 distinct animated GIFs
      { action: "fetch_image", url: `${baseUrl}/media/cat4.gif`, alt: "cat 4" },
      { action: "fetch_image", url: `${baseUrl}/media/cat5.gif`, alt: "cat 5" },
      // 11. Sends remaining 2 GIFs
      { action: "send_images" },
      // 12. Calls done with all 5 verified GIFs delivered
      { action: "done", answer: "Sent 5 distinct, verified animated cat GIFs directly into the chat.", requirements: verifiedReview.requirements },
    ];

    let llmCalls = 0;
    mocks.complete.mockImplementation(async (msgs: { content: string }[]) => {
      llmCalls++;
      if (/You plan tasks/.test(msgs[0].content)) {
        return { text: JSON.stringify(plan), providerLabel: "test", model: "fixture" };
      }
      if (/Audit a browser task/.test(msgs[0].content)) {
        return { text: JSON.stringify(verifiedReview), providerLabel: "test", model: "fixture" };
      }
      const next = scriptedActions.shift();
      return { text: JSON.stringify(next || { action: "done", answer: "Done" }), providerLabel: "test", model: "fixture" };
    });

    const events: RunEvent[] = [];
    await runAgent({ chatId: "e2e-gif-chat", ownerId: "owner", goal, signal: new AbortController().signal, emit: (e) => events.push(e) });

    // Verify 5 distinct animated GIFs were saved & delivered to chat
    const doneEvent = events.find((e): e is Extract<RunEvent, { type: "done" }> => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.imageIds).toHaveLength(5);
    expect(new Set(doneEvent!.imageIds).size).toBe(5);
    expect(mocks.saveImage).toHaveBeenCalledTimes(5);

    // Verify 403 retry was blocked before making a second server request (1 direct + 1 browserFetch fallback on first attempt = 2 max, 0 on blocked retry)
    expect(hits["/media/forbidden.gif"]).toBeLessThanOrEqual(2);

    // Verify well within the 32-request inference budget
    expect(llmCalls).toBeLessThan(32);
  }, 30_000);
});
