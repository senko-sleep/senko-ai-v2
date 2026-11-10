import { describe, it, expect } from "vitest";
import { composeProfile } from "@/lib/server/profile-compose";
import type { EntityDossier } from "@/lib/server/entity-dossier";

const dossier: EntityDossier = {
  query: "anya forger", title: "Anya Forger", description: "Fictional character from Spy × Family",
  summary: "Anya Forger is a character from Tatsuya Endo's manga Spy × Family. Anya is a telepath adopted by spy Loid Forger. Loid spies on the National Unity Party within .",
  text: "", quote: "I have to hide my power too.",
  sections: [{ title: "Appearance", body: "Anya is a small girl with pink hair.[ch. 1] She wears cone-shaped headpieces that look like horns.\n|}\nThey give the impression of reception.", source: "x" }],
  trivia: ["Anya's name was originally romanized as \"Ania\" by Endo.", "According to the official fanbook:"],
  facts: [
    { label: "Japanese", value: "アーニャ・フォージャー", source: "x" },
    { label: "Romaji", value: "Ānya Fōjā", source: "x" },
    { label: "Alias", value: "Test Subject \"007\" (Formerly), Princess Anya (Roleplaying)", source: "x" },
    { label: "Age", value: "6 (Forged I.D. papers), 5 (Approximate age)", source: "x" },
    { label: "Height", value: "99.5 cm (3'3\")", source: "x" },
    { label: "Occupation", value: "Test Subject (Formerly), Student", source: "x" },
    { label: "Japanese VA", value: "Atsumi Tanezaki", source: "x" },
    { label: "Family", value: "Loid Forger (Adoptive Father)", source: "x" },
  ],
  images: [{ url: "https://img/hero.png", caption: "Portrait", source: "x" }, { url: "https://img/2.png", caption: "Manga", source: "x" }],
  related: [{ name: "Loid Forger", relation: "Adoptive Father", imageUrl: "https://img/loid.png" }, { name: "Becky Blackbell", relation: "Best Friend" }],
  sources: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Anya_Forger" }],
  snippets: [],
};

function compose(extra: Record<string, unknown>[] = [], profile: Record<string, unknown> = {}) {
  const nodes: Record<string, unknown>[] = [{ type: "stack", children: [{ type: "profile", name: "Anya Forger", imageUrl: "https://img/hero.png", ...profile }, ...extra] }];
  composeProfile(nodes, dossier);
  const stack = nodes[0] as { children: Record<string, unknown>[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reads deep, loosely-typed JSON
  return { p: stack.children[0] as Record<string, any>, children: stack.children };
}

describe("composeProfile", () => {
  it("groups facts and picks current values for headline stats", () => {
    const { p } = compose();
    expect(p.facts.map((g: { group: string }) => g.group)).toEqual(["Identity", "Appearance", "Role", "In the series"]);
    expect(p.highlights).toContainEqual({ label: "Occupation", value: "Student" });
    expect(p.highlights).toContainEqual({ label: "Age", value: "6" });
    expect(p.nativeName).toBe("アーニャ・フォージャー · Ānya Fōjā");
    expect(p.aliases).toEqual(["Test Subject \"007\"", "Princess Anya"]);
    // Relations are shown as connections, not as infobox rows.
    expect(JSON.stringify(p.facts)).not.toContain("Adoptive Father");
  });

  it("adds research depth: sections, trivia, connections, gallery, sources", () => {
    const { p } = compose([], { relationships: [{ name: "Loid Forger", role: "Adoptive father who is a spy and recruited her" }] });
    expect(p.sections[0].body).not.toMatch(/\[ch\.|\|\}/);
    expect(p.trivia).toEqual(["Anya's name was originally romanized as \"Ania\" by Endo."]);
    const loid = p.relationships.find((r: { name: string }) => r.name === "Loid Forger");
    expect(loid.role).toBe("Adoptive Father");
    expect(loid.description).toContain("spy");
    expect(p.relationships.map((r: { name: string }) => r.name)).toContain("Becky Blackbell");
    expect(p.gallery).toEqual([{ title: "Manga", imageUrl: "https://img/2.png" }]);
    expect(p.sources[0].label).toBe("Wikipedia");
  });

  it("writes a clean lead when the model gave none", () => {
    const { p } = compose();
    expect(p.bio).toContain("telepath adopted by spy Loid Forger.");
    expect(p.bio).not.toContain("within .");
  });

  it("removes sibling blocks that repeat the profile", () => {
    const { children } = compose([
      { type: "key_value", items: [{ label: "Height", value: "99.5 cm (3'3\")" }, { label: "Japanese VA", value: "Atsumi Tanezaki" }] },
      { type: "gallery", title: "Anya pictures", items: [{ title: "x", imageUrl: "https://img/9.png" }] },
      { type: "text", content: "Sources: [[cite: Wikipedia | https://en.wikipedia.org]]" },
      { type: "timeline", events: [{ date: "2019", title: "Debut" }, { date: "2022", title: "Anime" }] },
    ]);
    expect(children.map((c) => c.type)).toEqual(["profile", "timeline"]);
  });
});
