import { describe, expect, it } from "vitest";
import { detectEmbedRequest } from "@/lib/embed/intent";
import {
  allowsFraming, extractVideos, isParked, latestListLink, parseChannelFeed, runEmbedTurn, scriptRedirect, videoPageLinks,
  type EmbedDeps, type Probe,
} from "@/lib/server/embed-reply";
import { proxyAsset, proxyClientScript, rewriteCss, rewriteHtml } from "@/lib/server/proxy-rewrite";
import { fetchUpstream, looksChallenged } from "@/lib/server/upstream-fetch";

describe("detectEmbedRequest", () => {
  it("reads a site embed", () => {
    expect(detectEmbedRequest("send me a embed of imhentai.com")).toEqual({ asked: "imhentai.com", url: "https://imhentai.com/" });
    expect(detectEmbedRequest("embed https://example.com/a?b=1")?.url).toBe("https://example.com/a?b=1");
    expect(detectEmbedRequest("can you make an embed of example.org/videos")?.url).toBe("https://example.org/videos");
    expect(detectEmbedRequest("imhentai.com embed please")?.url).toBe("https://imhentai.com/");
  });

  it("reads 'the newest video' as pre-navigation to that video", () => {
    expect(detectEmbedRequest("embed the new sml video")).toMatchObject({ name: "sml", video: "latest" });
    expect(detectEmbedRequest("send me an embed of sml's latest video")).toMatchObject({ name: "sml", video: "latest" });
    expect(detectEmbedRequest("embed the newest video on example.com")).toMatchObject({ url: "https://example.com/", video: "latest" });
    expect(detectEmbedRequest("embed a minecraft video")).toMatchObject({ name: "minecraft", video: "any" });
    expect(detectEmbedRequest("embed youtube.com/@SMLMovies newest video")).toMatchObject({ url: "https://youtube.com/@SMLMovies", video: "latest", youtube: true });
  });

  it("leaves questions, code and the comic reader alone", () => {
    expect(detectEmbedRequest("how do I embed a youtube video in html")).toBeNull();
    expect(detectEmbedRequest("embed this react component in my page")).toBeNull();
    expect(detectEmbedRequest("send me a manga of fnf as a embed ui all pages")).toBeNull();
    expect(detectEmbedRequest("what are text embeddings")).toBeNull();
    expect(detectEmbedRequest("send me imhentai.com")).toBeNull();
  });
});

