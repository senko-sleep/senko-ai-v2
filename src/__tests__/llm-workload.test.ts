// Realistic workload tests: the real openStream/complete path against a fake provider that
// enforces per-minute limits the way Groq does (429 + Retry-After), on a simulated clock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/server/db", () => ({
  q: async () => {
    throw new Error("no database in tests");
  },
  q1: async () => {
    throw new Error("no database in tests");
  },
}));

type Llm = typeof import("@/lib/llm");

interface FakeProvider {
  served: number;
  rejected: number;
  maxInFlight: number;
  /** When each model was hit, to check nothing was sent during a Retry-After window. */
  hits: { model: string; at: number; status: number }[];
}

/** A Groq-like API: rpm/tpm per model over a trailing minute, counting input + max_tokens. */
function fakeGroq(o: { rpm: number; tpm?: number; latencyMs?: number; retryAfterS?: number }): FakeProvider {
  const st: FakeProvider = { served: 0, rejected: 0, maxInFlight: 0, hits: [] };
  const log = new Map<string, { at: number; tokens: number }[]>();
  let inFlight = 0;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "m-a" }, { id: "m-b" }] }), { status: 200 });
    }
    const body = JSON.parse(init?.body || "{}") as { model: string; max_tokens: number; messages: { content: string }[] };
    const now = Date.now();
    const tokens = Math.ceil(JSON.stringify(body.messages).length / 3.6) + (body.max_tokens || 0);
    const events = (log.get(body.model) || []).filter((e) => e.at > now - 60_000);
    log.set(body.model, events);
    const usedTok = events.reduce((n, e) => n + e.tokens, 0);
    if (events.length >= o.rpm || (o.tpm && usedTok + tokens > o.tpm)) {
      st.rejected++;
      st.hits.push({ model: body.model, at: now, status: 429 });
      const wait = o.retryAfterS ?? Math.max(1, Math.ceil((events[0].at + 60_000 - now) / 1000));
      return new Response(JSON.stringify({ error: { message: `Rate limit reached for model ${body.model}. Please try again in ${wait}s.` } }), {
        status: 429,
        headers: { "retry-after": String(wait) },
      });
    }
    events.push({ at: now, tokens });
    st.hits.push({ model: body.model, at: now, status: 200 });
    inFlight++;
    st.maxInFlight = Math.max(st.maxInFlight, inFlight);
    if (o.latencyMs) await new Promise((r) => setTimeout(r, o.latencyMs));
    inFlight--;
    st.served++;
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"action":"scroll","direction":"down","thought":"looking further"}' } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return st;
}

const PROVIDER_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "OLLAMA_URL", "SENKO_LLM_URL", "PAID_API_KEY", "OPENAI_API_KEY", "LLM_ORDER"];
const saved: Record<string, string | undefined> = {};

async function freshLlm(limits: string): Promise<Llm> {
  vi.resetModules();
  delete (globalThis as { __llmScheduler?: unknown }).__llmScheduler;
  process.env.GROQ_API_KEY = "test";
  process.env.GROQ_MODEL = "m-a";
  process.env.LLM_LIMITS_GROQ = limits;
  return import("@/lib/llm");
}

/** An agent-step-sized request: ~6k characters of page + history. */
const step = (i: number) => [
  { role: "system" as const, content: "You are a browsing agent. Reply with one JSON action." },
  { role: "user" as const, content: `Step ${i}. Current page:\n${"element text and links ".repeat(250)}` },
];

/** Run a promise to completion on the fake clock. */
async function onClock<T>(p: Promise<T>, maxMs = 60 * 60_000): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let t = 0; !settled && t < maxMs; t += 500) await vi.advanceTimersByTimeAsync(500);
  return p;
}

