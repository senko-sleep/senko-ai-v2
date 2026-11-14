import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hybridAvailable, hybridSpeech } from "./senko-hybrid.mjs";
import { inspectWav } from "./windows-voice.mjs";

const available = hybridAvailable();
test("neural model assets and isolated interpreter are installed", () => assert.equal(available, true));
test("actual neural hybrid speech preserves the natural signal and has truthful provenance", { skip: !available }, async () => {
  const result = await hybridSpeech({ text: "A great character surprises us, yet their choices always feel earned.", durationSeconds: 5 });
  const decoded = inspectWav(result.audio);
  assert.ok(decoded.seconds > 1 && decoded.seconds <= 5.05);
  assert.equal(decoded.sampleRate, 24000);
  assert.equal(result.modelKind, "pretrained-neural-blend");
  assert.equal(result.baseModel, "hexgrad/Kokoro-82M");
  assert.ok(result.textureCorrelation > .99);
  assert.equal(result.model, "senko-hybrid-v1");
  assert.ok(result.synthesisMs < 60000);
});
test("overlong generation is rejected without returning a truncated recording", { skip: !available }, async () => {
  await assert.rejects(hybridSpeech({ text: "A memorable character makes choices that reveal a hidden strength and a weakness. ".repeat(8), durationSeconds: 5 }), /duration limit/);
});
test("missing runtime fails clearly without changing voices", async () => {
  const saved = process.env.SENKO_NEURAL_PYTHON;
  process.env.SENKO_NEURAL_PYTHON = "C:/nonexistent-senko-test/python.exe";
  try {
    assert.equal(hybridAvailable(), false);
    await assert.rejects(hybridSpeech({ text: "Hello there." }), /Neural voice generation failed/);
  } finally { if (saved === undefined) delete process.env.SENKO_NEURAL_PYTHON; else process.env.SENKO_NEURAL_PYTHON = saved; }
});
test("cancellation kills inference, cleans temporary files, and permits the next job", { skip: !available }, async () => {
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith("senko-hybrid-")));
  const controller = new AbortController();
  const pending = hybridSpeech({ text: "Welcome back to the show.", signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, /cancelled/);
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith("senko-hybrid-") && !before.has(name));
  assert.deepEqual(leftovers, []);
  const result = await hybridSpeech({ text: "Welcome back to the show." });
  assert.ok(result.audio.length > 44);
  assert.equal(existsSync(tmpdir()), true);
});
test("directed performance plan renders dynamic prosody, vocal IPA, and synthesized breaths without reading stage directions", { skip: !available }, async () => {
  const plan = {
    version: 2,
    voice: "senko",
    source: "director",
    character: "bratty tsundere",
    segments: [
      { kind: "vocal", description: "short annoyed huff", text: "Hmph!", ipa: "hˈʌmf", emotion: "annoyed", prosody: { pace: 1.05, energy: 1.0, pitch: 0.2, pauseAfterMs: 160, timbre: { warmth: 0.4, brightness: 0.5, breathiness: 0.1 } } },
      { kind: "speech", text: "Don't think I'm doing this because I like you!", emotion: "defensive", delivery: "sharp and energetic", prosody: { pace: 1.08, energy: 1.06, pitch: 0.5, pauseAfterMs: 320, timbre: { warmth: 0.35, brightness: 0.55, breathiness: 0.1 } } },
      { kind: "speech", text: "But... maybe I'll chat a bit.", emotion: "shy", delivery: "soft, hesitant", prosody: { pace: 0.9, energy: 0.82, pitch: 0.8, pauseAfterMs: 180, timbre: { warmth: 0.6, brightness: 0.2, breathiness: 0.45 } } },
      { kind: "vocal", description: "pouty exhale", text: "", breath: { kind: "exhale", ms: 350 }, emotion: "flustered", prosody: { pace: 0.95, energy: 0.85, pitch: 0, pauseAfterMs: 0, timbre: { warmth: 0.5, brightness: 0.3, breathiness: 0.4 } } },
    ],
  };
  const result = await hybridSpeech({ text: "Don't think I'm doing this because I like you! But... maybe I'll chat a bit. *pouts*", plan, durationSeconds: 15 });
  const decoded = inspectWav(result.audio);
  assert.ok(decoded.seconds > 2 && decoded.seconds <= 15.05);
  assert.equal(result.segments, 4);
  assert.equal(result.performance, "director");
  assert.equal(result.character, "bratty tsundere");
});
