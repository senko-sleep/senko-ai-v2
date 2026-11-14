import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectWav } from "./windows-voice.mjs";

const base = process.env.VOICE_TEST_URL || "http://localhost:3000";
const device = `voice_story_${Date.now()}`;
const headers = { "Content-Type": "application/json", "x-device-id": device, Cookie: `senko_device=${device}` };
const request = "send me a audio message talking to me about a bed time story about a girl finding out about her love life yes it can be about her comming out the closet make it fun and in japan should be a anime";
const created = await fetch(`${base}/api/chats`, { method: "POST", headers, body: JSON.stringify({ title: "Bedtime voice routing regression" }) });
assert.equal(created.status, 200);
const { chat } = await created.json();
// Reproduce the old false claim in prior history, not just a clean conversation.
const seeded = await fetch(`${base}/api/chats/${chat.id}/messages`, {
  method: "POST", headers, body: JSON.stringify({ content: "Can you send audio?", record: { content: "I can't actually send audio, my voice doesn't come out as a file. Read the story in your head instead." } }),
});
assert.equal(seeded.status, 200);
const response = await fetch(`${base}/api/chats/${chat.id}/messages`, {
  method: "POST", headers, body: JSON.stringify({ content: request }), signal: AbortSignal.timeout(300000),
});
assert.equal(response.status, 200);
const events = [], progress = [];
const reader = response.body.getReader(), decoder = new TextDecoder();
let pending = "";
const start = Date.now();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  pending += decoder.decode(value, { stream: true });
  const lines = pending.split("\n");
  pending = lines.pop() || "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    events.push(event);
    if (event.type === "voice_progress") {
      const item = { ...event.progress, elapsedMs: Date.now() - start };
      progress.push(item);
      console.log(JSON.stringify(item));
    }
  }
}
const message = events.find(event => event.type === "done")?.message;
assert.ok(!events.some(event => event.type === "delta"), "Unvalidated voice drafts must not stream as text");
assert.ok(message, JSON.stringify(events.filter(event => event.type === "error")));
assert.equal(message.meta?.comic, undefined);
assert.ok(!/hentai|which site|top 20|porn/i.test(message.content), message.content);
assert.ok(!/can(?:not|'t|’t).*audio|read.*in your head|doesn['’]t come out/i.test(message.content), message.content);
assert.ok(message.meta?.voice, JSON.stringify(message.meta?.voiceError));
assert.equal(message.meta.voice.engine, "senko-hybrid");
const audioResponse = await fetch(`${base}/api/uploads/${message.meta.voice.audioId}`, { headers });
assert.equal(audioResponse.status, 200);
const audio = Buffer.from(await audioResponse.arrayBuffer());
const info = inspectWav(audio);
assert.ok(info.seconds >= 50 && info.seconds <= 120.05, `Story should be developed, not a tiny summary: ${info.seconds}s`);
assert.ok(message.content.trim().split(/\s+/).length >= 138);
assert.ok(progress.some(p => p.phase === "preparing"));
const parts = progress.filter(p => p.phase === "synthesizing" && p.completed > 0);
assert.ok(parts.length > 1, "Must report real completed synthesis parts");
assert.ok(parts.every((p, index) => p.completed === index + 1 && p.total === parts[0].total));
assert.equal(parts.at(-1).completed, parts[0].total);
assert.ok(progress.some(p => p.phase === "assembling"));
assert.equal(progress.at(-1).phase, "ready");
assert.ok(parts[0].elapsedMs < progress.at(-1).elapsedMs, "Progress must arrive before completion");
await mkdir(".data/voice/story", { recursive: true });
await writeFile(".data/voice/story/bedtime.wav", audio);
await writeFile(".data/voice/story/result.json", JSON.stringify({ request, transcript: message.content, voice: message.meta.voice, progress, ...info }, null, 2));
await writeFile(".data/voice/story/session.json", JSON.stringify({ device, chatId: chat.id }));
console.log(JSON.stringify({ transcript: message.content, ...info }, null, 2));
