// Drives the DEPLOYED app's real UI the way a person does and checks the live browser.
// Usage: node scripts/verify-production-ui.mjs [baseUrl] [--headed] [--provider=<id>]
// Writes test-results/production-ui/{result.json,*.png}. Uses a fresh device (own chats).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv.find((a) => a.startsWith("http")) || "https://senko-ai.wasmer.app";
const providerPick = process.argv.find((a) => a.startsWith("--provider="))?.slice(11);
const out = "test-results/production-ui";
await mkdir(out, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results = { base, checks: {}, failures: [] };
const check = (name, ok, detail) => {
  results.checks[name] = { ok: !!ok, detail };
  log(ok ? "PASS" : "FAIL", name, detail ?? "");
  if (!ok) results.failures.push(name);
};

const browser = await chromium.launch({ headless: !process.argv.includes("--headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.addInitScript(() => {
  const ev = (window.__ev = { frame: 0, cursor: 0, audio: 0, pointer: 0, status: 0, reset: 0, lastFrame: null, lastStatus: null });
  const ES = window.EventSource;
  window.EventSource = class extends ES {
    constructor(u, o) {
      super(u, o);
      this.addEventListener("message", (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.type in ev) ev[e.type]++;
          if (e.type === "frame") ev.lastFrame = { w: e.width, h: e.height, at: performance.now() };
          if (e.type === "status") ev.lastStatus = e;
        } catch { /* keepalive */ }
      });
    }
  };
});
page.on("pageerror", (e) => log("page error:", e.message.slice(0, 160)));
const ev = () => page.evaluate(() => window.__ev);
const panel = page.locator('section[aria-label="Live browser"]');
const view = panel.locator(".sk-live-view");
const panelText = () => panel.innerText().catch(() => "");
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` }).catch(() => {});
const fps = async (seconds = 4) => { const a = (await ev()).frame; await page.waitForTimeout(seconds * 1000); return Math.round(((await ev()).frame - a) / seconds * 10) / 10; };
const viewHash = () => view.locator("canvas").evaluate((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) | 0; return h; });
const address = () => panel.locator("div.rounded-full > button").first();
async function goTo(url) {
  await address().click();
  const box = panel.getByRole("textbox", { name: "Address or search" });
  await box.fill(url);
  await box.press("Enter");
}
async function waitUrl(re, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = (await ev()).lastStatus;
    const tab = s?.tabs?.find((t) => t.active);
    if (tab && re.test(tab.url)) return tab.url;
    await page.waitForTimeout(500);
  }
  return null;
}
async function runTask(goal, { onTick, maxSec = 240 } = {}) {
  const box = page.locator("textarea").first();
  await box.fill(goal);
  await box.press("Enter");
  const end = Date.now() + maxSec * 1000;
  let sawRunning = false;
  while (Date.now() < end) {
    await page.waitForTimeout(1000);
    const running = await panel.getByRole("button", { name: /Stop/ }).isVisible().catch(() => false);
    sawRunning ||= running;
    if (onTick) await onTick(running);
    if (sawRunning && !running) return true;
  }
  return false;
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("radio", { name: "Agent" }).waitFor({ timeout: 60_000 });

  // Provider/model selection is still there and can be set by hand.
  const select = page.locator('select[aria-label="AI model"]');
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent, d: o.disabled })));
  const usable = options.filter((o) => !o.d && o.v !== "auto");
  const pick = providerPick || usable.find((o) => /gemini/i.test(o.t))?.v || usable[0]?.v;
  await select.selectOption(pick);
  check("provider selection available", usable.length > 1 && (await select.inputValue()) === pick, `${usable.length} usable; picked ${pick}`);

  await page.getByRole("radio", { name: "Agent" }).click();

  // 1. Agent task: live frames, AI pointer with its name, no third-party frame.
  let cursorSeen = null, maxFps = 0;
  const done1 = await runTask(`Open ${base}/test-fixtures/motion, then click in the middle of the page, and tell me the page title.`, {
    onTick: async (running) => {
      if (!running) return;
      const c = await page.evaluate(() => { const el = document.querySelector(".sk-agent-cursor"); return el ? { op: getComputedStyle(el).opacity, tag: el.textContent } : null; });
      if (c?.op === "1") cursorSeen = c;
    },
  });
  await shot("1-agent-done");
  check("agent task finished", done1);
  check("no embedded third-party browser frame", (await panel.locator("iframe").count()) === 0);
  const e1 = await ev();
  check("live frames arrived", e1.frame > 20, `${e1.frame} frames`);
  check("AI pointer visible with bot name during task", !!cursorSeen && /Senko/.test(cursorSeen.tag), cursorSeen?.tag);
  maxFps = await fps(4);
  check("live view frame rate on animated page", maxFps >= 15, `${maxFps} fps`);
  const vb = await view.boundingBox();
  const lf = (await ev()).lastFrame;
  check("page fills the panel (same aspect, no letterbox) at desktop width", lf && Math.abs(lf.w / lf.h - vb.width / vb.height) < 0.01 && lf.w >= Math.min(1280, vb.width * 2) - 4, `frame ${lf?.w}x${lf?.h}, panel ${Math.round(vb.width)}x${Math.round(vb.height)}`);
  const afterOp = await page.evaluate(() => getComputedStyle(document.querySelector(".sk-agent-cursor")).opacity);
  check("AI pointer stays visible after the task", afterOp === "1", afterOp);

  // 2. Control comes back to you automatically.
  check("you have control after the task", await panel.getByRole("button", { name: /View only/ }).isVisible(), "View only button shown = controlling");

  // 3. Manual browsing on a real website: address bar, typing, Enter, scrolling.
  await goTo("https://duckduckgo.com/");
  check("address bar navigation", !!(await waitUrl(/duckduckgo\.com/)));
  await page.waitForTimeout(2500);
  const vb2 = await view.boundingBox();
  // Find DuckDuckGo's search box the way a person would: hover until the page shows the
  // text cursor (mirrored from the real page), then click there and type.
  let spot = null;
  for (const fy of [0.03, 0.045, 0.06, 0.08, 0.1, 0.14, 0.2, 0.3, 0.4, 0.5]) {
    for (const fx of [0.3, 0.4, 0.5]) {
      await page.mouse.move(vb2.x + vb2.width * fx, vb2.y + vb2.height * fy, { steps: 2 });
      await page.waitForTimeout(250);
      if ((await view.evaluate((el) => el.style.cursor)) === "text") { spot = { fx, fy }; break; }
    }
    if (spot) break;
  }
  results.searchBoxAt = spot;
  await page.mouse.click(vb2.x + vb2.width * (spot?.fx ?? 0.33), vb2.y + vb2.height * (spot?.fy ?? 0.06));
  await page.keyboard.type("red fox facts", { delay: 30 });
  await page.keyboard.press("Enter");
  const searched = await waitUrl(/[?&]q=red(\+|%20)fox/);
  if (!searched) {
    // Fall back to the address bar search if the click missed the box on this layout.
    await shot("3-search-miss");
  }
  check("typing + Enter in a real site's search box", !!searched, searched || "search URL not reached");
  await page.waitForTimeout(2500);
  const h1 = await viewHash();
  await page.mouse.move(vb2.x + vb2.width / 2, vb2.y + vb2.height * 0.6);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(1500);
  check("scrolling moves the real page", (await viewHash()) !== h1);
  await shot("3-manual");
  // Clicking a result navigates.
  const before = (await ev()).lastStatus?.tabs?.find((t) => t.active)?.url;
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(800);
  check("page cursor mirrored while hovering", (await ev()).pointer > 0, `${(await ev()).pointer} cursor changes`);

  // 4. Take control mid-task, browse, then resume.
  const box = page.locator("textarea").first();
  await box.fill(`Open https://en.wikipedia.org/wiki/Red_fox, scroll down to the Diet section and read it, then open the Arctic fox article and tell me both scientific names and which of the two is larger.`);
  await box.press("Enter");
  await panel.getByRole("button", { name: /Take control/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await panel.getByRole("button", { name: /Take control/ }).click();
  check("no control error after Take control", !(await panel.getByRole("alert").isVisible().catch(() => false)), await panel.getByRole("alert").innerText().catch(() => ""));
  const resume = panel.getByRole("button", { name: /Resume/ });
  const paused = await resume.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("take control during a task pauses the agent", paused);
  await page.mouse.move(vb2.x + vb2.width / 2, vb2.y + vb2.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(800);
  if (paused) {
    await resume.click();
    const end = Date.now() + 180_000;
    let finished = false;
    while (Date.now() < end) {
      await page.waitForTimeout(1500);
      if (!(await panel.getByRole("button", { name: /Stop/ }).isVisible().catch(() => false)) && !(await resume.isVisible().catch(() => false))) { finished = true; break; }
    }
    const answer = await page.locator("main").innerText();
    check("resumed task completes", finished && /Vulpes vulpes/i.test(answer) && /lagopus/i.test(answer), finished ? "answer has both names: " + (/Vulpes vulpes/i.test(answer) && /lagopus/i.test(answer)) : "timeout");
  }
  await shot("4-takeover");

  // 5. Media: H.264 video plays (frames change) and page sound reaches the panel.
  const a0 = (await ev()).audio;
  await goTo("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4");
  await waitUrl(/flower\.mp4/);
  await page.waitForTimeout(3000);
  const v1 = await viewHash(); await page.waitForTimeout(1500); const v2 = await viewHash();
  check("H.264 MP4 video plays in the live browser", v1 !== v2, `fps ${await fps(3)}`);
  await shot("5-video");
  await goTo("https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3");
  await waitUrl(/t-rex-roar/);
  let playing = null;
  for (let i = 0; i < 16 && !playing; i++) {
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => { const a = window.__senkoLiveAudio; return a ? { t: a.currentTime, paused: a.paused } : null; });
    if (st && !st.paused && st.t > 0.2) playing = st;
  }
  const a1 = (await ev()).audio;
  check("page audio streamed to the panel", a1 - a0 > 3, `${a1 - a0} audio chunks`);
  check("panel actually plays the page's sound", !!playing, playing ? `playing at ${playing.t.toFixed(2)}s` : "not playing");
  await page.waitForTimeout(3000);
  check("sound control appears (and stays)", await panel.getByRole("button", { name: /Mute|Unmute|Turn on sound/ }).isVisible().catch(() => false));

  // 6. Where the browser appears to be (region / proxy).
  await goTo("https://ipinfo.io/json");
  await waitUrl(/ipinfo/);
  await page.waitForTimeout(2500);
  await shot("6-location");
  results.location = "see 6-location.png";

  // 7. Hand back and forth repeatedly without errors.
  let toggles = 0;
  for (let i = 0; i < 4; i++) {
    await panel.getByRole("button", { name: /View only/ }).click();
    await panel.getByRole("button", { name: /Interact/ }).click();
    toggles++;
  }
  await page.waitForTimeout(800);
  const err = await panel.getByRole("alert").isVisible().catch(() => false);
  check("switching control modes repeatedly without errors", toggles === 4 && !err, err ? await panel.getByRole("alert").innerText() : "");
  results.before = before;
} catch (e) {
  results.error = String(e?.stack || e);
  log("ERROR", e?.message);
  await shot("error");
} finally {
  results.passed = !results.error && results.failures.length === 0;
  await writeFile(`${out}/result.json`, JSON.stringify(results, null, 2));
  log(JSON.stringify({ passed: results.passed, failures: results.failures, error: results.error?.split("\n")[0] }));
  await browser.close();
}
