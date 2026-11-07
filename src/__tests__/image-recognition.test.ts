import { describe, it, expect } from "vitest";
import { confidentTarget, type VisualTarget } from "@/lib/agent/visual-target";
import { fitMessages, totalTokens, type LlmMessage } from "@/lib/llm";

const sampleTargets: VisualTarget[] = [
  { n: 1, x: 20, y: 40, w: 120, h: 120, alt: "Red jacket", source: "https://example.com/a.jpg", token: "v1" },
  { n: 2, x: 160, y: 40, w: 120, h: 120, alt: "Blue jacket", source: "https://example.com/b.jpg", token: "v2" },
];

describe("confidentTarget", () => {
  it("accepts integer target indices with high confidence (>= 0.85)", () => {
    const picked = confidentTarget(sampleTargets, { n: 2, confidence: 0.92 });
    expect(picked).toEqual(sampleTargets[1]);
  });

  it("rejects weak confidence, malformed answers, or unknown target numbers", () => {
    expect(confidentTarget(sampleTargets, { n: 1, confidence: 0.7 })).toBeUndefined();
    expect(confidentTarget(sampleTargets, { n: 1.5, confidence: 0.95 })).toBeUndefined();
    expect(confidentTarget(sampleTargets, { n: 99, confidence: 0.95 })).toBeUndefined();
    expect(confidentTarget(sampleTargets, null)).toBeUndefined();
    expect(confidentTarget(sampleTargets, "not-an-object")).toBeUndefined();
  });
});

describe("multimodal image budgeting", () => {
  it("accounts for image tokens and replaces older images when trimming to fit budget", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "System instructions" },
      { role: "user", content: "Look at this old photo", images: [{ mime: "image/png", data: "AAAA" }] },
      { role: "assistant", content: "That is a mountain." },
      { role: "user", content: "Turn 2" },
      { role: "assistant", content: "Reply 2" },
      { role: "user", content: "Turn 3" },
      { role: "assistant", content: "Reply 3" },
      { role: "user", content: "What about now?" },
    ];
    expect(totalTokens(messages)).toBeGreaterThan(800);
    const fitted = fitMessages(messages, 400);
    expect(totalTokens(fitted)).toBeLessThanOrEqual(400);
    const oldImageMsg = fitted.find((m) => m.content.includes("Look at this old photo"));
    if (oldImageMsg) {
      expect(oldImageMsg.images).toBeUndefined();
      expect(oldImageMsg.content).toContain("[image shared earlier]");
    }
  });
});
