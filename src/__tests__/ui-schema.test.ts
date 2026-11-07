import { describe, it, expect } from "vitest";
import {
  validateUINode,
  parseTolerantJSON,
  parseMessageSegments,
  extractUIImageQueries,
  evaluateCondition,
} from "@/lib/ui-schema";
import { extractDocumentFromFile } from "@/lib/document-extractor";
import { detectCollageRequest } from "@/lib/server/images";
import { relevantImageCandidates } from "@/lib/server/gallery-images";

describe("Dynamic UI Schema & Intelligent Message Rendering System", () => {
  describe("parseTolerantJSON", () => {
    it("parses valid JSON cleanly", () => {
      const res = parseTolerantJSON('{"type":"vs_card","title":"X vs. Bill Cipher"}') as Record<string, unknown>;
      expect(res).toBeTruthy();
      expect(res.type).toBe("vs_card");
      expect(res.title).toBe("X vs. Bill Cipher");
    });

    it("tolerates trailing commas and smart quotes", () => {
      const res = parseTolerantJSON(
        '{\n  “type”: “probability_bars”,\n  “bars”: [{"label": "Bill Cipher", "percent": 90,},],\n}'
      ) as Record<string, unknown>;
      expect(res).toBeTruthy();
      expect(res.type).toBe("probability_bars");
    });
  });

  describe("validateUINode — Character Battle & Reference Screenshot Components", () => {
    it("validates vs_card matching the X vs. Bill Cipher layout (both combatants[] and left/right shorthands)", () => {
      const node = validateUINode({
        type: "vs_card",
        title: "X vs. Bill Cipher",
        left: {
          name: "X",
          subtitle: "TO BE HERO X",
          imageQuery: "X To Be Hero X anime character",
        },
        right: {
          name: "Bill Cipher",
          subtitle: "Gravity Falls",
          imageQuery: "Bill Cipher Gravity Falls",
        },
        verdictLabel: "PREDICTED WINNER",
        verdictTitle: "Bill Cipher — 9/10",
        verdictSummary:
          "Bill wins overwhelmingly against X based on demonstrated abilities, assuming Bill has his physical Weirdmageddon form.",
      });

      expect(node).not.toBeNull();
      expect(node?.type).toBe("vs_card");
      if (node?.type === "vs_card") {
        expect(node.combatants[0].name).toBe("X");
        expect(node.combatants[1].name).toBe("Bill Cipher");
        expect(node.verdict?.title).toBe("Bill Cipher — 9/10");
        expect(node.verdict?.eyebrow).toBe("PREDICTED WINNER");
      }
    });

    it("validates comparison_table with string or object rows", () => {
      const node = validateUINode({
        type: "comparison_table",
        title: "Power comparison",
        columns: ["Category", "Winner"],
        rows: [
          ["Physical combat", "X"],
          ["Speed", "Unclear"],
          { cells: ["Reality manipulation", "Bill Cipher"], winner: "Bill Cipher", badge: "Decisive" },
        ],
      });

      expect(node).not.toBeNull();
      expect(node?.type).toBe("comparison_table");
      if (node?.type === "comparison_table") {
        expect(node.columns.map((c) => c.label)).toEqual(["Category", "Winner"]);
        expect(node.rows).toHaveLength(3);
        expect(node.rows[0].cells).toEqual({ category: "Physical combat", winner: "X" });
        expect(node.rows[2].cells).toEqual({ category: "Reality manipulation", winner: "Bill Cipher" });
        expect(node.rows[2].badge).toBe("Decisive");
      }
    });

    it("validates probability_bars and clamps percentages to [0, 100]", () => {
      const node = validateUINode({
        type: "probability_bars",
        title: "Final verdict",
        bars: [
          { label: "Bill Cipher", percent: 90, color: "amber" },
          { label: "X", percent: 10, color: "slate" },
          { label: "Out of bounds", percent: 150 },
        ],
        footnote: "Subjective matchup estimates, not canonical statistics.",
      });

      expect(node).not.toBeNull();
      expect(node?.type).toBe("probability_bars");
      if (node?.type === "probability_bars") {
        expect(node.bars[0]).toMatchObject({ label: "Bill Cipher", value: 90, color: "amber" });
        expect(node.bars[1]).toMatchObject({ label: "X", value: 10, color: "slate" });
        expect(node.bars[2].value).toBe(100);
        expect(node.caption).toContain("Subjective matchup estimates");
      }
    });
  });

  describe("validateUINode — Charts, Stats, Rankings, Questionnaires, Quizzes, Controls, 3D & Docs", () => {
    it("validates chart node with multi-series or single data", () => {
      const node = validateUINode({
        type: "chart",
        chartType: "radar",
        title: "Attribute Comparison",
        data: [
          { label: "Speed", value: 85 },
          { label: "Power", value: 95 },
          { label: "Hax", value: 100 },
        ],
      });

      expect(node?.type).toBe("chart");
      if (node?.type === "chart") {
        expect(node.chartType).toBe("radar");
        expect(node.labels).toEqual(["Speed", "Power", "Hax"]);
        expect(node.series[0].data).toEqual([85, 95, 100]);
      }
    });

    it("validates questionnaire with multiple field types", () => {
      const node = validateUINode({
        type: "questionnaire",
        title: "PC Build Preferences",
        fields: [
          { id: "budget", label: "Target Budget", type: "slider", min: 500, max: 4000, step: 100, defaultValue: 1500, unit: "$" },
          { id: "use_case", label: "Primary Use", type: "radio", options: ["Gaming", "AI / ML", "Video Editing"] },
          { id: "parts", label: "Existing Parts", type: "checkbox", options: ["Monitor", "Keyboard", "SSD"] },
        ],
      });

      expect(node?.type).toBe("questionnaire");
      if (node?.type === "questionnaire") {
        expect(node.fields).toHaveLength(3);
        expect(node.fields[0].type).toBe("slider");
        expect(node.fields[1].options?.map((o) => o.label)).toContain("AI / ML");
      }
    });

    it("validates quiz node with questions, options, and explanations", () => {
      const node = validateUINode({
        type: "quiz",
        title: "Algorithm Complexity Check",
        questions: [
          {
            id: "q1",
            question: "What is the average time complexity of QuickSort?",
            options: ["O(n)", "O(n log n)", "O(n^2)", "O(log n)"],
            correctIndex: 1,
            explanation: "QuickSort partitions n elements across O(log n) average recursion depth.",
          },
        ],
      });

      expect(node?.type).toBe("quiz");
      if (node?.type === "quiz") {
        expect(node.questions[0].correctOptionId).toBe("opt_1");
      }
    });

    it("validates nested stack, grid, tabs, and conditional controls", () => {
      const node = validateUINode({
        type: "stack",
        gap: "md",
        children: [
          {
            type: "controls",
            controls: [
              {
                id: "form",
                label: "Form",
                type: "segmented",
                stateKey: "form",
                options: ["Base", "Weirdmageddon"],
                defaultValue: "Weirdmageddon",
              },
            ],
          },
          {
            type: "callout",
            variant: "warning",
            title: "Weirdmageddon Active",
            content: "Physical form unlocked.",
            visibleWhen: { stateKey: "form", operator: "eq", value: "Weirdmageddon" },
          },
        ],
      });

      expect(node?.type).toBe("stack");
      if (node?.type === "stack") {
        expect(node.children).toHaveLength(2);
        expect(node.children[0].type).toBe("controls");
        expect(node.children[1].when?.stateKey).toBe("form");
        expect(node.children[1].when?.equals).toBe("Weirdmageddon");
      }
    });

    it("validates model_viewer and document_preview nodes", () => {
      const modelNode = validateUINode({
        type: "model_viewer",
        title: "Torus Knot Topology",
        preset: "torus",
        color: "#f59e0b",
        wireframe: false,
      });
      expect(modelNode?.type).toBe("model_viewer");

      const docNode = validateUINode({
        type: "document_preview",
        title: "Architecture RFC.pdf",
        fileType: "pdf",
        pageCount: 12,
        sections: [{ heading: "1. Overview", content: "System architecture overview.", page: 1 }],
      });
      expect(docNode?.type).toBe("document_preview");
    });

    it("falls back gracefully for unrecognized component types", () => {
      const fallbackWithContent = validateUINode({
        type: "future_hologram_widget",
        title: "Hologram Summary",
        content: "Graceful fallback text content.",
      });
      expect(fallbackWithContent?.type).toBe("callout");

      const emptyUnknown = validateUINode({
        type: "future_hologram_widget",
        foo: "bar",
      });
      expect(emptyUnknown).toBeNull();
    });
  });

  describe("parseMessageSegments & Streaming Tolerance", () => {
    it("splits mixed markdown, ui blocks, mermaid, and math segments", () => {
      const raw = [
        "### Matchup Overview",
        "```ui",
        '{"type":"probability_bars","bars":[{"label":"Bill Cipher","percent":90},{"label":"X","percent":10}]}',
        "```",
        "And here is the state diagram:",
        "```mermaid",
        "graph LR\n  A[Start] --> B[Finish]",
        "```",
      ].join("\n");

      const segments = parseMessageSegments(raw);
      expect(segments).toHaveLength(4);
      expect(segments[0].kind).toBe("markdown");
      expect(segments[1].kind).toBe("ui");
      expect(segments[2].kind).toBe("markdown");
      expect(segments[3].kind).toBe("mermaid");
    });

    it("detects unclosed ```ui fence during streaming as ui_pending instead of flashing raw JSON", () => {
      const partialStream = 'Here is the breakdown:\n\n```ui\n{"type": "vs_card", "title": "X vs. Bill';
      const segments = parseMessageSegments(partialStream, true);
      expect(segments).toHaveLength(2);
      expect(segments[0].kind).toBe("markdown");
      expect(segments[1].kind).toBe("ui_pending");
      expect(parseMessageSegments(partialStream)[1].kind).toBe("ui_error");
    });

    it("preserves completed blocks and renders complete JSON even when its closing fence is missing", () => {
      const complete = '```ui\n{"type":"text","content":"First panel"}\n```';
      const trailing = '```ui\n{"type":"text","content":"Second panel"}';
      expect(parseMessageSegments(`${complete}\n${trailing}`, true).map((s) => s.kind)).toEqual(["ui", "ui"]);
      expect(parseMessageSegments(`${complete}\n${trailing.slice(0, -3)}`).map((s) => s.kind)).toEqual(["ui", "ui_error"]);
      expect(parseMessageSegments(`\`\`\`\`md\n${complete}\n\`\`\`\``).map((s) => s.kind)).toEqual(["markdown"]);
    });

    it("keeps column spans paired with valid children", () => {
      expect(validateUINode({ type: "grid", cols: 3, children: [null, { type: "text", content: "Lead", colSpan: 2 }, "Detail"] }))
        .toMatchObject({ type: "grid", spans: [2, 1] });
      expect(validateUINode({ type: "grid", cols: 2, tracks: [9, -1], children: ["Main", "Aside"] }))
        .toMatchObject({ type: "grid", tracks: [4, 1] });
    });

    it("extracts a collage subject, count, and requested layout", () => {
      expect(detectCollageRequest("make a UI image collage of Eevee want you to find 10 images"))
        .toEqual({ query: "Eevee", count: 10, cols: 3, layout: "auto" });
      expect(detectCollageRequest("Create a collage of red foxes using 8 photos in a 4-column grid"))
        .toEqual({ query: "red foxes", count: 8, cols: 4, layout: "grid" });
      expect(detectCollageRequest("Make an image collage of Anya Forger but make the environment feel like a printest gallery"))
        .toEqual({ query: "Anya Forger", count: 10, cols: 3, layout: "masonry" });
      expect(detectCollageRequest("How do I make an image collage of Eevee?")).toBeUndefined();
    });

    it("keeps the masonry layout when rendering a generated gallery", () => {
      const items = [{ imageUrl: "/api/uploads/i_a", width: 640, height: 960 }];
      expect(validateUINode({ type: "gallery", layout: "masonry", curated: true, cols: 4, items }))
        .toMatchObject({ type: "gallery", layout: "masonry", curated: true, cols: 4, items });
    });

    it("uses subject metadata rather than unrelated results to fill a gallery", () => {
      const hit = { url: "https://example.test/art/anya-forger.webp", alt: "Illustration", source: "", engine: "test" };
      const wrong = { ...hit, url: "https://example.test/art/yor.webp", alt: "Yor Forger" };
      expect(relevantImageCandidates("Anya Forger fanart", [wrong, hit])).toEqual([hit]);
    });
  });

  describe("extractUIImageQueries & evaluateCondition", () => {
    it("extracts all nested imageQuery strings from UI blocks", () => {
      const raw = [
        "```ui",
        JSON.stringify({
          type: "vs_card",
          left: { name: "X", imageQuery: "X To Be Hero X anime" },
          right: { name: "Bill Cipher", imageQuery: "Bill Cipher Gravity Falls" },
        }),
        "```",
      ].join("\n");

      const queries = extractUIImageQueries(raw);
      expect(queries).toEqual(["X To Be Hero X anime", "Bill Cipher Gravity Falls"]);
    });

    it("evaluates conditional visibility rules accurately", () => {
      const state = { mode: "advanced", tags: ["cpu", "gpu"], active: true };
      expect(evaluateCondition({ stateKey: "mode", equals: "advanced" }, state)).toBe(true);
      expect(evaluateCondition({ stateKey: "mode", notEquals: "basic" }, state)).toBe(true);
      expect(evaluateCondition({ stateKey: "tags", includes: "gpu" }, state)).toBe(true);
      expect(evaluateCondition({ stateKey: "active", truthy: true }, state)).toBe(true);
    });
  });

  describe("Document & 3D Wavefront OBJ Extractor", () => {
    it("extracts 3D Wavefront .obj files and counts vertices/faces", async () => {
      const objText = ["v -1 -1 0", "v 1 -1 0", "v 0 1 0", "f 1 2 3"].join("\n");
      const file = new File([objText], "triangle.obj", { type: "text/plain" });
      const extracted = await extractDocumentFromFile(file);
      expect(extracted.is3DModel).toBe(true);
      expect(extracted.summary).toContain("3 vertices");
      expect(extracted.summary).toContain("1 faces");
      expect(extracted.objData).toContain("v -1 -1 0");
    });
  });
});

import { parseMessageSegments as pms } from "@/lib/ui-schema";
describe("invalid UI block fallback", () => {
  it("shows the links from a block that fails validation instead of a placeholder", () => {
    const msg = 'Results:\n```ui\n{"type":"made_up_widget","items":[{"title":"Clip one","url":"https://example.com/v/1"},{"title":"Clip two","href":"https://example.com/v/2"}]}\n```';
    const segs = pms(msg);
    expect(segs.map(s => s.kind)).toEqual(["markdown", "markdown"]);
    const text = (segs[1] as { text: string }).text;
    expect(text).toContain("[Clip one](<https://example.com/v/1>)");
    expect(text).toContain("[Clip two](<https://example.com/v/2>)");
  });
});
