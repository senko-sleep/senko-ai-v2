// Measures real Agent Mode execution: the real runner, BrowserSession and local Chromium.
// Uses an in-memory database, so it never reads or writes the app's real data.
//
//   node scripts/bench-agent.mjs [label] [--no-llm] [--runs=3]
//
// Scripted tasks run on a deterministic fixture site served through Playwright routing, so
// runs compare fairly. The image task uses the live web and, unless --no-llm, real AI providers.
// Results: test-results/agent-bench/<label>.json
import { build } from "esbuild";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) || "current";
const useLlm = !args.includes("--no-llm");
const runs = Math.max(1, Number(args.find((a) => a.startsWith("--runs="))?.slice(7)) || 3);

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
// Isolation: no real database, and always the local Chromium.
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "SENKO_DATABASE_URL", "BROWSERBASE_API_KEY", "BROWSERLESS_TOKEN", "STEEL_API_KEY", "BROWSER_CDP_URL", "AGENT_HOST"]) delete process.env[key];
process.env.DATA_DIR = ":memory:";
process.env.BROWSER_HEADLESS = "1";

const cache = path.resolve("node_modules/.cache/agent-bench");
await mkdir(cache, { recursive: true });
await build({
  stdin: {
    contents: `export {runAgent} from './src/lib/agent/runner';
      export {sessions} from './src/lib/agent/sessions';
      export {getBrowser, restartBrowser} from './src/lib/agent/browser';
      export {observeDom, pointAndClick, settlePage} from './src/lib/agent/interaction';
      export {runSearch} from './src/lib/agent/web-search';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(cache, "agent.cjs"),
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  logLevel: "error",
  alias: { "@": path.resolve("src") },
});
const { runAgent, sessions, getBrowser, restartBrowser, observeDom, pointAndClick, settlePage, runSearch } = createRequire(import.meta.url)(path.join(cache, "agent.cjs"));

const now = () => performance.now();
const round = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

// Count real model calls without changing how they're made.
let llmCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(typeof input === "string" ? input : input?.url || "");
  if ((init?.method || input?.method) === "POST" && /chat\/completions|generateContent|\/messages\b|\/v1\/responses/.test(url)) llmCalls++;
  return realFetch(input, init);
};

async function frameKind(b64) {
  try {
    const { channels } = await sharp(Buffer.from(b64, "base64")).resize(32, 20, { fit: "fill" }).removeAlpha().stats();
    const spread = Math.max(...channels.map((c) => c.stdev));
    const mean = channels.reduce((n, c) => n + c.mean, 0) / channels.length;
    return spread < 2.5 ? (mean > 235 ? "white" : "solid") : "content";
  } catch {
    return "invalid";
  }
}

/** Plays the viewer: subscribes as soon as the session exists and classifies every frame. */
function watch(chatId) {
  const t0 = now();
  const stats = { firstFrame: null, firstContent: null, frames: 0, white: 0, solid: 0, cursor: 0, click: 0, resets: 0 };
  const pending = [];
  let unsubscribe = null;
  const poll = setInterval(() => {
    const s = sessions.get(chatId);
    if (!s || unsubscribe) return;
    unsubscribe = s.subscribe((e) => {
      if (e.type === "reset") stats.resets++;
      if (e.type === "cursor") { stats.cursor++; if (e.kind === "click") stats.click++; }
      if (e.type !== "frame") return;
      const at = now() - t0;
      stats.frames++;
      stats.firstFrame ??= at;
      // Sample while hunting for the first content frame, then every 4th to keep CPU honest.
      if (stats.firstContent === null || stats.frames % 4 === 0) {
        pending.push(frameKind(e.data).then((kind) => {
          if (kind === "white") stats.white++;
          if (kind === "solid") stats.solid++;
          if (kind === "content" && (stats.firstContent === null || at < stats.firstContent)) stats.firstContent = at;
        }));
      }
    }, 60);
  }, 5);
  return {
    async stop() {
      clearInterval(poll);
      unsubscribe?.();
      await Promise.all(pending);
      return { ...stats, firstFrame: round(stats.firstFrame), firstContent: round(stats.firstContent) };
    },
  };
}

const longBody = Array.from({ length: 120 }, (_, i) => `<p id="p${i}" style="padding:18px;background:hsl(${i * 7} 45% 88%)">Paragraph ${i}</p>`).join("");
const FIXTURES = {
  "/": `<title>Home</title><body style="font:18px system-ui;padding:24px"><h1>Bench home</h1><nav><a id="next" href="/two">Second page</a> <a href="/long">Long</a> <a href="/form">Form</a></nav><button id="toggle" onclick="this.textContent='Clicked'">Press me</button></body>`,
  "/two": `<title>Two</title><body style="font:18px system-ui;padding:24px;background:#dfe9ff"><h1>Second page</h1><a href="/">Back home</a></body>`,
  "/long": `<title>Long</title><body style="margin:0;font:18px system-ui">${longBody}</body>`,
  "/form": `<title>Form</title><body style="font:18px system-ui;padding:24px"><h1>Sign up</h1><form onsubmit="event.preventDefault();document.title='Submitted '+name.value"><input id="name" name="name" placeholder="Name"><input id="mail" placeholder="Email"><select id="plan"><option>Free</option><option>Pro</option></select><button>Submit</button></form></body>`,
};
const FIXTURE = "https://bench.senko.test";
/** Each document arrives after a realistic 250 ms server delay. */
async function routeFixture(session) {
  await session.context.route(`${FIXTURE}/**`, async (route) => {
    const body = FIXTURES[new URL(route.request().url()).pathname];
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({ status: body ? 200 : 404, contentType: "text/html", body: `<!doctype html>${body || "missing"}` });
  });
}

const signal = new AbortController().signal;
async function elementId(page, selector) {
  const dom = await observeDom(page);
  const handle = await page.$(selector);
  const id = Number(await handle.getAttribute("data-agent-id"));
  return dom.elements.find((e) => e.id === id);
}
async function clickSelector(session, selector) {
  const page = session.active();
  const el = await elementId(page, selector);
  const out = await pointAndClick(page, session, { id: el.id, fp: el.fp ?? null }, { signal });
  if (!out.ok) throw new Error(`click failed: ${out.reason}`);
}

async function scripted(name, task) {
  const chatId = `bench_${name}_${Date.now()}`;
  const viewer = watch(chatId);
  const start = now();
  const session = await sessions.open(chatId, "bench");
  const sessionMs = now() - start;
  await routeFixture(session);
  await new Promise((r) => setTimeout(r, 20)); // let the viewer attach
  await session.startCast();
  let error;
  const marks = {};
  try {
    await task(session, marks);
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  const totalMs = now() - start;
  await new Promise((r) => setTimeout(r, 250)); // trailing frames
  const view = await viewer.stop();
  await sessions.close(chatId).catch(() => {});
  return { name, ok: !error, error, sessionMs: round(sessionMs), totalMs: round(totalMs), ...Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, round(v)])), view };
}

const goto = async (session, url) => {
  const t = now();
  const p = session.active();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await settlePage(p, { navigated: true, signal });
  return now() - t;
};

const TASKS = {
  "open-and-click": async (s, m) => {
    m.navMs = await goto(s, `${FIXTURE}/`);
    const t = now();
    await clickSelector(s, "#toggle");
    m.clickMs = now() - t;
    if ((await s.active().textContent("#toggle")) !== "Clicked") throw new Error("click had no effect");
  },
  "scroll-long-page": async (s, m) => {
    m.navMs = await goto(s, `${FIXTURE}/long`);
    const p = s.active();
    const t = now();
    await p.mouse.move(400, 400);
    for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 600);
    await p.waitForFunction(() => scrollY >= 2400, null, { timeout: 5000 });
    m.scrollMs = now() - t;
  },
  "fill-form": async (s, m) => {
    m.navMs = await goto(s, `${FIXTURE}/form`);
    const t = now();
    const p = s.active();
    await clickSelector(s, "#name");
    await p.fill("#name", "Senko");
    await clickSelector(s, "#mail");
    await p.fill("#mail", "test@example.test");
    await p.selectOption("#plan", "Pro");
    await clickSelector(s, "form button");
    await p.waitForFunction(() => document.title.startsWith("Submitted"), null, { timeout: 3000 });
    m.formMs = now() - t;
  },
  "multi-page-nav": async (s, m) => {
    const times = [];
    for (const u of ["/", "/two", "/long", "/form", "/"]) times.push(await goto(s, `${FIXTURE}${u}`));
    m.navMs = median(times);
  },
  "search-engine": async (s, m) => {
    const t = now();
    const r = await runSearch(s, { query: "red fox", kind: "web", engine: "bing", level: "strict", signal });
    if (!r.ok) throw new Error(r.result);
    await settlePage(s.active(), { navigated: true, signal });
    m.searchMs = now() - t;
  },
};

async function imageTask(goal, i) {
  const chatId = `bench_images_${i}_${Date.now()}`;
  const viewer = watch(chatId);
  const calls = llmCalls;
  const events = { firstAction: null, connected: null, firstImage: null };
  const steps = [];
  let outcome = "none", answer = "", images = 0;
  const ctl = new AbortController();
  const limit = setTimeout(() => ctl.abort("benchmark timeout"), 150_000);
  const start = now();
  await runAgent({
    chatId,
    ownerId: "bench",
    goal,
    signal: ctl.signal,
    emit: (e) => {
      const at = now() - start;
      if (e.type === "step" && e.status === "running") {
        steps.push(e.label);
        if (e.id > 1) events.firstAction ??= at;
      }
      if (e.type === "step" && e.id === 1 && e.status !== "running") events.connected ??= at;
      if (e.type === "images") { events.firstImage ??= at; images = e.imageIds.length; }
      if (["done", "paused", "error", "stopped"].includes(e.type)) {
        outcome = e.type;
        answer = String(e.answer || e.reason || e.message || "").slice(0, 160);
        if (e.imageIds) images = e.imageIds.length;
      }
    },
  }).catch((e) => { outcome = "threw"; answer = String(e).slice(0, 160); });
  clearTimeout(limit);
  const totalMs = now() - start;
  await new Promise((r) => setTimeout(r, 200));
  const view = await viewer.stop();
  await sessions.close(chatId).catch(() => {});
  return { goal, outcome, images, llmCalls: llmCalls - calls, steps: steps.length, stepLabels: steps.slice(0, 14), answer, connectedMs: round(events.connected), firstActionMs: round(events.firstAction), firstImageMs: round(events.firstImage), totalMs: round(totalMs), view };
}

const report = { label, at: new Date().toISOString(), node: process.version, llm: useLlm, runs, tasks: {}, imageRuns: [] };
const coldStart = now();
const browser = await getBrowser();
report.browserColdMs = round(now() - coldStart);
report.browser = browser.version();

for (const [name, task] of Object.entries(TASKS)) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await scripted(name, task));
  report.tasks[name] = results;
  const last = results.at(-1);
  console.log(`${name}: ok=${results.filter((r) => r.ok).length}/${runs} total=${median(results.map((r) => r.totalMs))}ms firstContent=${median(results.map((r) => r.view.firstContent))}ms white=${results.reduce((n, r) => n + r.view.white, 0)}${last.error ? ` error=${last.error}` : ""}`);
}

if (useLlm) {
  for (let i = 0; i < runs; i++) {
    const r = await imageTask("Send 5 images of a tsundere", i);
    report.imageRuns.push(r);
    console.log(`images#${i + 1}: ${r.outcome} images=${r.images} llm=${r.llmCalls} steps=${r.steps} firstAction=${r.firstActionMs}ms firstImage=${r.firstImageMs}ms total=${r.totalMs}ms`);
  }
}
report.rssMB = Math.round(process.memoryUsage().rss / 1048576);

const out = path.resolve("test-results/agent-bench", `${label}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${path.relative(process.cwd(), out)} (browser cold start ${report.browserColdMs}ms, node RSS ${report.rssMB} MB)`);
await restartBrowser("benchmark finished").catch(() => {});
await rm(cache, { recursive: true, force: true });
process.exit(0);
