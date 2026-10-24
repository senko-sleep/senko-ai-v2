// Isolated smoke test against the public Wasmer URL. Never uses a real user's chat.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.argv[2] || "https://senko-ai.wasmer.app";
const headers = { "x-device-id": `test_${randomUUID()}`, "content-type": "application/json" };
const ctl = new AbortController();
const deadline = setTimeout(() => ctl.abort(), 240_000);
let id, latest = {}, frames = 0, cursors = 0;
const report = { base, at: new Date().toISOString() };
async function call(path, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
  return { status: r.status, body: await r.json() };
}
async function sse(response, onEvent) {
  assert.equal(response.status, 200, await (response.status === 200 ? Promise.resolve("") : response.text()));
  const reader = response.body.getReader(), dec = new TextDecoder(); let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) return;
      buf += dec.decode(value, { stream: true }); let end;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, end); buf = buf.slice(end + 2);
        if (line.startsWith("data: ") && onEvent(JSON.parse(line.slice(6))) === false) return;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
let watch;
try {
  const host = await call("/api/agent-host", {}); assert.equal(host.status, 200, JSON.stringify(host.body));
  const chat = await call("/api/chats", { title: "Browser control verification" }); assert.equal(chat.status, 200);
  id = chat.body.chat.id;
  const open = await call(`/api/sessions/${id}`, { action: "open" }); assert.equal(open.status, 200);
  assert.equal(open.body.live.inputProtocol, 2, "Browser snapshot must match the UI input protocol");
  watch = sse(await fetch(`${base}/api/sessions/${id}/stream`, { headers, signal: ctl.signal }), e => {
    if (e.type === "status") latest = e;
    if (e.type === "reset") latest.epoch = e.epoch;
    if (e.type === "frame") { frames++; latest.epoch = e.epoch; }
    if (e.type === "cursor") cursors++;
  }).catch(e => { if (!ctl.signal.aborted) console.error("Live stream:", e.message); });
  const goal = `Open ${base}/test-fixtures/popups, dismiss the newsletter overlay, follow Continue to article, report the exact secret code, and leave the article open. Complete every requirement.`;
  let terminal;
  await sse(await fetch(`${base}/api/chats/${id}/agent`, { method: "POST", headers, body: JSON.stringify({ goal, provider: "groq" }), signal: ctl.signal }), e => {
    if (e.type === "step" && e.status === "running") console.log(e.label);
    if (["done", "error", "paused", "stopped"].includes(e.type)) { terminal = e; console.log("Agent terminal:", JSON.stringify(e)); return false; }
  });
  assert.equal(terminal?.type, "done", "Complex task must actually complete");
  assert.match(terminal.answer, /4217-KIWI/);
  assert.match(terminal.url, /stage=article/);
  // The terminal event is sent after release; the SSE status can follow one async title read later.
  const stateResponse = await fetch(`${base}/api/sessions/${id}/stream`, { headers, signal: ctl.signal });
  await sse(stateResponse, e => { if (e.type === "status") { latest = e; return false; } });
  assert.equal(latest.takeover, true); assert.equal(latest.running, false);
  const input = events => call(`/api/sessions/${id}/input`, { events, protocol: 2, epoch: latest.epoch, control: latest.control, sessionId: latest.sessionId });
  assert.equal((await input([{ type: "click", x: 500, y: 200 }, { type: "key", key: "End" }, { type: "wheel", dx: 0, dy: 120 }, { type: "text", text: "é漢🦊" }])).status, 200);
  for (let i = 0; i < 4; i++) {
    const view = await call(`/api/sessions/${id}/takeover`, { on: false }); assert.equal(view.status, 200);
    const claim = await call(`/api/sessions/${id}/takeover`, { on: true }); assert.equal(claim.status, 200); latest = { ...latest, ...claim.body };
    assert.equal((await input([{ type: "down", x: 500, y: 200, button: "left" }, { type: "up", x: 500, y: 200, button: "left" }])).status, 200);
  }
  const bad = await input([{ type: "move", x: null, y: 1 }]); assert.equal(bad.status, 400); assert.equal(bad.body.code, "INVALID_INPUT");
  assert.equal((await input([{ type: "key", key: "Home" }])).status, 200);
  const stale = await call(`/api/sessions/${id}/input`, { events: [{ type: "click", x: 1, y: 1 }], epoch: latest.epoch - 1, control: latest.control, sessionId: latest.sessionId });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "STALE_VIEW");
  const link = await call(`/api/sessions/${id}/live`);
  if (link.body.url) {
    const direct = new URL(link.body.url); direct.pathname = direct.pathname.replace(/\/stream$/, "/input");
    const r = await fetch(direct, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ events: [{ type: "wheel", dy: 10 }], epoch: latest.epoch, control: latest.control, sessionId: latest.sessionId, protocol: 2 }), signal: ctl.signal });
    assert.equal(r.status, 200, "Signed direct input must also work"); report.directInput = true;
  }
  assert(frames > 0 && cursors > 0);
  Object.assign(report, { passed: true, frames, cursors, automaticUserControl: true, repeatedHandoffs: 4, invalidInputRecovery: true, staleInputRejected: true, complexTaskVerified: true });
  await mkdir("test-results/browser-control", { recursive: true });
  await writeFile("test-results/browser-control/deployed.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(deadline); ctl.abort(); await watch;
  if (id) {
    await fetch(`${base}/api/chats/${id}/agent/stop`, { method: "POST", headers }).catch(() => {});
    for (const path of [`/api/sessions/${id}`, `/api/chats/${id}`]) await fetch(base + path, { method: "DELETE", headers }).catch(() => {});
  }
}
