/**
 * Tests for src/lib/server/youtube.ts and src/lib/server/net-guard.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyYouTubeVideo,
  clearVerificationCache,
  extractVideoIds,
  sanitizeYouTubeInReply,
  searchYouTube,
  parseSearchResults,
  titleMatches,
  channelMatches,
  textOverlap,
  searchFilterParam,
  mapLimit,
  type VideoCheck,
} from "../lib/server/youtube";
import { isPrivateAddress, assertPublicHttpUrl, redactUrl } from "../lib/server/net-guard";

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

// ── verifyYouTubeVideo ────────────────────────────────────────────────────

describe("verifyYouTubeVideo", () => {
  beforeEach(() => clearVerificationCache());
  afterEach(() => vi.restoreAllMocks());

  it("returns verified for a 200 response with title", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { title: "Baby Shark Dance", author_name: "Pinkfong" }));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("verified");
    expect(c.title).toBe("Baby Shark Dance");
    expect(c.channel).toBe("Pinkfong");
  });

  it("returns not_found for 404", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("not_found");
  });

  it("returns not_found for 400", async () => {
    vi.stubGlobal("fetch", mockFetch(400, {}));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("not_found");
  });

  it("returns restricted for 401", async () => {
    vi.stubGlobal("fetch", mockFetch(401, {}));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("restricted");
  });

  it("returns restricted for 403", async () => {
    vi.stubGlobal("fetch", mockFetch(403, {}));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("restricted");
  });

  it("returns not_found immediately for a non-11-char ID", async () => {
    vi.stubGlobal("fetch", vi.fn()); // should not be called
    const c = await verifyYouTubeVideo("short");
    expect(c.status).toBe("not_found");
    expect((vi.fn() as ReturnType<typeof vi.fn>).mock?.calls.length ?? 0).toBe(0);
  });

  it("returns unchecked on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    const c = await verifyYouTubeVideo("XqZsoesa55w");
    expect(c.status).toBe("unchecked");
  });

  it("caches verified result", async () => {
    const fetchMock = mockFetch(200, { title: "Test", author_name: "Chan" });
    vi.stubGlobal("fetch", fetchMock);
    await verifyYouTubeVideo("XqZsoesa55w");
    await verifyYouTubeVideo("XqZsoesa55w");
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

// ── extractVideoIds ───────────────────────────────────────────────────────

describe("extractVideoIds", () => {
  it("finds ID in watch URL", () => {
    expect(extractVideoIds("https://www.youtube.com/watch?v=dQw4w9WgXcY")).toContain("dQw4w9WgXcY");
  });

  it("finds ID in youtu.be short URL", () => {
    expect(extractVideoIds("https://youtu.be/dQw4w9WgXcY")).toContain("dQw4w9WgXcY");
  });

  it("finds ID in JSON videoId field", () => {
    expect(extractVideoIds('{"videoId":"dQw4w9WgXcY"}')).toContain("dQw4w9WgXcY");
  });

  it("finds ID in embed URL", () => {
    expect(extractVideoIds("https://www.youtube.com/embed/dQw4w9WgXcY")).toContain("dQw4w9WgXcY");
  });

  it("finds ID in shorts URL", () => {
    expect(extractVideoIds("https://www.youtube.com/shorts/dQw4w9WgXcY")).toContain("dQw4w9WgXcY");
  });

  it("deduplicates IDs", () => {
    const ids = extractVideoIds("https://youtu.be/dQw4w9WgXcY https://youtu.be/dQw4w9WgXcY");
    expect(ids.filter((id) => id === "dQw4w9WgXcY").length).toBe(1);
  });

  it("rejects strings shorter than 11 chars", () => {
    expect(extractVideoIds("https://www.youtube.com/watch?v=short")).toHaveLength(0);
  });

  it("returns empty array for plain text with no IDs", () => {
    expect(extractVideoIds("Hello world, no YouTube links here.")).toHaveLength(0);
  });
});

// ── textOverlap / titleMatches / channelMatches ───────────────────────────

describe("textOverlap", () => {
  it("returns 1 for identical strings", () => {
    expect(textOverlap("baby shark", "baby shark")).toBe(1);
  });

  it("returns 0 for completely disjoint strings", () => {
    expect(textOverlap("cat dog", "moon star")).toBe(0);
  });

  it("returns 0 when either string is empty", () => {
    expect(textOverlap("", "hello")).toBe(0);
    expect(textOverlap("hello", "")).toBe(0);
  });

  it("ignores stop words", () => {
    // 'the' is a stop word; only meaningful token is 'shark'
    expect(textOverlap("the shark", "shark music")).toBeGreaterThan(0.5);
  });
});

describe("titleMatches", () => {
  it("returns true when titles overlap >= 60%", () => {
    expect(titleMatches("Baby Shark Dance", "Baby Shark Dance - Official")).toBe(true);
  });

  it("returns false when titles are completely different", () => {
    expect(titleMatches("Baby Shark Dance", "Rick Astley Never Gonna Give You Up")).toBe(false);
  });

  it("returns true when either title is undefined", () => {
    expect(titleMatches(undefined, "anything")).toBe(true);
    expect(titleMatches("anything", undefined)).toBe(true);
  });
});

describe("channelMatches", () => {
  it("matches when channel overlap >= 50%", () => {
    expect(channelMatches("Ed Sheeran", "Ed Sheeran Music")).toBe(true);
  });

  it("does not match totally different channels", () => {
    expect(channelMatches("Ed Sheeran", "Pinkfong Baby Shark")).toBe(false);
  });
});

// ── sanitizeYouTubeInReply ────────────────────────────────────────────────

describe("sanitizeYouTubeInReply", () => {
  beforeEach(() => clearVerificationCache());
  afterEach(() => vi.restoreAllMocks());

  const makeVerifier = (checks: Record<string, VideoCheck>) =>
    async (id: string): Promise<VideoCheck> =>
      checks[id] ?? { id, status: "unchecked" as const, reason: "Not in fixture." };

  it("removes dead links from prose", async () => {
    const text = "Watch [Rick Roll](https://www.youtube.com/watch?v=dQw4w9WgXcY) here.";
    const verify = makeVerifier({ dQw4w9WgXcY: { id: "dQw4w9WgXcY", status: "not_found", reason: "Deleted." } });
    const { text: out, report } = await sanitizeYouTubeInReply(text, { verify });
    expect(out).not.toContain("youtube.com/watch?v=dQw4w9WgXcY");
    expect(out).toContain("not found on YouTube");
    expect(report.removed).toBe(1);
  });

  it("keeps and marks verified links", async () => {
    const id = "XqZsoesa55w";
    const text = `Watch [Baby Shark](https://www.youtube.com/watch?v=${id})`;
    const verify = makeVerifier({ [id]: { id, status: "verified", title: "Baby Shark Dance", channel: "Pinkfong", reason: "Exists." } });
    const { text: out, report } = await sanitizeYouTubeInReply(text, { verify });
    expect(out).toContain(id);
    expect(report.verified).toBe(1);
    expect(report.removed).toBe(0);
  });

  it("corrects a mismatched title in a ui block", async () => {
    const id = "XqZsoesa55w";
    const block = `\`\`\`ui\n${JSON.stringify({ type: "video_grid", videos: [{ videoId: id, title: "Wrong Title", channel: "Wrong Channel" }] })}\n\`\`\``;
    const verify = makeVerifier({ [id]: { id, status: "verified", title: "Baby Shark Dance", channel: "Pinkfong", reason: "Exists." } });
    const { text: out, report } = await sanitizeYouTubeInReply(block, { verify });
    expect(out).toContain("Baby Shark Dance");
    expect(out).not.toContain("Wrong Title");
    expect(report.corrected).toBe(1);
  });

  it("strips ungrounded stats from ui block video entries", async () => {
    const id = "XqZsoesa55w";
    const block = `\`\`\`ui\n${JSON.stringify({ type: "video_grid", videos: [{ videoId: id, title: "Baby Shark Dance", views: "15B", likes: "45M" }] })}\n\`\`\``;
    const verify = makeVerifier({ [id]: { id, status: "verified", title: "Baby Shark Dance", channel: "Pinkfong", reason: "Exists." } });
    // groundedIds is empty → stats should be stripped
    const { text: out } = await sanitizeYouTubeInReply(block, { verify, groundedIds: new Set() });
    const parsed = JSON.parse(out.match(/```ui\n([\s\S]*?)\n```/)?.[1] ?? "{}");
    expect(parsed.videos?.[0]?.views).toBeUndefined();
    expect(parsed.videos?.[0]?.likes).toBeUndefined();
  });

  it("adds a YouTube link check footnote", async () => {
    const id = "XqZsoesa55w";
    const text = `https://www.youtube.com/watch?v=${id}`;
    const verify = makeVerifier({ [id]: { id, status: "verified", title: "Baby Shark", channel: "Pinkfong", reason: "ok" } });
    const { text: out } = await sanitizeYouTubeInReply(text, { verify });
    expect(out).toContain("YouTube link check");
  });

  it("returns unchanged text when no YouTube IDs found", async () => {
    const text = "No YouTube links here, just regular text.";
    const verify = vi.fn();
    const { text: out } = await sanitizeYouTubeInReply(text, { verify });
    expect(out).toBe(text);
    expect(verify).not.toHaveBeenCalled();
  });
});

// ── parseSearchResults ────────────────────────────────────────────────────

describe("parseSearchResults", () => {
  it("extracts video entries from ytInitialData shape", () => {
    const videoId = "dQw4w9WgXcY";
    const ytData = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId,
                          title: { runs: [{ text: "Never Gonna Give You Up" }] },
                          ownerText: { runs: [{ text: "Rick Astley", navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/c/RickAstley" } } }] },
                          viewCountText: { simpleText: "1.5B views" },
                          publishedTimeText: { simpleText: "15 years ago" },
                          lengthText: { simpleText: "3:32" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const html = `<script>var ytInitialData = ${JSON.stringify(ytData)};</script>`;
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe(videoId);
    expect(results[0].title).toBe("Never Gonna Give You Up");
    expect(results[0].channel).toBe("Rick Astley");
    expect(results[0].views).toBe("1.5B views");
    expect(results[0].duration).toBe("3:32");
  });

  it("returns empty array when no ytInitialData found", () => {
    expect(parseSearchResults("<html>no data</html>", 5)).toHaveLength(0);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseSearchResults("<script>var ytInitialData = {broken;</script>", 5)).toHaveLength(0);
  });

  it("respects the limit", () => {
    const makeVideo = (id: string) => ({
      videoRenderer: {
        videoId: id,
        title: { runs: [{ text: `Video ${id}` }] },
        ownerText: { runs: [{ text: "Channel" }] },
      },
    });
    const ytData = {
      contents: {
        sectionListRenderer: {
          contents: [{ itemSectionRenderer: { contents: ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map(makeVideo) } }],
        },
      },
    };
    const html = `<script>var ytInitialData = ${JSON.stringify(ytData)};</script>`;
    expect(parseSearchResults(html, 2)).toHaveLength(2);
  });
});

// ── searchYouTube ─────────────────────────────────────────────────────────

describe("searchYouTube", () => {
  afterEach(() => vi.restoreAllMocks());

  const makeYtHtml = (videoId: string, title: string, channel: string) => {
    const ytData = {
      contents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    videoRenderer: {
                      videoId,
                      title: { runs: [{ text: title }] },
                      ownerText: { runs: [{ text: channel }] },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    };
    return `<script>var ytInitialData = ${JSON.stringify(ytData)};</script>`;
  };

  it("returns ok:true with verified results", async () => {
    const html = makeYtHtml("dQw4w9WgXcY", "Never Gonna Give You Up", "Rick Astley");
    const fetchHtml = vi.fn().mockResolvedValue(html);
    const verify = vi.fn().mockResolvedValue({ id: "dQw4w9WgXcY", status: "verified", title: "Never Gonna Give You Up", channel: "Rick Astley", reason: "ok" } satisfies VideoCheck);

    const result = await searchYouTube({ query: "rick roll" }, { fetchHtml, verify });
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].verification).toBe("verified");
    expect(result.results[0].videoId).toBe("dQw4w9WgXcY");
  });

  it("drops not_found results", async () => {
    const html = makeYtHtml("dQw4w9WgXcY", "Never Gonna Give You Up", "Rick Astley");
    const fetchHtml = vi.fn().mockResolvedValue(html);
    const verify = vi.fn().mockResolvedValue({ id: "dQw4w9WgXcY", status: "not_found", reason: "gone" } satisfies VideoCheck);

    const result = await searchYouTube({ query: "rick roll" }, { fetchHtml, verify });
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it("returns ok:false when page has no readable results", async () => {
    const fetchHtml = vi.fn().mockResolvedValue("<html>no youtube data</html>");
    const result = await searchYouTube({ query: "something" }, { fetchHtml });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no readable results/i);
  });

  it("returns ok:false on network error", async () => {
    const fetchHtml = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await searchYouTube({ query: "something" }, { fetchHtml });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Could not reach YouTube");
  });
});

// ── searchFilterParam ─────────────────────────────────────────────────────

describe("searchFilterParam", () => {
  it("returns a non-empty base64 string", () => {
    const sp = searchFilterParam("relevance", "any");
    expect(typeof sp).toBe("string");
    expect(sp.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(() => Buffer.from(sp, "base64")).not.toThrow();
  });

  it("returns different values for different sort/period combos", () => {
    expect(searchFilterParam("relevance", "any")).not.toBe(searchFilterParam("views", "week"));
  });
});

// ── mapLimit ─────────────────────────────────────────────────────────────

describe("mapLimit", () => {
  it("processes all items", async () => {
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("preserves order", async () => {
    const results = await mapLimit([3, 1, 2], 3, async (n) => n);
    expect(results).toEqual([3, 1, 2]);
  });

  it("works with limit larger than items", async () => {
    const results = await mapLimit([1, 2], 10, async (n) => n + 10);
    expect(results).toEqual([11, 12]);
  });
});

// ── net-guard ─────────────────────────────────────────────────────────────

describe("isPrivateAddress", () => {
  it("flags 127.0.0.1 as private", () => expect(isPrivateAddress("127.0.0.1")).toBe(true));
  it("flags 10.0.0.1 as private", () => expect(isPrivateAddress("10.0.0.1")).toBe(true));
  it("flags 172.16.5.1 as private", () => expect(isPrivateAddress("172.16.5.1")).toBe(true));
  it("flags 192.168.1.1 as private", () => expect(isPrivateAddress("192.168.1.1")).toBe(true));
  it("flags ::1 as private", () => expect(isPrivateAddress("::1")).toBe(true));
  it("flags localhost as private", () => expect(isPrivateAddress("localhost")).toBe(true));
  it("does not flag 8.8.8.8 as private", () => expect(isPrivateAddress("8.8.8.8")).toBe(false));
  it("does not flag 1.1.1.1 as private", () => expect(isPrivateAddress("1.1.1.1")).toBe(false));
  it("does not flag 203.0.113.1 (TEST-NET) — treats non-private public IP as non-private", () => expect(isPrivateAddress("203.0.113.1")).toBe(false));
});

describe("assertPublicHttpUrl", () => {
  it("accepts a public HTTPS IP URL without DNS", async () => {
    // Uses a direct IP to bypass DNS lookup — 8.8.8.8 is not private
    await expect(assertPublicHttpUrl("https://8.8.8.8/")).resolves.toBeDefined();
  });

  it("rejects javascript: URLs", async () => {
    await expect(assertPublicHttpUrl("javascript:alert(1)")).rejects.toThrow();
  });

  it("rejects URLs with credentials", async () => {
    await expect(assertPublicHttpUrl("https://user:pass@8.8.8.8/")).rejects.toThrow();
  });

  it("rejects localhost", async () => {
    await expect(assertPublicHttpUrl("http://localhost:3000/")).rejects.toThrow();
  });

  it("rejects private IP addresses", async () => {
    await expect(assertPublicHttpUrl("http://192.168.1.1/")).rejects.toThrow();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicHttpUrl("ftp://8.8.8.8/file")).rejects.toThrow();
  });
});

describe("redactUrl", () => {
  it("masks key= param", () => {
    const out = redactUrl("https://api.example.com/?key=secret123&q=test");
    expect(out).not.toContain("secret123");
    expect(out).toContain("key=");
  });

  it("masks token= param", () => {
    const out = redactUrl("https://api.example.com/?token=abcdef&q=test");
    expect(out).not.toContain("abcdef");
    expect(out).toContain("token=");
  });

  it("masks secret= param", () => {
    const out = redactUrl("https://api.example.com/?secret=mysecret");
    expect(out).not.toContain("mysecret");
    expect(out).toContain("secret=");
  });

  it("leaves non-sensitive params intact", () => {
    const out = redactUrl("https://api.example.com/?q=hello&sort=views");
    expect(out).toContain("q=hello");
    expect(out).toContain("sort=views");
  });
});
