import { describe, expect, it, vi } from "vitest";
import { detectSearchRequest } from "@/lib/search/intent";
import { categorize, queryTerms, relevance } from "@/lib/search/classify";
import { ddgNextForm, parseBing, parseDdg, searchWeb, unwrapBingUrl, unwrapDdgUrl, type Provider, type RawResult } from "@/lib/server/web-search";
import { detectComicRequest } from "@/lib/comics/intent";

vi.mock("@/lib/server/entity-dossier", () => ({ buildEntityDossier: async () => null }));

const fake = (name: string, results: RawResult[] | Error, seen?: { safe?: string }): Provider => ({
  name,
  async run(_q, _w, safe) {
    if (seen) seen.safe = safe;
    if (results instanceof Error) throw results;
    return results;
  },
});
const r = (url: string, title: string, snippet = ""): RawResult => ({ url, title, snippet });

describe("detectSearchRequest", () => {
  it("keeps the user's exact words, adult terms included", () => {
    expect(detectSearchRequest("FNF hentai")).toEqual({ query: "FNF hentai", count: 10 });
    expect(detectSearchRequest("send me fnf hentai")).toEqual({ query: "fnf hentai", count: 10 });
    expect(detectSearchRequest("can you search for fnf hentai")).toEqual({ query: "fnf hentai", count: 10 });
  });

  it("reads how many results were asked for", () => {
    expect(detectSearchRequest("top 20 sites for fnf hentai")).toEqual({ query: "fnf hentai", count: 20 });
    expect(detectSearchRequest("show me the top 20 results for rust borrow checker")).toEqual({ query: "rust borrow checker", count: 20 });
    expect(detectSearchRequest("search best roguelike games, 15 results")?.count).toBe(15);
    expect(detectSearchRequest("top 99 sites for anything")?.count).toBe(30);
  });

  it("covers the usual ways of asking", () => {
    expect(detectSearchRequest("google nextjs app router docs")?.query).toBe("nextjs app router docs");
    expect(detectSearchRequest("look up hollow knight silksong release date")?.query).toBe("hollow knight silksong release date");
    expect(detectSearchRequest("websites for free sheet music")?.query).toBe("free sheet music");
    expect(detectSearchRequest("where can I read one piece")?.query).toBe("read one piece");
    expect(detectSearchRequest("search rust borrow checker on google")?.query).toBe("rust borrow checker");
  });

  it("leaves chat, image requests and agent jobs alone", () => {
    expect(detectSearchRequest("hi")).toBeNull();
    expect(detectSearchRequest("what is hentai")).toBeNull();
    expect(detectSearchRequest("show me nsfw pics of girlfriend fnf")).toBeNull();
    expect(detectSearchRequest("search flights to tokyo and book the cheapest")).toBeNull();
    expect(detectSearchRequest("I like manga")).toBeNull();
  });

  it("the comic reader no longer rewrites adult requests (search handles them)", () => {
    expect(detectComicRequest("send me fnf hentai")?.explicit).toBe(true);
    expect(detectSearchRequest("send me fnf hentai")?.query).toBe("fnf hentai");
  });
});

