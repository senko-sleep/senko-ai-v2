import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { ModelRotator } from "@/lib/agent/model-rotator";
import { parseBrowserDecision } from "@/lib/agent/action-protocol";
import { clearStash } from "@/lib/agent/image-store";

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

import { runAgent, type RunEvent } from "@/lib/agent/runner";

async function makeAnimatedGif(seed: number): Promise<Buffer> {
  const f1 = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: (seed * 41) % 255, g: 30, b: 100 } } }).png().toBuffer();
  const f2 = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: (seed * 67) % 255, b: 50 } } }).png().toBuffer();
  return sharp([f1, f2], { join: { animated: true } }).gif().toBuffer();
}

describe("ModelRotator — automatic model switching for long tasks", () => {
  it("rotates away from a model after 3 consecutive failed/no-effect steps", () => {
    const r = new ModelRotator({ maxConsecutiveFailures: 3, maxTurnsPerModel: 18 });
    expect(r.recordStep("model-a", false, false).rotated).toBe(false);
    expect(r.recordStep("model-a", true, false).rotated).toBe(false);
    const third = r.recordStep("model-a", false, true);
    expect(third.rotated).toBe(true);
    expect(third.excludedModel).toBe("model-a");
    expect(r.excludedModels).toEqual(["model-a"]);
  });

  it("rotates after maxTurnsPerModel on long tasks and resets cleanly when exhausted", () => {
    const r = new ModelRotator({ maxConsecutiveFailures: 3, maxTurnsPerModel: 4 });
    for (let i = 0; i < 3; i++) expect(r.recordStep("model-a", true, true, false).rotated).toBe(false);
    expect(r.recordStep("model-a", true, true, false).rotated).toBe(true);
    expect(r.excludedModels).toContain("model-a");
    r.resetIfExhausted();
    expect(r.excludedModels).toEqual([]);
  });
});

