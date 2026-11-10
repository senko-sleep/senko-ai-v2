import { describe, expect, it } from "vitest";
import { discussionSubject, subjectSearchQuery, visualAnswerNote } from "@/lib/server/visual-intent";
import { guardFacts, type EnrichStats } from "@/lib/server/ui-enrich";
import type { EntityDossier } from "@/lib/server/entity-dossier";

describe("discussion subjects get a visual answer", () => {
  it.each([
    ["do you like chara from undertale", "chara from undertale"],
    ["what do you think of Makima?", "Makima"],
    ["thoughts on breaking bad", "breaking bad"],
    ["how do you feel about Taylor Swift lol", "Taylor Swift"],
    ["who is Gojo Satoru", "Gojo Satoru"],
    ["is Elden Ring worth it", "Elden Ring"],
    ["tell me about the Nintendo Switch 2", "Nintendo Switch 2"],
  ])("%s → %s", (q, subject) => expect(discussionSubject(q)).toBe(subject));

  it.each([
    "hi how are you",
    "do you like me",
    "what do you think about life",
    "how do you feel about it",
    "do you know how to fix this react component",
    "tell me about your day",
    "i'm sad today",
  ])("ignores %s", (q) => expect(discussionSubject(q)).toBeNull());

  it("builds a search query and a layout note", () => {
    expect(subjectSearchQuery("chara from undertale")).toBe("chara undertale");
    expect(visualAnswerNote("Chara")).toMatch(/figure/);
  });
});

describe("facts-only checking keeps opinions", () => {
  const dossier = {
    title: "Chara", summary: "Chara is a character in the 2015 video game Undertale by Toby Fox. ".repeat(8),
    text: "Chara was the first human to fall into the Underground. ".repeat(10),
    facts: [{ label: "Series", value: "Undertale" }], related: [], images: [], snippets: [], sources: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Undertale" }],
  } as unknown as EntityDossier;
  const stats = (): EnrichStats => ({ images: 0, droppedImages: 0, droppedFacts: [], inventedUrls: 0 });

  it("does not strip Senko's take from prose", () => {
    const nodes = [{ type: "text", content: "Honestly I think they are the most haunting character ever made." }];
    guardFacts(nodes, dossier, stats(), { prose: false });
    expect(nodes[0].content).toContain("haunting");
  });

  it("still drops unsupported hard facts", () => {
    const nodes = [{ type: "key_value", items: [{ label: "Series", value: "Undertale" }, { label: "Voice actor", value: "Zendaya Coleman" }] }];
    guardFacts(nodes, dossier, stats(), { prose: false });
    expect(nodes[0].items).toHaveLength(1);
  });
});
