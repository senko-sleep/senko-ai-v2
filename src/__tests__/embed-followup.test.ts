// Regression: the conversation where follow-ups lost the embed action.
//   1. "send me an embedded anime website"            -> embedded an anime site (worked)
//   2. "now a random hentai website"                  -> ran a web search instead (with a Wikipedia article in it)
//   3. "no i want a manga website embedded so i can read, pick one"
//                                                     -> ignored the results it had and recommended unrelated sites
// Follow-ups are now read against what the chat already did (turn-context.ts), sites of a kind
// are picked from real results that are sites (not articles about them), and the reply only
// says "embedded" when a card exists.
import { describe, expect, it } from "vitest";
import { detectEmbedRequest } from "@/lib/embed/intent";
import { detectComicRequest } from "@/lib/comics/intent";
import { detectSearchRequest } from "@/lib/search/intent";
import { followContext, toolNote } from "@/lib/server/turn-context";
import { pickOrder, rankSites, runEmbedTurn, siteQuery, type EmbedDeps, type Probe, type SiteHit } from "@/lib/server/embed-reply";
import { searchWeb, type Provider } from "@/lib/server/web-search";
import { stripLiveTags } from "@/components/assistant/lib";
import type { MessageMeta, StoredMessage } from "@/lib/server/chats";
import type { SearchCard } from "@/lib/search/types";

let n = 0;
function msg(role: "user" | "assistant", content: string, meta: MessageMeta = {}): StoredMessage {
  return { id: `m${++n}`, role, content, imageIds: [], meta, createdAt: new Date(2026, 10, 13, 12, n).toISOString() };
}

const animeEmbed: MessageMeta = {
  embed: { url: "https://anime-site.example/", asked: "anime website", host: "anime-site.example", mode: "direct", topic: "anime" },
};
const hentaiSearch: SearchCard = {
  query: "hentai website",
  engines: ["bing"],
  safeSearch: "off",
  wanted: 10,
  results: [
    { title: "Hentai - Wikipedia", url: "https://en.wikipedia.org/wiki/Hentai", snippet: "Hentai is a style of Japanese pornographic anime and manga.", source: "en.wikipedia.org", engines: ["bing"], category: "wiki", link: "ok" },
    { title: "H-Reader: hentai manga and doujinshi, read online", url: "https://h-reader.example/", snippet: "Read hentai manga online", source: "h-reader.example", engines: ["bing"], category: "adult", link: "ok" },
    { title: "H-Tube: hentai videos", url: "https://h-tube.example/", snippet: "Watch hentai videos", source: "h-tube.example", engines: ["bing"], category: "adult", link: "ok" },
  ],
};

function probeOf(url: string, html = "<title>Site</title><h1>Welcome</h1>", extra: Partial<Probe> = {}): Probe {
  return { ok: true, status: 200, finalUrl: url, html, headers: new Headers(), challenged: false, ...extra };
}

function deps(over: Partial<EmbedDeps> & { calls?: string[] } = {}): Partial<EmbedDeps> {
  const calls = over.calls ?? [];
  return {
    probe: async (url) => probeOf(url, `<title>${new URL(url).hostname}</title>`),
    findSite: async () => null,
    youtube: async () => null,
    openLive: async () => { throw new Error("no live browser in tests"); },
    allowed: async () => ({ allowed: true }),
    random: () => 0,
    search: async (q) => {
      calls.push(q);
      return [];
    },
    ...over,
  };
}

const quiet = () => {};

