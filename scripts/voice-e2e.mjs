import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectWav } from "./windows-voice.mjs";

const nativeFetch = globalThis.fetch;
const fetch = (url, options = {}) => nativeFetch(url, { ...options, signal: options.signal || AbortSignal.timeout(150000) });
const expectedEngine = process.env.VOICE_TEST_ENGINE || "senko-hybrid";
const base = process.env.VOICE_TEST_URL || "http://localhost:3012";
const run = Date.now();
const device = suffix => `voice_e2e_${run}_${suffix}`;
const headers = id => ({ "Content-Type": "application/json", "x-device-id": id, Cookie: `senko_device=${id}` });
const results = [];
const budgets = process.env.VOICE_TEST_DURATIONS ? process.env.VOICE_TEST_DURATIONS.split(",").map(Number) : [5, 30, 120];
assert.ok(budgets.length && budgets.every(value => [5, 30, 120].includes(value)));
const texts = {
  5: "A great character surprises us, yet their choices always feel earned.",
  30: "Welcome back. Today, let's talk about what makes a character stay with you. I think it starts with a contradiction. Someone can be brave in a fight and terrified of an honest conversation. That gap gives a story somewhere to go. Think about a favorite character: what do they want, and what are they avoiding? When those answers collide, even a quiet scene can feel electric.",
  120: "Welcome back to our character discussion. " + "A memorable character makes choices that reveal both a strength and a weakness. We care because the consequences feel personal. A brave hero might avoid asking for help, while a careful friend might risk everything for someone they love. That tension gives the story motion. Watch the small decisions as closely as the dramatic ones. " .repeat(4),
};
await mkdir(".data/voice/e2e", { recursive: true });
for (const seconds of budgets) {
  const response = await fetch(`${base}/api/tts`, { method: "POST", headers: headers(device(seconds)), body: JSON.stringify({ text: texts[seconds], durationSeconds: seconds }) });
  if (!response.ok) {
    const detail = await response.text();
    await writeFile(".data/voice/e2e/failure.json", JSON.stringify({ expectedEngine, budgets, completed: results, failedBudget: seconds, status: response.status, detail }, null, 2));
    throw new Error(`TTS ${seconds}s: HTTP ${response.status}: ${detail}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const info = inspectWav(data);
  assert.ok(info.seconds <= seconds + .05 && info.seconds > 0);
  assert.equal(response.headers.get("x-voice-engine"), expectedEngine);
  await writeFile(`.data/voice/e2e/${seconds}s.wav`, data);
  results.push({ test: `${seconds}-second budget, real ${expectedEngine} speech`, ...info });
}
for (const [body, expected] of [[{ text: "Hello", durationSeconds: 121 }, 400], [{ text: "x".repeat(1501) }, 413], [{ text: "Hello", durationSeconds: "30" }, 400]]) {
  const response = await fetch(`${base}/api/tts`, { method: "POST", headers: headers(device("invalid")), body: JSON.stringify(body) });
  assert.equal(response.status, expected); results.push({ test: "invalid input", status: response.status });
}
const same = device("rate");
const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}/api/tts`, { method: "POST", headers: headers(same), body: JSON.stringify({ text: texts[5], durationSeconds: 5 }) })));
assert.equal(responses.filter(r => r.status === 200).length, 3);
assert.equal(responses.filter(r => r.status === 429).length, 1);
assert.ok(Number(responses.find(r => r.status === 429).headers.get("retry-after")) > 0);
results.push({ test: "simultaneous requests and rate limit", statuses: responses.map(r => r.status) });
const exhausted = await fetch(`${base}/api/tts`, { method: "POST", headers: headers(same), body: JSON.stringify({ text: texts[5], durationSeconds: 5 }) });
assert.equal(exhausted.status, 429);
assert.ok(Number(exhausted.headers.get("retry-after")) > 0);
assert.equal((await exhausted.json()).code, "rate_limited");
results.push({ test: "completed requests exhaust the persistent rate quota", status: 429 });

// Real LLM -> synthesis -> persisted attachment -> authenticated Range retrieval.
const chatDevice = device("chat");
const created = await fetch(`${base}/api/chats`, { method: "POST", headers: headers(chatDevice), body: JSON.stringify({ title: "Voice podcast acceptance" }) });
assert.equal(created.status, 200);
const { chat } = await created.json();
const turn = await fetch(`${base}/api/chats/${chat.id}/messages`, { method: "POST", headers: headers(chatDevice), body: JSON.stringify({ content: "Send me an audio message about what makes a character memorable. Talk to me like you're in a podcast.", voiceDurationSeconds: 30 }) });
const events = (await turn.text()).split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
const done = events.find(e => e.type === "done");
assert.ok(done?.message.meta.voice, JSON.stringify(done?.message.meta.voiceError || events.filter(e => e.type === "error")) || "Missing voice attachment");
const message = done.message;
const voice = message.meta.voice;
const url = `${base}/api/uploads/${voice.audioId}`;
const audioResponse = await fetch(url, { headers: headers(chatDevice) });
const data = Buffer.from(await audioResponse.arrayBuffer());
const info = inspectWav(data);
const range = await fetch(url, { headers: { ...headers(chatDevice), Range: "bytes=0-43" } });
assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 44);
assert.equal((await fetch(url, { headers: headers(device("stranger")) })).status, 404);
await writeFile(".data/voice/e2e/podcast.wav", data);
await writeFile(".data/voice/e2e/session.json", JSON.stringify({ device: chatDevice, chatId: chat.id, audioId: voice.audioId }));
await mkdir("public/test-fixtures/ui-generation", { recursive: true });
await writeFile("public/test-fixtures/ui-generation/voice-podcast.json", JSON.stringify({ scope: "Real speech acceptance test", message: { id: message.id, role: "assistant", content: message.content, voice } }));
results.push({ test: "real chat podcast and stored audio", ...info, voice: voice.voice, rangeStatus: range.status });
await writeFile(".data/voice/e2e/results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
