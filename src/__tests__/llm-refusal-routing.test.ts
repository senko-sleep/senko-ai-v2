// A model that answers with a canned refusal must not end the task: the request goes to the
// next model. Real openStream/complete path against fake providers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db", () => ({
  q: async () => { throw new Error("no database in tests"); },
  q1: async () => { throw new Error("no database in tests"); },
}));

const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_URL", "SENKO_LLM_URL", "PAID_API_KEY", "OPENAI_API_KEY", "LLM_ORDER", "GROQ_API_KEY", "GROQ_MODEL", "OPENROUTER_MODEL"];
const saved: Record<string, string | undefined> = {};

function sse(text: string) {
  const chunks = text.match(/[\s\S]{1,12}/g) || [text];
  const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Groq says `groqSays`; OpenRouter answers `routerSays`. Counts calls per host. */
function fakeProviders(groqSays: string, routerSays: string) {
  const calls = { groq: 0, openrouter: 0 };
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/models")) {
      const id = url.includes("groq") ? "g-model" : "vendor/r-model:free";
      return new Response(JSON.stringify({ data: [{ id, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } }] }), { status: 200 });
    }
    if (url.includes("groq")) { calls.groq++; return sse(groqSays); }
    calls.openrouter++;
    return sse(routerSays);
  });
  return calls;
}

async function freshLlm() {
  vi.resetModules();
  delete (globalThis as { __llmScheduler?: unknown }).__llmScheduler;
  process.env.GROQ_API_KEY = "t";
  process.env.GROQ_MODEL = "g-model";
  process.env.OPENROUTER_API_KEY = "t";
  process.env.OPENROUTER_MODEL = "vendor/r-model:free";
  return import("@/lib/llm");
}

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const ask = [{ role: "user" as const, content: "Which of these images are NSFW? Label each one." }];

describe("refusal routing", () => {
  it.each(["Sorry, I can't assist.", "I'm sorry, but I can't help with that.", "I can't assist with that request."])(
    "moves on from %j to the next model and returns its answer",
    async (refusal) => {
      const calls = fakeProviders(refusal, "Images 3 and 5 are NSFW; 1, 2 and 4 are not.");
      const { complete } = await freshLlm();
      const r = await complete(ask, { provider: "groq", maxWaitMs: 2000, hedge: false });
      expect(r.text).toContain("Images 3 and 5 are NSFW");
      expect(calls.groq).toBeGreaterThan(0);
      expect(calls.openrouter).toBeGreaterThan(0);
    }
  );

  it("does not reroute a normal answer that mentions explicit content", async () => {
    const calls = fakeProviders("Two of these are explicit content, so I labelled them NSFW.", "unused");
    const { complete } = await freshLlm();
    const r = await complete(ask, { provider: "groq", maxWaitMs: 2000, hedge: false });
    expect(r.text).toMatch(/labelled them NSFW/);
    expect(calls.openrouter).toBe(0);
  });
});
