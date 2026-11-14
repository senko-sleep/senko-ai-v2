import { describe, expect, it } from "vitest";
import { detectComicRequest, OTHER_SITE, parseSeriesChoice, parseSourceChoice } from "@/lib/comics/intent";
import {
  COMIC_SOURCES, aboutSubject, parseGalleryPage, parseGallerySearch, parseEhGallery, parseEhImage, parseEhSearch, parseTapasPages, parseTapasSearch,
  parseWebtoonEpisodes, parseWebtoonPages, parseWebtoonSearch, sourcesFor,
} from "@/lib/server/comics";
import type { ComicSeries } from "@/lib/comics/types";

describe("detectComicRequest", () => {
  it.each([
    "pic one for me make it for manga i wanna embed so i can read",
    "pick one for me make it for manga i wanna embed so i can read",
    "choose one for me manga please",
    "select something for me as a manga reader",
    "send me a manga of pick one for me",
  ])("does not invent a comic title from the follow-up %j", (text) => {
    expect(detectComicRequest(text)).toBeNull();
  });

  it("keeps real titles containing choice words", () => {
    expect(detectComicRequest("show me a one piece manga")?.query).toBe("one piece");
    expect(detectComicRequest("read a manga called Pick One")?.query).toBe("Pick One");
  });

  it("pulls the subject out of a reader request", () => {
    expect(detectComicRequest("send me a manga of fnf as a embed ui all pages")).toEqual({ query: "fnf", source: undefined });
    expect(detectComicRequest("show me a one piece manga")?.query).toBe("one piece");
    expect(detectComicRequest("find me an fnf comic")?.query).toBe("fnf");
    expect(detectComicRequest("i wanna read a manhwa about solo leveling")?.query).toBe("solo leveling");
  });

  it("notices a site named in the same message", () => {
    expect(detectComicRequest("send me fnf comics from webtoon")).toEqual({ query: "fnf", source: "webtoon-canvas" });
    expect(detectComicRequest("give me a chainsaw man manga on mangadex")).toEqual({ query: "chainsaw man", source: "mangadex" });
  });

  it("flags porn requests and keeps the plain subject", () => {
    expect(detectComicRequest("send me fnf hentai")).toEqual({ query: "fnf", source: undefined, explicit: true });
    expect(detectComicRequest("send me a nsfw manga of fnf")).toEqual({ query: "fnf", source: undefined, explicit: true });
    expect(detectComicRequest("send me a manga of fnf")?.explicit).toBeUndefined();
    expect(detectComicRequest("fnf rule 34 hentai ui i wanna read a comic here")).toEqual({ query: "fnf", source: undefined, explicit: true });
  });

  it("knows the new sites, and that e-hentai means adult", () => {
    expect(detectComicRequest("send me fnf comics from tapas")).toEqual({ query: "fnf", source: "tapas" });
    expect(detectComicRequest("read an fnf doujin on e-hentai")).toEqual({ query: "fnf", source: "ehentai", explicit: true });
  });

  it("leaves adult image requests to the image flow", () => {
    expect(detectComicRequest("send me fnf hentai pics")).toBeNull();
  });

  it("leaves questions about comics to the normal chat", () => {
    expect(detectComicRequest("what is a manga")).toBeNull();
    expect(detectComicRequest("how do I draw a comic")).toBeNull();
    expect(detectComicRequest("I like manga")).toBeNull();
  });
});

describe("choices", () => {
  it("reads a site pick by number or name", () => {
    expect(parseSourceChoice("2", COMIC_SOURCES)).toBe(COMIC_SOURCES[1].id);
    expect(parseSourceChoice("MangaDex", COMIC_SOURCES)).toBe("mangadex");
    expect(parseSourceChoice("webtoon originals please", COMIC_SOURCES)).toBe("webtoon-originals");
    expect(parseSourceChoice("Webtoon Canvas", COMIC_SOURCES)).toBe("webtoon-canvas");
    expect(parseSourceChoice("lol ok", COMIC_SOURCES)).toBeNull();
  });

  const results: ComicSeries[] = ["FNF: Corruption Before Story", "Bob and Friends FNF", "Pico's School"].map((title, i) => ({
    id: String(i), source: "webtoon-canvas", title, url: `https://www.webtoons.com/x/${i}`,
  }));

  it("reads a series pick by number, ordinal or title", () => {
    expect(parseSeriesChoice("#2 Bob and Friends FNF", results)?.id).toBe("1");
    expect(parseSeriesChoice("3", results)?.id).toBe("2");
    expect(parseSeriesChoice("the first one", results)?.id).toBe("0");
    expect(parseSeriesChoice("corruption before story", results)?.id).toBe("0");
    expect(parseSeriesChoice("tell me a joke", results)).toBeNull();
    expect(OTHER_SITE.test("try a different site")).toBe(true);
  });
});