beforeEach(() => {
  for (const k of [...PROVIDER_KEYS, "GROQ_API_KEY", "GROQ_MODEL", "LLM_LIMITS_GROQ"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("LLM pacing under realistic workloads", () => {
  it("a burst never goes over the limit: extra requests wait instead of getting 429s", async () => {
    const api = fakeGroq({ rpm: 5 });
    const llm = await freshLlm("rpm=5,tpm=100000,concurrency=20");
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, (_, i) => llm.complete(step(i), { maxTokens: 100, maxWaitMs: 0, hedge: false }))
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(api.rejected).toBe(0); // proactive: not one rate-limit error from the provider
    expect(ok).toBe(10); // 5 per model × 2 models
    const busy = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
    expect(busy.every((e) => e instanceof llm.LlmBusyError && (e.retryInMs ?? 0) > 50_000)).toBe(true);
  });

  it("never runs more requests at once than the provider's concurrency limit, and finishes them all", async () => {
    const api = fakeGroq({ rpm: 100, latencyMs: 150 });
    const llm = await freshLlm("rpm=100,tpm=1000000,concurrency=2");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => llm.complete(step(i), { maxTokens: 100, maxWaitMs: 15_000 })));
    expect(results).toHaveLength(8);
    expect(api.maxInFlight).toBeLessThanOrEqual(2);
    expect(api.rejected).toBe(0);
  });

  it("a 30-step agent task on tight free-tier limits completes with zero rate-limit errors", async () => {
    vi.useFakeTimers();
    const api = fakeGroq({ rpm: 6, tpm: 30_000 });
    const llm = await freshLlm("rpm=6,tpm=30000,concurrency=2");
    const run = (async () => {
      for (let i = 0; i < 30; i++) {
        await llm.complete(step(i), { maxTokens: 400, maxWaitMs: 120_000, priority: "background", fast: true });
      }
    })();
    await onClock(run);
    expect(api.served).toBe(30);
    expect(api.rejected).toBe(0);
    // Background work keeps 15% of each limit free for chat: at most floor(6*0.85)=5 per model in any minute.
    for (const model of ["m-a", "m-b"]) {
      const at = api.hits.filter((h) => h.model === model).map((h) => h.at);
      const busiest = Math.max(...at.map((t) => at.filter((u) => u >= t && u < t + 60_000).length));
      expect(busiest).toBeLessThanOrEqual(5);
    }
  });

  it("when the provider is stricter than we think, 429s are absorbed with backoff and every request still completes", async () => {
    vi.useFakeTimers();
    const api = fakeGroq({ rpm: 3 }); // real limit 3/min
    const llm = await freshLlm("rpm=30,tpm=1000000,concurrency=4"); // we believe 30/min
    const run = (async () => {
      for (let i = 0; i < 12; i++) await llm.complete(step(i), { maxTokens: 100, maxWaitMs: 180_000, priority: "background" });
    })();
    await onClock(run);
    expect(api.served).toBe(12);
    // Each 429 shrinks the model's limit and backs it off, so they stay rare instead of cascading.
    expect(api.rejected).toBeLessThanOrEqual(8);
    expect(api.rejected / (api.served + api.rejected)).toBeLessThan(0.45);
  });

  it("respects Retry-After: nothing is sent to that model again until it has passed", async () => {
    vi.useFakeTimers();
    const api = fakeGroq({ rpm: 1, retryAfterS: 20 });
    const llm = await freshLlm("rpm=60,tpm=1000000,concurrency=4");
    const run = (async () => {
      for (let i = 0; i < 6; i++) await llm.complete(step(i), { maxTokens: 100, maxWaitMs: 300_000 });
    })();
    await onClock(run);
    expect(api.served).toBe(6);
    for (const model of ["m-a", "m-b"]) {
      const hits = api.hits.filter((h) => h.model === model);
      for (let i = 1; i < hits.length; i++) {
        if (hits[i - 1].status === 429) expect(hits[i].at - hits[i - 1].at).toBeGreaterThanOrEqual(20_000);
      }
    }
  });

  it("identical requests with cacheTtlMs share one call", async () => {
    const api = fakeGroq({ rpm: 100 });
    const llm = await freshLlm("rpm=100,tpm=1000000,concurrency=4");
    const opts = { maxTokens: 100, cacheTtlMs: 60_000 };
    const [a, b] = await Promise.all([llm.complete(step(1), opts), llm.complete(step(1), opts)]);
    const c = await llm.complete(step(1), opts);
    expect(a.text).toBe(b.text);
    expect(c.text).toBe(a.text);
    expect(api.served).toBe(1);
  });
});
