import { describe, it, expect } from "vitest";
import { parseIntent, isKnownSite } from "@/lib/intent-parser";
import { parseMemoryTags } from "@/hooks/use-memory";
import { buildLayeredPrompt } from "@/lib/prompt-builder";

// ════════════════════════════════════════════════════════════════════
// CONSISTENCY SUITE: memory + conversational stitching
//
// Goal: prove that a conversation stays coherent —
//   1. Memory tags round-trip correctly (AI → stored → injected back).
//   2. "Look up images of X" consistently routes to an IMAGE search.
//   3. An unrelated follow-up that has NOTHING to do with images is NOT
//      re-hijacked into an image search / new research fetch.
//   4. Plain chat stays plain chat (no accidental browse/search intent).
// ════════════════════════════════════════════════════════════════════

// --- Image-intent contract (mirrors fetchSearchResults logic in page.tsx) ---
const IMAGE_QUERY_PATTERN =
  /\b(images?|pics?|pictures?|photos?|gifs?|animated|show me|send me|get me|give me|wanna see|want to see|let me see|i want|wallpapers?)\b/i;

// Image follow-ups are still image-related; conversational/topical follow-ups are NOT.
const IS_IMAGE_REQUEST = (text: string): boolean => IMAGE_QUERY_PATTERN.test(text);

describe("Memory round-trip", () => {
  it("extracts a single [MEMORY:key:value] tag", () => {
    const tags = parseMemoryTags("Nice to meet you! [MEMORY:name:Alex]");
    expect(tags).toEqual([{ key: "name", value: "Alex" }]);
  });

  it("extracts multiple memory tags from one message", () => {
    const tags = parseMemoryTags(
      "Got it. [MEMORY:name:Alex] [MEMORY:favorite_color:teal] [MEMORY:likes:cats]"
    );
    expect(tags).toHaveLength(3);
    expect(tags).toContainEqual({ key: "likes", value: "cats" });
  });

  it("trims whitespace from key and value", () => {
    const tags = parseMemoryTags("[MEMORY:  pet  :  a dog  ]");
    expect(tags[0]).toEqual({ key: "pet", value: "a dog" });
  });

  it("ignores text that is NOT a memory tag", () => {
    const tags = parseMemoryTags("I love pizza and long walks on the beach.");
    expect(tags).toHaveLength(0);
  });

  it("does not confuse [STATUS:...] or [ACTION:...] with memory", () => {
    const tags = parseMemoryTags(
      "[STATUS:happy:glad to help!] [ACTION:SEARCH:eevee] [MEMORY:name:Sam]"
    );
    expect(tags).toEqual([{ key: "name", value: "Sam" }]);
  });
});

describe("Memory injected back into prompt", () => {
  const memoryContext =
    "THINGS I REMEMBER ABOUT THE USER (from previous conversations):\n- name: Alex\n- likes: cats";

  it("memory layer is included when memoryContext is provided", () => {
    const prompt = buildLayeredPrompt({
      agentMode: false,
      memoryContext,
      hasTabs: false,
      hasUrlInMessage: false,
      isResearch: false,
    });
    expect(prompt).toContain("name: Alex");
    expect(prompt).toContain("likes: cats");
  });

  it("memory context survives a brand-new conversation turn (consistency)", () => {
    // Simulate: AI stored a memory last turn, user comes back next turn.
    const stored = parseMemoryTags("[MEMORY:name:Alex]");
    const ctx = stored.map((m) => `- ${m.key}: ${m.value}`).join("\n");
    const prompt = buildLayeredPrompt({
      agentMode: false,
      memoryContext: ctx,
      hasTabs: false,
      hasUrlInMessage: false,
      isResearch: false,
    });
    expect(prompt).toContain("name: Alex");
  });
});

