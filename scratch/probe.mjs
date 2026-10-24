// Exploratory UI probe of the deployed app: opens the live browser like a user would.
import { chromium } from "playwright";
const base = process.argv[2] || "https://senko-ai.wasmer.app";
const out = process.argv[3] || ".";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__ev = { frame: 0, cursor: 0, status: 0, reset: 0, other: 0, firstFrameAt: 0, urls: [] };
  const ES = window.EventSource;
  window.EventSource = class extends ES {
    constructor(u, o) {
      super(u, o);
      window.__ev.urls.push(String(u));
      this.addEventListener("message", (m) => {
        try { const t = JSON.parse(m.data).type; window.__ev[t in window.__ev ? t : "other"]++; if (t === "frame" && !window.__ev.firstFrameAt) window.__ev.firstFrameAt = performance.now(); } catch {}
      });
    }
  };
});
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text().slice(0, 200)); });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.getByRole("radio", { name: "Agent" }).waitFor({ timeout: 60000 });
log("app ready");
const models = await page.locator('select[aria-label="AI model"] option').allTextContents();
log("models:", models.join(" | "));
await page.getByRole("radio", { name: "Agent" }).click();
const box = page.locator("textarea").first();
await box.fill(`Open ${base}/test-fixtures/motion and tell me the page title.`);
await box.press("Enter");
log("task sent");
const canvas = page.locator(".sk-live-view canvas");
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const ev = await page.evaluate(() => window.__ev);
  const ctl = await page.locator("[data-browser-control]").textContent().catch(() => null);
  const status = await page.locator('section[aria-label="Live browser"]').innerText().catch(() => "");
  log(JSON.stringify({ frame: ev.frame, cursor: ev.cursor, status: ev.status, reset: ev.reset, ctl }), status.split("\n").slice(0, 3).join(" / ").slice(0, 160));
  if (i % 10 === 0) await page.screenshot({ path: `${out}/probe-${i}.png` });
  if (ctl && /Done|Interact/.test(ctl) && ev.frame > 30 && !/Stop/.test(status)) break;
}
await page.screenshot({ path: `${out}/probe-final.png` });
const ev = await page.evaluate(() => window.__ev);
log("stream urls:", ev.urls);
// frame rate over 5s
const f1 = ev.frame; await page.waitForTimeout(5000); const f2 = (await page.evaluate(() => window.__ev)).frame;
log("fps over 5s:", (f2 - f1) / 5);
await browser.close();