describe("the transcript, turn by turn", () => {
  const t1 = msg("user", "send me an embedded anime website");
  const a1 = msg("assistant", "Here's **anime-site.example**, embedded~", animeEmbed);
  const t2 = msg("user", "now a random hentai website");

  it("turn 2 keeps the embed action from turn 1 instead of becoming a search for the words", () => {
    const ctx = followContext([t1, a1]);
    expect(ctx.lastTool).toBe("embed");
    const req = detectEmbedRequest(t2.content, ctx);
    expect(req).toMatchObject({ topic: "hentai", pick: "random", followUp: true });
    // The site shown already isn't picked again.
    expect(req?.exclude).toContain("anime-site.example");
    // Even if it did reach search, the query is the intent, not "now a random ...".
    expect(detectSearchRequest(t2.content)?.query).toBe("hentai website");
  });

  it("turn 3 is a manga site embedded for reading, picked by us, from the results already found", () => {
    const a2 = msg("assistant", "Here are 3 results for **hentai website**.", { search: hentaiSearch });
    const t3 = "no i want a manga website embedded so i can read, pick one";
    const ctx = followContext([t1, a1, t2, a2]);
    expect(ctx.results?.map((r) => r.url)).toContain("https://h-reader.example/");
    const req = detectEmbedRequest(t3, ctx);
    expect(req).toMatchObject({ topic: "manga", purpose: "read", pick: "random" });
    // Not the comic reader's site picker (MangaDex / Webtoon / Tapas) and not a bogus title.
    expect(detectComicRequest(t3)).toBeNull();
    expect(detectComicRequest("send me a hentai website")).toBeNull();
  });

  it("turn 3 embeds the manga site from the earlier results without searching again", async () => {
    const a2 = msg("assistant", "Here are 3 results.", { search: hentaiSearch });
    const follow = followContext([t1, a1, t2, a2]);
    const req = detectEmbedRequest("no i want a manga website embedded so i can read, pick one", follow)!;
    const calls: string[] = [];
    const turn = await runEmbedTurn(req, { safe: "off", step: quiet, follow, deps: deps({ calls }) });
    expect(calls).toEqual([]);
    expect(turn.meta.embed).toMatchObject({ host: "h-reader.example", topic: "manga", purpose: "read", mode: "direct" });
    expect(turn.content).toMatch(/results above/);
    expect(turn.content).toMatch(/embedded/);
  });
});

describe("follow-ups and delegation", () => {
  const afterEmbed = followContext([msg("user", "embed an anime site"), msg("assistant", "Here it is", animeEmbed)]);
  const afterSearch = followContext([msg("user", "search hentai website"), msg("assistant", "Here are 3 results", { search: hentaiSearch })]);

  it("'another one' / 'a different site' keeps the kind and skips what was shown", () => {
    for (const t of ["another one", "a different site", "send me another"]) {
      expect(detectEmbedRequest(t, afterEmbed), t).toMatchObject({ topic: "anime", pick: "random", exclude: ["anime-site.example"] });
    }
  });

  it("points at results on screen by number, and picks one when told to choose", () => {
    expect(detectEmbedRequest("embed the third one", afterSearch)).toMatchObject({ url: "https://h-tube.example/" });
    expect(detectEmbedRequest("pick one for me", afterSearch)).toMatchObject({ topic: "", pick: "random" });
  });

  it("doesn't hijack ordinary messages or list requests", () => {
    expect(detectEmbedRequest("ok but first tell me a joke", afterSearch)).toBeNull();
    expect(detectEmbedRequest("recommend me some anime sites", afterEmbed)).toBeNull();
    expect(detectEmbedRequest("top 10 hentai websites", afterEmbed)).toBeNull();
    expect(detectEmbedRequest("what is the best anime website", afterEmbed)).toBeNull();
    expect(detectEmbedRequest("how are you", afterEmbed)).toBeNull();
    // Fresh chat, no embed word, no delegation: not an embed.
    expect(detectEmbedRequest("i like anime websites")).toBeNull();
  });

  it("keeps the original shapes working", () => {
    expect(detectEmbedRequest("embed the crunchyroll website")).toMatchObject({ name: "crunchyroll" });
    expect(detectEmbedRequest("embed the new sml video")).toMatchObject({ name: "sml", video: "latest" });
    expect(detectEmbedRequest("send me a manga of fnf as a embed ui all pages")).toBeNull();
    expect(detectComicRequest("send me a manga of fnf as a embed ui all pages")).toMatchObject({ query: "fnf" });
  });
});