describe("classify", () => {
  it("sorts results by what the site is", () => {
    expect(categorize("https://nhentai.net/g/1", "FNF", "")).toBe("adult");
    expect(categorize("https://rule34.xxx/index.php", "fnf", "")).toBe("adult");
    expect(categorize("https://www.reddit.com/r/x", "FNF hentai thread", "")).toBe("adult");
    expect(categorize("https://mangadex.org/title/1", "One Piece", "")).toBe("comics");
    expect(categorize("https://www.webtoons.com/en/canvas/x", "FNF comic", "")).toBe("comics");
    expect(categorize("https://www.youtube.com/watch?v=1", "FNF mod", "")).toBe("video");
    expect(categorize("https://doc.rust-lang.org/book/ch04", "References and Borrowing", "")).toBe("docs");
    expect(categorize("https://developer.mozilla.org/en-US/docs/Web", "fetch()", "")).toBe("docs");
    expect(categorize("https://github.com/rust-lang/rust", "rust", "")).toBe("code");
    expect(categorize("https://store.steampowered.com/app/1", "Hades", "")).toBe("gaming");
    expect(categorize("https://gamebanana.com/mods/1", "FNF mod", "")).toBe("gaming");
    expect(categorize("https://en.wikipedia.org/wiki/Rust", "Rust", "")).toBe("wiki");
    expect(categorize("https://www.pinterest.com/pin/1", "cats", "")).toBe("images");
  });

  it("scores how much of the query a result matches", () => {
    const t = queryTerms("fnf hentai");
    expect(t).toEqual(["fnf", "hentai"]);
    expect(relevance(t, r("https://x.com/fnf-hentai", "FNF Hentai"))).toBe(1);
    expect(relevance(t, r("https://www.webtoons.com/en/canvas/fnf", "FNF Comic"))).toBe(0.5);
    expect(relevance(t, r("https://x.example/a", "Friday Night Funkin' hentai collection"))).toBe(1);
    expect(relevance(t, r("https://x.example/b", "Fun nights in Finland"))).toBe(0);
  });
});

