import { describe, expect, it } from "vitest";
import { hasChatLayoutImages, splitChatLayouts, validateChatLayout } from "@/lib/chat-layout";
import { extractCodeArtifacts } from "@/components/assistant/workspace-artifacts";

const composition = {
  type: "row", children: [
    { type: "text", text: "## The northern lights\n\nCharged particles light up the sky.", weight: 2 },
    { type: "column", children: [{ type: "image", image: 0, imageQuery: "aurora borealis", caption: "Aurora", aspect: "video" }] },
  ],
};
const fence = (node: unknown) => "```chat-layout\n" + JSON.stringify(node) + "\n```";

describe("conversational layouts", () => {
  it("preserves prose, nested compositions and UI widgets in their original order", () => {
    const parts = splitChatLayouts("Before\n" + fence(composition) + '\n```ui\n{"type":"text","content":"Map details"}\n```\nAfter');
    expect(parts.map((p) => p.kind)).toEqual(["prose", "layout", "prose"]);
    expect(parts[0]).toEqual({ kind: "prose", text: "Before\n" });
    expect(parts[2]).toMatchObject({ text: expect.stringContaining("```ui") });
    expect(hasChatLayoutImages(parts)).toBe(true);
  });

  it("holds incomplete JSON during streaming and renders it once complete", () => {
    const text = "Intro\n" + fence(composition);
    for (let end = text.indexOf("\n", text.indexOf("```")) + 1; end < text.length - 3; end++) {
      expect(splitChatLayouts(text.slice(0, end), true).map((p) => p.kind)).toEqual(["prose", "pending"]);
    }
    expect(splitChatLayouts(text, true)[1].kind).toBe("layout");
    expect(splitChatLayouts("Intro\n```chat-la", true)[1].kind).toBe("pending");
  });

  it("keeps layout examples inside code fences as code", () => {
    const example = "````markdown\n" + fence(composition) + "\n````";
    expect(splitChatLayouts(example)).toEqual([{ kind: "prose", text: example }]);
  });

  it("never exposes malformed or interrupted layout JSON as code", () => {
    expect(splitChatLayouts('```chat-layout\n{"type":broken}\n```')).toEqual([{ kind: "error" }]);
    expect(splitChatLayouts('```chat-layout\n{"type":')).toEqual([{ kind: "error" }]);
    expect(hasChatLayoutImages(splitChatLayouts(fence({ type: "text", text: "Hello" })))).toBe(false);
  });

  it("bounds model-provided geometry, strips styles and rejects unsafe or excessive trees", () => {
    expect(validateChatLayout({ type: "text", text: "Hello", span: 500, weight: -10, style: { position: "fixed" } })).toMatchObject({ span: 6, weight: 0.25 });
    expect(validateChatLayout({ type: "text", text: "Hello", style: "display:none" })).not.toHaveProperty("style");
    expect(validateChatLayout({ type: "image", imageUrl: "javascript:alert(1)" })).toBeNull();
    expect(validateChatLayout({ type: "image", image: -1 })).toBeNull();
    expect(validateChatLayout({ type: "grid", children: Array(101).fill({ type: "text", text: "Hi" }) })).toBeNull();
    let deep: unknown = { type: "text", text: "Hi" };
    for (let i = 0; i < 10; i++) deep = { type: "column", children: [deep] };
    expect(validateChatLayout(deep)).toBeNull();
  });

  it("does not turn conversation composition into a workspace coding job", () => {
    expect(extractCodeArtifacts([{ id: "reply", role: "assistant", content: fence(composition) }])).toEqual([]);
    expect(extractCodeArtifacts([{ id: "reply", role: "assistant", content: fence(composition) + '\n```js\nconsole.log("real code");\n```' }])).toHaveLength(1);
  });
});
