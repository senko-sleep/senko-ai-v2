// End-to-end check of the live browser panel against a REAL Chromium session, offline:
// the real BrowserSession (no database), the real live stream, and the real BrowserPanel /
// LiveView rendered in a second browser that plays the user. Verifies what a person sees
// and does, not just that code runs:
//   frames stream live, the real page is sized to the panel (no letterboxing), the AI pointer
//   is visible with its name, clicks/typing/scrolling/navigation reach the real page, the
//   page's cursor shape is mirrored, and page sound arrives and plays.
// Usage: node scripts/verify-live-panel.mjs [--headed]
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const headed = process.argv.includes("--headed");
const cache = path.resolve("node_modules/.cache/live-panel");
await mkdir(cache, { recursive: true });
const stubDb = {
  name: "stub-db",
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/server\/db$/ }, () => ({ path: "stub-db", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const q=async()=>[];export const q1=async()=>null;export const json=(v,d)=>v??d;export const newId=p=>p+Math.random().toString(36).slice(2);export const toBuffer=v=>v;",
      loader: "js",
    }));
  },
};
await build({
  stdin: { contents: "export {BrowserSession} from './src/lib/agent/sessions'; export {createLiveStream} from './src/lib/server/live-stream';", resolveDir: process.cwd(), loader: "ts" },
  outfile: path.join(cache, "server.cjs"), bundle: true, platform: "node", packages: "external", format: "cjs", logLevel: "silent", plugins: [stubDb],
  alias: { "@": "./src" },
});
const { BrowserSession, createLiveStream } = createRequire(import.meta.url)(path.join(cache, "server.cjs"));

const client = await build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { BrowserPanel } from './src/components/assistant/browser-panel';
      import { createLiveBus } from './src/components/assistant/live-view';
      const bus = createLiveBus();
      window.stats = { frame: 0, cursor: 0, audio: 0, pointer: 0, inputs: 0 };
      const es = new EventSource('/events');
      es.onmessage = m => { const e = JSON.parse(m.data); if (e.type in window.stats) window.stats[e.type]++; if (['frame','cursor','reset','pointer','audio'].includes(e.type)) bus.emit(e); if (e.type === 'status') window.lastStatus = e; };
      const post = (p, b) => fetch(p, { method: 'POST', body: JSON.stringify(b) });
      function App() {
        const [state] = useState({ running: false, status: '', url: 'http://local/page', title: 'Fixture', plan: [], steps: [{ id: 1, label: 'Opened the page', status: 'done' }], outcome: 'done' });
        return React.createElement(BrowserPanel, {
          state, bus, controlling: true, paused: false, opening: false, pageBusy: false, agentName: 'Senko · Gemini',
          onStop() {}, onClose() {}, onOpenBrowser() {}, onToggleControl() {}, onResume() {}, onPageOp() {},
          onInput: e => { window.stats.inputs++; post('/input', e); },
          onNav: n => post('/input', 'url' in n ? { type: 'goto', url: n.url } : { type: 'nav', action: n.action }),
          onViewport: s => post('/viewport', s),
        });
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, minify: true, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", alias: { "@": "./src" },
});
const css = (await postcss([tailwind({ base: process.cwd() })]).process(
  `@import "tailwindcss" source(none); @source "../../../src/components/assistant"; ${await readFile("src/app/senko.css", "utf8")}`,
  { from: path.join(cache, "in.css") },
)).css;

// A one-second 440 Hz tone (16-bit PCM WAV), looped by the fixture page.
function tone() {
  const rate = 22050, n = rate, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}
const PAGE = `<!doctype html><title>Fixture</title><style>body{margin:0;font:16px system-ui;height:5000px;background:#fff}
#size{position:fixed;right:8px;top:8px} input{position:absolute;left:20px;top:20px;width:260px;height:36px}
a{position:absolute;left:20px;top:80px;font-size:22px} #grab{position:absolute;left:20px;top:130px;width:160px;height:60px;background:#cde;cursor:grab}
#play{position:absolute;left:20px;top:210px;width:120px;height:40px}</style>
<input id="text" aria-label="Text"><a href="/next">Go next</a><div id="grab">grab me</div><button id="play">Play sound</button><div id="size"></div>
<audio id="snd" src="/tone.wav" loop></audio>
<script>const s=()=>document.getElementById('size').textContent=innerWidth+'x'+innerHeight;s();addEventListener('resize',s);
document.getElementById('play').onclick=()=>document.getElementById('snd').play();</script>`;

