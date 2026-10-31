import { describe, it, expect } from "vitest";
import {
  extractUIImageQueries,
  extractYouTubeVideoId,
  parseMessageSegments,
  validateUINode,
} from "@/lib/ui-schema";
import { classifyYouTubeIntent } from "@/lib/server/grounding";
import { DYNAMIC_UI_SYSTEM } from "@/lib/ui-prompt";

const fence = (o: unknown) => "```ui\n" + JSON.stringify(o) + "\n```";
const types = (text: string) =>
  parseMessageSegments(text).map((s) => (s.kind === "ui" ? s.node.type : s.kind));

describe("Universal UI composition", () => {
  it("profile: character (Anya Forger) with portrait query, relationships, trivia", () => {
    const n = validateUINode({
      type: "character_profile",
      name: "Anya Forger",
      series: "SPY×FAMILY",
      attributes: [{ label: "School", value: "Eden Academy" }],
      relationships: [{ name: "Loid Forger", role: "Father" }],
      trivia: ["Loves peanuts"],
    });
    expect(n?.type).toBe("profile");
    if (n?.type === "profile") {
      expect(n.imageQuery).toContain("Anya Forger");
      expect(n.relationships?.[0].imageQuery).toContain("Loid Forger");
      expect(n.trivia).toHaveLength(1);
    }
    expect(extractUIImageQueries(fence({ type: "profile", name: "Anya Forger" }))).toContain("Anya Forger");
  });

  it("video_grid: derives real thumbnail + url from videoId and never invents stats", () => {
    const n = validateUINode({
      type: "youtube_grid",
      interpretation: "Currently trending",
      dataStatus: "live",
      videos: [
        { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channel: "Rick Astley", views: "1.5B" },
        { url: "https://youtu.be/kJQP7kiw5Fk", title: "Despacito" },
        { title: "No id" },
      ],
    });
    expect(n?.type).toBe("video_grid");
    if (n?.type === "video_grid") {
      expect(n.videos[0].thumbnailUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
      expect(n.videos[1].videoId).toBe("kJQP7kiw5Fk");
      expect(n.videos[2].views).toBeUndefined();
      expect(n.videos[2].videoId).toBeUndefined();
      expect(n.dataStatus).toBe("live");
    }
  });

  it("extractYouTubeVideoId handles urls and rejects junk", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(extractYouTubeVideoId("javascript:alert(1)")).toBeUndefined();
  });

  it("classifies YouTube intents from user wording", () => {
    expect(classifyYouTubeIntent("What are the most popular YouTube videos right now?").intent).toBe("trending_now");
    expect(classifyYouTubeIntent("most viewed youtube videos of all time").intent).toBe("all_time_most_viewed");
    expect(classifyYouTubeIntent("most liked youtube videos").intent).toBe("most_liked");
    expect(classifyYouTubeIntent("top youtube gaming videos").intent).toBe("category_specific");
    expect(classifyYouTubeIntent("Hello, how are you?").isYouTubeQuery).toBe(false);
  });

  it("explain science: prose + diagram + math + steps compose in one message", () => {
    const text = [
      "Quantum mechanics describes nature at tiny scales.",
      fence({ type: "math", latex: "i\\hbar\\frac{\\partial}{\\partial t}\\Psi=\\hat H\\Psi" }),
      fence({ type: "steps", steps: [{ title: "Prepare", description: "State" }, "Measure"] }),
    ].join("\n");
    expect(types(text)).toEqual(["markdown", "math", "steps"]);
  });

  it("compare Python vs JavaScript: table + radar chart, non-battle eyebrow", () => {
    const t = validateUINode({
      type: "comparison_table",
      columns: ["Aspect", "Python", "JavaScript"],
      rows: [["Typing", "Dynamic", "Dynamic"]],
    });
    expect(t?.type).toBe("comparison_table");
    const v = validateUINode({ type: "verdict", title: "Pick by use case" });
    if (v?.type === "verdict") expect(v.eyebrow).not.toBe("PREDICTED WINNER");
    const c = validateUINode({ type: "chart", chartType: "radar", labels: ["a", "b", "c"], series: [{ name: "Py", data: [1, 2, 3] }] });
    expect(c?.type).toBe("chart");
  });

  it("highest mountains: map + ranking validated, bad coordinates dropped", () => {
    const m = validateUINode({
      type: "map",
      markers: [
        { label: "Everest", lat: 27.9881, lng: 86.925, elevation: "8,848.86 m" },
        { label: "Nowhere", lat: "abc", lng: 0 },
      ],
    });
    expect(m?.type).toBe("map");
    if (m?.type === "map") expect(m.markers).toHaveLength(1);
    const r = validateUINode({ type: "ranking", items: [{ title: "Everest", score: "8,848 m", category: "Himalaya", imageQuery: "Mount Everest" }] });
    expect(r?.type).toBe("ranking");
  });

  it("naruto strongest: ranking carries imageQuery for pre-resolution", () => {
    const qs = extractUIImageQueries(
      fence({ type: "ranking", items: [{ title: "Hagoromo", imageQuery: "Hagoromo Naruto" }, { title: "Kaguya", imageQuery: "Kaguya Otsutsuki" }] })
    );
    expect(qs).toEqual(["Hagoromo Naruto", "Kaguya Otsutsuki"]);
  });

  it("quiz: correct answer resolved by index and label", () => {
    const q = validateUINode({
      type: "quiz",
      questions: [{ question: "Big-O of binary search?", options: ["O(n)", "O(log n)"], correctIndex: 1 }],
    });
    if (q?.type === "quiz") expect(q.questions[0].correctOptionId).toBe(q.questions[0].options[1].id);
    else throw new Error("quiz expected");
  });

  it("PDF: document_preview survives with only a summary", () => {
    expect(validateUINode({ type: "document_preview", title: "Paper", summary: "About X" })?.type).toBe("document_preview");
  });

  it("news_feed + product_grid + timeline + key_value validate and drop unsafe urls", () => {
    const n = validateUINode({
      type: "news",
      dataStatus: "live",
      articles: [{ title: "Story", source: "Wire", url: "javascript:alert(1)" }],
    });
    expect(n?.type).toBe("news_feed");
    if (n?.type === "news_feed") expect(n.articles[0].url).toBeUndefined();
    expect(validateUINode({ products: [{ name: "Laptop", price: "$999", specs: ["CPU: M4"] }] })?.type).toBe("product_grid");
    expect(validateUINode({ type: "timeline", events: [{ date: "1905", title: "Annus mirabilis" }] })?.type).toBe("timeline");
    expect(validateUINode({ type: "specs", items: [{ label: "RAM", value: "16 GB" }] })?.type).toBe("key_value");
  });

  it("casual chat: 'Hello' stays plain markdown with zero UI", () => {
    expect(types("Hello! I'm doing great, how about you?")).toEqual(["markdown"]);
  });

  it("prompt is topic-agnostic and enforces data integrity", () => {
    expect(DYNAMIC_UI_SYSTEM).toContain("NEVER invent live statistics");
    expect(DYNAMIC_UI_SYSTEM).toContain("plain conversational text only");
    expect(DYNAMIC_UI_SYSTEM).not.toMatch(/Bill Cipher/);
  });
});