describe("engine parsers", () => {
  it("unwraps redirect links to the real page", () => {
    const b64 = Buffer.from("https://doc.rust-lang.org/book/").toString("base64url");
    expect(unwrapBingUrl(`https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${b64}&amp;ntb=1`)).toBe("https://doc.rust-lang.org/book/");
    expect(unwrapDdgUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1")).toBe("https://example.com/a");
  });

  it("reads Bing and DuckDuckGo result pages", () => {
    const b64 = Buffer.from("https://blog.example.com/borrow").toString("base64url");
    const bing = `<ol><li class="b_algo" data-id><div><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;u=a1${b64}&amp;ntb=1">The <strong>borrow checker</strong></a></h2><p class="b_lineclamp2"><span class="news_dt">Mar 25, 2024</span>&nbsp;&#0183;&#32;How Rust&#39;s borrow checker works</p></div></li></ol>`;
    expect(parseBing(bing)).toEqual([{ url: "https://blog.example.com/borrow", title: "The borrow checker", snippet: "How Rust's borrow checker works" }]);

    const ddg = `<div class="result results_links results_links_deep web-result "><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdocs&amp;rut=x">Example <b>Docs</b></a></h2><a class="result__snippet" href="#">The <b>docs</b> page</a></div>
      <div class="result results_links result--ad "><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
      <div class="nav-link"><form action="/html/" method="post"><input type="submit" value="Next" /><input type="hidden" name="q" value="x" /><input type="hidden" name="s" value="10" /><input type="hidden" name="vqd" value="4-1" /></form></div>`;
    expect(parseDdg(ddg)).toEqual([{ url: "https://example.org/docs", title: "Example Docs", snippet: "The docs page" }]);
    expect(ddgNextForm(ddg)?.toString()).toBe("q=x&s=10&vqd=4-1");
  });
});

describe("searchWeb", () => {
  it("returns only what the engines returned, fused across engines", async () => {
    const run = await searchWeb("fnf hentai", {
      safe: "off",
      count: 20,
      checkLinks: false,
      providers: [
        fake("google", [r("https://site-a.example/fnf-hentai", "FNF hentai - Site A"), r("https://site-b.example/fnf", "FNF Hentai collection")]),
        fake("bing", [r("https://site-b.example/fnf", "FNF Hentai collection", "snippet from bing"), r("https://site-c.example/fnf-hentai", "fnf hentai gallery")]),
      ],
    });
    expect(run.results.map((x) => x.url)).toEqual(["https://site-b.example/fnf", "https://site-a.example/fnf-hentai", "https://site-c.example/fnf-hentai"]);
    expect(run.results[0].engines).toEqual(["google", "bing"]);
    expect(run.results[0].snippet).toBe("snippet from bing");
    expect(run.results.every((x) => x.category === "adult")).toBe(true);
  });

  it("drops results that don't match instead of offering unrelated sites", async () => {
    const run = await searchWeb("fnf hentai", {
      safe: "off",
      count: 10,
      checkLinks: false,
      providers: [
        fake("google", [
          r("https://www.webtoons.com/en/canvas/list", "Webtoon Canvas"),
          r("https://mangadex.org/", "MangaDex"),
          r("https://site-a.example/fnf-hentai", "FNF hentai"),
          r("https://site-d.example/x", "fnf hentai comics"),
          r("https://site-e.example/y", "More FNF hentai"),
        ]),
      ],
    });
    expect(run.results.map((x) => x.source)).toEqual(["site-a.example", "site-d.example", "site-e.example"]);
  });

  it("falls back to the next engine when one fails or finds nothing", async () => {
    const run = await searchWeb("rust borrow checker", {
      safe: "off",
      count: 10,
      checkLinks: false,
      providers: [fake("google", new Error("quota")), fake("bing", []), fake("duckduckgo", [r("https://doc.rust-lang.org/borrow", "The Rust borrow checker")])],
    });
    expect(run.engines).toEqual(["duckduckgo"]);
    expect(run.results).toHaveLength(1);
    expect(run.attempts.find((a) => a.engine === "google")?.error).toBe("quota");
  });

  it("passes SafeSearch to the engines and hides adult results when it is on", async () => {
    const seen: { safe?: string } = {};
    const run = await searchWeb("fnf hentai", {
      safe: "moderate",
      count: 10,
      checkLinks: false,
      providers: [fake("bing", [r("https://nhentai.net/g/1", "FNF hentai"), r("https://fnf.fandom.com/wiki/hentai_policy", "FNF wiki: hentai policy")], seen)],
    });
    expect(seen.safe).toBe("moderate");
    expect(run.hiddenAdult).toBeGreaterThanOrEqual(1);
    expect(run.results.some((x) => x.source === "nhentai.net")).toBe(false);
  });

  it("drops links that don't resolve", async () => {
    const run = await searchWeb("rust borrow checker", {
      safe: "off",
      count: 10,
      providers: [fake("bing", [r("https://does-not-exist.invalid/rust-borrow-checker", "rust borrow checker"), r("http://127.0.0.1/rust-borrow-checker", "rust borrow checker local")])],
    });
    expect(run.results).toEqual([]);
  });
});

describe("search legal limits", () => {
  it("refuses sexual searches involving minors, allows other adult searches", async () => {
    const { searchAllowed } = await import("@/lib/server/search-reply");
    expect((await searchAllowed("loli hentai")).allowed).toBe(false);
    expect((await searchAllowed("fnf hentai")).allowed).toBe(true);
    expect((await searchAllowed("rust borrow checker")).allowed).toBe(true);
  });
});

describe("kind words", () => {
  it("an adult page about the subject matches 'hentai' even when it says 'rule34'", () => {
    const t = queryTerms("fnf hentai");
    const page = r("https://scrollx.org/tag/fnf", "Friday Night Funkin' Rule34 Art & Videos", "");
    expect(relevance(t, page, categorize(page.url, page.title, page.snippet))).toBe(1);
    const mod = r("https://www.nexusmods.com/fridaynightfunkin/mods/217", "Friday Night Funkin' Nexus - Mods", "fully twitch safe");
    expect(relevance(t, mod, categorize(mod.url, mod.title, mod.snippet))).toBe(0.5);
  });
});

describe("adult tagging on known sites", () => {
  it("a store's genre list doesn't make a page adult", () => {
    expect(categorize("https://www.amazon.com/one-piece/s", "Amazon.com: One Piece Manga", "Fantasy, Romance, Erotica, Science Fiction")).toBe("shopping");
  });
});
