import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compileVoicebank, selectMood, buildPerformance } from "./senko-voice-core.mjs";
import { senkoSpeech } from "./senko-voice.mjs";
import { inspectWav } from "./windows-voice.mjs";

const bank = JSON.parse(await readFile("voice/senko/voicebank.json", "utf8"));
const text = "Welcome back. You do not have to be perfect to make something worth sharing.";
test("phrase performance preserves content and escapes untrusted markup", () => {
  const plan = buildPerformance('Hello — you made it. Are you ready?', "soft");
  assert.equal(plan.phrases.length, 2);
  assert.equal(plan.phrases[1].pitch, 52);
  assert.equal(plan.phrases[0].volume, "-1dB");
  assert.match(plan.markup, /break time="80ms"/);
  const escaped = buildPerformance('<audio src="https://example.test/file.wav"/>', "neutral");
  assert.ok(!escaped.markup.includes('<audio'));
  assert.ok(escaped.markup.includes('&lt;audio'));
});
test("warm, bright and airy layers share the same formant identity", () => {
  const variants = Object.keys(bank.moods).map(mood => compileVoicebank(bank, mood));
  const formants = variant => variant.variant.split("\n").filter(line => line.startsWith("formant "));
  for (const model of variants) {
    assert.deepEqual(formants(model), formants(variants[0]));
    assert.equal(model.fingerprint, variants[0].fingerprint);
  }
  assert.ok(compileVoicebank(bank, "excited").rate > compileVoicebank(bank, "sleepy").rate);
  assert.equal(selectMood("feeling cozy and gentle"), "soft");
  assert.equal(selectMood("playful and excited"), "excited");
});
test("actual authored voicebank generates nonempty, distinct speech for each mood", async () => {
  const hashes = new Set();
  for (const emotion of Object.keys(bank.moods)) {
    const result = await senkoSpeech({ text, emotion, bank });
    assert.equal(result.model, bank.id);
    assert.match(result.voice, /designed synthetic voice/);
    assert.ok(inspectWav(result.audio).seconds > 1);
    hashes.add(createHash("sha256").update(result.audio).digest("hex"));
  }
  assert.equal(hashes.size, 5);
});
test("the synthesis worker enforces duration before returning incomplete audio", async () => {
  await assert.rejects(senkoSpeech({ text: text.repeat(5), bank, maxSeconds: 1 }), /duration limit/);
});
test("abandoned workers are terminated and the next job still succeeds", async () => {
  const controller = new AbortController();
  const pending = senkoSpeech({ text, bank, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.ok((await senkoSpeech({ text, bank })).audio.length > 44);
});
