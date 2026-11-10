import { describe, it, expect, vi, afterEach } from "vitest";
import { googleImagesConfigured, searchMultiEngineImages, type ScrapedImage } from "@/lib/server/images";
import { relevantImageCandidates } from "@/lib/server/gallery-images";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); });

describe("Google Images engine (Programmable Search JSON API)", () => {
  it("is off until a key and search engine id are configured", () => {
    delete process.env.GOOGLE_CSE_KEY; delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_CSE_ID; delete process.env.GOOGLE_SEARCH_ENGINE_ID;
    expect(googleImagesConfigured()).toBe(false);
    process.env.GOOGLE_CSE_KEY = "k"; process.env.GOOGLE_CSE_ID = "cx";
    expect(googleImagesConfigured()).toBe(true);
  });

  it("returns image results from the official API with their source pages", async () => {
    process.env.GOOGLE_CSE_KEY = "test-key";
    process.env.GOOGLE_CSE_ID = "test-cx";
    process.env.SENKO_DISABLE_IMAGE_ENGINES = "bing,ddg,wallhaven,booru,gallery,reddit,wikimedia,openverse,proxy";
    delete process.env.SEARCH_API_URL;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      const start = Number(new URL(url).searchParams.get("start"));
      return new Response(JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({
        link: `https://img.example.com/anya-${start + i}.jpg`, title: `Anya Forger ${start + i}`, image: { contextLink: `https://example.com/page-${start + i}` },
      })) }), { status: 200 });
    }));
    const res = await searchMultiEngineImages("Anya Forger", 1, 50);
    expect(calls.every((u) => u.startsWith("https://customsearch.googleapis.com/customsearch/v1?") && u.includes("searchType=image") && u.includes("cx=test-cx"))).toBe(true);
    expect(calls).toHaveLength(3);
    expect(res.images).toHaveLength(30);
    expect(res.stats.google).toBe(30);
    expect(res.images[0]).toMatchObject({ url: "https://img.example.com/anya-1.jpg", source: "https://example.com/page-1", engine: "google" });
  });

  it("an engine outage leaves the others working", async () => {
    process.env.SENKO_DISABLE_IMAGE_ENGINES = "google,bing,ddg,wallhaven,booru,gallery,reddit,openverse,proxy";
    delete process.env.SEARCH_API_URL;
    const commons = { query: { pages: { 1: { title: "File:Eiffel Tower at night.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/orig.jpg", thumburl: "https://upload.wikimedia.org/thumb/1280px.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:x" }] } } } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(commons), { status: 200 })));
    const res = await searchMultiEngineImages("Eiffel Tower", 1, 20);
    // Web-sized rendition, not the multi-megabyte original.
    expect(res.images[0].url).toBe("https://upload.wikimedia.org/thumb/1280px.jpg");
  });
});

describe("collage relevance", () => {
  const img = (alt: string): ScrapedImage => ({ url: `https://x.test/${encodeURIComponent(alt)}.jpg`, alt, source: "", engine: "wikimedia" });

  it("names must match every word", () => {
    const out = relevantImageCandidates("Anya Forger", [img("Anya Forger smiling"), img("Anya Taylor-Joy"), img("Loid Forger")]);
    expect(out.map((i) => i.alt)).toEqual(["Anya Forger smiling"]);
  });

  it("longer descriptive searches allow one missing word, ranked after full matches", () => {
    const out = relevantImageCandidates("Eiffel Tower at night", [img("Eiffel Tower in spring"), img("Eiffel Tower lit at night"), img("Paris at night")]);
    expect(out.map((i) => i.alt)).toEqual(["Eiffel Tower lit at night", "Eiffel Tower in spring"]);
  });
});
