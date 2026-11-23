// Real end to end: real LLM providers, real neural voice, real audio checks. Uses a throwaway
// in-memory database. Run one at a time:
//   npx vitest run --config vitest.live.config.ts src/__live__/voice-production.live.test.ts
//   LIVE_VOICE_FULL=1 adds the full three-page story (several minutes of CPU synthesis).
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
process.env.DATA_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SENKO_DATABASE_URL;
process.env.SENKO_VOICE_ENGINE = "senko-hybrid";
process.env.SENKO_VOICE_PER_MINUTE = "100";
process.env.SENKO_VOICE_PER_HOUR = "1000";

const { reply } = await import("@/lib/server/reply");
const { createChat } = await import("@/lib/server/chats");
const { ensureDevice } = await import("@/lib/server/identity");
const { q1, toBuffer } = await import("@/lib/server/db");
const { runProduction } = await import("@/lib/server/voice-production");
const { sameWords } = await import("@/lib/voice/production");
const { speechText } = await import("@/lib/server/voice");
const { inspectWav } = await import("../../scripts/windows-voice.mjs");
const { stopHybridWorker } = await import("../../scripts/senko-hybrid.mjs");
import type { VoiceProduction } from "@/lib/voice/production";
import type { VoiceProgress } from "@/lib/voice/progress";

const audioOf = async (id: string) => toBuffer((await q1<{ data: unknown }>("SELECT data FROM images WHERE id = $1", [id]))!.data);
const pcm = (wav: Buffer) => wav.subarray(wav.indexOf("data", 12, "ascii") + 8);

async function assertRecording(p: VoiceProduction, transcript: string) {
  expect(p.stage).toBe("completed");
  expect(sameWords(p.sections.map(s => s.text).join("\n"), speechText(transcript))).toBe(true);
  const full = await audioOf(p.audioId!);
  const info = inspectWav(full);
  expect(info.seconds).toBeGreaterThan(1);
  expect(info.sampleRate).toBe(24000);
  const mix = pcm(full);
  expect(mix.some(byte => byte !== 0)).toBe(true);
  // Every section's exact samples sit in the mix at its reported offset, in order.
  for (const s of p.sections) {
    const part = pcm(await audioOf(s.audioId!));
    const at = Math.round(s.startSeconds! * 48000);
    expect(s.seconds).toBeGreaterThan(0);
    expect(mix.subarray(at, at + part.length).equals(part), `section ${s.index + 1} audio`).toBe(true);
  }
  return { full, info };
}

async function ask(content: string, voiceDurationSeconds: number) {
  const { ownerId } = await ensureDevice("voicelivetestdevice00001");
  const chat = await createChat(ownerId, "Live voice test");
  const deltas: string[] = [], progress: VoiceProgress[] = [];
  const started = Date.now();
  const message = await reply({ ownerId, chatId: chat.id, content, voiceDurationSeconds, onDelta: t => deltas.push(t), onVoiceProgress: x => progress.push(x) });
  return { ownerId, message, deltas, progress, ms: Date.now() - started };
}

const summary = (p: VoiceProduction, ms: number) => ({
  ms, seconds: p.seconds, words: p.sections.reduce((n, s) => n + s.words, 0), writer: p.writer, engine: p.engine, directingMs: p.directingMs, synthesisMs: p.synthesisMs, assemblingMs: p.assemblingMs,
  sections: p.sections.map(s => ({ n: s.index + 1, words: s.words, seconds: s.seconds, source: s.directionSource, emotion: s.direction.emotion, directorMs: s.directorMs, synthesisMs: s.synthesisMs, attempts: s.synthesisAttempts, note: s.directorNote })),
});

describe("real audio requests", () => {
  it("short text-to-audio request returns playable audio", async () => {
    const r = await ask("send me a voice message saying good night and wishing me sweet dreams", 20);
    expect(r.message.meta.voiceError, JSON.stringify(r.message.meta.voiceError)).toBeUndefined();
    expect(r.deltas).toEqual([]);
    await assertRecording(r.message.meta.voiceProduction!, r.message.content);
    console.log("SHORT", JSON.stringify(summary(r.message.meta.voiceProduction!, r.ms)));
  }, 300_000);

  it("a story becomes one directed recording, and one section can be re-recorded alone", async () => {
    const r = await ask("Tell me a story about a lighthouse keeper who rescues a lost seal pup during a storm, make it into audio.", 150);
    expect(r.message.meta.voiceError, JSON.stringify(r.message.meta.voiceError)).toBeUndefined();
    expect(r.deltas, "narration must not stream as a text answer").toEqual([]);
    expect(r.message.meta.voice?.engine).toBe("senko-hybrid");
    const p = r.message.meta.voiceProduction!;
    expect(p.sections.length).toBeGreaterThanOrEqual(2);
    const { full } = await assertRecording(p, r.message.content);
    expect(r.progress.some(x => x.production?.sections.some(s => s.status === "ready") && x.phase === "synthesizing"), "sections playable before the end").toBe(true);
    console.log("STORY", JSON.stringify(summary(p, r.ms)));
    await mkdir(".data/voice/story", { recursive: true });
    await writeFile(".data/voice/story/live-story.wav", full);

    const before = p.sections.map(s => s.audioId);
    p.sections[1].direction.pace = 0.9;
    p.sections[1].directionSource = "edited";
    const again = await runProduction({ ownerId: r.ownerId, production: p, only: [1], keepDirection: true });
    expect(again.failure, JSON.stringify(again.failure)).toBeUndefined();
    p.sections.forEach((s, i) => (i === 1 ? expect(s.audioId).not.toBe(before[i]) : expect(s.audioId).toBe(before[i])));
    await assertRecording(p, r.message.content);
  }, 900_000);

  it("consecutive and concurrent recordings don't corrupt each other", async () => {
    const [a, b] = await Promise.all([
      ask("send me a voice message saying the kettle is finally boiling", 20),
      ask("send me a voice message saying the garden looks lovely this morning", 20),
    ]);
    for (const r of [a, b]) {
      expect(r.message.meta.voiceError, JSON.stringify(r.message.meta.voiceError)).toBeUndefined();
      await assertRecording(r.message.meta.voiceProduction!, r.message.content);
    }
    expect(a.message.meta.voice?.audioId).not.toBe(b.message.meta.voice?.audioId);
  }, 300_000);

  it.runIf(process.env.LIVE_VOICE_FULL === "1")("a full three-page story becomes one recording", async () => {
    const r = await ask("Tell me a story about two rival bakers in a mountain village who must save the winter festival, make it 3 pages long, make it into audio.", 600);
    expect(r.message.meta.voiceError, JSON.stringify(r.message.meta.voiceError)).toBeUndefined();
    const p = r.message.meta.voiceProduction!;
    const { full } = await assertRecording(p, r.message.content);
    console.log("FULL", JSON.stringify(summary(p, r.ms)));
    await writeFile(".data/voice/story/live-full-story.wav", full);
  }, 1_800_000);

  it("cleans up", () => stopHybridWorker());
});
