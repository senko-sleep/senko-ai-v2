import { describe, it, expect } from "vitest";
import { Scheduler, parseLimits, parseReset } from "@/lib/llm/scheduler";

function setup(env: Record<string, string> = {}, random = () => 0.5) {
  let t = 1_700_000_000_000; // a real epoch, so epoch-style reset headers parse as they would live
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const s = new Scheduler({ now: clock.now, random, env: (k) => env[k] });
  return { s, clock };
}

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("parseLimits / parseReset", () => {
  it("parses env limit specs and ignores junk", () => {
    expect(parseLimits("rpm=15, tpm=250000,concurrency=2,bogus=3,rpd=-1")).toEqual({ rpm: 15, tpm: 250000, concurrency: 2 });
    expect(parseLimits(undefined)).toEqual({});
  });

  it("parses the reset formats providers use", () => {
    const now = 1_700_000_000_000;
    expect(parseReset("7.66s", now)).toBe(7660);
    expect(parseReset("1m2.5s", now)).toBe(62_500);
    expect(parseReset("292ms", now)).toBe(292);
    expect(parseReset("2m59.56s", now)).toBe(179_560);
    expect(parseReset("30", now)).toBe(30_000);
    expect(parseReset(String(now + 4000), now)).toBe(4000); // epoch ms (OpenRouter)
    expect(parseReset(String(Math.floor(now / 1000) + 10), now)).toBe(10_000); // epoch s
    expect(parseReset("soon", now)).toBeNull();
  });
});

describe("Scheduler pacing", () => {
  it("holds a request back when the per-minute request limit is full, until the oldest leaves the window", () => {
    const { s, clock } = setup({ LLM_LIMITS_GROQ: "rpm=3,concurrency=10" });
    for (let i = 0; i < 3; i++) {
      expect(s.delayFor("groq", "m", 100)).toBe(0);
      s.acquire("groq", "m", 100).release();
      clock.advance(1000);
    }
    // 3 requests at t=0s,1s,2s; now t=3s: the next slot opens when the first leaves (t=60s).
    expect(s.delayFor("groq", "m", 100)).toBe(57_000);
    clock.advance(57_000);
    expect(s.delayFor("groq", "m", 100)).toBe(0);
  });

  it("paces by tokens per minute and refuses a request bigger than the whole minute", () => {
    const { s, clock } = setup({ LLM_LIMITS_GROQ: "tpm=10000,concurrency=10" });
    s.acquire("groq", "m", 6000).release();
    clock.advance(10_000);
    expect(s.delayFor("groq", "m", 3000)).toBe(0);
    expect(s.delayFor("groq", "m", 5000)).toBe(50_000); // waits for the 6000 to age out
    expect(s.delayFor("groq", "m", 20_000)).toBe(Infinity);
    expect(s.maxRequestTokens("groq", "m")).toBe(10_000);
  });

  it("counts what a request really used once it's released", () => {
    const { s } = setup({ LLM_LIMITS_GROQ: "tpm=10000,concurrency=10" });
    s.acquire("groq", "m", 9000).release(2000); // reserved input + max output, used much less
    expect(s.delayFor("groq", "m", 7000)).toBe(0);
  });

  it("limits requests in flight per provider and frees the slot on release", () => {
    const { s } = setup({ LLM_LIMITS_DEEPSEEK: "concurrency=2" });
    const a = s.acquire("deepseek", "x", 10);
    s.acquire("deepseek", "y", 10); // another model, same provider
    expect(s.delayFor("deepseek", "z", 10)).toBeGreaterThan(0);
    a.release();
    a.release(); // idempotent
    expect(s.delayFor("deepseek", "z", 10)).toBe(0);
    expect(s.inFlight("deepseek")).toBe(1);
  });

  it("forgets a ticket that was never released after 5 minutes (no permanent leak)", () => {
    const { s, clock } = setup({ LLM_LIMITS_DEEPSEEK: "concurrency=1" });
    s.acquire("deepseek", "x", 10);
    expect(s.delayFor("deepseek", "x", 10)).toBeGreaterThan(0);
    clock.advance(5 * 60_000 + 1);
    expect(s.delayFor("deepseek", "x", 10)).toBe(0);
  });

  it("leaves part of every limit to interactive chat while background work runs", () => {
    const { s } = setup({ LLM_LIMITS_GEMINI: "rpm=10,concurrency=10" });
    for (let i = 0; i < 8; i++) s.acquire("gemini", "flash", 10).release(); // background share: floor(10*0.85)=8
    expect(s.delayFor("gemini", "flash", 10, "background")).toBeGreaterThan(0);
    expect(s.delayFor("gemini", "flash", 10, "interactive")).toBe(0);
  });
});