describe("page facts", () => {
  it("spots parked domains and JS redirects", () => {
    expect(isParked('<script src="https://router.parklogic.com/x.js"></script>')).toBe(true);
    expect(isParked("<h1>This domain is for sale!</h1>")).toBe(true);
    expect(isParked("<h1>Welcome</h1>")).toBe(false);
    expect(scriptRedirect('<meta http-equiv="refresh" content="0; url=/home/">', "https://a.com/")).toBe("https://a.com/home/");
    expect(scriptRedirect('<script>window.location.href = "https://b.com/x"</script>', "https://a.com/")).toBe("https://b.com/x");
    expect(scriptRedirect("<p>hi</p>", "https://a.com/")).toBeNull();
  });

  it("reads framing rules", () => {
    expect(allowsFraming(new Headers())).toBe(true);
    expect(allowsFraming(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toBe(false);
    expect(allowsFraming(new Headers({ "content-security-policy": "frame-ancestors 'self'" }))).toBe(false);
    expect(allowsFraming(new Headers({ "content-security-policy": "frame-ancestors *; img-src *" }))).toBe(true);
  });

  it("finds video pages, newest-first lists, and the playable source", () => {
    const home = `<a href="/categories/">Cats</a><a href="/latest/">Newest</a><a href="/video/123/first-clip">A</a><a href="https://other.com/video/9">ext</a><a href="/watch?v=abcd">B</a>`;
    expect(videoPageLinks(home, "https://site.com/")).toEqual(["https://site.com/video/123/first-clip", "https://site.com/watch?v=abcd"]);
    expect(latestListLink(home, "https://site.com/")).toBe("https://site.com/latest/");

    const page = `<title>Clip &amp; more</title><meta property="og:image" content="/p.jpg"><video><source src="/media/clip.mp4" type="video/mp4"></video>
      <script>var cfg={"hls":"https:\\/\\/cdn.site.com\\/v\\/master.m3u8?t=1"}</script>`;
    const vids = extractVideos(page, "https://site.com/video/123");
    expect(vids[0]).toMatchObject({ src: "https://site.com/media/clip.mp4", kind: "file", poster: "https://site.com/p.jpg", title: "Clip & more" });
    expect(vids.some((v) => v.kind === "hls" && v.src === "https://cdn.site.com/v/master.m3u8?t=1")).toBe(true);
    expect(extractVideos('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', "https://a.com/")[0]).toMatchObject({ kind: "embed", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  });

  it("reads a channel's upload feed", () => {
    const xml = `<feed><author><name>SML</name></author><entry><yt:videoId>U2hnnFIPoII</yt:videoId><title>SML Movie: Jeffy Loves Lasagna!</title><published>2026-11-12T20:00:00+00:00</published></entry><entry><yt:videoId>xxxxxxxxxxx</yt:videoId><title>Old</title></entry></feed>`;
    expect(parseChannelFeed(xml)).toEqual({ id: "U2hnnFIPoII", title: "SML Movie: Jeffy Loves Lasagna!", published: "2026-11-12T20:00:00+00:00", channel: "SML" });
  });
});

function probeOf(url: string, html: string, extra: Partial<Probe> = {}): Probe {
  return { ok: true, status: 200, finalUrl: url, html, headers: new Headers(), challenged: false, ...extra };
}

describe("runEmbedTurn", () => {
  const steps: string[] = [];
  const step = (s: { label: string }) => void steps.push(s.label);

  it("skips a parked domain and embeds the real site through the proxy", async () => {
    const deps: Partial<EmbedDeps> = {
      probe: async (url) =>
        url.includes("imhentai.com")
          ? probeOf(url, '<title>Redirecting...</title><script src="https://router.parklogic.com/"></script>')
          : probeOf("https://imhentai.xxx/home/", "<title>IMHentai</title>", { headers: new Headers({ "x-frame-options": "SAMEORIGIN" }) }),
      findSite: async (name) => (name === "imhentai" ? "https://imhentai.xxx/" : null),
    };
    const turn = await runEmbedTurn(detectEmbedRequest("send me a embed of imhentai.com")!, { safe: "off", step, deps });
    expect(turn.meta.embed).toMatchObject({ url: "https://imhentai.xxx/home/", host: "imhentai.xxx", mode: "proxy" });
    expect(turn.meta.embed?.note).toMatch(/parked/);
    expect(turn.content).toMatch(/imhentai\.xxx/);
  });

  it("refuses adult sites while SafeSearch is on", async () => {
    const deps: Partial<EmbedDeps> = { probe: async (url) => probeOf(url, "<title>Free hentai porn</title>") };
    const turn = await runEmbedTurn(detectEmbedRequest("embed somehentai.xxx")!, { safe: "moderate", step, deps });
    expect(turn.meta.embed).toBeUndefined();
    expect(turn.content).toMatch(/SafeSearch/);
  });

  it("frames sites that allow it directly", async () => {
    const deps: Partial<EmbedDeps> = { probe: async (url) => probeOf(url, "<title>Example</title>") };
    const turn = await runEmbedTurn(detectEmbedRequest("embed example.com")!, { safe: "strict", step, deps });
    expect(turn.meta.embed?.mode).toBe("direct");
  });

  it("pre-navigates to the newest video and pulls out its player", async () => {
    const pages: Record<string, string> = {
      "https://tube.test/": '<a href="/newest">New</a><a href="/video/1/old">old</a>',
      "https://tube.test/newest": '<a href="/video/77/fresh">fresh</a><a href="/video/1/old">old</a>',
      "https://tube.test/video/77/fresh": '<title>Fresh one</title><video src="https://cdn.tube.test/77.mp4"></video>',
    };
    const deps: Partial<EmbedDeps> = { probe: async (url) => probeOf(url, pages[url] ?? "") };
    const turn = await runEmbedTurn(detectEmbedRequest("embed the newest video on tube.test")!, { safe: "off", step, deps });
    expect(turn.meta.embed?.url).toBe("https://tube.test/video/77/fresh");
    expect(turn.meta.embed?.path).toEqual(["https://tube.test/", "https://tube.test/newest"]);
    expect(turn.meta.videos?.[0]).toMatchObject({ src: "https://cdn.tube.test/77.mp4", kind: "file", pageUrl: "https://tube.test/video/77/fresh" });
  });

  it("opens bot-walled sites in the live browser", async () => {
    const deps: Partial<EmbedDeps> = {
      probe: async (url) => probeOf(url, "<title>Just a moment...</title>", { ok: false, status: 403, challenged: true }),
      openLive: async (_c, _o, url) => ({ url, title: "Walled", videos: [] }),
    };
    const turn = await runEmbedTurn(detectEmbedRequest("embed walled.test")!, { safe: "off", step, chatId: "c1", ownerId: "o1", deps });
    expect(turn.meta.embed).toMatchObject({ mode: "live", title: "Walled" });
    expect(turn.content).toMatch(/live browser/);
  });

  it("embeds a creator's newest YouTube upload", async () => {
    const deps: Partial<EmbedDeps> = {
      youtube: async (name, latest) => (name === "sml" && latest ? { video: { src: "https://www.youtube-nocookie.com/embed/U2hnnFIPoII", kind: "embed", pageUrl: "https://www.youtube.com/watch?v=U2hnnFIPoII", title: "Jeffy Loves Lasagna" }, channel: "SML" } : null),
    };
    const turn = await runEmbedTurn(detectEmbedRequest("embed the new sml video")!, { safe: "off", step, deps });
    expect(turn.meta.videos?.[0].src).toContain("U2hnnFIPoII");
    expect(turn.content).toMatch(/newest upload from \*\*SML\*\*/);
  });
});

describe("proxy rewriting", () => {
  it("routes media, lazy images, frames and srcset through the proxy", () => {
    const html = `<head><script integrity="sha384-x" src="/app.js"></script></head><img data-src="https://cdn.a.com/t.jpg" src="/blank.gif" srcset="/a.jpg 1x, /b.jpg 2x">
      <video poster="/p.jpg"><source src="/v.mp4"></video><iframe src="https://player.a.com/embed/1"></iframe><a href="/next">n</a>`;
    const out = rewriteHtml(html, "https://a.com/page");
    const ref = "https://a.com";
    expect(out).toContain(`data-src="${proxyAsset("https://cdn.a.com/t.jpg", ref)}"`);
    expect(out).toContain(`src="${proxyAsset("https://a.com/v.mp4", ref)}"`);
    expect(out).toContain(`poster="${proxyAsset("https://a.com/p.jpg", ref)}"`);
    expect(out).toContain(proxyAsset("https://a.com/b.jpg", ref) + " 2x");
    expect(out).toMatch(/<iframe allowfullscreen allow="autoplay; fullscreen[^"]*" src="\/api\/proxy\?ref=[^"]*url=https%3A%2F%2Fplayer\.a\.com%2Fembed%2F1"/);
    expect(out).toContain('href="/api/proxy?url=https%3A%2F%2Fa.com%2Fnext"');
    expect(out).not.toContain("integrity=");
  });

  it("rewrites CSS urls with the page as Referer", () => {
    expect(rewriteCss("a{background:url('/x.png')}", "https://a.com/s/site.css")).toBe(`a{background:url('${proxyAsset("https://a.com/x.png", "https://a.com")}')}`);
  });

  it("injects a client script that parses", () => {
    const script = proxyClientScript('https://a.com/p?q="</script>').replace(/^<script>|<\/script>$/g, "");
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("fetchUpstream", () => {
  it("knows a bot wall when it sees one", () => {
    expect(looksChallenged(403, new Headers(), "<title>Just a moment...</title>")).toBe(true);
    expect(looksChallenged(200, new Headers({ "cf-mitigated": "challenge" }), "")).toBe(true);
    expect(looksChallenged(403, new Headers(), "<title>Forbidden</title>")).toBe(false);
  });

  it("flags a challenged page and still hands back its body", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("<title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html" } })) as typeof fetch;
    try {
      const r = await fetchUpstream("https://walled.test/");
      expect(r.challenged).toBe(true);
      expect(await r.res.text()).toContain("Just a moment");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("proxy: modern single-page sites", () => {
  it("serves scripts at a path that mirrors the site, so relative module imports stay proxied", async () => {
    const { scriptPath, scriptPathTarget, withProxyToken } = await import("@/lib/server/proxy-rewrite");
    const p = scriptPath("https://www.site.example/assets/index-1.js?v=2")!;
    expect(p).toBe("/api/proxy/m/_/https%3A%2F%2Fwww.site.example/assets/index-1.js?v=2");
    expect(proxyAsset("https://www.site.example/assets/index-1.js")).toMatch(/^\/api\/proxy\/m\/_\//);
    expect(proxyAsset("https://www.site.example/a.png")).toMatch(/^\/api\/proxy\?asset=1/);
    // "./chunk.js" imported from that module, as the browser resolves it:
    const chunk = new URL("./chunk-9.js", `http://localhost:3000${withProxyToken(p, "123.abc")}`);
    expect(scriptPathTarget(chunk.pathname, chunk.search)).toEqual({ token: "123.abc", url: "https://www.site.example/assets/chunk-9.js" });
  });

  it("gives the page its real path for its router, and stubs the storage the sandbox blocks", () => {
    const s = proxyClientScript("https://www.site.example/browse?x=1");
    expect(s).toContain("__sp=");
    expect(s).toContain("origReplaceState.call(history");
    expect(s).toMatch(/localStorage', 'sessionStorage'/);
    expect(s).toContain("Document.prototype, 'cookie'");
  });
});
