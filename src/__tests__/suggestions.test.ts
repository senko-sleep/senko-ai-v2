import { describe, it, expect, beforeAll } from "vitest";

process.env.DATA_DIR = ":memory:";

import { cleanSuggestions, fallbackSuggestions, gatherSignals, parseSuggestions } from "@/lib/server/suggestions";
import { guessIcon, isSuggestionIcon } from "@/lib/suggestion-icons";
import { q } from "@/lib/server/db";

describe("parseSuggestions", () => {
  it("reads an object, a bare array, and fenced JSON with chatter", () => {
    expect(parseSuggestions('{"suggestions":[{"title":"a"}]}')).toHaveLength(1);
    expect(parseSuggestions('[{"title":"a"},{"title":"b"}]')).toHaveLength(2);
    expect(parseSuggestions('Sure!\n```json\n{"suggestions":[{"title":"x"}]}\n```')).toHaveLength(1);
    expect(parseSuggestions("not json")).toEqual([]);
  });
});

describe("cleanSuggestions", () => {
  const base = { prompt: "Teach me something interesting about volcanoes today" };

  it("keeps valid items, swaps unknown icons for a keyword guess, and caps at four", () => {
    const raw = [
      { ...base, title: "Volcano basics", icon: "volcano-3d" },
      { title: "Anime picks", prompt: "Recommend anime like Steins;Gate for me", icon: "tv" },
      { title: "Cook dinner", prompt: "Give me a quick dinner recipe with rice", icon: "chef-hat" },
      { title: "Debug code", prompt: "Help me debug my python script please", icon: "code" },
      { title: "Fifth", prompt: "This one should be dropped by the cap", icon: "star" },
    ];
    const out = cleanSuggestions(raw, { mode: "chat" });
    expect(out).toHaveLength(4);
    expect(out.every((s) => isSuggestionIcon(s.icon))).toBe(true);
    expect(out[0].icon).toBe("lightbulb");
  });

  it("drops duplicates, recently shown titles, and anything leaking private data", () => {
    const raw = [
      { ...base, title: "Volcano basics", icon: "mountain" },
      { ...base, title: "Volcano basics!", icon: "mountain" },
      { ...base, title: "Shown before", icon: "star" },
      { title: "Email me", prompt: "Send the plan to someone@example.com tonight", icon: "mail" },
      { title: "Near home", prompt: "Find good coffee near Maple Grove for me", icon: "coffee" },
      { title: "x", prompt: "too short" },
    ];
    const out = cleanSuggestions(raw, { mode: "chat", avoid: ["shown before"], privateValues: ["Maple Grove"] });
    expect(out.map((s) => s.title)).toEqual(["Volcano basics"]);
  });

  it("forces agent mode in agent mode", () => {
    const out = cleanSuggestions([{ ...base, title: "Do a thing", mode: "chat" }], { mode: "agent" });
    expect(out[0].mode).toBe("agent");
  });
});

describe("fallback + icons", () => {
  it("always returns four renderable, distinct suggestions and avoids recent ones", () => {
    const first = fallbackSuggestions("chat");
    expect(first).toHaveLength(4);
    expect(first.every((s) => isSuggestionIcon(s.icon))).toBe(true);
    const next = fallbackSuggestions("chat", first.map((s) => s.title));
    expect(next.some((s) => first.some((f) => f.title === s.title))).toBe(false);
    expect(fallbackSuggestions("agent").every((s) => s.mode === "agent")).toBe(true);
  });
  it("guesses icons from keywords", () => {
    expect(guessIcon("watch the next episode")).toBe("tv");
    expect(guessIcon("nothing matches here")).toBe("sparkles");
  });
});

describe("gatherSignals", () => {
  beforeAll(async () => {
    await q("INSERT INTO memories (owner_id, key, value) VALUES ('o_t', 'favorite_anime', 'Steins;Gate'), ('o_t', 'name', 'Robin'), ('o_t', 'city', 'Maple Grove')");
    await q("INSERT INTO chats (id, owner_id, title) VALUES ('c_t', 'o_t', 'Sourdough help')");
    await q("INSERT INTO messages (id, chat_id, role, content) VALUES ('m_t', 'c_t', 'user', 'call me at 555-123-4567 about bouldering')");
  });
  it("uses interests and topics, but keeps identity facts out", async () => {
    const s = await gatherSignals("o_t");
    expect(s.interests.join(" ")).toContain("Steins;Gate");
    expect(s.interests.join(" ")).not.toMatch(/Robin|Maple/);
    expect(s.privateValues).toEqual(expect.arrayContaining(["Robin", "Maple Grove"]));
    expect(s.recentTopics).toContain("Sourdough help");
    expect(s.recentTopics.join(" ")).not.toContain("555");
  });
});
