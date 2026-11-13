/**
 * Tests for the entity-grounding layer that powers rich, accurate "who is X, make the UI"
 * responses.  Covers:
 *  - extractEntityQuery: pattern recognition for combined research+UI messages
 *  - gatherEntityGroundingNote: returns a useful note even when search is unavailable
 *  - reply grounding integration: composedUI requests with entity queries get a note injected
 *  - UI_GENERATION_CONTRACT: mandates rich content population
 */
import { describe, it, expect, vi } from "vitest";
import { extractEntityQuery, fetchEntityWebSnippets, gatherEntityGroundingNote } from "@/lib/server/grounding";
import { UI_GENERATION_CONTRACT, wantsGeneratedUI } from "@/lib/ui-generation";

// ─── extractEntityQuery ───────────────────────────────────────────────────────

describe("extractEntityQuery", () => {
  it("extracts entity from 'who is X' patterns", () => {
    expect(extractEntityQuery("who is Anya Forger look it up as well and make the ui")).toBe("Anya Forger");
    expect(extractEntityQuery("who is Loid Forger and show me a profile")).toBe("Loid Forger");
    expect(extractEntityQuery("what is Naruto and make the ui")).toBe("Naruto");
    // Everyday questions are not a subject to research (no Wikipedia lookup of "What Time Is It?").
    expect(extractEntityQuery("what time is it in ui")).toBeNull();
    expect(extractEntityQuery("show the weather today in a ui")).toBeNull();
  });

  it("extracts entity from 'look up X' patterns", () => {
    expect(extractEntityQuery("look up Senko-San and create a ui")).toContain("Senko");
    expect(extractEntityQuery("search for Yor Forger and generate a card ui")).toContain("Yor Forger");
  });

  it("extracts entity from 'tell me about X' patterns", () => {
    const q = extractEntityQuery("tell me about Anya Forger and make the ui");
    expect(q).toContain("Anya Forger");
  });

  it("returns null for pure UI creation requests without an entity", () => {
    expect(extractEntityQuery("create a beautiful interactive UI")).toBeNull();
    expect(extractEntityQuery("make me a Pokedex UI")).toBeNull();
    expect(extractEntityQuery("build an infographic UI")).toBeNull();
  });

  it("returns null for unrelated content", () => {
    expect(extractEntityQuery("what is the weather today")).toBeNull();
    expect(extractEntityQuery("write me a poem")).toBeNull();
  });
});

// ─── wantsGeneratedUI ─────────────────────────────────────────────────────────

describe("wantsGeneratedUI — combined research+UI messages", () => {
  it("detects UI intent in combined 'who is X ... make the ui' messages", () => {
    expect(wantsGeneratedUI("who is anya forger look it up as well and make the ui")).toBe(true);
    expect(wantsGeneratedUI("who is Naruto, search and show me a ui")).toBe(true);
    expect(wantsGeneratedUI("look up Luffy and generate a character ui")).toBe(true);
  });

  it("still rejects code project requests that mention ui", () => {
    expect(wantsGeneratedUI("build this React UI in my workspace")).toBe(false);
    expect(wantsGeneratedUI("create ui with next.js")).toBe(false);
  });

  it("rejects simple questions about characters with no UI keyword", () => {
    expect(wantsGeneratedUI("who is anya forger")).toBe(false);
    expect(wantsGeneratedUI("tell me about naruto")).toBe(false);
  });
});

// ─── gatherEntityGroundingNote ────────────────────────────────────────────────

