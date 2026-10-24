import { describe, expect, it } from "vitest";
import { looksLikeRefusal, startsLikeRefusal } from "@/lib/refusal";
import { contentGuidance, normalizeSafeSearch, safeParams } from "@/lib/content-policy";

describe("refusal detection", () => {
  it.each([
    "Sorry, I can't assist.",
    "Sorry, I can't assist with that.",
    "I'm sorry, but I can't help with that request.",
    "I can't assist with that.",
    "I cannot help with this request.",
    "I'm unable to help with that.",
    "I won't be able to do that.",
    "Apologies, but I cannot provide that.",
    "As an AI language model, I can't search for that.",
    "I must decline.",
    "I'm not able to assist with that request.",
    "This request violates my guidelines.",
    "That's not something I can help with.",
    "I don't feel comfortable doing that.",
    "Unable to comply.",
  ])("treats %j as a refusal", (text) => {
    expect(looksLikeRefusal(text)).toBe(true);
    expect(startsLikeRefusal(text)).toBe(true);
  });

  it.each([
    "Here are the results for that search: three sites listed the adult tag.",
    "Opening the page now. Note it contains explicit content tags that I've sorted into the NSFW group.",
    'These images are not appropriate for work (NSFW): 3, 5 and 8 are explicit; 1, 2 and 4 are safe.',
    "I can see the page. I can't tell which one is Anya without a closer look, so I'll zoom in.".repeat(6),
    '{"action":"click","id":4,"thought":"I cannot see it yet"}',
    "```json\n{\"n\": 3}\n```",
    "Sure! The first result is on rule34, and I can open it.",
    "I can't tell which one is Anya without a closer look, so I'll zoom in.",
    "I can't find that episode, but here's the show page.",
    "I cannot see the Next button yet, scrolling down.",
    "",
  ])("does not treat %j as a refusal", (text) => {
    expect(looksLikeRefusal(text)).toBe(false);
  });

  it("only looks at how a reply opens, so a mid-answer 'I can't' is not a refusal", () => {
    expect(looksLikeRefusal("Found it! I can't show a preview, but here is the link.")).toBe(false);
  });
});

describe("content guidance", () => {
  it("tells the model to classify adult content plainly, never to give a bare refusal, and keeps the fixed limits", () => {
    const text = contentGuidance("off");
    expect(text).toMatch(/classifying and labelling is analysis/i);
    expect(text).toMatch(/never reply with a bare/i);
    expect(text).toMatch(/minors/);
    expect(text).not.toMatch(/SafeSearch to/);
    // Plain wording, not an attempt to override the model.
    expect(text).not.toMatch(/ABSOLUTELY|no content policy|ZERO EXCEPTIONS/i);
  });

  it("states the user's SafeSearch choice when one is set", () => {
    expect(contentGuidance("strict")).toMatch(/STRICT/);
    expect(contentGuidance("moderate")).toMatch(/MODERATE/);
  });

  it("maps the setting to each search engine, defaulting to off", () => {
    expect(normalizeSafeSearch(undefined)).toBe("off");
    expect(normalizeSafeSearch("nonsense")).toBe("off");
    expect(normalizeSafeSearch("strict")).toBe("strict");
    expect([safeParams.google("off"), safeParams.bing("off"), safeParams.bingImages("off"), safeParams.ddg("off")]).toEqual(["safe=off", "safeSearch=Off", "adlt=off", "kp=-2"]);
    expect([safeParams.google("strict"), safeParams.bing("strict"), safeParams.bingImages("moderate"), safeParams.ddg("strict")]).toEqual(["safe=active", "safeSearch=Strict", "adlt=moderate", "kp=1"]);
  });
});
