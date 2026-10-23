import { describe, it, expect } from "vitest";
import { fitMessages, totalTokens, type LlmMessage } from "@/lib/llm";

const long = (n: number, ch = "x") => ch.repeat(n);

function chat(turns: number, size = 2000): LlmMessage[] {
  const msgs: LlmMessage[] = [{ role: "system", content: long(18_000, "s") }]; // ~5k-token persona
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "user", content: `question ${i} ${long(200)}` });
    msgs.push({ role: "assistant", content: `answer ${i} ${long(size)}` });
  }
  msgs.push({ role: "user", content: "latest question" });
  return msgs;
}

describe("fitMessages", () => {
  it("leaves a request that already fits untouched", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "be nice" },
      { role: "user", content: "hi" },
    ];
    expect(fitMessages(msgs, 5000, "compact")).toEqual(msgs);
  });

  it("uses the compact persona for local models even when it would fit", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "full persona" },
      { role: "user", content: "hi" },
    ];
    expect(fitMessages(msgs, 5000, "compact", true)[0].content).toBe("compact");
  });

  it("brings a long chat under budget, keeping the system prompt and the latest message", () => {
    const msgs = chat(30);
    expect(totalTokens(msgs)).toBeGreaterThan(20_000);
    const out = fitMessages(msgs, 5000, "short persona");
    expect(totalTokens(out)).toBeLessThanOrEqual(5000);
    expect(out[0]).toEqual({ role: "system", content: "short persona" });
    expect(out[out.length - 1].content).toBe("latest question");
    // History starts with the user, not a dangling assistant reply.
    expect(out[1].role).toBe("user");
    // The newest turns survive whole.
    expect(out[out.length - 2].content).toContain("answer 29");
    expect(out[out.length - 2].content).not.toContain("[shortened]");
  });

  it("shortens old replies before dropping whole turns", () => {
    const msgs = chat(6, 3000);
    const out = fitMessages(msgs, 3500, "short persona");
    expect(out.some((m) => m.content.includes("[shortened]"))).toBe(true);
    expect(out.find((m) => m.content.startsWith("question 0"))).toBeTruthy();
  });

  it("stops resending old images", () => {
    const img = { mime: "image/jpeg", data: "abc" };
    const msgs: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "look", images: [img, img, img, img, img, img] },
      { role: "assistant", content: "nice" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "and now?" },
    ];
    const out = fitMessages(msgs, 1000);
    expect(out.every((m) => !m.images?.length)).toBe(true);
    expect(out.some((m) => m.content.includes("[image shared earlier]"))).toBe(true);
  });

  it("cuts the middle of one giant message as a last resort", () => {
    const msgs: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: `START ${long(60_000)} END` },
    ];
    const out = fitMessages(msgs, 4000);
    const text = out[1].content;
    expect(text.startsWith("START")).toBe(true);
    expect(text.endsWith("END")).toBe(true);
    expect(text).toContain("middle cut to fit");
    expect(totalTokens(out)).toBeLessThanOrEqual(4100);
  });

  it("does not modify the input array", () => {
    const msgs = chat(10);
    const copy = JSON.parse(JSON.stringify(msgs));
    fitMessages(msgs, 3000, "c");
    expect(msgs).toEqual(copy);
  });
});
