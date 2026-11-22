import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { classifyPage, isDirectMediaUrl, isLikelyThumbnailUrl, isSearchPageUrl, normalizeSearchKey, normalizeUrl } from "@/lib/agent/url-utils";
import { StrategyMonitor } from "@/lib/agent/strategy";
import { diagnoseFailure } from "@/lib/agent/recovery";
import { InferenceRequestBudget } from "@/lib/llm/request-budget";
import { parseMediaDeliverable } from "@/lib/agent/context";
import { clearStash, ImageFetchError, listStash, stashImage } from "@/lib/agent/image-store";

async function makeAnimatedGif(r1: number, r2: number, width = 64, height = 64): Promise<Buffer> {
  const f1 = await sharp({ create: { width, height, channels: 3, background: { r: r1, g: 40, b: 80 } } }).png().toBuffer();
  const f2 = await sharp({ create: { width, height, channels: 3, background: { r: r2, g: 180, b: 120 } } }).png().toBuffer();
  return sharp([f1, f2], { join: { animated: true } }).gif().toBuffer();
}

async function makeStaticJpeg(r = 120): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 90, channels: 3, background: { r, g: 90, b: 200 } } }).jpeg().toBuffer();
}

async function makeStaticGif(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 10, g: 200, b: 10 } } }).gif().toBuffer();
}

describe("URL normalization, search deduplication & page classification", () => {
  it("normalizes rotating Bing/Google tracking params to the same canonical URL", () => {
    const a = "https://www.bing.com/images/search?q=cute+cat+gif&form=HDRSC3&cvid=AAA111&first=1";
    const b = "https://bing.com/images/search?q=Cute%20Cat%20GIF&form=QBIR&cvid=BBB222&tsc=ImageHoverTitle";
    expect(normalizeUrl(a)).toBe(normalizeUrl(b));
    expect(normalizeUrl(a)).toBe("bing:images?q=cute%20cat%20gif");
  });

  it("distinguishes search pages, image grids, image previews, thumbnails, and direct media", () => {
    expect(isSearchPageUrl("https://www.bing.com/images/search?q=cats")).toBe(true);
    expect(isSearchPageUrl("https://www.google.com/search?q=cats&udm=2")).toBe(true);
    expect(isSearchPageUrl("https://media.example.com/cat.gif")).toBe(false);

    expect(isDirectMediaUrl("https://media.example.com/cat.gif")).toBe(true);
    expect(isDirectMediaUrl("https://www.bing.com/images/search?q=cats")).toBe(false);

    expect(isLikelyThumbnailUrl("https://tse1.mm.bing.net/th?id=OIP.abc")).toBe(true);
    expect(isLikelyThumbnailUrl("https://encrypted-tbn0.gstatic.com/images?q=tbn:123")).toBe(true);
    expect(isLikelyThumbnailUrl("https://media.example.com/full/cat.gif")).toBe(false);

    expect(classifyPage({ url: "https://www.bing.com/search?q=cats", title: "cats - Bing", text: "results", imageCount: 0 }).kind).toBe("search_results");
    expect(classifyPage({ url: "https://www.bing.com/images/search?q=cats", title: "cats - Bing Images", text: "images", imageCount: 12 }).kind).toBe("image_search_results");
    expect(classifyPage({ url: "https://www.bing.com/images/search?q=cats&view=detailV2", title: "cats", text: "preview", imageCount: 1 }).kind).toBe("image_preview");
    expect(classifyPage({ url: "https://cdn.example.com/anim.gif", title: "anim.gif", text: "", imageCount: 1 }).kind).toBe("direct_media");
    expect(classifyPage({ url: "https://www.bing.com/images/search?q=zzzxxyy", title: "Bing", text: "There are no results for zzzxxyy", imageCount: 0 }).kind).toBe("empty_results");
    expect(classifyPage({ url: "https://blocked.example.com/pic", title: "403 Forbidden", text: "Access Denied", imageCount: 0 }).kind).toBe("blocked_or_error");
  });

  it("parses media deliverable counts and animated GIF requirements", () => {
    expect(parseMediaDeliverable("Search for cute cat GIFs and send five distinct, valid GIFs directly into the chat.")).toEqual({
      count: 5,
      requireAnimated: true,
      deliverToChat: true,
      isCollage: false,
    });
    expect(parseMediaDeliverable("download 3 landscape photos and make a collage")).toEqual({
      count: 3,
      requireAnimated: false,
      deliverToChat: false,
      isCollage: true,
    });
  });
});

