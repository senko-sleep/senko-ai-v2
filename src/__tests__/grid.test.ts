import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { bestTileUrl, buildGrid, readGridImages, type RawGridTile } from "@/lib/agent/grid";
import { pageMatchesGoal } from "@/lib/agent/page-first";

const signal = new AbortController().signal;
const tile = (candidates: RawGridTile["candidates"], groupSize = 6): RawGridTile => ({ candidates, alt: "", href: "", groupSize });

describe("generic grid parsing", () => {
  it("prefers the largest srcset image", () => {
    expect(bestTileUrl(tile([
      { value: "https://cdn.example/a-200.jpg", kind: "image", width: 200 },
      { value: "https://cdn.example/a-1600.jpg", kind: "image", width: 1600 },
    ]))).toBe("https://cdn.example/a-1600.jpg");
  });

  it("unwraps JSON attributes and wrapped links past thumbnails", () => {
    expect(bestTileUrl(tile([
      { value: "https://th.bing.com/th?id=1", kind: "image" },
      { value: '{"murl":"https://site.example/full.png","purl":"https://site.example/page"}', kind: "attr" },
    ]))).toBe("https://site.example/full.png");
    expect(bestTileUrl(tile([
      { value: "https://search.example/view?imgurl=https%3A%2F%2Fsite.example%2Fphoto.webp", kind: "link" },
    ]))).toBe("https://site.example/photo.webp");
  });

  it("ignores page links, thumbnails-only tiles and non-grid images", () => {
    expect(bestTileUrl(tile([{ value: "https://site.example/article", kind: "link" }]))).toBe("");
    expect(bestTileUrl(tile([{ value: "https://cdn.example/thumbs/a.jpg", kind: "image" }]))).toBe("");
    expect(buildGrid([tile([{ value: "https://cdn.example/hero.jpg", kind: "image" }], 1)])).toEqual([]);
  });
});

describe("page match", () => {
  it("needs the page to name the requested subject", () => {
    expect(pageMatchesGoal("send me 5 red panda pics", "https://www.bing.com/images/search?q=red%20panda", "Images")).toBe(true);
    expect(pageMatchesGoal("send me 5 red panda pics", "https://news.example/", "Today's headlines")).toBe(false);
    expect(pageMatchesGoal("send me 5 pics", "https://news.example/", "Pics")).toBe(false);
  });
});

describe("reading a real page", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); }, 30_000);
  afterAll(async () => { await browser?.close(); });
  afterEach(() => vi.unstubAllGlobals());

  it("reads an unfamiliar gallery and skips its lone banner", async () => {
    const page = await browser.newPage();
    const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const tiles = [1, 2, 3, 4].map((n) => `<div class="photo"><a href="https://gallery.example/full/${n}.jpg"><img alt="Photo ${n}" width="120" height="120" src="${pixel}"></a></div>`).join("");
    await page.setContent(`<header><img width="600" height="80" src="${pixel}" data-full="https://gallery.example/banner.jpg"></header><main>${tiles}</main>`);
    const images = await readGridImages(page, { goal: "send 3 photos", signal });
    expect(images.map((i) => i.url)).toEqual([1, 2, 3, 4].map((n) => `https://gallery.example/full/${n}.jpg`));
    expect(images[0].alt).toBe("Photo 1");
    await page.close();
  });

  it("does nothing for explicit requests", async () => {
    const page = await browser.newPage();
    await page.setContent("<main></main>");
    expect(await readGridImages(page, { goal: "send 5 nsfw images", signal })).toEqual([]);
    await page.close();
  });
});