describe("site lists", () => {
  it("lists only hentai sites for adult requests, and none for normal ones", () => {
    expect(sourcesFor(false).some((s) => s.adult)).toBe(false);
    expect(sourcesFor(true).map((s) => s.id)).toEqual(["imhentai", "ehentai", "hentaiera", "hentaifox"]);
    expect(parseSourceChoice("tapas", sourcesFor(false))).toBe("tapas");
    expect(parseSourceChoice("1", sourcesFor(true))).toBe("imhentai");
    expect(parseSourceChoice("hentai fox", sourcesFor(true))).toBe("hentaifox");
    expect(detectComicRequest("read fnf doujins on imhentai")).toEqual({ query: "fnf", source: "imhentai", explicit: true });
  });

  it("keeps adult results about the subject", () => {
    const q = ["Friday Night Funkin", "fnf"];
    expect(aboutSubject({ title: "[Pixiv] FNF" }, q)).toBe(true);
    expect(aboutSubject({ title: "Gallery", description: "parody:friday night funkin, character:girlfriend" }, q)).toBe(true);
    expect(aboutSubject({ title: "[GD Mechano] n.f.n.f. [Dante x Vergil]" }, q)).toBe(false);
    expect(aboutSubject({ title: "Koyanslaya CN FN" }, q)).toBe(false);
  });
});

describe("gallery engine parsing (IMHentai / HentaiEra / HentaiFox)", () => {
  it("reads search cards", () => {
    const html = `<div class="thumb" data-tags="38 41"><div class="inner_thumb"><a href="/gallery/1676528/"><img class="lazy" data-src="https://m11.imhentai.xxx/032/80hrowf2jn/thumb.jpg" /></a></div>
      <div class="caption"><a href="/gallery/1676528/">Enigi09 - deltarune art</a></div></div>
      <div class="thumb" data-tags="1"><div class="g_type"><h3 class="g_cat"><a class="t_cat" href="/category/doujinshi/">Doujinshi</a></h3></div>
      <div class="inner_thumb"><a href="/gallery/159862/"><img class="lazy" data-src="https://i3.hentaifox.com/004/3852327/thumb.jpg" alt="" /></a></div>
      <div class="caption"><h2 class="g_title"><a href="/gallery/159862/">Gender Change Party</a></h2></div></div>`;
    const r = parseGallerySearch(html, "imhentai");
    expect(r.map((s) => [s.title, s.url, s.cover])).toEqual([
      ["Enigi09 - deltarune art", "https://imhentai.xxx/gallery/1676528/", "https://m11.imhentai.xxx/032/80hrowf2jn/thumb.jpg"],
      ["Gender Change Party", "https://imhentai.xxx/gallery/159862/", "https://i3.hentaifox.com/004/3852327/thumb.jpg"],
    ]);
    expect(r[1].stat).toBe("Doujinshi");
  });

  it("reads tags and every page image", () => {
    const html = `<a href='/parody/friday-night-funkin/'>x</a><a href='/tag/big-breasts/'>y</a>
      <img class="lazy preloader" data-src="https://m11.imhentai.xxx/032/80hrowf2jn/1t.jpg">
      <script>var g_th = $.parseJSON('{"1":"w,1280,839","2":"j,956,1057"}');</script>`;
    expect(parseGalleryPage(html)).toEqual({
      tags: ["parody:friday night funkin", "tag:big breasts"],
      pages: [
        { src: "https://m11.imhentai.xxx/032/80hrowf2jn/1.webp", width: 1280, height: 839 },
        { src: "https://m11.imhentai.xxx/032/80hrowf2jn/2.jpg", width: 956, height: 1057 },
      ],
    });
  });
});

