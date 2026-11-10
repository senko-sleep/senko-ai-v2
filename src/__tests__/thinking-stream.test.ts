import { describe, expect, it } from "vitest";
import { stripThink } from "@/lib/llm";

async function* chunks(parts: string[]) { for (const p of parts) yield p; }
async function run(parts: string[]) {
  let answer = "";
  let thoughts = "";
  for await (const c of stripThink(chunks(parts), (t) => (thoughts += t))) answer += c;
  return { answer, thoughts };
}

describe("reasoning is split from the answer", () => {
  it("Gemini <thought> summaries go to the thought stream", async () => {
    const r = await run(["<thought>**Analyzing Chara**\n\nThey are complex.", "</thought>Ngl, Chara is", " fascinating."]);
    expect(r.answer).toBe("Ngl, Chara is fascinating.");
    expect(r.thoughts).toBe("**Analyzing Chara**\n\nThey are complex.");
  });

  it("handles tags split across chunks", async () => {
    const r = await run(["<thi", "nk>plan it</th", "ink>Hello", " <b>world</b>"]);
    expect(r.answer).toBe("Hello <b>world</b>");
    expect(r.thoughts).toBe("plan it");
  });

  it("leaves normal text alone", async () => {
    const r = await run(["Just ", "an answer < 5."]);
    expect(r.answer).toBe("Just an answer < 5.");
    expect(r.thoughts).toBe("");
  });
});
