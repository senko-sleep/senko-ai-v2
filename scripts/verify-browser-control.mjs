// Real Chromium regression for ownership and the server-side input queue.
// profile-browser.mjs additionally exercises the React canvas and native UI events.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const cache = path.resolve("node_modules/.cache/browser-control");
await mkdir(cache, { recursive: true });
await build({ stdin: { contents: "export {BrowserSession} from './src/lib/agent/sessions';", resolveDir: process.cwd(), loader: "ts" }, outfile: path.join(cache, "session.cjs"), bundle: true, platform: "node", packages: "external", format: "cjs", logLevel: "silent" });
const { BrowserSession } = createRequire(import.meta.url)(path.join(cache, "session.cjs"));
const html = `<!doctype html><title>Control fixture</title><style>body{margin:0;height:6000px}input{position:absolute;left:20px;top:20px;width:300px;height:40px}canvas{position:absolute;left:20px;top:100px;background:#ddd}</style><input aria-label="Text"><canvas width="400" height="200"></canvas><script>window.drag=[];for(const type of ['mousedown','mousemove','mouseup'])document.querySelector('canvas').addEventListener(type,e=>drag.push(type));</script>`;
const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  for (const channel of ["chromium", "chrome", "msedge"]) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch {}
  }
  assert(browser, "Chromium must be installed");
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const session = new BrowserSession("control-fixture", "test");
  session.context = context; session.pages = [page]; session.status = "active";
  for (let i = 0; i < 15; i++) {
    const ctl = new AbortController(); session.beginAgent(ctl.signal);
    assert.equal(session.takeover, false);
    if (i % 3 === 0) ctl.abort("stopped");
    if (i % 3 === 1) { ctl.abort("takeover"); session.setTakeover(true); }
    session.endAgent(ctl.signal);
    assert.equal(session.takeover, true); assert.equal(session.running, false);
    await session.inputBatch([{ type: "click", x: 80, y: 40 }, { type: "key", key: "Control+a" }, { type: "text", text: `handoff ${i} é漢🦊` }]);
    assert.equal(await page.locator("input").inputValue(), `handoff ${i} é漢🦊`);
  }
  const old = new AbortController(), next = new AbortController();
  session.beginAgent(old.signal); session.beginAgent(next.signal); session.endAgent(old.signal);
  assert.equal(session.takeover, false); assert.equal(session.running, true);
  session.endAgent(next.signal);
  await session.inputBatch([{ type: "down", x: 50, y: 130, button: "left" }, { type: "move", x: 160, y: 200 }, { type: "up", x: 160, y: 200, button: "left" }]);
  const drag = await page.evaluate(() => window.drag);
  assert(drag.includes("mousedown") && drag.includes("mouseup"), "Drag must reach the canvas");
  const valueBefore = await page.locator("input").inputValue();
  await assert.rejects(session.inputBatch([{ type: "text", text: "must not type" }], session.viewEpoch - 1), e => e.code === "STALE_VIEW");
  assert.equal(await page.locator("input").inputValue(), valueBefore);
  await session.input({ type: "wheel", dy: 600, x: 600, y: 400 });
  await page.waitForFunction(() => scrollY > 100);
  await session.input({ type: "goto", url: `${base}/next` });
  await page.waitForURL(`${base}/next`);
  await page.waitForLoadState("domcontentloaded");
  await session.inputBatch([{ type: "click", x: 80, y: 40 }, { type: "text", text: "after navigation" }]);
  assert.equal(await page.locator("input").inputValue(), "after navigation");
  console.log(JSON.stringify({ browser: browser.version(), handoffs: 15, replacedRunFenced: true, unicode: true, canvasDrag: true, staleInputRejected: true, scroll: true, navigationRecovery: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