describe("fetch_images batch action & smart inference usage", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearStash("batch-chat");
    mocks.save.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.q.mockResolvedValue([]);
    let seq = 0;
    mocks.saveImage.mockImplementation(async () => `saved_${++seq}`);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    clearStash("batch-chat");
  });

  it("parses fetch_images batch action cleanly", () => {
    expect(parseBrowserDecision('{"action":"fetch_images","urls":["https://a.test/1.gif","https://a.test/2.gif"],"send":true}')).toMatchObject({
      action: "fetch_images",
      urls: ["https://a.test/1.gif", "https://a.test/2.gif"],
      send: true,
    });
    expect(parseBrowserDecision('{"action":"fetch_images","urls":[]}')).toBeNull();
  });

  it("downloads, validates, deduplicates, and sends 5 animated GIFs in ONE inference step and disables speculative hedging once healthy", async () => {
    const gifs = await Promise.all([1, 2, 3, 4, 5].map(makeAnimatedGif));
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const s = String(u);
      if (s.includes("403")) return new Response("Forbidden", { status: 403 });
      const m = /cat(\d)\.gif/.exec(s);
      if (m) return new Response(new Uint8Array(gifs[Number(m[1]) - 1]), { status: 200, headers: { "content-type": "image/gif" } });
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const page = {
      url: () => "https://gallery.test/cats",
      title: async () => "Cat GIFs",
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      on: vi.fn(),
      off: vi.fn(),
      mainFrame: () => ({}),
      evaluate: vi.fn(async (_fn: unknown, arg?: { cmd?: string }) => {
        if (arg?.cmd === "observe") {
          return {
            elements: [],
            images: [1, 2, 3, 4, 5].map((n) => ({ url: `https://cdn.test/cat${n}.gif`, alt: `cat ${n}`, col: 0, row: 0, animated: true })),
            text: "Cat GIF gallery",
            atBottom: false,
          };
        }
        return null;
      }),
    };
    const session = {
      pages: [page],
      active: () => page,
      isActive: () => true,
      viewport: () => ({ width: 1280, height: 800 }),
      beginAgent: vi.fn(),
      endAgent: vi.fn(),
      startCast: async () => {},
      emitStatus: vi.fn(),
      emit: vi.fn(),
      tabs: async () => [{ index: 0, title: "Cat GIFs", url: "https://gallery.test/cats", active: true }],
      screenshot: async () => Buffer.from("shot"),
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

    const goal = "Find 5 distinct animated cat GIFs and send them directly into chat.";
    const verified = [{ id: "r0", status: "verified", evidence: "5 animated GIFs attached via fetch_images(send=true)" }];
    const decisions = [
      {
        action: "fetch_images",
        urls: [
          "https://cdn.test/403.gif",
          "https://cdn.test/cat1.gif",
          "https://cdn.test/cat2.gif",
          "https://cdn.test/cat3.gif",
          "https://cdn.test/cat4.gif",
          "https://cdn.test/cat5.gif",
        ],
        send: true,
      },
      { action: "done", answer: "Sent 5 distinct animated cat GIFs to chat.", requirements: verified },
    ];

    const seenOpts: { hedge?: boolean; excludeModels?: string[] }[] = [];
    mocks.complete.mockImplementation(async (msgs: { content: string }[], opts: { hedge?: boolean; excludeModels?: string[] }) => {
      if (/You plan tasks/.test(msgs[0].content)) {
        return { text: JSON.stringify({ requirements: [], steps: ["Batch fetch 5 GIFs"] }), providerLabel: "Primary", model: "fast-model" };
      }
      seenOpts.push({ hedge: opts?.hedge, excludeModels: opts?.excludeModels });
      return { text: JSON.stringify(decisions.shift()), providerLabel: "Primary", model: "fast-model" };
    });

    const events: RunEvent[] = [];
    await runAgent({ chatId: "batch-chat", ownerId: "owner", goal, signal: new AbortController().signal, emit: (e) => events.push(e) });

    const done = events.find((e): e is Extract<RunEvent, { type: "done" }> => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.imageIds).toHaveLength(5);
    // Only 2 decision calls total (1 batch fetch+send + 1 done) instead of 7!
    expect(seenOpts).toHaveLength(2);
    // Speculative hedging disabled once a healthy model responded (no 2x-3x budget burn)
    expect(seenOpts[1].hedge).toBe(false);
  });

  it("open_fastest races multiple websites in parallel tabs, switches to the fastest healthy tab, and closes slower/blocked tabs", async () => {
    expect(parseBrowserDecision('{"action":"open_fastest","urls":["https://slow.test","https://fast.test"]}')).toMatchObject({
      action: "open_fastest",
      urls: ["https://slow.test", "https://fast.test"],
    });

    const closed: string[] = [];
    const switchedTo: number[] = [];
    const pages: unknown[] = [];

    const makeTab = (targetUrl: string) => {
      let isClosed = false;
      const tab = {
        url: () => targetUrl,
        title: async () => `Title for ${targetUrl}`,
        isClosed: () => isClosed,
        close: vi.fn(async () => { isClosed = true; closed.push(targetUrl); }),
        bringToFront: vi.fn(async () => {}),
        waitForLoadState: async () => {},
        waitForTimeout: async () => {},
        on: vi.fn(),
        off: vi.fn(),
        mainFrame: () => ({}),
        goto: vi.fn(async (u: string) => {
          targetUrl = u;
          if (u.includes("blocked")) return { status: () => 403 };
          if (u.includes("slow")) {
            await new Promise((r) => setTimeout(r, 400));
            return { status: () => 200 };
          }
          return { status: () => 200 };
        }),
        evaluate: vi.fn(async (_fn: unknown, arg?: { cmd?: string }) => {
          if (arg?.cmd === "observe") return { elements: [], images: [], text: `Loaded ${targetUrl}`, atBottom: false };
          return { title: "Fast Site", bodyText: "Normal content", hasChallengeWidget: false, challengeProviderHint: "" };
        }),
      };
      pages.push(tab);
      return tab;
    };

    const initialTab = makeTab("https://start.test/");
    let activeIdx = 0;
    const session = {
      pages,
      context: { newPage: vi.fn(async () => makeTab("about:blank")) },
      active: () => pages[activeIdx],
      isActive: () => true,
      switchTab: vi.fn(async (idx: number) => { activeIdx = idx; switchedTo.push(idx); }),
      viewport: () => ({ width: 1280, height: 800 }),
      beginAgent: vi.fn(),
      endAgent: vi.fn(),
      startCast: async () => {},
      emitStatus: vi.fn(),
      emit: vi.fn(),
      tabs: async () => [{ index: activeIdx, title: "Active", url: (pages[activeIdx] as { url: () => string }).url(), active: true }],
      screenshot: async () => Buffer.from("shot"),
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

    const decisions = [
      { action: "open_fastest", urls: ["https://blocked.test/p", "https://slow.test/p", "https://fast.test/p"] },
      { action: "done", answer: "Opened fast.test.", requirements: [{ id: "r0", status: "verified", evidence: "Opened fast.test" }] },
    ];
    mocks.complete.mockImplementation(async (msgs: { content: string }[]) => {
      if (/You plan tasks/.test(msgs[0].content)) return { text: JSON.stringify({ requirements: [], steps: ["Race sites"] }), providerLabel: "Primary", model: "fast-model" };
      return { text: JSON.stringify(decisions.shift()), providerLabel: "Primary", model: "fast-model" };
    });

    const events: RunEvent[] = [];
    await runAgent({ chatId: "race-chat", ownerId: "owner", goal: "Open the fastest site", signal: new AbortController().signal, emit: (e) => events.push(e) });

    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(switchedTo.length).toBeGreaterThan(0);
    expect((pages[activeIdx] as { url: () => string }).url()).toBe("https://fast.test/p");
    // Both blocked and slow tabs were automatically closed!
    expect(closed).toContain("https://blocked.test/p");
    expect(closed).toContain("https://slow.test/p");
    expect(closed).not.toContain("https://fast.test/p");
    void initialTab;
  });
});