describe("Tapas and E-Hentai parsing", () => {
  it("reads Tapas search cards and episode images", () => {
    const html = `<li class="search-item-wrap"><div class="item-thumb-wrap"><a class="thumb-wrap" data-series-id="256287" href="/series/BF-Vs-The-Nobody">
      <img src="https://us-a.tapas.io/sa/ac/x_m.png" alt="BF Vs The Nobody" width="140" height="140"></a></div>
      <div class="title-section"><p class="title"><a class="link link--ink js-fb-tracking" data-series-id="256287" href="/series/BF-Vs-The-Nobody">BF Vs The Nobody</a></p></div></li>`;
    expect(parseTapasSearch(html)).toEqual([
      { id: "256287", source: "tapas", title: "BF Vs The Nobody", author: undefined, cover: "https://us-a.tapas.io/sa/ac/x_m.png", url: "https://tapas.io/series/BF-Vs-The-Nobody" },
    ]);
    const viewer = `<img class="content__img js-lazy" src="data:image/gif;base64,R0" data-src="https://us-a.tapas.io/c/00/p.png?__token__=a&amp;version=v4" data-width="940" data-height="1330">`;
    expect(parseTapasPages(viewer)).toEqual([{ src: "https://us-a.tapas.io/c/00/p.png?__token__=a&version=v4", width: 940, height: 1330 }]);
  });

  const row = (gid: string, tags: string[]) =>
    `<tr><td class="gl1c glcat"><div class="cn cta">Western</div></td><td class="gl2c"><div class="glthumb"><div><img alt="x" src="https://ehgt.org/w/${gid}.webp" /></div><div><div>94 pages</div></div></div></td>` +
    `<td class="gl3c glname"><a href="https://e-hentai.org/g/${gid}/c8d65322cf/"><div class="glink">[Artist] Gallery ${gid}</div><div>${tags.map((t) => `<div class="gt" title="${t}">${t}</div>`).join("")}</div></a></td>` +
    `<td class="gl4c glhide"><div><a href="https://e-hentai.org/uploader/Toasty">Toasty</a></div></td></tr>`;

  it("reads E-Hentai rows with their tags", () => {
    const [g] = parseEhSearch(`<table><tr><th>x</th></tr>${row("4297937", ["parody:friday night funkin", "character:girlfriend"])}</table>`);
    expect(g).toMatchObject({ id: "https://e-hentai.org/g/4297937/c8d65322cf/", title: "[Artist] Gallery 4297937", author: "Toasty", cover: "https://ehgt.org/w/4297937.webp", stat: "Western · 94 pages" });
    expect(g.tags).toContain("character:girlfriend");
  });

  it("reads gallery page links and the page image", () => {
    const html = `<a href="https://e-hentai.org/s/d5a35de0e0/4297937-1"></a><a href="https://e-hentai.org/s/e74cb6d217/4297937-2"></a><p class="gpc">Showing 1 - 20 of 94 images</p>`;
    expect(parseEhGallery(html)).toEqual({ pages: ["https://e-hentai.org/s/d5a35de0e0/4297937-1", "https://e-hentai.org/s/e74cb6d217/4297937-2"], total: 94 });
    expect(parseEhImage(`<img id="img" src="https://a.hath.network/h/x/p.webp" style="">`)).toBe("https://a.hath.network/h/x/p.webp");
  });
});

describe("Webtoon parsing", () => {
  it("reads search cards", () => {
    const html = `<li><a href="https://www.webtoons.com/en/canvas/fnf-x/list?title_no=639802" class="link _card_item" data-title-no="639802">
      <div class="image_wrap" data-title-unsuitable-for-children="true"><img src="https://webtoon-phinf.pstatic.net/a.png?type=q90" width="192"></div>
      <div class="info_text"><strong class="title">FNF: Corruption &amp; Story</strong><div class="author">FBP</div><div class="view_count">10K Views</div></div></a></li>`;
    expect(parseWebtoonSearch(html, "webtoon-canvas")).toEqual([
      { id: "https://www.webtoons.com/en/canvas/fnf-x/list?title_no=639802", source: "webtoon-canvas", title: "FNF: Corruption & Story", author: "FBP",
        cover: "https://webtoon-phinf.pstatic.net/a.png?type=q90", url: "https://www.webtoons.com/en/canvas/fnf-x/list?title_no=639802", stat: "10K Views", mature: true },
    ]);
  });

  it("reads episodes and page images", () => {
    const list = `<li class="_episodeItem detail_list_item" id="episode_4" data-episode-no="4">
      <a href="https://www.webtoons.com/en/canvas/x/p4/viewer?title_no=1&amp;episode_no=4" class="detail_list_link">
      <span class="subj"><span>Prologue Part 4</span></span><span class="date">Dec 19, 2021</span></a></li>`;
    expect(parseWebtoonEpisodes(list)).toEqual([{ no: 4, title: "Prologue Part 4", url: "https://www.webtoons.com/en/canvas/x/p4/viewer?title_no=1&episode_no=4", date: "Dec 19, 2021" }]);
    const viewer = `<img src="bg.png" width="800" height="1280.0" alt="image" class="_images" data-url="https://webtoon-phinf.pstatic.net/p1.png?type=opti">`;
    expect(parseWebtoonPages(viewer)).toEqual([{ src: "https://webtoon-phinf.pstatic.net/p1.png?type=opti", width: 800, height: 1280 }]);
  });
});
