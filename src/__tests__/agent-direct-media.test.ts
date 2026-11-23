import { describe, expect, it } from "vitest";
import { fetchUntil, rankGridImages } from "@/lib/agent/direct-media";
import { annotationStyle, pickLabels } from "@/lib/agent/annotations";
import { createLiveStream } from "@/lib/server/live-stream";

const image = (url: string, alt = "", source = "") => ({ url, alt, source });

describe("rankGridImages", () => {
  it("drops images with no sign of being on-topic instead of padding the count", () => {
    const ranked = rankGridImages([image("https://a.test/car.jpg", "Red sports car"), image("https://a.test/1.jpg", "Tsundere anime girl")], "tsundere");
    expect(ranked.map((r) => r.alt)).toEqual(["Tsundere anime girl"]);
  });
  it("requires every search term and treats plurals as the same word", () => {
    const ranked = rankGridImages([image("https://a.test/1.jpg", "Red fox in snow"), image("https://a.test/2.jpg", "Red panda")], "red foxes");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].alt).toBe("Red fox in snow");
  });
  it("prefers a title match over a URL-only match", () => {
    const ranked = rankGridImages([image("https://a.test/eevee.jpg", "Pokemon art"), image("https://a.test/2.jpg", "Eevee drawing")], "eevee");
    expect(ranked[0].alt).toBe("Eevee drawing");
  });
});

describe("fetchUntil", () => {
  it("runs in parallel within the limit and stops starting work once enough succeeded", async () => {
    let active = 0, peak = 0, started = 0;
    const out = await fetchUntil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3, async (n) => {
      started++;
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    }, { concurrency: 3 });
    expect(out).toEqual([1, 2, 3]);
    expect(peak).toBe(3);
    expect(started).toBeLessThan(12);
  });
  it("replaces failures with later candidates and reports them", async () => {
    const failed: number[] = [];
    const out = await fetchUntil([1, 2, 3, 4], 2, async (n) => { if (n < 3) throw new Error("no"); return n; }, { concurrency: 1, onError: (n) => failed.push(n) });
    expect(out).toEqual([3, 4]);
    expect(failed).toEqual([1, 2]);
  });
  it("stops when cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await fetchUntil([1, 2], 2, async (n) => n, { signal: ctl.signal })).toEqual([]);
  });
});

describe("annotations", () => {
  it("styles interactive targets differently from content", () => {
    expect(annotationStyle({ kind: "button", clickable: true }).dashed).toBe(false);
    expect(annotationStyle({ kind: "image", clickable: false }).dashed).toBe(true);
    expect(annotationStyle({ kind: "input", clickable: true }).stroke).not.toBe(annotationStyle({ kind: "link", clickable: true }).stroke);
  });
  it("never places two labels on top of each other, and favours the agent's targets", () => {
    const base = { kind: "button" as const, x: 10, y: 40, w: 80, h: 20 };
    const picked = pickLabels([{ ...base, label: "Other" }, { ...base, id: 7, label: "Target" }]);
    expect(picked.map((p) => p.label)).toEqual(["Target"]);
  });
  it("keeps only the newest overlay snapshot for a slow viewer, and drops it on navigation", async () => {
    type E = { type: string; id?: number };
    let emit!: (e: E) => void;
    const stream = createLiveStream<E>((fn) => { emit = fn; return () => {}; }, new AbortController().signal);
    emit({ type: "status", id: 1 });
    emit({ type: "annotations", id: 2 });
    emit({ type: "annotations", id: 3 });
    const reader = stream.getReader();
    const read = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    expect((await read()).id).toBe(1);
    expect((await read()).id).toBe(3);
    emit({ type: "annotations", id: 4 });
    emit({ type: "reset", id: 5 });
    expect((await read()).id).toBe(4);
    expect((await read()).id).toBe(5);
    await reader.cancel();
  });
});