describe("gatherEntityGroundingNote", () => {
  it("returns a non-empty note even when network is unavailable (graceful fallback)", async () => {
    // Mock fetch to always fail so we exercise the fallback path
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    try {
      const note = await gatherEntityGroundingNote("Anya Forger");
      expect(note).toBeTruthy();
      expect(note).toContain("Anya Forger");
      // The fallback note should still instruct the LLM to use parametric knowledge
      expect(note).toMatch(/parametric knowledge|training data|your knowledge/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes imageQuery guidance in the returned note", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    try {
      const note = await gatherEntityGroundingNote("Anya Forger");
      expect(note).toContain("imageQuery");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns empty string for empty query", async () => {
    expect(await gatherEntityGroundingNote("")).toBe("");
  });

  it("returns real snippet grounding when search succeeds", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.SEARCH_API_URL;
    // Use the proxy path so our mock is straightforward
    process.env.SEARCH_API_URL = "http://test-grounding-proxy:9999";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "Anya Forger | Spy × Family Wiki", url: "https://spyfamily.fandom.com/wiki/Anya_Forger", snippet: "Anya Forger is the adopted daughter of Loid Forger and Yor Forger." },
          { title: "Anya Forger - MyAnimeList", url: "https://myanimelist.net/character/188736/Anya_Forger", snippet: "An Esper girl who can read minds, raised at a lab." },
        ],
      }),
    } as unknown as Response);
    try {
      const note = await gatherEntityGroundingNote("Anya Forger");
      expect(note).toContain("WEB SEARCH RESULTS");
      expect(note).toContain("Anya Forger");
      expect(note).toContain("adopted daughter");
      expect(note).toContain("imageQuery");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv === undefined) delete process.env.SEARCH_API_URL;
      else process.env.SEARCH_API_URL = originalEnv;
    }
  });
});

// ─── UI_GENERATION_CONTRACT completeness ─────────────────────────────────────

describe("UI_GENERATION_CONTRACT", () => {
  it("mandates comprehensive profile population", () => {
    expect(UI_GENERATION_CONTRACT).toContain("attributes");
    expect(UI_GENERATION_CONTRACT).toContain("imageQuery");
    // Should warn about skeleton-only responses
    expect(UI_GENERATION_CONTRACT).toMatch(/skeleton.*WRONG|every.*field|EVERY.*field/i);
  });

  it("forbids skeleton-only profile responses", () => {
    // The contract should explicitly state that a name-only profile is wrong
    expect(UI_GENERATION_CONTRACT).toMatch(/skeleton|name.*only|only.*name/i);
  });

  it("requires specific imageQuery strings not invented URLs", () => {
    expect(UI_GENERATION_CONTRACT).toContain("NEVER invent imageUrl");
    expect(UI_GENERATION_CONTRACT).toContain("imageQuery");
  });

  it("includes all supported node types", () => {
    expect(UI_GENERATION_CONTRACT).toContain("profile");
    expect(UI_GENERATION_CONTRACT).toContain("timeline");
    expect(UI_GENERATION_CONTRACT).toContain("gallery");
    expect(UI_GENERATION_CONTRACT).toContain("key_value");
    expect(UI_GENERATION_CONTRACT).toContain("stat_grid");
  });
});

// ─── fetchEntityWebSnippets env flag ─────────────────────────────────────────

describe("fetchEntityWebSnippets", () => {
  it("returns empty array gracefully when all engines fail", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    try {
      const snippets = await fetchEntityWebSnippets("test query", AbortSignal.timeout(100));
      expect(Array.isArray(snippets)).toBe(true);
      expect(snippets.length).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses SEARCH_API_URL proxy when set", async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.SEARCH_API_URL;
    process.env.SEARCH_API_URL = "http://test-search-api:9999";
    let calledUrl = "";
    globalThis.fetch = vi.fn().mockImplementation(async (url: RequestInfo) => {
      calledUrl = url.toString();
      return { ok: true, json: async () => ({ results: [{ title: "T", url: "https://example.com", snippet: "S" }] }) } as Response;
    });
    try {
      const snippets = await fetchEntityWebSnippets("Anya Forger");
      expect(calledUrl).toContain("test-search-api:9999");
      expect(snippets.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv === undefined) delete process.env.SEARCH_API_URL;
      else process.env.SEARCH_API_URL = originalEnv;
    }
  });
});

describe("casual UI requests", () => {
  it("treats 'who is X us ui' as a researched UI request about X", () => {
    for (const q of ["who is anya forger us ui", "who is anya forger use ui", "who is anya forger in a ui", "tell me about Yor Forger ui please"]) {
      expect(wantsGeneratedUI(q)).toBe(true);
    }
    expect(extractEntityQuery("who is anya forger us ui")).toBe("anya forger");
    expect(extractEntityQuery("who is anya forger in a ui")).toBe("anya forger");
  });

  it("leaves ordinary questions and code requests alone", () => {
    expect(wantsGeneratedUI("who is anya forger")).toBe(false);
    expect(wantsGeneratedUI("fix the react ui in my repo")).toBe(false);
    expect(wantsGeneratedUI("what does ui stand for")).toBe(false);
  });
});
