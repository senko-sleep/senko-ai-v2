import { describe, expect, it } from "vitest";
import { compileGeneratedUI, wantsGeneratedUI } from "@/lib/ui-generation";
import { generateComposedUI } from "@/lib/server/ui-response";
import { parseMessageSegments, validateUITheme } from "@/lib/ui-schema";

describe("real UI generation contract", () => {
  it("routes composed interfaces separately from code projects and ordinary questions", () => {
    expect(wantsGeneratedUI("Create a beautiful Eevee-themed interactive UI")).toBe(true);
    expect(wantsGeneratedUI("Create an interactive technical schematic")).toBe(true);
    expect(wantsGeneratedUI("Build this React UI in my workspace")).toBe(false);
    expect(wantsGeneratedUI("What is a user interface?")).toBe(false);
  });
  it("compiles schema-valid output into actual renderer segments, without a topic template", () => {
    for (const node of [{ type: "gallery", title: "Wildlife", imageFit: "contain", aspect: "square", items: [{ title: "Observed fox", imageUrl: "https://example.com/provided-fox.png" }] }, { type: "diagram", title: "Request flow", mermaid: "flowchart LR\nA[Browser] --> B[API]" }]) {
      const result = compileGeneratedUI(JSON.stringify(node));
      expect(result.ok, result.issues.join(" ")).toBe(true);
      expect(parseMessageSegments(result.content).some((segment) => segment.kind === "ui")).toBe(true);
      expect(result.nodes[0].type).toBe(node.type);
    }
    expect(compileGeneratedUI('[Profile] Name: Eevee\n[Gallery] Eevee images').ok).toBe(false);
    expect(compileGeneratedUI('{"type":"invented_widget","text":"fake component"}').ok).toBe(false);
  });
  it("accepts bounded theme tokens and rejects CSS injection", () => {
    expect(validateUITheme({ accent: "#b77a36", font: "editorial", background: "url(https://bad.test/x)" })).toEqual({ accent: "#b77a36", font: "editorial" });
  });
  it("repairs a pseudo-UI response exactly once without publishing the invalid draft", async () => {
    let calls = 0;
    const result = await generateComposedUI([{ role: "system", content: "UI test fixture" }, { role: "user", content: "Create an interactive UI" }], { modelCall: async (_messages, options) => {
      calls++; expect(options.hedge).toBe(false); expect(options.json).toBe(true);
      return { text: calls === 1 ? "[Card] A fake layout" : '{"type":"text","content":"A real renderer node"}', provider: "fixture", providerLabel: "Labelled test adapter", model: "deterministic-adapter", skipped: [] };
    } });
    expect(calls).toBe(2); expect(result.repaired).toBe(true);
    expect(parseMessageSegments(result.text)[0].kind).toBe("ui");
    // Without research to fall back on, repeated invalid output is an error, never a fake skeleton card.
    let failures = 0;
    await expect(generateComposedUI(
      [{ role: "system", content: "UI test" }, { role: "user", content: "who is Anya Forger make a ui" }],
      { modelCall: async () => { failures++; return { text: "[Gallery] Fake again", provider: "fixture", providerLabel: "Test", model: "fixture", skipped: [] }; } },
    )).rejects.toThrow();
    expect(failures).toBe(3);
  });
});
