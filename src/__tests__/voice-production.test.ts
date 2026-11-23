import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SENKO_DATABASE_URL;
process.env.SENKO_VOICE_PER_MINUTE = "1000";
process.env.SENKO_VOICE_PER_HOUR = "10000";

const { runProduction } = await import("@/lib/server/voice-production");
const { joinWavs } = await import("@/lib/server/voice-audio");
const { VoiceError } = await import("@/lib/server/voice-policy");
const { ensureDevice } = await import("@/lib/server/identity");
const { q1, toBuffer } = await import("@/lib/server/db");
const { createProduction, parseSectionDirection, sameWords, sectionPlan, splitNarration, directorLines, countWords } = await import("@/lib/voice/production");
const { classifyProviderFailure } = await import("@/lib/llm/provider-health");
const { inspectWav } = await import("../../scripts/windows-voice.mjs");
import type { VoiceEngine } from "@/lib/server/voice";

/** Real PCM whose length tracks the text, so section order and duration can be checked. */
function wav(seconds: number, level = 1000) {
  const samples = Math.round(24000 * seconds), data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(level, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const story = Array.from({ length: 5 }, (_, p) => Array.from({ length: 9 }, (_, s) => `In part ${p + 1} sentence ${s + 1} the lantern keeper walked further along the quiet northern shore tonight.`).join(" ")).join("\n");

function engine(fail: (text: string, call: number) => Error | null = () => null) {
  const calls: string[] = [];
  const e: VoiceEngine = {
    id: "senko-hybrid", available: () => true,
    synthesize: vi.fn(async ({ text }) => {
      calls.push(text);
      const problem = fail(text, calls.length);
      if (problem) throw problem;
      return { audio: wav(1 + countWords(text) / 200), mime: "audio/wav", engine: "senko-hybrid" as const, voice: "Senko (neural hybrid voice)", model: "senko-hybrid-v1" };
    }),
  };
  return { e, calls };
}
const goodAnswer = JSON.stringify({ emotion: "quietly hopeful", delivery: "unhurried", pace: 0.95, energy: 0.9, pitch: 0.2, warmth: 0.6, brightness: 0.3, breathiness: 0.2, pauseAfterMs: 500, cast: { Mina: { pitch: 1 } }, lines: [{ line: 1, speaker: "Mina", kind: "dialogue", emphasis: ["lantern"] }] });
let ownerId = "";
beforeEach(async () => { ({ ownerId } = await ensureDevice("voiceproductiontest00001")); });

describe("narration integrity", () => {
  it("splits a long story without skipping, duplicating or reordering a word", () => {
    const parts = splitNarration(story);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(8);
    expect(sameWords(parts.join("\n"), story)).toBe(true);
  });
  it("keeps a short message as one section", () => expect(splitNarration("Good morning. Sleep well?")).toHaveLength(1));
  it("never lets direction change the spoken words", () => {
    const p = createProduction(story);
    const s = p.sections[0];
    const parsed = parseSectionDirection(JSON.stringify({ emotion: "tense", pace: 9, text: "REWRITTEN WORDS", lines: [{ line: 1, text: "HACKED", emphasis: ["notaword"] }, { line: 999 }] }), directorLines(s.text).length)!;
    Object.assign(s, { direction: parsed.direction, cues: parsed.cues, directionSource: "director" });
    expect(parsed.direction.pace).toBe(1.2);
    expect(parsed.cues).toHaveLength(1);
    const plan = sectionPlan(s);
    expect(sameWords(plan.segments.flatMap(x => x.kind === "speech" ? [x.text] : []).join(" "), s.text)).toBe(true);
    expect(plan.segments.some(x => x.kind === "speech" && x.prosody.emphasis?.includes("notaword"))).toBe(false);
  });
});

describe("director failures", () => {
  it("repairs a malformed answer with one bounded retry", async () => {
    const p = createProduction("The lamp flickered. Mina held the lantern close.");
    const ask = vi.fn().mockResolvedValueOnce({ text: "sure! here is {broken" }).mockResolvedValueOnce({ text: goodAnswer, model: "fixture" });
    const r = await runProduction({ ownerId, production: p, engines: [engine().e], ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(r.voice).toBeTruthy();
    expect(p.sections[0].directionSource).toBe("director");
  });
  it("records with a neutral performance when answers stay malformed", async () => {
    const p = createProduction("The lamp flickered. Mina held the lantern close.");
    const ask = vi.fn(async () => ({ text: "not json" }));
    const r = await runProduction({ ownerId, production: p, engines: [engine().e], ask });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(r.voice?.performance).toBe("neutral");
  });
  it("doesn't retry an unavailable director, and still records", async () => {
    const p = createProduction("The lamp flickered. Mina held the lantern close.");
    const ask = vi.fn(async () => { throw new Error("Every AI provider is busy"); });
    const r = await runProduction({ ownerId, production: p, engines: [engine().e], ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.voice).toBeTruthy();
    expect(p.sections[0].directorNote).toMatch(/No director/);
  });
});

describe("section recording", () => {
  const ask = async () => ({ text: goodAnswer, model: "fixture" });

  it("assembles valid audio in section order with accurate offsets", async () => {
    const p = createProduction(story);
    const { e, calls } = engine();
    const stages: string[] = [];
    const r = await runProduction({ ownerId, production: p, engines: [e], ask, onProgress: x => { if (x.production) stages.push(x.production.stage); } });
    expect(r.failure).toBeUndefined();
    expect(calls).toEqual(p.sections.map(s => s.text));
    const row = await q1<{ data: unknown }>("SELECT data FROM images WHERE id = $1", [r.voice!.audioId]);
    const info = inspectWav(toBuffer(row!.data));
    const pauses = p.sections.slice(0, -1).reduce((n, s) => n + s.direction.pauseAfterMs / 1000, 0);
    expect(info.seconds).toBeCloseTo(p.sections.reduce((n, s) => n + s.seconds!, 0) + pauses, 2);
    p.sections.forEach((s, i) => { if (i) expect(s.startSeconds!).toBeGreaterThan(p.sections[i - 1].startSeconds!); });
    expect(stages).toContain("synthesizing");
    expect(stages.at(-1)).toBe("completed");
  });

  it("keeps finished sections after a neural failure and retries only the failed one", async () => {
    const p = createProduction(story);
    const broken = p.sections[1].text;
    let down = true;
    const { e, calls } = engine(text => (down && text === broken ? new Error("Neural voice generation failed") : null));
    const first = await runProduction({ ownerId, production: p, engines: [e], ask });
    expect(first.voice).toBeUndefined();
    expect(first.failure?.code).toBe("sections_failed");
    expect(p.sections[1].status).toBe("failed");
    expect(p.sections.filter(s => s.status === "ready")).toHaveLength(p.sections.length - 1);
    const kept = p.sections[0].audioId;
    down = false;
    calls.length = 0;
    const second = await runProduction({ ownerId, production: p, engines: [e], ask });
    expect(second.voice).toBeTruthy();
    expect(calls).toEqual([broken]);
    expect(p.sections[0].audioId).toBe(kept);
  });

  it("regenerates one section without replacing the others", async () => {
    const p = createProduction(story);
    const { e, calls } = engine();
    await runProduction({ ownerId, production: p, engines: [e], ask });
    const before = p.sections.map(s => s.audioId);
    calls.length = 0;
    p.sections[2].direction.pace = 0.85;
    p.sections[2].directionSource = "edited";
    const r = await runProduction({ ownerId, production: p, only: [2], keepDirection: true, engines: [e], ask });
    expect(r.voice).toBeTruthy();
    expect(calls).toEqual([p.sections[2].text]);
    expect(p.sections[2].direction.pace).toBe(0.85);
    p.sections.forEach((s, i) => (i === 2 ? expect(s.audioId).not.toBe(before[i]) : expect(s.audioId).toBe(before[i])));
  });

  it("a failed regeneration keeps the take that worked", async () => {
    const p = createProduction(story);
    let down = false;
    const { e } = engine(() => (down ? new Error("Neural voice generation failed") : null));
    await runProduction({ ownerId, production: p, engines: [e], ask });
    const take = p.sections[1].audioId;
    down = true;
    await runProduction({ ownerId, production: p, only: [1], keepDirection: true, engines: [e], ask });
    expect(p.sections[1].audioId).toBe(take);
    expect(p.sections[1].error).toBeTruthy();
  });

  it("reports failure, never success, when no engine can speak", async () => {
    const p = createProduction("Nothing can say this.");
    const r = await runProduction({ ownerId, production: p, engines: [], ask });
    expect(r.voice).toBeUndefined();
    expect(p.stage).toBe("failed");
    expect(r.failure).toBeTruthy();
  });

  it("refuses to join mismatched formats", () => {
    const other = wav(1); other.writeUInt32LE(16000, 24); other.writeUInt32LE(32000, 28);
    expect(() => joinWavs([{ audio: wav(1), pauseAfterMs: 0 }, { audio: other, pauseAfterMs: 0 }])).toThrow(VoiceError);
  });
});

describe("provider failure classification", () => {
  it("treats retired models and plan limits as permanent, whatever the status", () => {
    expect(classifyProviderFailure(400, "This model has been deprecated")).toEqual({ state: "unavailable", retryable: false });
    expect(classifyProviderFailure(400, "Model is not available on the free plan")).toEqual({ state: "configuration_error", retryable: false });
    expect(classifyProviderFailure(402, "Insufficient credits").state).toBe("configuration_error");
    expect(classifyProviderFailure(401).retryable).toBe(false);
  });
  it("keeps real rate limits and outages recoverable", () => {
    expect(classifyProviderFailure(429, "rate limited").retryable).toBe(true);
    expect(classifyProviderFailure(503, "model temporarily deprecated route").retryable).toBe(true);
  });
});