let session;
const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const body = async () => { let b = ""; for await (const c of req) b += c; return JSON.parse(b || "{}"); };
  if (url === "/app") { res.setHeader("content-type", "text/html"); res.end(`<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body style="margin:0;background:#000"><div class="sk" style="width:var(--w,900px);height:var(--h,640px)" id="host"><div id="root" style="height:100%"></div></div><script>${client.outputFiles[0].text}</script></body></html>`); }
  else if (url === "/page") { res.setHeader("content-type", "text/html"); res.end(PAGE); }
  else if (url === "/next") { res.setHeader("content-type", "text/html"); res.end("<title>Next</title><h1>Next page</h1>"); }
  else if (url === "/tone.wav") { res.setHeader("content-type", "audio/wav"); res.end(tone()); }
  else if (url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const abort = new AbortController(); req.on("close", () => abort.abort());
    const reader = createLiveStream((send) => session.subscribe(send), abort.signal).getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (!res.write(value)) await new Promise((r) => res.once("drain", r)); } } catch {} finally { res.end(); }
  } else if (url === "/input") {
    const e = await body();
    try { await session.inputBatch([e]); res.end("ok"); } catch (err) { res.statusCode = 409; res.end(String(err)); }
  } else if (url === "/viewport") { const { width, height } = await body(); await session.setViewport(width, height); res.end("ok"); }
  else { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_URL = base; // lets the session's browser open this local fixture

const results = {};
// The page gets a ~1280 CSS px wide viewport, scaled down to narrower panels (same aspect ratio).
const expectVp = (w, h) => { const z = Math.max(0.5, Math.min(1, w / 1280)); return [Math.round(w / z), Math.round(h / z)]; };
let viewer;
try {
  session = new BrowserSession("panel-fixture", "test");
  await session.start(null);
  results.browser = session.context.browser()?.version();
  await session.active().goto(`${base}/page`);

  viewer = await chromium.launch({ headless: !headed, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await viewer.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  page.on("pageerror", (e) => console.log("viewer error:", e.message));
  await page.goto(`${base}/app`);
  const view = page.locator(".sk-live-view");
  await page.waitForFunction(() => window.stats.frame > 0, null, { timeout: 15_000 });

  // 1. Live frames: a steady stream, not a snapshot.
  const f0 = await page.evaluate(() => window.stats.frame);
  await session.active().evaluate(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:0;bottom:0;width:60px;height:60px;background:red"; document.body.append(d); let x = 0; (function t() { d.style.left = (x = (x + 7) % 600) + "px"; requestAnimationFrame(t); })(); });
  await page.waitForTimeout(3000);
  results.fps = Math.round(((await page.evaluate(() => window.stats.frame)) - f0) / 3);
  assert(results.fps >= 15, `live frames too slow: ${results.fps} fps`);

  // 2. The real page is sized to the panel's viewing area (no letterboxing, no frame).
  const box = await view.boundingBox();
  await page.waitForFunction(() => window.stats.frame > 0);
  await session.active().waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1, expectVp(Math.round(box.width), Math.round(box.height)), { timeout: 5000 });
  results.viewport = await session.active().evaluate(() => `${innerWidth}x${innerHeight}`);
  results.panel = `${Math.round(box.width)}x${Math.round(box.height)}`;
  await page.evaluate(() => { document.getElementById("host").style.setProperty("--w", "700px"); document.getElementById("host").style.setProperty("--h", "520px"); });
  const box2 = await view.boundingBox();
  await session.active().waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1, expectVp(Math.round(box2.width), Math.round(box2.height)), { timeout: 5000 });
  results.resizedViewport = await session.active().evaluate(() => `${innerWidth}x${innerHeight}`);
  await page.waitForTimeout(400);
  const pageBox = await view.boundingBox();
  const vpNow = session.viewport();
  const k = pageBox.width / vpNow.width; // page CSS px -> screen px (the page fills the view)
  const at = (x, y) => ({ x: pageBox.x + x * k, y: pageBox.y + y * k });

  // 3. The AI pointer is visible, named, glides to where the agent moves, ripples on click.
  const vp = session.viewport();
  session.emit({ type: "cursor", x: 300, y: 200, kind: "move", box: null, width: vp.width, height: vp.height });
  session.emit({ type: "cursor", x: 300, y: 200, kind: "click", box: null, width: vp.width, height: vp.height });
  await page.waitForTimeout(700);
  const cur = await page.evaluate(() => { const el = document.querySelector(".sk-agent-cursor"); const m = /translate3d\(([\d.]+)px, ([\d.]+)px/.exec(el.style.transform); return { opacity: getComputedStyle(el).opacity, x: +m?.[1], y: +m?.[2], tag: el.textContent }; });
  assert.equal(cur.opacity, "1", "AI pointer must be visible");
  assert.equal(cur.tag, "Senko · Gemini");
  assert(Math.abs(cur.x - 300 * k) < 3 && Math.abs(cur.y - 200 * k) < 3, `pointer at ${cur.x},${cur.y}, expected ${300 * k},${200 * k}`);
  results.aiPointer = cur;

  // 4. Your clicks and typing reach the real page.
  const input = await session.active().locator("#text").boundingBox();
  const p = at(input.x + 20, input.y + 10);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("hello 漢🦊");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("typed by you");
  await session.active().waitForFunction(() => document.querySelector("#text").value === "typed by you", null, { timeout: 5000 });
  results.typing = true;

  // 5. The page's cursor shape is mirrored (hand over links, grab over draggables).
  const link = await session.active().locator("a").boundingBox();
  await page.mouse.move(at(link.x + 10, link.y + 8).x, at(link.x + 10, link.y + 8).y, { steps: 4 });
  await page.waitForFunction(() => document.querySelector(".sk-live-view").style.cursor === "pointer", null, { timeout: 5000 });
  const grab = await session.active().locator("#grab").boundingBox();
  await page.mouse.move(at(grab.x + 30, grab.y + 20).x, at(grab.x + 30, grab.y + 20).y, { steps: 4 });
  await page.waitForFunction(() => document.querySelector(".sk-live-view").style.cursor === "grab", null, { timeout: 5000 });
  results.pageCursor = true;

  // 6. Page sound is streamed and played by the panel.
  const play = await session.active().locator("#play").boundingBox();
  await page.mouse.click(at(play.x + 30, play.y + 15).x, at(play.x + 30, play.y + 15).y);
  await page.waitForFunction(() => window.stats.audio > 5, null, { timeout: 10_000 });
  await page.getByRole("button", { name: /Mute|Unmute|Turn on sound/ }).waitFor({ timeout: 5000 });
  results.audioChunks = await page.evaluate(() => window.stats.audio);

  // 7. Scrolling, then navigation by clicking a link.
  await page.mouse.move(at(400, 300).x, at(400, 300).y);
  await page.mouse.wheel(0, 900);
  await session.active().waitForFunction(() => scrollY > 300, null, { timeout: 5000 });
  results.scrolled = await session.active().evaluate(() => scrollY);
  await page.mouse.wheel(0, -5000);
  await session.active().waitForFunction(() => scrollY === 0, null, { timeout: 5000 });
  await page.mouse.click(at(link.x + 10, link.y + 8).x, at(link.x + 10, link.y + 8).y);
  await session.active().waitForURL(/\/next$/, { timeout: 5000 });
  await page.waitForFunction(() => window.stats.frame > 0);
  results.navigation = true;

  // 8. The address bar navigates.
  await page.getByRole("button", { name: /local\/page|Search or enter address/ }).click();
  await page.getByRole("textbox", { name: "Address or search" }).fill(`${base}/page`);
  await page.keyboard.press("Enter");
  await session.active().waitForURL(/\/page$/, { timeout: 5000 });
  results.addressBar = true;

  await page.screenshot({ path: "test-results/live-panel/panel.png" }).catch(async () => { await mkdir("test-results/live-panel", { recursive: true }); await page.screenshot({ path: "test-results/live-panel/panel.png" }); });
  results.passed = true;
} finally {
  await mkdir("test-results/live-panel", { recursive: true });
  await writeFile("test-results/live-panel/result.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await viewer?.close();
  await session?.context?.browser()?.close().catch(() => {});
  server.close();
  setTimeout(() => process.exit(results.passed ? 0 : 1), 200);
}
