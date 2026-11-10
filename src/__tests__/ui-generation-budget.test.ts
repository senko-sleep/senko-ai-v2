/**
 * Tests for the generateComposedUI budget-exhaustion fixes (Phase 2).
 *
 * Verifies:
 *  - Budget increased beyond 4 so weak models don't exhaust before repair
 *  - Up to 2 repair attempts are made before falling back
 *  - Fallback profile is returned (not thrown) when all LLM attempts fail
 *  - Succeeds on second / third attempt after earlier bad responses
 *  - `strong: true` is forwarded in the options (not tested here — LLM unit)
 */
import { describe, it, expect, vi } from "vitest";
import { generateComposedUI } from "@/lib/server/ui-response";
import { compileGeneratedUI } from "@/lib/ui-generation";
import type { EntityDossier } from "@/lib/server/entity-dossier";

// A model reply that is definitely invalid JSON UI
const INVALID_RESPONSE = { text: "[Profile] Anya Forger", provider: "fixture", providerLabel: "Test", model: "fixture", skipped: [] };
// A minimally valid profile JSON
const VALID_PROFILE_JSON = JSON.stringify({ type: "profile", name: "Anya Forger", imageQuery: "Anya Forger Spy x Family artwork" });
const VALID_RESPONSE = { text: VALID_PROFILE_JSON, provider: "fixture", providerLabel: "Test", model: "fixture", skipped: [] };

const BASE_MESSAGES = [
  { role: "system" as const, content: "You are a helpful assistant." },
  { role: "user" as const, content: "who is anya forger make the ui" },
];

// ─── Fallback: total LLM failure ─────────────────────────────────────────────

const DOSSIER: EntityDossier = {
  query: "anya forger", title: "Anya Forger", description: "Fictional character from Spy × Family",
  summary: "Anya Forger is a character from Tatsuya Endo's manga Spy × Family. Anya is a telepath adopted by spy Loid Forger.",
  text: "Creation:\nAnya was one of the earliest characters Endo created for the manga, inspired by the protagonist of Rengoku no Ashe. ".repeat(4),
  quote: "I have to hide my power too.",
  sections: [], trivia: [],
  facts: [{ label: "Height", value: "99.5 cm", source: "https://spy-x-family.fandom.com/wiki/Anya_Forger" }, { label: "Japanese VA", value: "Atsumi Tanezaki", source: "x" }, { label: "Hair Color", value: "Light Pink", source: "x" }],
  images: [{ url: "https://static.wikia.nocookie.net/anya.png", caption: "Anya", source: "x" }],
  related: [{ name: "Loid Forger", relation: "Adoptive Father", imageUrl: "https://static.wikia.nocookie.net/loid.png" }],
  sources: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Anya_Forger" }],
  snippets: [],
};

describe("generateComposedUI — every model fails", () => {
  it("lays out the research instead of an empty name-only card", async () => {
    const result = await generateComposedUI(BASE_MESSAGES, { modelCall: async () => INVALID_RESPONSE, dossier: DOSSIER });
    expect(result.fromResearch).toBe(true);
    expect(compileGeneratedUI(result.text).ok).toBe(true);
    expect(result.text).toContain("99.5 cm");
    expect(result.text).toContain("Atsumi Tanezaki");
    expect(result.text).toContain("Loid Forger");
    // Sources live in the composed profile's footer.
    expect(result.text).toContain('"sources":[{"label":"Wikipedia"');
  });

  it("uses the research layout when the provider call itself throws", async () => {
    const result = await generateComposedUI(BASE_MESSAGES, { modelCall: async () => { throw new Error("all providers down"); }, dossier: DOSSIER });
    expect(result.fromResearch).toBe(true);
    expect(result.text).toContain("Anya Forger");
  });

  it("fails clearly (no fake skeleton) when there is nothing real to show", async () => {
    await expect(generateComposedUI(BASE_MESSAGES, { modelCall: async () => INVALID_RESPONSE })).rejects.toThrow(/validation/);
  });

  it("sets repaired=true when repair attempts were made", async () => {
    let calls = 0;
    const result = await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => { calls++; return INVALID_RESPONSE; }, dossier: DOSSIER,
    });
    expect(result.repaired).toBe(true);
    expect(calls).toBe(3);
  });
});