// ════════════════════════════════════════════════════════════════════
// IMAGE LOOKUP — must stay an image lookup
// ════════════════════════════════════════════════════════════════════
describe("Image-lookup consistency", () => {
  const imageRequests = [
    "show me images of eevee",
    "send me pics of cats",
    "find pictures of anime girls",
    "show me photos of mountains",
    "i want to see wallpapers of space",
    "get me gifs of dancing cats",
    "images of anya forger",
    "pictures of sunsets",
  ];

  it.each(imageRequests)('"%s" is detected as an image request', (msg) => {
    expect(IS_IMAGE_REQUEST(msg)).toBe(true);
  });

  it('a known-site image command still resolves the site correctly', () => {
    // "look up images of eevee on rule34video" → image search on that site
    const intent = parseIntent("look up images of eevee on rule34video");
    expect(intent.type).toBe("site-search");
    expect(intent.site).toBe("https://rule34video.com");
    expect(IS_IMAGE_REQUEST("look up images of eevee on rule34video")).toBe(true);
  });

  it('"show me images of X" does not accidentally become a browse/open-url intent', () => {
    const intent = parseIntent("show me images of cats");
    // Conversational image request → AI handles it (and triggers image fetch in sendToAI),
    // never a navigation/pick intent.
    expect(intent.type).not.toBe("open-url");
    expect(intent.type).not.toBe("pick-result");
    expect(intent.type).not.toBe("pagination");
  });

  it('noun-only image request "eevee gif porn images" is detected as an image request', () => {
    // This is the exact phrasing that used to silently do nothing. It must be
    // recognized as an image request so fetchSearchResults actually fetches images.
    const msg = "eevee gif porn images";
    expect(IS_IMAGE_REQUEST(msg)).toBe(true);
  });

  it('"can you find eevee gif porn images for me" is detected as an image request', () => {
    const msg = "can you find eevee gif porn images for me";
    expect(IS_IMAGE_REQUEST(msg)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// UNRELATED FOLLOW-UPS — must NOT be stitched into an image search
//
// After an image lookup, the user may pivot to a totally unrelated topic
// (weather, a joke, a factual question, casual chat). Those must stay
// conversational and NOT trigger a new image/research fetch.
// ════════════════════════════════════════════════════════════════════
describe("Unrelated follow-ups are NOT hijacked into image searches", () => {
  const unrelatedFollowUps = [
    "what's the weather like today?",
    "tell me a joke",
    "who won the world cup in 2022?",
    "why is the sky blue?",
    "can you explain how black holes work?",
    "that's so cute, thanks!",
    "lol that made me laugh",
    "what do you think about pineapple on pizza?",
    "remind me what we were talking about earlier",
    "how are you today?",
  ];

  it.each(unrelatedFollowUps)('"%s" is NOT treated as an image request', (msg) => {
    expect(IS_IMAGE_REQUEST(msg)).toBe(false);
  });

  it.each(unrelatedFollowUps)('"%s" falls through to the AI (none / no browse intent)', (msg) => {
    const intent = parseIntent(msg);
    expect(intent.type).toBe("none");
  });

  it("a follow-up about a different topic after images stays conversational", () => {
    // Image turn: "show me pictures of dogs"
    expect(IS_IMAGE_REQUEST("show me pictures of dogs")).toBe(true);
    // Next turn pivots to weather (nothing to do with images)
    const followUp = "what should i wear outside, is it cold?";
    expect(IS_IMAGE_REQUEST(followUp)).toBe(false);
    expect(parseIntent(followUp).type).toBe("none");
  });

  it("a factual 'tell me about X' follow-up is conversational, not an image fetch", () => {
    // Even though it shares a subject with a prior image search, an informational
    // request must NOT be re-routed to images.
    const msg = "tell me about eevee's evolutions";
    expect(IS_IMAGE_REQUEST(msg)).toBe(false);
    expect(parseIntent(msg).type).toBe("none");
  });
});

// ════════════════════════════════════════════════════════════════════
// CONVERSATION STITCHING — known sites remain consistent across turns
// ════════════════════════════════════════════════════════════════════
describe("Cross-turn site consistency", () => {
  it("rule34video resolves identically every turn", () => {
    for (const variant of ["rule34video", "rule 34 video", "rul34video", "rule34vidoe"]) {
      expect(isKnownSite(variant)).toBe(true);
    }
  });

  it("an image request on a known site keeps the same resolved URL as a plain search", () => {
    const imgIntent = parseIntent("look up images of eevee on rule34video");
    const searchIntent = parseIntent("look up eevee on rule34video");
    expect(imgIntent.site).toBe(searchIntent.site);
    expect(imgIntent.site).toBe("https://rule34video.com");
  });
});