describe("Scheduler rate-limit handling", () => {
  it("honors Retry-After as a floor, with jitter only on top", () => {
    for (const r of [0, 0.5, 0.999]) {
      const { s } = setup({}, () => r);
      const ms = s.onRateLimited("gemini", "flash", 20_000);
      expect(ms).toBeGreaterThanOrEqual(20_000);
      expect(ms).toBeLessThanOrEqual(24_000);
      expect(s.delayFor("gemini", "flash", 10)).toBe(ms);
    }
  });

  it("backs off exponentially without Retry-After, within ±20% jitter, capped at 5 minutes", () => {
    const { s } = setup({}, () => 0.5); // no jitter at 0.5
    expect([1, 2, 3, 4].map(() => s.onRateLimited("groq", "m", null))).toEqual([5000, 10_000, 20_000, 40_000]);
    for (let i = 0; i < 10; i++) s.onRateLimited("groq", "m", null);
    expect(s.onRateLimited("groq", "m", null)).toBe(300_000);
    const lo = setup({}, () => 0).s.onRateLimited("groq", "m", null);
    const hi = setup({}, () => 0.999).s.onRateLimited("groq", "m", null);
    expect(lo).toBe(4000);
    expect(hi).toBeLessThanOrEqual(6000);
  });

  it("shrinks a model's effective limit after a 429 and recovers it on successes", () => {
    const { s, clock } = setup({ LLM_LIMITS_GROQ: "rpm=10,concurrency=10" });
    s.onRateLimited("groq", "m", 1000);
    clock.advance(2000);
    expect(s.snapshot("groq", "m").factor).toBeCloseTo(0.6);
    for (let i = 0; i < 6; i++) s.acquire("groq", "m", 1).release(); // effective rpm 6
    expect(s.delayFor("groq", "m", 1)).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) s.onSuccess("groq", "m");
    expect(s.snapshot("groq", "m").factor).toBe(1);
  });

  it("learns what's left from x-ratelimit headers (shared keys, other processes)", () => {
    const { s } = setup({ LLM_LIMITS_GROQ: "rpm=100,tpm=100000,concurrency=10" });
    s.observeHeaders(
      "groq",
      "m",
      headers({ "x-ratelimit-remaining-tokens": "800", "x-ratelimit-reset-tokens": "7.66s", "x-ratelimit-limit-tokens": "8000" })
    );
    expect(s.delayFor("groq", "m", 500)).toBe(0);
    expect(s.delayFor("groq", "m", 1000)).toBe(7660);
    // The real per-minute limit (8000) replaces our default, since its reset is within a minute.
    expect(s.limitsFor("groq", "m").tpm).toBe(8000);
    // Spending what's left counts against it.
    s.acquire("groq", "m", 500).release();
    expect(s.delayFor("groq", "m", 400)).toBe(7660);
  });

  it("waits for the reset when the provider says no requests are left (OpenRouter style)", () => {
    const { s, clock } = setup();
    s.observeHeaders("openrouter", "free", headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(clock.now() + 12_000) }));
    expect(s.delayFor("openrouter", "free", 10)).toBe(12_000);
  });
});