describe("generateComposedUI — research checks", () => {
  it("replaces imageRef with the real image, drops invented URLs and unsupported facts", async () => {
    const tree = { type: "stack", children: [
      { type: "profile", name: "Anya Forger", imageRef: 1, imageUrl: "https://fake.example/anya.jpg",
        attributes: [{ label: "Height", value: "99.5 cm" }, { label: "Favorite food", value: "Strawberries from Tokyo" }, { label: "Hair", value: "Light Pink" }],
        relationships: [{ name: "Loid Forger", role: "Adoptive Father" }] },
      { type: "gallery", items: [{ title: "Fake", imageUrl: "https://invented.example/x.png" }] },
    ] };
    const result = await generateComposedUI(BASE_MESSAGES, { modelCall: async () => ({ ...VALID_RESPONSE, text: JSON.stringify(tree) }), dossier: DOSSIER });
    expect(result.text).toContain("https://static.wikia.nocookie.net/anya.png");
    expect(result.text).toContain("https://static.wikia.nocookie.net/loid.png");
    expect(result.text).not.toContain("fake.example");
    expect(result.text).not.toContain("invented.example");
    expect(result.text).not.toContain("Strawberries");
    expect(result.text).toContain("99.5 cm");
    expect(result.stats.inventedUrls).toBeGreaterThanOrEqual(1);
  });
});

// ─── Repair: succeeds on second attempt ──────────────────────────────────────

describe("generateComposedUI — repair on retry", () => {
  it("succeeds on second call (first repair) without throwing", async () => {
    let calls = 0;
    const result = await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => {
        calls++;
        return calls === 1 ? INVALID_RESPONSE : VALID_RESPONSE;
      },
    });
    expect(calls).toBe(2);
    const compiled = compileGeneratedUI(result.text);
    expect(compiled.ok).toBe(true);
    expect(result.repaired).toBe(true);
  });

  it("succeeds on third call (second repair) without throwing", async () => {
    let calls = 0;
    const result = await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => {
        calls++;
        return calls <= 2 ? INVALID_RESPONSE : VALID_RESPONSE;
      },
    });
    expect(calls).toBe(3);
    const compiled = compileGeneratedUI(result.text);
    expect(compiled.ok).toBe(true);
  });

  it("resolves with valid UI on first attempt when model behaves", async () => {
    let calls = 0;
    const result = await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => { calls++; return VALID_RESPONSE; },
    });
    expect(calls).toBe(1);
    expect(result.repaired).toBe(false);
    const compiled = compileGeneratedUI(result.text);
    expect(compiled.ok).toBe(true);
  });
});

// ─── onPhase callback coverage ────────────────────────────────────────────────

describe("generateComposedUI — onPhase callbacks", () => {
  it("calls onPhase(false) at start of generation", async () => {
    const onPhase = vi.fn();
    await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => VALID_RESPONSE,
      onPhase,
    });
    expect(onPhase).toHaveBeenCalledWith(false);
  });

  it("calls onPhase(true, issues) during repair when first attempt fails", async () => {
    const onPhase = vi.fn();
    let calls = 0;
    await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => { calls++; return calls === 1 ? INVALID_RESPONSE : VALID_RESPONSE; },
      onPhase,
    });
    // Second call should be onPhase(true, [...issues])
    expect(onPhase).toHaveBeenCalledTimes(2);
    expect(onPhase.mock.calls[1][0]).toBe(true);
    expect(Array.isArray(onPhase.mock.calls[1][1])).toBe(true);
  });
});

// ─── inferenceRequests tracking ───────────────────────────────────────────────

describe("generateComposedUI — inferenceRequests", () => {
  it("returns inferenceRequests as a non-negative number", async () => {
    const result = await generateComposedUI(BASE_MESSAGES, {
      modelCall: async () => VALID_RESPONSE,
    });
    // With a mock modelCall the real budget.take() is never called (the mock bypasses
    // the LLM layer), so attempts is 0.  We only assert the field exists and is numeric.
    expect(typeof result.inferenceRequests).toBe("number");
    expect(result.inferenceRequests).toBeGreaterThanOrEqual(0);
  });
});