describe("choosing a site of a kind", () => {
  const found: SiteHit[] = [
    { title: "Hentai - Wikipedia", url: "https://en.wikipedia.org/wiki/Hentai", snippet: "Hentai is a style of anime" },
    { title: "Top 15 Best Hentai Sites (2026)", url: "https://blog.example/best-hentai-sites", snippet: "the best hentai sites ranked" },
    { title: "Hentai thread", url: "https://www.reddit.com/r/x/comments/1/hentai", snippet: "hentai" },
    { title: "HSite - free hentai", url: "https://hsite.example/videos/123", snippet: "free hentai videos" },
    { title: "Other hentai archive", url: "https://archive.example/", snippet: "hentai archive" },
  ];

  it("keeps only actual sites: no encyclopedia article, listicle or forum thread", () => {
    const sites = rankSites(found, "hentai", { homepage: true });
    expect(sites.map((s) => s.url)).toEqual(["https://hsite.example/", "https://archive.example/"]);
  });

  it("searches what someone would type to find one", () => {
    expect(siteQuery("manga", "read")).toBe("read manga online");
    expect(siteQuery("anime")).toBe("anime website");
  });

  it("random picks vary among the good ones; best takes the top", () => {
    const sites = rankSites(found, "hentai", { homepage: true });
    expect(pickOrder(sites, "best", () => 0.99)[0].url).toBe("https://hsite.example/");
    expect(pickOrder(sites, "random", () => 0.99)[0].url).toBe("https://archive.example/");
  });

  it("falls back to the next site when the chosen one doesn't load, and says so", async () => {
    const turn = await runEmbedTurn({ asked: "hentai website", topic: "hentai", pick: "best" }, {
      safe: "off", step: quiet,
      deps: deps({
        search: async () => found,
        probe: async (url) => (url.includes("hsite") ? { ...probeOf(url), ok: false, status: 503 } : probeOf(url)),
      }),
    });
    expect(turn.meta.embed?.host).toBe("archive.example");
    expect(turn.meta.embed?.skipped).toEqual(["hsite.example: HTTP 503"]);
    expect(turn.content).toMatch(/hsite\.example couldn't be embedded, so I went with archive\.example/);
  });

  it("prefers a site that really embeds over one behind a bot check, and falls back to it", async () => {
    const challenged = (url: string) => probeOf(url, "<title>Just a moment...</title>", { ok: false, status: 403, challenged: true });
    const prefer = await runEmbedTurn({ asked: "hentai website", topic: "hentai", pick: "best" }, {
      safe: "off", step: quiet,
      deps: deps({ search: async () => found, probe: async (url) => (url.includes("hsite") ? challenged(url) : probeOf(url)) }),
    });
    expect(prefer.meta.embed).toMatchObject({ host: "archive.example", mode: "direct" });
    const only = await runEmbedTurn({ asked: "hentai website", topic: "hentai", pick: "best" }, {
      safe: "off", step: quiet,
      deps: deps({ search: async () => found, probe: async (url) => (url.includes("hsite") ? challenged(url) : { ...probeOf(url), ok: false, status: 500 }) }),
    });
    expect(only.meta.embed).toMatchObject({ host: "hsite.example", mode: "live" });
  });

  it("skips a site whose own page is a directory of sites", async () => {
    const turn = await runEmbedTurn({ asked: "hentai website", topic: "hentai", pick: "best" }, {
      safe: "off", step: quiet,
      deps: deps({
        search: async () => found,
        probe: async (url) => probeOf(url, url.includes("hsite") ? "<title>Best Hentai Sites &amp; Free Tubes List of 2026</title>" : "<title>Archive</title>"),
      }),
    });
    expect(turn.meta.embed?.host).toBe("archive.example");
    expect(turn.meta.embed?.skipped).toEqual(["hsite.example: a list of sites, not one"]);
  });

  it("says nothing loaded instead of claiming an embed", async () => {
    const turn = await runEmbedTurn({ asked: "hentai website", topic: "hentai", pick: "best" }, {
      safe: "off", step: quiet,
      deps: deps({ search: async () => found, probe: async (url) => ({ ...probeOf(url), ok: false, status: 0, error: "ECONNREFUSED" }) }),
    });
    expect(turn.meta.embed).toBeUndefined();
    expect(turn.content).toMatch(/none would load/);
    expect(turn.content).not.toMatch(/embedded/);
  });

  it("reports a failed search honestly", async () => {
    const turn = await runEmbedTurn({ asked: "anime website", topic: "anime" }, { safe: "off", step: quiet, deps: deps() });
    expect(turn.meta.embed).toBeUndefined();
    expect(turn.content).toMatch(/couldn't reach the search engines/);
  });

  it("only articles and lists found: says so, doesn't embed Wikipedia", async () => {
    const turn = await runEmbedTurn({ asked: "hentai website", topic: "hentai" }, { safe: "off", step: quiet, deps: deps({ search: async () => found.slice(0, 3) }) });
    expect(turn.meta.embed).toBeUndefined();
    expect(turn.content).toMatch(/articles and lists/);
  });

  it("follows SafeSearch for adult kinds before searching", async () => {
    const calls: string[] = [];
    const turn = await runEmbedTurn({ asked: "hentai website", topic: "hentai" }, { safe: "moderate", step: quiet, deps: deps({ calls }) });
    expect(calls).toEqual([]);
    expect(turn.content).toMatch(/SafeSearch is set to moderate/);
  });
});

describe("how the site is shown", () => {
  const one: SiteHit[] = [{ title: "Anime site", url: "https://anime.example/", snippet: "watch anime" }];

  it("a site that forbids framing (X-Frame-Options / CSP) goes through the proxy", async () => {
    const turn = await runEmbedTurn({ asked: "anime website", topic: "anime" }, {
      safe: "off", step: quiet,
      deps: deps({ search: async () => one, probe: async (url) => probeOf(url, "<title>A</title>", { headers: new Headers({ "x-frame-options": "DENY" }) }) }),
    });
    expect(turn.meta.embed?.mode).toBe("proxy");
  });

  it("a bot-checked site with no live browser says it isn't showing, not that it's embedded", async () => {
    const turn = await runEmbedTurn({ asked: "anime website", topic: "anime" }, {
      safe: "off", step: quiet,
      deps: deps({ search: async () => one, probe: async (url) => probeOf(url, "<title>Just a moment...</title>", { ok: false, status: 403, challenged: true }) }),
    });
    expect(turn.meta.embed).toMatchObject({ mode: "live", liveUnavailable: true });
    expect(turn.content).not.toMatch(/embedded|I opened/);
    expect(turn.content).toMatch(/couldn't open it/);
  });
});

describe("the model sees what the tools showed", () => {
  it("search results and embeds are in the history note", () => {
    const s = toolNote({ search: hentaiSearch });
    expect(s).toContain("https://h-reader.example/");
    expect(s).toContain('search card for "hentai website"');
    expect(toolNote(animeEmbed)).toMatch(/anime-site\.example.*embedded directly/);
    expect(toolNote({})).toBe("");
  });

  it("the [[embed: url]] tool tag is hidden while streaming", () => {
    expect(stripLiveTags("On it!\n[[embed: https://a.example/]]")).toBe("On it!\n");
  });
});

describe("site searches", () => {
  it("drop encyclopedia articles about the topic when there are real sites", async () => {
    const provider: Provider = {
      name: "fake",
      run: async () => [
        { title: "Hentai - Wikipedia", url: "https://en.wikipedia.org/wiki/Hentai", snippet: "Hentai is anime and manga pornography" },
        { title: "HSite hentai", url: "https://hsite.example/", snippet: "hentai videos" },
        { title: "Archive hentai", url: "https://archive.example/", snippet: "hentai archive" },
      ],
    };
    const run = await searchWeb("hentai website", { safe: "off", count: 10, providers: [provider], checkLinks: false });
    expect(run.results.map((r) => r.source)).toEqual(["hsite.example", "archive.example"]);
    // Information searches keep it.
    const info = await searchWeb("hentai", { safe: "off", count: 10, providers: [provider], checkLinks: false });
    expect(info.results.map((r) => r.source)).toContain("en.wikipedia.org");
  });
});
