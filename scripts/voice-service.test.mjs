import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createVoiceService } from "./voice-service.mjs";

async function serve(t, options) {
  const server = createVoiceService(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const input = { text: "Welcome to my podcast.", voice: "senko-v1", mood: "excited", personality: "warm and playful" };
const request = (base, body = input, token) => fetch(`${base}/synthesize`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});

test("missing model reports connected but awaiting training, never fabricated audio", async t => {
  const base = await serve(t, { config: {} });
  assert.equal((await (await fetch(`${base}/health`)).json()).status, "awaiting_model");
  assert.equal((await request(base)).status, 503);
});

test("local model receives personality and returns playable bytes; auth and validation enforced", async t => {
  const audio = Buffer.alloc(256, 1);
  const base = await serve(t, { config: { token: "test-secret" }, synthesize: async body => {
    assert.deepEqual(body, input);
    return { audio, mime: "audio/wav", seconds: 1 };
  } });
  assert.equal((await request(base)).status, 401);
  assert.equal((await request(base, { ...input, text: "" }, "test-secret")).status, 400);
  const reply = await request(base, input, "test-secret");
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("content-type"), "audio/wav");
  assert.deepEqual(Buffer.from(await reply.arrayBuffer()), audio);
});

test("cloud pool fails over and rotates replicas without changing voice", async t => {
  const calls = [];
  const base = await serve(t, { config: { workers: [{ url: "http://worker-a" }, { url: "http://worker-b", token: "worker-token" }] }, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.deepEqual(JSON.parse(options.body), input);
    if (url.endsWith("worker-a")) return new Response("busy", { status: 503 });
    assert.equal(options.headers.Authorization, "Bearer worker-token");
    return new Response(Buffer.alloc(256), { headers: { "Content-Type": "audio/wav" } });
  } });
  assert.equal((await request(base)).status, 200);
  assert.equal((await request(base)).status, 200);
  assert.deepEqual(calls, ["http://worker-a", "http://worker-b", "http://worker-b"]);
});

test("bounded slots recover after model timeout", async t => {
  let calls = 0;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const base = await serve(t, { config: { maxConcurrent: 1, timeoutMs: 200 }, synthesize: async () => {
    calls++;
    started();
    if (calls === 1) return new Promise(() => {});
    return { audio: Buffer.alloc(256), mime: "audio/wav" };
  } });
  const first = request(base);
  await ready;
  const busy = await request(base);
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("retry-after"), "2");
  assert.equal((await first).status, 503);
  assert.equal((await request(base)).status, 200);
});