describe("StrategyMonitor — loop prevention, oscillation, search dedup & failure memory", () => {
  it("detects repeated visits to the same page even with changing tracking params", () => {
    const m = new StrategyMonitor();
    for (let i = 0; i < 3; i++) {
      m.observe(`state-${i}`, `https://www.bing.com/images/search?q=cats&cvid=run${i}`, "image_search_results");
    }
    // Even though the raw state string differed slightly, the normalized URL was visited 3x without progress.
    expect(m.urlVisits("https://www.bing.com/images/search?q=cats")).toBe(3);
  });

  it("detects A <-> B oscillation between Bing web search and Bing Images tab", () => {
    const m = new StrategyMonitor();
    const web = "https://www.bing.com/search?q=cat+gif&cvid=1";
    const img = "https://www.bing.com/images/search?q=cat+gif&cvid=2";
    m.observe("web", web, "search_results");
    m.observe("img", img, "image_search_results");
    m.observe("web", `${web}&form=QBLH`, "search_results");
    m.observe("img", `${img}&form=HDRSC3`, "image_search_results");
    expect(m.detectOscillation()).toBe(true);
    expect(m.advice()).toContain("OSCILLATION");
  });

  it("deduplicates repeated searches without progress, but allows retry after genuine progress", () => {
    const m = new StrategyMonitor();
    expect(normalizeSearchKey("bing", "images", "Cat  GIFs")).toBe("bing:images:cat gifs");
    m.recordSearch("bing", "images", "cat gifs");
    expect(m.duplicateSearchReason("bing", "images", "  Cat   GIFs ")).toContain("Already searched");
    m.recordProgress();
    expect(m.duplicateSearchReason("bing", "images", "cat gifs")).toBeNull();
  });

  it("tracks HTTP 403/404/429 failed URLs and serializes/restores cleanly across checkpoints", () => {
    const m = new StrategyMonitor();
    m.recordFailedUrl("https://blocked.example.com/1.gif", "http_403", "HTTP 403");
    m.recordFailedUrl("https://blocked.example.com/2.gif", "http_403", "HTTP 403");
    m.recordFailedUrl("https://rate.example.com/3.gif", "http_429", "HTTP 429", 30_000);

    expect(m.failedUrlReason("https://blocked.example.com/1.gif")).toContain("http_403");
    expect(m.host403Count("https://blocked.example.com/other.gif")).toBe(2);
    expect(m.hostRateLimitRemainingMs("https://rate.example.com/other.gif")).toBeGreaterThan(10_000);
    expect(m.advice()).toContain("RESTRICTED/RATE-LIMITED HOSTS");

    const snap = m.serialize();
    const restored = new StrategyMonitor();
    restored.restore(snap);
    expect(restored.failedUrlReason("https://blocked.example.com/1.gif")).toContain("http_403");
    expect(restored.host403Count("https://blocked.example.com/x.gif")).toBe(2);
    expect(restored.hostRateLimitRemainingMs("https://rate.example.com/x.gif")).toBeGreaterThan(0);
  });
});

