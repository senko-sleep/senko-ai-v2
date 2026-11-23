import { afterEach, describe, expect, it, vi } from "vitest";
import { ddgGridNote, fetchDdgGrid } from "@/lib/agent/ddg-grid";

const signal = new AbortController().signal;

function mockDdg(results: unknown[]) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/i.js")) return new Response(JSON.stringify({ results }), { status: 200 });
    return new Response(`<script>vqd="4-123"</script>`, { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("DuckDuckGo grid reader", () => {
  it("returns unique direct URLs and requests the strict filter", async () => {
    const fn = mockDdg([
      { image: "https://a.example/1.jpg", title: "One", url: "https://a.example/p" },
      { image: "https://a.example/1.jpg", title: "Dup" },
      { image: "not-a-url" },
      { image: "https://b.example/2.png" },
    ]);
    const out = await fetchDdgGrid("red pandas", signal);
    expect(out.map((i) => i.url)).toEqual(["https://a.example/1.jpg", "https://b.example/2.png"]);
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("kp=1");
    expect(urls[1]).toContain("p=1");
  });

  it("lists URLs for ordinary DDG searches", async () => {
    mockDdg([{ image: "https://a.example/1.jpg", title: "One" }]);
    const note = await ddgGridNote({ engine: "ddg", goal: "send 5 red panda pics", query: "red panda", signal });
    expect(note).toContain("fetch_images");
    expect(note).toContain("https://a.example/1.jpg");
  });

  it("does nothing for other engines or explicit requests", async () => {
    const fn = mockDdg([{ image: "https://a.example/1.jpg" }]);
    expect(await ddgGridNote({ engine: "bing", goal: "red pandas", query: "red pandas", signal })).toBe("");
    expect(await ddgGridNote({ engine: "ddg", goal: "send 5 nsfw images", query: "nsfw", signal })).toBe("");
    expect(fn).not.toHaveBeenCalled();
  });
});
