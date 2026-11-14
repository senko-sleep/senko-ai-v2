// A model that answers with a canned refusal must not end the task: the request goes to the
// next model. Real openStream/complete path against fake providers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";

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
  it("caps real inference requests across fallback and compatibility retries", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: url.includes("groq") ? "g-model" : "vendor/r-model:free", pricing: { prompt: "0", completion: "0" } }] });
      posts++; return new Response("compatibility option rejected", { status: 400 });
    });
    const { complete } = await freshLlm();
    const { InferenceRequestBudget } = await import("@/lib/llm/request-budget");
    const budget = new InferenceRequestBudget(2);
    await expect(complete(ask, { provider: "groq", hedge: false, maxWaitMs: 0, requestBudget: budget })).rejects.toThrow(/request budget exhausted/);
    expect(posts).toBe(2);
    expect(budget.attempts).toHaveLength(2);
    expect(budget.attempts.every((attempt) => attempt.status === 400)).toBe(true);
    // Reusing the task budget must not send another request.
    await expect(complete(ask, { requestBudget: budget, hedge: false, maxWaitMs: 0 })).rejects.toThrow(/request budget exhausted/);
    expect(posts).toBe(2);
  });
  it("passes requested JSON mode to compatible providers", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "g-model" }] });
      body = JSON.parse(String(init?.body));
      return sse('{"ops":[],"done":false}');
    });
    const { complete } = await freshLlm();
    const result = await complete([{ role: "user", content: "Return JSON." }], { provider: "groq", model: "g-model", json: true, hedge: false });
    expect(body?.response_format).toEqual({ type: "json_object" });
    expect(JSON.parse(result.text).ops).toEqual([]);
  });
  it("treats a JSON-mode validation failure as one bad answer, not an outage", async () => {
    const calls = { groq: 0, router: 0 };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/models")) return Response.json({ data: (url.includes("groq") ? ["g-model"] : ["vendor/r-model:free"]).map((id) => ({ id, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } })) });
      if (url.includes("groq")) {
        calls.groq++;
        const err = { error: { message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details." } };
        return new Response(`data: ${JSON.stringify(err)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      calls.router++; return sse('{"ok":true}');
    });
    const { complete } = await freshLlm();
    const result = await complete([{ role: "user", content: "Return JSON." }], { provider: "groq", json: true, maxWaitMs: 2000, hedge: false });
    expect(JSON.parse(result.text).ok).toBe(true);
    expect(calls.groq).toBe(1);
    expect(calls.router).toBe(1);
  });
  it("skips remaining models after an account credit failure and fails over", async () => {
    const calls = { groq: 0, router: 0 };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/models")) return Response.json({ data: (url.includes("groq") ? ["g-model", "g-backup"] : ["vendor/r-model:free"]).map((id) => ({ id, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } })) });
      if (url.includes("groq")) { calls.groq++; return new Response("Account credit exhausted", { status: 402 }); }
      calls.router++; return sse("Recovered through another configured provider.");
    });
    const { complete } = await freshLlm();
    const result = await complete(ask, { provider: "groq", maxWaitMs: 2000, hedge: false });
    expect(result.text).toContain("Recovered");
    expect(calls.groq).toBe(1);
    expect(calls.router).toBe(1);
  });
  it("releases caller abort listeners after a complete model response", async () => {
    fakeProviders("A complete and ordinary response.", "unused");
    const { complete } = await freshLlm();
    const controller = new AbortController();
    await complete(ask, { provider: "groq", maxWaitMs: 2000, hedge: false, signal: controller.signal });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("never substitutes a different model when one was explicitly pinned", async () => {
    const calls = fakeProviders("fallback must not run", "fallback must not run");
    const { complete } = await freshLlm();
    await expect(complete(ask, { model: "unavailable-exact-model", maxWaitMs: 100, hedge: false })).rejects.toThrow();
    expect(calls.groq).toBe(0);
    expect(calls.openrouter).toBe(0);
  });

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

describe("daily quota behind a 5xx", () => {
  it("benches a gateway whose 503 says the daily allocation is used up", async () => {
    const calls = { groq: 0, openrouter: 0 };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/models")) {
        const id = url.includes("groq") ? "g-model" : "vendor/r-model:free";
        return Response.json({ data: [{ id, pricing: { prompt: "0", completion: "0" } }] });
      }
      if (url.includes("groq")) {
        calls.groq++;
        return new Response(JSON.stringify({ error: { message: "No model could answer. @cf/x: 4006: you have used up your daily free allocation of 10,000 neurons" } }), { status: 503 });
      }
      calls.openrouter++;
      return sse("Hello there, this is a normal answer.");
    });
    process.env.LLM_ORDER = "groq,openrouter";
    const { complete } = await freshLlm();
    await complete(ask, { hedge: false, maxWaitMs: 0 });
    const groqAfterFirst = calls.groq;
    expect(groqAfterFirst).toBeGreaterThan(0);
    // Five minutes later (well past a normal 30s error cooldown) it is still benched.
    const start = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => start + 5 * 60_000);
    await complete(ask, { hedge: false, maxWaitMs: 0 });
    await complete(ask, { hedge: false, maxWaitMs: 0 });
    // Benched for the hour: later requests go straight to the next provider.
    expect(calls.groq).toBe(groqAfterFirst);
    expect(calls.openrouter).toBeGreaterThanOrEqual(3);
  });
});
