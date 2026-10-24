// Interaction benchmark: the real agent loop driving a real local Chrome through fixture
// pages (scrolling, search, menus, loading states, overlays, layout shifts, re-renders,
// live-updating text, consecutive clicks). The AI is replaced by a scripted policy with a
// fixed "thinking" delay, so runs are reproducible and comparable before/after a change.
//
//   npx vitest run --config vitest.live.config.ts src/__live__/interaction-bench.live.test.ts
//   BENCH_LABEL=before  (or after) names the report in test-results/interaction-bench/
import { it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.hoisted(() => {
  process.env.DATA_DIR = ":memory:";
  process.env.AGENT_MAX_STEPS = process.env.AGENT_MAX_STEPS || "14";
  process.env.BROWSER_PROVIDER = "local";
  process.env.BROWSER_HEADLESS = "1";
});

const THINK_MS = Number(process.env.BENCH_THINK_MS || 600);
const TRIALS = Number(process.env.BENCH_TRIALS || 3);

type El = { id: number; kind: string; text: string; rest: string };
type Ctx = { prompt: string; text: string; url: string; elements: El[]; history: string };
type Choice = { decision: Record<string, unknown>; intended?: string };

let current: { scenario: Scenario; log: TrialLog } | null = null;

vi.mock("@/lib/llm", () => {
  class LlmBusyError extends Error { retryInMs?: number; }
  return {
    LlmBusyError,
    headroom: async () => 1,
    complete: async (messages: { role: string; content: string }[]) => {
      await new Promise((r) => setTimeout(r, THINK_MS));
      const sys = messages[0]?.content || "";
      const user = messages[1]?.content || "";
      const log = current!.log;
      log.llmCalls++;
      const reply = (v: unknown) => ({ text: JSON.stringify(v), providerLabel: "bench", model: "scripted" });
      if (sys.startsWith("You plan tasks")) return reply({ requirements: [], steps: ["Do it"] });
      if (sys.startsWith("Audit a browser task")) {
        const ids = [...user.matchAll(/^(r\d+) \[/gm)].map((m) => m[1]);
        return reply({ requirements: ids.map((id) => ({ id, status: "verified", evidence: "Status shows TASK COMPLETE" })) });
      }
      const ctx = parseCtx(user);
      if (process.env.BENCH_DEBUG && (process.env.BENCH_DEBUG === "1" || user.includes(process.env.BENCH_DEBUG))) console.log("---PROMPT---\n" + (user.split("Previous steps:")[1] || "").slice(0, 2500));
      const lastLine = ctx.history.trim().split("\n").pop() || "";
      const skippedPrev = /Skipped/.test(lastLine);
      if (skippedPrev) log.skipped++;
      const choice = current!.scenario.decide(ctx);
      log.decisions.push({ at: Date.now(), action: String(choice.decision.action), intended: choice.intended, skippedPrev });
      return reply({ check: { ok: true }, thought: "scripted", ...choice.decision });
    },
  };
});
vi.mock("@/lib/server/persona", () => ({ agentVoice: async () => "", safeSearchFor: async () => "off" }));
vi.mock("@/lib/server/chats", () => ({ saveImage: async () => "img" }));

function parseCtx(prompt: string): Ctx {
  const page = prompt.split("Current page:\n")[1] || "";
  const elements: El[] = [];
  for (const m of page.matchAll(/^\[(\d+)\] (\S+) "(.*?)"(.*)$/gm)) elements.push({ id: Number(m[1]), kind: m[2], text: m[3], rest: m[4] });
  const text = page.split(/Visible text[^\n]*\n/)[1] || "";
  const url = page.match(/^URL: (.*)$/m)?.[1] || "";
  const history = prompt.split("Previous steps:")[1]?.split("\n\n")[0] || "";
  return { prompt, text, url, elements, history };
}

const find = (c: Ctx, re: RegExp) => c.elements.find((e) => re.test(e.text) || re.test(e.text + e.rest));
const done = (): Choice => ({ decision: { action: "done", answer: "Done: TASK COMPLETE" } });
const clickOn = (e: El, intended: string): Choice => ({ decision: { action: "click", id: e.id }, intended });
const completeNow = (c: Ctx) => /TASK COMPLETE/.test(c.text);
/** Follow site memory like the prompt instructs: a remembered route first, then a search URL; each tried once. */
function shortcut(c: Ctx, query: string): Choice | null {
  const route = c.prompt.match(/^- This exact request finished before at (\S+?)(?: \(\d+ actions\))?: goto/m)?.[1];
  if (route && !c.history.includes(route)) return { decision: { action: "goto", url: route } };
  const tmpl = c.prompt.match(/^- Search URL on [^:]+: (\S+)/m)?.[1];
  if (tmpl) {
    const url = tmpl.replace("{query}", query);
    if (!c.history.includes(url)) return { decision: { action: "goto", url } };
  }
  return null;
}

// ---- fixtures ------------------------------------------------------------------------------

const HEAD = `<meta charset=utf-8><style>body{font:16px system-ui;margin:0;padding:12px;background:#fff;color:#111}button{font:inherit;padding:8px 14px;margin:4px}#status{font-weight:700;min-height:20px}</style>
<script>addEventListener('click',e=>{const el=e.target.closest&&e.target.closest('[data-t]');window.__benchClick&&window.__benchClick({t:el?el.dataset.t:String(e.target.tagName||'?').toLowerCase(),trusted:e.isTrusted});},true);
function complete(){document.getElementById('status').textContent='TASK COMPLETE'}</script>`;
const filler = (n: number) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. ${"Lorem ipsum dolor sit amet. ".repeat(6)}</p>`).join("");
const links = (n: number) => Array.from({ length: n }, (_, i) => `<a href="#l${i}" data-t="nav${i}">Section ${i + 1}</a> `).join("");

const PAGES: Record<string, string> = {
  "/scroll": `${HEAD}<div id=status></div><h1>Long article</h1>${filler(60)}<button data-t=details onclick=complete()>Load details</button>${filler(4)}`,
  "/shop": `${HEAD}<div id=status></div><h1>Shop</h1><form action=/results><input name=q data-t=q placeholder="Search products"> <button data-t=go>Search</button></form>${filler(3)}`,
  "/results": `${HEAD}<div id=status></div><h1>Results</h1><div id=r></div><script>const q=new URLSearchParams(location.search).get('q')||'';
    document.getElementById('r').innerHTML=['Red Widget','Blue Widget Lite','Blue Widget Pro','Green Widget','Widget Stand','Widget Case'].filter(n=>n.toLowerCase().includes(q.split(' ').pop().toLowerCase())).map(n=>'<p><a data-t="'+n.toLowerCase().replace(/ /g,'-')+'" href="/product/'+n.toLowerCase().replace(/ /g,'-')+'">'+n+'</a></p>').join('')</script>`,
  "/product/blue-widget-pro": `${HEAD}<div id=status>TASK COMPLETE</div><h1>Blue Widget Pro</h1>`,
  "/menu": `${HEAD}<div id=status></div><nav><button data-t=products onclick=openMenu()>Products</button> ${links(70)}</nav><main id=main><h1>Store</h1>${filler(3)}</main>
    <script>function openMenu(){setTimeout(()=>{const m=document.createElement('div');m.setAttribute('role','menu');m.style.cssText='position:absolute;top:56px;left:14px;background:#eee;padding:6px;border:1px solid #999;opacity:0;transition:opacity .15s';
      m.innerHTML='<button role=menuitem data-t=laptops onclick=pick()>Laptops</button><button role=menuitem data-t=phones>Phones</button>';document.body.appendChild(m);requestAnimationFrame(()=>m.style.opacity=1)},150)}
    function pick(){document.querySelector('[role=menu]').remove();const main=document.getElementById('main');main.setAttribute('aria-busy','true');main.innerHTML='<div class=spinner>Loading…</div>';
      setTimeout(()=>{main.removeAttribute('aria-busy');main.innerHTML='<h2>Laptops</h2><button data-t=gaming onclick=complete()>Gaming Laptop</button><button data-t=office>Office Laptop</button>'},700)}</script>`,
  "/steps": `${HEAD}<div id=status></div><h1>Setup wizard</h1><div id=list></div><script>let next=1;function render(){document.getElementById('list').innerHTML=[1,2,3,4,5].map(i=>'<button data-t="step'+i+'" '+(i===next?'':'disabled')+' onclick="go('+i+')">Step '+i+(i<next?' ✓':'')+'</button>').join('')}
    function go(i){if(i!==next)return;next++;setTimeout(()=>{render();if(next>5)complete()},120)}render()</script>`,
  "/ticker": `${HEAD}<div id=status></div><p id=live>Viewers online: 1000</p><h1>Live stream</h1><div id=list></div><script>let n=1000;setInterval(()=>{document.getElementById('live').textContent='Viewers online: '+(n+=Math.floor(Math.random()*9)+1)},200);
    let next=1;function render(){document.getElementById('list').innerHTML=[1,2,3].map(i=>'<button data-t="step'+i+'" '+(i===next?'':'disabled')+' onclick="go('+i+')">Step '+i+(i<next?' ✓':'')+'</button>').join('')}
    function go(i){if(i!==next)return;next++;render();if(next>3)complete()}render()</script>`,
  "/checkout": `${HEAD}<div id=status></div><h1>Cart</h1>${filler(5)}<button data-t=checkout onclick=complete() style="position:absolute;top:660px;left:40px">Checkout</button>
    <script>setTimeout(()=>{const b=document.createElement('div');b.dataset.t='cookie-banner';b.style.cssText='position:fixed;left:0;right:0;bottom:0;height:220px;background:#223;color:#fff;padding:20px;z-index:9';
      b.innerHTML='We use cookies. <button data-t=accept onclick="this.parentNode.remove()">Accept all</button>';document.body.appendChild(b)},300)</script>`,
  "/shift": `${HEAD}<div id=status></div><div id=top></div><h1>Your cart</h1><p>One item: Blue Widget Pro</p><div style="height:120px"></div><button data-t=remove onclick="document.querySelector('h1').textContent='Cart (item removed)'">Remove item</button><div style="height:100px"></div><button data-t=buy onclick=complete()>Buy now</button>
    <script>let shifted=false;addEventListener('mousemove',()=>{if(shifted)return;shifted=true;setTimeout(()=>{const d=document.createElement('div');d.dataset.t='promo';d.style.cssText='height:173px;background:#fd0';d.textContent='Limited offer!';document.getElementById('top').appendChild(d)},30)});</script>`,
  "/feed": `${HEAD}<div id=status></div><h1>Feed</h1><div id=feed></div><script>let liked=0;function render(){document.getElementById('feed').innerHTML=[1,2,3,4,5,6].map(i=>'<article style="border:1px solid #ccc;margin:6px;padding:6px"><h3>Post '+i+'</h3><p>Some words about post '+i+'.</p><button data-t="like'+i+'" onclick="like('+i+')">Like</button></article>').join('')}
    function like(i){liked=i;if(i===3)complete();else document.getElementById('status').textContent='Liked post '+i}render();setInterval(render,400)</script>`,
};

// The "site redesign" scenario switches these pages to version 2 between runs.
let siteVersion = 1;
/** Where Confirm order is in the layout the model first sees (for prompts without positions). */
let coordGuess = { x: 0, y: 0 };
const RESULTS_SCRIPT = (base: string, param: string) => `<script>const q=new URLSearchParams(location.search).get('${param}')||'';
    document.getElementById('r').innerHTML=['Red Widget','Blue Widget Lite','Blue Widget Pro','Green Widget','Widget Stand','Widget Case'].filter(n=>n.toLowerCase().includes(q.split(' ').pop().toLowerCase())).map(n=>'<p><a data-t="'+n.toLowerCase().replace(/ /g,'-')+'" href="${base}'+n.toLowerCase().replace(/ /g,'-')+'">'+n+'</a></p>').join('')</script>`;
const PAGES_V2: Record<string, string | null> = {
  "/shop": `${HEAD}<div id=status></div><h1>Shop (new design)</h1><form action=/find><input name=query data-t=q placeholder="Search the store"> <button data-t=go>Find</button></form>${filler(3)}`,
  "/results": null,
  "/product/blue-widget-pro": null,
  "/find": `${HEAD}<div id=status></div><h1>Results</h1><div id=r></div>${RESULTS_SCRIPT("/item/", "query")}`,
  "/item/blue-widget-pro": `${HEAD}<div id=status>TASK COMPLETE</div><h1>Blue Widget Pro</h1>`,
};
Object.assign(PAGES, {
  "/loopA": `${HEAD}<div id=status></div><h1>Archive page 1</h1>${filler(2)}<a data-t=nextA href=/loopB>Next page</a>`,
  "/loopB": `${HEAD}<div id=status></div><h1>Archive page 2</h1><a data-t=home href=/loopA>Back to start</a>${filler(2)}<a data-t=nextB href=/loopA>Next page</a>`,
  "/blocked": `${HEAD}<div id=status></div><h1>Settings</h1><label><input type=checkbox checked> Email me</label><p><button data-t=save onclick=complete()>Save settings</button></p>
    <div data-t=blocker style="position:fixed;inset:0;opacity:0.01;z-index:50;background:#000"></div>`,
  "/coords": `${HEAD}<div id=status></div><div id=notice></div><h1>Review order</h1><p>Blue Widget Pro x1</p>
    <div style="height:60px"></div><button data-t=cancel style="display:block;margin:10px" onclick="document.querySelector('h1').textContent='Order cancelled'">Cancel order</button>
    <div style="height:70px"></div><button data-t=confirm style="display:block;margin:10px" onclick=complete()>Confirm order</button>
    <script>const t=setInterval(()=>{if(document.querySelector('[data-agent-id]')){clearInterval(t);setTimeout(()=>{const n=document.getElementById('notice');n.style.cssText='height:'+(document.querySelector('[data-t=confirm]').getBoundingClientRect().top-document.querySelector('[data-t=cancel]').getBoundingClientRect().top)+'px;background:#eef';n.textContent='Prices updated'},300)}},20)</script>`,
});

interface Scenario { name: string; start?: string; goal: string; optimal: number; injected?: string; decide(c: Ctx): Choice }

const SEARCH_POLICY = (c: Ctx): Choice => {
  if (completeNow(c)) return done();
  const pro = find(c, /^Blue Widget Pro$/);
  if (pro) return clickOn(pro, "blue-widget-pro");
  if (!c.url || /not found/i.test(c.text)) {
    const sc = shortcut(c, "blue+widget");
    if (sc) return sc;
    if (!/fixture\.test\/shop/.test(c.url)) return { decision: { action: "goto", url: "https://fixture.test/shop" } };
  }
  const box = c.elements.find((e) => e.kind.startsWith("input"));
  return box ? { decision: { action: "type", id: box.id, text: "blue widget", submit: true } } : { decision: { action: "goto", url: "https://fixture.test/shop" } };
};

const ADAPTIVE: Scenario[] = [
  { name: "redesigned-site", optimal: 2, goal: "Search fixture.test for blue widget and open the Blue Widget Pro product page.", decide: SEARCH_POLICY },
  {
    name: "navigation-loop", start: "/loopA", optimal: 0, injected: "pagination that loops back to the start (target never appears)",
    goal: "Go through the archive pages until you find the Finish button, then press it.",
    decide: (c) => {
      const f = find(c, /^Finish$/); if (f) return clickOn(f, "finish");
      const next = find(c, /^Next page$/);
      return next ? clickOn(next, /Archive page 1/.test(c.text) ? "nextA" : "nextB") : { decision: { action: "scroll", direction: "down" } };
    },
  },
  {
    name: "invisible-blocker", start: "/blocked", optimal: 1, injected: "transparent layer over the whole page swallowing pointer clicks",
    goal: "Press the Save settings button and confirm the settings were saved.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const tries = (c.history.match(/"action":"click"/g) || []).length;
      if (tries === 1 && !/dismiss/.test(c.history)) return { decision: { action: "dismiss" } };
      const b = find(c, /^Save settings$/);
      return b ? clickOn(b, "save") : { decision: { action: "wait", seconds: 1 } };
    },
  },
  {
    name: "stale-coordinates", start: "/coords", optimal: 1, injected: "layout shifts while the model is thinking; the model clicks by coordinates",
    goal: "Click Confirm order (by its position on screen) and confirm the order went through.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const b = find(c, /^Confirm order$/);
      const at = b?.rest.match(/@(\d+),(\d+)/);
      // Older prompts carry no positions: use where the button sits in the layout the model saw.
      return { decision: { action: "click", x: at ? Number(at[1]) : coordGuess.x, y: at ? Number(at[2]) : coordGuess.y }, intended: "confirm" };
    },
  },
];

const SCENARIOS: Scenario[] = [
  {
    name: "scroll-to-target", start: "/scroll", optimal: 1, goal: "Scroll down this article and press the Load details button at the end, then confirm it worked.",
    decide: (c) => completeNow(c) ? done() : (find(c, /^Load details$/) ? clickOn(find(c, /^Load details$/)!, "details") : { decision: { action: "scroll", direction: "down" } }),
  },
  {
    name: "search-and-open", optimal: 2, goal: "Search fixture.test for blue widget and open the Blue Widget Pro product page.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const pro = find(c, /^Blue Widget Pro$/);
      if (pro) return clickOn(pro, "blue-widget-pro");
      if (!c.url || /not found/i.test(c.text)) {
        const sc = shortcut(c, "blue+widget");
        if (sc) return sc;
        if (!/fixture\.test\/shop/.test(c.url)) return { decision: { action: "goto", url: "https://fixture.test/shop" } };
      }
      const box = c.elements.find((e) => e.kind.startsWith("input"));
      if (box) return { decision: { action: "type", id: box.id, text: "blue widget", submit: true } };
      return { decision: { action: "scroll", direction: "down" } };
    },
  },
  {
    name: "menu-then-loading", start: "/menu", optimal: 3, injected: "menu portal at end of a 70-link page + 700ms loading state",
    goal: "Open the Products menu, choose Laptops, then open the Gaming Laptop page and confirm.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const g = find(c, /^Gaming Laptop$/); if (g) return clickOn(g, "gaming");
      if (/Loading…/.test(c.text)) return { decision: { action: "wait", seconds: 1 } };
      const l = find(c, /^Laptops$/); if (l) return clickOn(l, "laptops");
      if (/\{"action":"click"[^\n]*-> Clicked "Products"/.test(c.history)) return { decision: { action: "scroll", direction: "down" } };
      const p = find(c, /^Products$/); if (p) return clickOn(p, "products");
      return { decision: { action: "scroll", direction: "down" } };
    },
  },
  {
    name: "consecutive-clicks", start: "/steps", optimal: 5, goal: "Complete the setup wizard by pressing Step 1 through Step 5 in order and confirm it finished.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const next = c.elements.find((e) => /^Step \d$/.test(e.text));
      return next ? clickOn(next, `step${next.text.slice(5)}`) : { decision: { action: "wait", seconds: 1 } };
    },
  },
  {
    name: "live-updating-page", start: "/ticker", optimal: 3, injected: "text that changes every 200ms",
    goal: "On this live page press Step 1, Step 2 and Step 3 in order and confirm it finished.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const next = c.elements.find((e) => /^Step \d$/.test(e.text));
      return next ? clickOn(next, `step${next.text.slice(5)}`) : { decision: { action: "wait", seconds: 1 } };
    },
  },
  {
    name: "overlay-covers-target", start: "/checkout", optimal: 1, injected: "cookie banner covering the button",
    goal: "Press the Checkout button on this cart page and confirm the checkout started.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const tries = (c.history.match(/"action":"click"/g) || []).length;
      if (tries >= 1 && !/dismiss/.test(c.history)) return { decision: { action: "dismiss" } };
      const b = find(c, /^Checkout$/);
      return b ? clickOn(b, "checkout") : { decision: { action: "scroll", direction: "down" } };
    },
  },
  {
    name: "layout-shift", start: "/shift", optimal: 1, injected: "banner inserted on first mouse move, pushing the target down",
    goal: "Press the Buy now button for my cart and confirm the purchase started.",
    decide: (c) => completeNow(c) ? done() : (find(c, /^Buy now$/) ? clickOn(find(c, /^Buy now$/)!, "buy") : { decision: { action: "wait", seconds: 1 } }),
  },
  {
    name: "rerendering-list", start: "/feed", optimal: 1, injected: "list re-rendered every 400ms; six identical Like buttons",
    goal: "Like Post 3 in this feed (only Post 3) and confirm it worked.",
    decide: (c) => {
      if (completeNow(c)) return done();
      const exact = c.elements.find((e) => e.text === "Like" && /Post 3\b/.test(e.rest)) || c.elements.find((e) => /Like.*Post 3\b/.test(e.text));
      if (exact) return clickOn(exact, "like3");
      const any = c.elements.find((e) => e.text === "Like");
      return any ? clickOn(any, "like3") : { decision: { action: "wait", seconds: 1 } };
    },
  },
];

// ---- run -----------------------------------------------------------------------------------

interface TrialLog { llmCalls: number; skipped: number; decisions: { at: number; action: string; intended?: string; skippedPrev?: boolean }[]; clicks: { at: number; t: string; trusted: boolean }[] }
interface TrialResult { scenario: string; trial: string; completed: boolean; claimedDone: boolean; actions: number; unnecessary: number; llmCalls: number; skipped: number;
  clickDecisions: number; correctClicks: number; misclicks: number; missedClicks: number; latenciesMs: number[]; cycleMs: number[]; wallMs: number; paused?: string }

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const p90 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };

async function runTrial(scenario: Scenario, ownerId: string, trial: string): Promise<TrialResult> {
  const { sessions } = await import("@/lib/agent/sessions");
  const { runAgent } = await import("@/lib/agent/runner");
  const chatId = `bench_${scenario.name}_${trial}_${Math.random().toString(36).slice(2, 7)}`;
  const log: TrialLog = { llmCalls: 0, skipped: 0, decisions: [], clicks: [] };
  current = { scenario, log };
  const s = await sessions.open(chatId, ownerId, { fresh: true });
  await s.context.exposeBinding("__benchClick", (_src, c: { t: string; trusted: boolean }) => { log.clicks.push({ at: Date.now(), ...c }); });
  await s.context.route("https://fixture.test/**", (route) => {
    const u = new URL(route.request().url());
    const body = siteVersion === 2 && u.pathname in PAGES_V2 ? PAGES_V2[u.pathname] : PAGES[u.pathname];
    return body ? route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><title>Fixture ${u.pathname}</title></head><body>${body}</body></html>` }) : route.fulfill({ status: 404, body: "not found" });
  });
  if (scenario.start) await s.active().goto(`https://fixture.test${scenario.start}`, { waitUntil: "load" });
  if (scenario.name === "stale-coordinates") {
    coordGuess = await s.active().evaluate(() => { const r = document.querySelector("[data-t=confirm]")!.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  }
  const events: { type: string; reason?: string }[] = [];
  const t0 = Date.now();
  await runAgent({ chatId, ownerId, goal: scenario.goal, signal: new AbortController().signal, emit: (e) => events.push(e as never) });
  const wallMs = Date.now() - t0;
  const statusText = await s.active().evaluate(() => document.getElementById("status")?.textContent || "").catch(() => "");
  await sessions.close(chatId);

  const acts = log.decisions.filter((d) => d.action !== "done");
  const trusted = log.clicks.filter((c) => c.trusted);
  let correct = 0, mis = 0, missed = 0;
  const latencies: number[] = [];
  log.decisions.forEach((d, i) => {
    if (d.action !== "click" || !d.intended) return;
    const until = log.decisions[i + 1]?.at ?? Infinity;
    const hit = trusted.find((c) => c.at >= d.at && c.at < until);
    if (!hit) { missed++; return; }
    latencies.push(hit.at - d.at);
    if (hit.t === d.intended) correct++; else mis++;
  });
  // Executed actions only: decide -> act -> settle -> observe -> next decision (minus the fixed thinking time).
  const cycle = log.decisions.slice(1).flatMap((d, i) => (d.skippedPrev || log.decisions[i].action === "wait" ? [] : [d.at - log.decisions[i].at - THINK_MS]));
  return {
    scenario: scenario.name, trial, completed: /TASK COMPLETE/.test(statusText), claimedDone: events.some((e) => e.type === "done"),
    actions: acts.length, unnecessary: Math.max(0, acts.length - scenario.optimal), llmCalls: log.llmCalls,
    skipped: log.skipped,
    clickDecisions: correct + mis + missed, correctClicks: correct, misclicks: mis, missedClicks: missed,
    latenciesMs: latencies, cycleMs: cycle, wallMs, paused: events.find((e) => e.type === "paused")?.reason?.slice(0, 160),
  };
}

/**
 * BENCH_RTT_MS > 0 runs Chrome behind a WebSocket proxy that delays every DevTools message,
 * like a cloud browser (Browserbase/Steel) where each browser command is a network round trip.
 */
async function startRemoteBrowser(rttMs: number) {
  const { chromium } = await import("playwright");
  const { WebSocketServer, WebSocket } = await import("ws");
  const port = 9300 + Math.floor(Math.random() * 400);
  const chrome = await chromium.launch({ headless: true, channel: "chrome", args: [`--remote-debugging-port=${port}`] }).catch(() => chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] }));
  const info = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (client) => {
    const upstream = new WebSocket(info.webSocketDebuggerUrl, { perMessageDeflate: false });
    const pending: (string | Buffer)[] = [];
    const later = (fn: () => void) => setTimeout(fn, rttMs / 2);
    upstream.on("open", () => { for (const m of pending.splice(0)) upstream.send(m); });
    client.on("message", (m, bin) => later(() => { const data = bin ? m : m.toString(); if (upstream.readyState === 1) upstream.send(data as never); else pending.push(data as never); }));
    upstream.on("message", (m, bin) => later(() => client.readyState === 1 && client.send(bin ? m : m.toString())));
    client.on("close", () => upstream.close()); upstream.on("close", () => client.close());
  });
  const addr = wss.address() as { port: number };
  process.env.BROWSER_CDP_URL = `ws://127.0.0.1:${addr.port}/devtools/browser`;
  return async () => { wss.close(); await chrome.close(); };
}

