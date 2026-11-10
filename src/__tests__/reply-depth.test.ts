import { describe, expect, it } from "vitest";
import { wantsDeepThinking } from "@/lib/server/reply-depth";
import { parseGoogleImagesHtml } from "@/lib/server/google-browser-images";

describe("thinking only where it helps", () => {
  it.each(["hey how are you", "lol", "good morning!", "i'm tired today", "thanks!"])("quick: %s", (q) => expect(wantsDeepThinking(q)).toBe(false));
  it.each([
    "why is the sky blue but sunsets are red?",
    "compare python and rust for a cli tool",
    "who would win, goku or saitama",
    "plan a 3 day trip to kyoto",
    "solve 3x + 7 = 22",
    "explain how vaccines work",
  ])("deep: %s", (q) => expect(wantsDeepThinking(q)).toBe(true));
  it("visual, places and attachments always think", () => {
    expect(wantsDeepThinking("chara", { visual: true })).toBe(true);
    expect(wantsDeepThinking("ramen", { places: true })).toBe(true);
    expect(wantsDeepThinking("what's this", { attachments: true })).toBe(true);
  });
});

describe("Google Images results page parsing", () => {
  it("pulls full-size images and their pages, skipping thumbnails", () => {
    const html = `junk ["https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",194,259] x ["https://cdn.example.com/gojo.jpg",1080,1920],null,"https://example.com/gojo-wiki" ["https://img.example.org/tiny.png",80,80] ["https://a.example.net/p\u003d1.webp",800,600] "https://site.example/page"`;
    const out = parseGoogleImagesHtml(html);
    expect(out.map((i) => i.url)).toEqual(["https://cdn.example.com/gojo.jpg", "https://a.example.net/p=1.webp"]);
    expect(out[0]).toMatchObject({ width: 1920, height: 1080, source: "https://example.com/gojo-wiki" });
  });
});