describe("Image & GIF retrieval validation (403, 404, 429, static thumbnails, duplicates)", () => {
  const sessionId = "test-media-overhaul";
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    clearStash(sessionId);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    clearStash(sessionId);
  });

  it("rejects search-result page URLs before making any HTTP request", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(
      stashImage(sessionId, "https://www.bing.com/images/search?q=cat+gif", "cats", undefined, { requireAnimated: true }),
    ).rejects.toMatchObject({ code: "search_page" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("classifies HTTP 403, 404, and 429 with Retry-After cleanly", async () => {
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const s = String(u);
      if (s.includes("403")) return new Response("Forbidden", { status: 403 });
      if (s.includes("404")) return new Response("Not Found", { status: 404 });
      if (s.includes("429")) return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "45" } });
      return new Response("OK", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(stashImage(sessionId, "https://cdn.test/403.gif")).rejects.toMatchObject({ code: "http_403", status: 403 });
    await expect(stashImage(sessionId, "https://cdn.test/404.gif")).rejects.toMatchObject({ code: "http_404", status: 404 });
    await expect(stashImage(sessionId, "https://cdn.test/429.gif")).rejects.toMatchObject({ code: "http_429", status: 429, retryAfterMs: 45_000 });
  });

  it("rejects static JPEG thumbnails and single-frame GIFs when requireAnimated is true", async () => {
    const jpg = await makeStaticJpeg();
    const singleGif = await makeStaticGif();
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const s = String(u);
      if (s.includes("thumb")) return new Response(new Uint8Array(jpg), { status: 200, headers: { "content-type": "image/jpeg" } });
      return new Response(new Uint8Array(singleGif), { status: 200, headers: { "content-type": "image/gif" } });
    }) as unknown as typeof fetch;

    await expect(
      stashImage(sessionId, "https://tse1.mm.bing.net/th?id=thumb1", "cat gif", undefined, { requireAnimated: true }),
    ).rejects.toMatchObject({ code: "not_animated" });

    await expect(
      stashImage(sessionId, "https://cdn.test/static-single.gif", "cat gif", undefined, { requireAnimated: true }),
    ).rejects.toMatchObject({ code: "not_animated" });
  });

  it("accepts genuine multi-frame animated GIFs and deduplicates identical bytes across different URLs", async () => {
    const gif1 = await makeAnimatedGif(20, 220);
    const gif2 = await makeAnimatedGif(180, 30);
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const s = String(u);
      const buf = s.includes("second") ? gif2 : gif1;
      return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/gif" } });
    }) as unknown as typeof fetch;

    const first = await stashImage(sessionId, "https://host-a.test/cat-1.gif", "cat 1", undefined, { requireAnimated: true });
    expect(first.animated).toBe(true);
    expect(first.frameCount).toBe(2);
    expect(first.mime).toBe("image/gif");

    // Different URL returning identical bytes -> rejected as duplicate!
    await expect(
      stashImage(sessionId, "https://host-b.test/mirror-cat-1.gif", "cat 1 mirror", undefined, { requireAnimated: true }),
    ).rejects.toBeInstanceOf(ImageFetchError);
    await expect(
      stashImage(sessionId, "https://host-b.test/mirror-cat-1.gif", "cat 1 mirror", undefined, { requireAnimated: true }),
    ).rejects.toMatchObject({ code: "duplicate" });

    // Distinct animated GIF -> accepted
    const second = await stashImage(sessionId, "https://host-b.test/second.gif", "cat 2", undefined, { requireAnimated: true });
    expect(second.animated).toBe(true);
    expect(second.hash).not.toBe(first.hash);
    expect(listStash(sessionId)).toHaveLength(2);
  });
});

describe("Failure diagnosis & request budget awareness", () => {
  it("maps 403, 404, 429, not_animated, and duplicate errors to targeted recovery strategies", () => {
    expect(diagnoseFailure({ action: "fetch_image", ok: false, hadEffect: true, resultText: "HTTP 403", errorCode: "http_403" })?.strategy).toBe("switch_source");
    expect(diagnoseFailure({ action: "fetch_image", ok: false, hadEffect: true, resultText: "HTTP 404", errorCode: "http_404" })?.strategy).toBe("alternate_route");
    expect(diagnoseFailure({ action: "fetch_image", ok: false, hadEffect: true, resultText: "HTTP 429", errorCode: "http_429" })?.strategy).toBe("backoff_and_switch");
    expect(diagnoseFailure({ action: "fetch_image", ok: false, hadEffect: true, resultText: "static", errorCode: "not_animated" })?.strategy).toBe("pick_direct_media");
    expect(diagnoseFailure({ action: "fetch_image", ok: false, hadEffect: true, resultText: "dup", errorCode: "duplicate" })?.strategy).toBe("pick_distinct_candidate");
  });

  it("reports LOW and CRITICAL budget states within the 32-request budget", () => {
    const budget = new InferenceRequestBudget(32);
    expect(budget.isLow).toBe(false);
    expect(budget.statusSummary()).toContain("32/32");
    for (let i = 0; i < 25; i++) budget.take("test", "model");
    expect(budget.remaining).toBe(7);
    expect(budget.isLow).toBe(true);
    expect(budget.statusSummary()).toContain("LOW");
    for (let i = 0; i < 4; i++) budget.take("test", "model");
    expect(budget.remaining).toBe(3);
    expect(budget.isCritical).toBe(true);
    expect(budget.statusSummary()).toContain("CRITICAL");
  });
});