it("interaction benchmark", async () => {
  const rtt = Number(process.env.BENCH_RTT_MS || 0);
  const stopRemote = rtt > 0 ? await startRemoteBrowser(rtt) : null;
  const label = process.env.BENCH_LABEL || "current";
  const only = (process.env.BENCH_ONLY || "").split(",").filter(Boolean);
  const list = SCENARIOS.filter((s) => !only.length || only.includes(s.name));
  const results: TrialResult[] = [];
  for (const sc of list) {
    for (let t = 1; t <= TRIALS; t++) {
      const r = await runTrial(sc, `o_bench_cold_${sc.name}_${t}`, `cold${t}`);
      results.push(r);
      console.log(`[bench] ${sc.name} cold${t}: ${r.completed ? "OK " : "FAIL"} actions=${r.actions} llm=${r.llmCalls} clicks ${r.correctClicks}/${r.clickDecisions} mis=${r.misclicks} lat=${median(r.latenciesMs)}ms wall=${r.wallMs}ms${r.paused ? ` paused: ${r.paused}` : ""}`);
    }
  }
  // Learning: the same owner repeats a task; the second run can reuse what worked.
  for (const name of ["search-and-open", "overlay-covers-target", "layout-shift"]) {
    const sc = SCENARIOS.find((s) => s.name === name)!;
    if (!list.includes(sc)) continue;
    const owner = `o_bench_warm_${name}`;
    const first = await runTrial(sc, owner, "learn1");
    const second = await runTrial(sc, owner, "learn2");
    results.push(first, second);
    console.log(`[bench] ${name} learning: first actions=${first.actions} wall=${first.wallMs}ms -> second actions=${second.actions} wall=${second.wallMs}ms (${second.completed ? "OK" : "FAIL"})`);
  }

  // Adaptive behaviour: outdated memory after a redesign, loops, blocked pointers, stale coordinates.
  const adaptive: Record<string, unknown> = {};
  if (!only.length || only.includes("adaptive")) {
    const redesign = ADAPTIVE[0];
    const owner = "o_bench_redesign";
    siteVersion = 1;
    const v1 = await runTrial(redesign, owner, "v1-learn");
    siteVersion = 2;
    const v2 = await runTrial(redesign, owner, "v2-after-redesign");
    const v2b = await runTrial(redesign, owner, "v2-relearned");
    siteVersion = 1;
    results.push(v1, v2, v2b);
    adaptive.redesign = [v1, v2, v2b].map((r) => ({ run: r.trial, completed: r.completed, actions: r.actions, wallMs: r.wallMs }));
    console.log(`[bench] redesign: v1 ${v1.actions} actions -> v2 ${v2.actions} (${v2.completed ? "OK" : "FAIL"}) -> v2 again ${v2b.actions} (${v2b.completed ? "OK" : "FAIL"})`);

    const loop = await runTrial(ADAPTIVE[1], "o_bench_loop", "loop");
    results.push(loop);
    adaptive.loop = { actionsBeforeStopping: loop.actions, llmCalls: loop.llmCalls, falseDone: loop.claimedDone, stoppedBy: loop.paused };
    console.log(`[bench] loop: stopped after ${loop.actions} actions (${loop.paused})`);

    const b1 = await runTrial(ADAPTIVE[2], "o_bench_blocker", "blocker1");
    const b2 = await runTrial(ADAPTIVE[2], "o_bench_blocker", "blocker2");
    results.push(b1, b2);
    adaptive.blocker = [b1, b2].map((r) => ({ run: r.trial, completed: r.completed, actions: r.actions, misclicks: r.misclicks, clickLatencyMs: median(r.latenciesMs), wallMs: r.wallMs }));
    console.log(`[bench] blocker: run1 ${b1.completed ? "OK" : "FAIL"} ${b1.actions} actions lat=${median(b1.latenciesMs)}ms -> run2 ${b2.completed ? "OK" : "FAIL"} ${b2.actions} actions lat=${median(b2.latenciesMs)}ms`);

    const coordRuns = [];
    for (let t = 1; t <= TRIALS; t++) coordRuns.push(await runTrial(ADAPTIVE[3], `o_bench_coords_${t}`, `coords${t}`));
    results.push(...coordRuns);
    adaptive.staleCoordinates = { completed: coordRuns.filter((r) => r.completed).length, runs: coordRuns.length, misclicks: coordRuns.reduce((a, r) => a + r.misclicks, 0) };
    console.log(`[bench] stale coords: ${coordRuns.filter((r) => r.completed).length}/${coordRuns.length} completed, misclicks=${coordRuns.reduce((a, r) => a + r.misclicks, 0)}`);
  }

  const cold = results.filter((r) => r.trial.startsWith("cold"));
  const sum = (f: (r: TrialResult) => number, rs = cold) => rs.reduce((a, r) => a + f(r), 0);
  const recovery = cold.filter((r) => SCENARIOS.find((s) => s.name === r.scenario)?.injected);
  const summary = {
    label, trials: TRIALS, thinkMs: THINK_MS, browserRttMs: rtt, runs: cold.length,
    taskCompletionRate: sum((r) => (r.completed ? 1 : 0)) / cold.length,
    falseDoneClaims: sum((r) => (r.claimedDone && !r.completed ? 1 : 0)),
    targetAccuracy: sum((r) => r.correctClicks) / Math.max(1, sum((r) => r.clickDecisions)),
    misclicks: sum((r) => r.misclicks), missedClicks: sum((r) => r.missedClicks),
    clickLatencyMedianMs: median(cold.flatMap((r) => r.latenciesMs)), clickLatencyP90Ms: p90(cold.flatMap((r) => r.latenciesMs)),
    actionCycleMedianMs: median(cold.flatMap((r) => r.cycleMs)),
    unnecessaryActions: sum((r) => r.unnecessary), totalActions: sum((r) => r.actions), llmCalls: sum((r) => r.llmCalls), skippedSteps: sum((r) => r.skipped),
    recoverySuccessRate: recovery.filter((r) => r.completed).length / Math.max(1, recovery.length),
    medianTaskWallMs: median(cold.map((r) => r.wallMs)),
    adaptive,
    learning: ["search-and-open", "overlay-covers-target", "layout-shift"].map((n) => {
      const a = results.find((r) => r.scenario === n && r.trial === "learn1"), b = results.find((r) => r.scenario === n && r.trial === "learn2");
      return a && b ? { scenario: n, firstActions: a.actions, secondActions: b.actions, firstWallMs: a.wallMs, secondWallMs: b.wallMs, secondCompleted: b.completed } : null;
    }).filter(Boolean),
    perScenario: list.map((sc) => {
      const rs = cold.filter((r) => r.scenario === sc.name);
      return { scenario: sc.name, completed: `${rs.filter((r) => r.completed).length}/${rs.length}`, medianActions: median(rs.map((r) => r.actions)), misclicks: sum((r) => r.misclicks, rs),
        medianClickLatencyMs: median(rs.flatMap((r) => r.latenciesMs)), medianWallMs: median(rs.map((r) => r.wallMs)), llmCalls: sum((r) => r.llmCalls, rs) };
    }),
  };
  const dir = path.resolve("test-results/interaction-bench");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await stopRemote?.();
}, 60 * 60_000);
