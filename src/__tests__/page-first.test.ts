import { describe, expect, it } from "vitest";
import type { BrowserDecision } from "@/lib/agent/action-protocol";
import { pickPageMedia, preferPageMedia } from "@/lib/agent/page-first";
import { InferenceRequestBudget } from "@/lib/llm/request-budget";

describe("page-first media", () => {
  it("skips thumbnails, duplicates and failed URLs, and keeps a few spares", () => {
    const candidates = [
      { url: "https://a.example/thumb.jpg", thumbnail: true },
      { url: "https://a.example/1.jpg" },
      { url: "https://a.example/1.jpg" },
      { url: "https://a.example/bad.jpg" },
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://b.example/${i}.jpg` })),
    ];
    const urls = pickPageMedia(candidates, { needed: 2, isUnusable: (u) => u.includes("bad") });
    expect(urls).toHaveLength(5);
    expect(urls[0]).toBe("https://a.example/1.jpg");
    expect(urls.some((u) => u.includes("thumb") || u.includes("bad"))).toBe(false);
  });

  it("requires real GIFs for animated goals and returns nothing when satisfied", () => {
    const candidates = [{ url: "https://a.example/still.jpg" }, { url: "https://a.example/move.gif" }];
    expect(pickPageMedia(candidates, { needed: 1, requireAnimated: true })).toEqual(["https://a.example/move.gif"]);
    expect(pickPageMedia(candidates, { needed: 0 })).toEqual([]);
  });

  it("turns leaving actions into a batch fetch, and leaves other actions alone", () => {
    const urls = ["https://a.example/1.jpg"];
    const click = { action: "click", id: 4 } as BrowserDecision;
    const done = { action: "done", answer: "ok" } as BrowserDecision;
    expect(preferPageMedia(click, urls)).toEqual({ action: "fetch_images", urls, send: true });
    expect(preferPageMedia(done, urls)).toBe(done);
    expect(preferPageMedia(click, [])).toBe(click);
  });
});

describe("inference budget refunds", () => {
  it("does not charge failed provider calls, up to the allowance", () => {
    const budget = new InferenceRequestBudget(2, { failedAllowance: 1 });
    const failed = budget.take("p", "m");
    failed.status = 429;
    budget.settle(failed);
    expect(budget.remaining).toBe(2);
    const second = budget.take("p", "m");
    second.status = 503;
    budget.settle(second);
    expect(budget.remaining).toBe(1);
  });

  it("always charges successful calls and keeps strict budgets strict", () => {
    const budget = new InferenceRequestBudget(2);
    const failed = budget.take("p", "m");
    failed.status = 429;
    budget.settle(failed);
    expect(budget.remaining).toBe(1);
    const flexible = new InferenceRequestBudget(2, { failedAllowance: 5 });
    const ok = flexible.take("p", "m");
    ok.status = 200;
    flexible.settle(ok);
    expect(flexible.remaining).toBe(1);
  });
});
