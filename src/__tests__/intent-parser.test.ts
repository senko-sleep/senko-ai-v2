import { describe, it, expect } from "vitest";
import { parseIntent, isKnownSite } from "@/lib/intent-parser";

// ══════════════════════════════════════════════════════════════
// COMPLEXITY GATE — long/complex messages pass to AI
// ══════════════════════════════════════════════════════════════
describe("Complexity gate", () => {
  it("rejects long winding instructions (>15 words)", () => {
    const result = parseIntent(
      "look up eevee porn on rule34 video listing ALL options on that page on google click first link and look for eevee"
    );
    expect(result.type).toBe("none");
  });

  it("rejects multi-step detailed instructions", () => {
    const result = parseIntent(
      "go to rule34video and search for eevee then list all the options and click on the first one and play it"
    );
    expect(result.type).toBe("none");
  });

  it("rejects conversational paragraphs", () => {
    const result = parseIntent(
      "hey can you go to pornhub and find me some good videos about cats doing funny things and then bookmark them all please"
    );
    expect(result.type).toBe("none");
  });
});

// ══════════════════════════════════════════════════════════════
// FUZZY SITE MATCHING — misspellings resolve correctly
// ══════════════════════════════════════════════════════════════
describe("Fuzzy site matching", () => {
  it("exact match: rule34video", () => {
    expect(isKnownSite("rule34video")).toBe(true);
  });

  it("fuzzy: pornhib → pornhub", () => {
    expect(isKnownSite("pornhib")).toBe(true);
  });

  it("fuzzy: rul34video → rule34video", () => {
    expect(isKnownSite("rul34video")).toBe(true);
  });

  it("fuzzy: rule34vidoe → rule34video", () => {
    expect(isKnownSite("rule34vidoe")).toBe(true);
  });

  it("fuzzy with spaces: rule 34 video → rule34video", () => {
    expect(isKnownSite("rule 34 video")).toBe(true);
  });

  it("fuzzy: youtueb → youtube", () => {
    expect(isKnownSite("youtueb")).toBe(true);
  });

  it("rejects garbage: rule34videolistingalloptionson", () => {
    expect(isKnownSite("rule34videolistingalloptionson")).toBe(false);
  });

  it("rejects random words: banana", () => {
    expect(isKnownSite("banana")).toBe(false);
  });

  it("rejects long garbage strings", () => {
    expect(isKnownSite("thisisnotawebsiteatall")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// PATTERN A: "look up QUERY on SITE"
// ══════════════════════════════════════════════════════════════
describe("Pattern A: look up QUERY on SITE", () => {
  it("look up eevee on rule34video", () => {
    const result = parseIntent("look up eevee on rule34video");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://rule34video.com");
    expect(result.query).toBe("eevee");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("search for eevee porn on pornhub", () => {
    const result = parseIntent("search for eevee porn on pornhub");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.pornhub.com");
    expect(result.query).toBe("eevee porn");
  });

  it("find cats on youtube", () => {
    const result = parseIntent("find cats on youtube");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.youtube.com");
    expect(result.query).toBe("cats");
  });

  it("handles misspelled site: search eevee on pornhib", () => {
    const result = parseIntent("search eevee on pornhib");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.pornhub.com");
    expect(result.query).toBe("eevee");
  });
});

// ══════════════════════════════════════════════════════════════
// PATTERN A2: multi-word site "look up QUERY on rule 34 video"
// ══════════════════════════════════════════════════════════════
describe("Pattern A2: multi-word site name", () => {
  it("look up eevee on rule 34 video", () => {
    const result = parseIntent("look up eevee on rule 34 video");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://rule34video.com");
    expect(result.query).toBe("eevee");
  });
});

// ══════════════════════════════════════════════════════════════
// PATTERN B: "go to SITE and look up QUERY"
// ══════════════════════════════════════════════════════════════
describe("Pattern B: go to SITE and look up QUERY", () => {
  it("go to rule34video and search for eevee", () => {
    const result = parseIntent("go to rule34video and search for eevee");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://rule34video.com");
    expect(result.query).toBe("eevee");
  });

  it("open pornhub and find milf", () => {
    const result = parseIntent("open pornhub and find milf");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.pornhub.com");
    expect(result.query).toBe("milf");
  });
});

// ══════════════════════════════════════════════════════════════
// PATTERN C: "SITE QUERY" (implicit)
// ══════════════════════════════════════════════════════════════
describe("Pattern C: implicit SITE QUERY", () => {
  it("rule34video eevee", () => {
    const result = parseIntent("rule34video eevee");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://rule34video.com");
    expect(result.query).toBe("eevee");
  });

  it("pornhub milf compilation", () => {
    const result = parseIntent("pornhub milf compilation");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.pornhub.com");
    expect(result.query).toBe("milf compilation");
  });

  it("youtube funny cats", () => {
    const result = parseIntent("youtube funny cats");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.youtube.com");
    expect(result.query).toBe("funny cats");
  });

  it("misspelled: pornhib eevee → pornhub", () => {
    const result = parseIntent("pornhib eevee");
    expect(result.type).toBe("site-search");
    expect(result.site).toBe("https://www.pornhub.com");
    expect(result.query).toBe("eevee");
  });
});

// ══════════════════════════════════════════════════════════════
// PATTERN D: "open SITE" / "go to SITE"
// ══════════════════════════════════════════════════════════════
describe("Pattern D: open/go to SITE", () => {
  it("open pornhub", () => {
    const result = parseIntent("open pornhub");
    expect(result.type).toBe("open-url");
    expect(result.site).toBe("https://www.pornhub.com");
  });

  it("go to youtube", () => {
    const result = parseIntent("go to youtube");
    expect(result.type).toBe("open-url");
    expect(result.site).toBe("https://www.youtube.com");
  });

  it("go to rule 34 video (multi-word)", () => {
    const result = parseIntent("go to rule 34 video");
    expect(result.type).toBe("open-url");
    expect(result.site).toBe("https://rule34video.com");
  });

  it("open cooltube.com (unknown site with extension)", () => {
    const result = parseIntent("open cooltube.com");
    expect(result.type).toBe("open-url");
    expect(result.site).toBe("https://cooltube.com");
  });
});

// ══════════════════════════════════════════════════════════════
// EXPLICIT URL
// ══════════════════════════════════════════════════════════════
describe("Explicit URL", () => {
  it("open https://rule34video.com", () => {
    const result = parseIntent("open https://rule34video.com");
    expect(result.type).toBe("open-url");
    expect(result.url).toBe("https://rule34video.com");
    expect(result.confidence).toBe(0.95);
  });

  it("https://example.com (bare URL)", () => {
    const result = parseIntent("https://example.com");
    expect(result.type).toBe("open-url");
    expect(result.url).toBe("https://example.com");
  });
});

// ══════════════════════════════════════════════════════════════
// PAGINATION
// ══════════════════════════════════════════════════════════════
describe("Pagination", () => {
  it("next page", () => {
    const result = parseIntent("next page");
    expect(result.type).toBe("pagination");
  });

  it("page 3", () => {
    const result = parseIntent("page 3");
    expect(result.type).toBe("pagination");
    expect(result.pageNum).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════
// RESULT PICKS
// ══════════════════════════════════════════════════════════════
describe("Result picks", () => {
  it("play the 3rd video", () => {
    const result = parseIntent("play the 3rd video");
    expect(result.type).toBe("pick-result");
    expect(result.autoPick).toBe(3);
  });

  it("option 5", () => {
    const result = parseIntent("option 5");
    expect(result.type).toBe("pick-result");
    expect(result.autoPick).toBe(5);
  });

  it("bare number 7 (low confidence)", () => {
    const result = parseIntent("7");
    expect(result.type).toBe("pick-result");
    expect(result.autoPick).toBe(7);
    expect(result.confidence).toBeLessThan(0.8);
  });
});

// ══════════════════════════════════════════════════════════════
// NONE — conversational messages should NOT trigger
// ══════════════════════════════════════════════════════════════
describe("None — pass to AI", () => {
  it("hello how are you", () => {
    const result = parseIntent("hello how are you");
    expect(result.type).toBe("none");
  });

  it("what is the meaning of life", () => {
    const result = parseIntent("what is the meaning of life");
    expect(result.type).toBe("none");
  });

  it("tell me a joke", () => {
    const result = parseIntent("tell me a joke");
    expect(result.type).toBe("none");
  });

  it("the ORIGINAL failing input — should be none", () => {
    const result = parseIntent(
      "look up eevee porn on rule34 video listing ALL options on that page on google"
    );
    expect(result.type).toBe("none");
  });
});
