import { chromium } from "playwright";
const base = process.argv[2];
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.addInitScript(() => { const ev = window.__ev = { frame: 0, audio: 0, last: null }; const ES = window.EventSource; window.EventSource = class extends ES { constructor(u, o) { super(u, o); this.addEventListener("message", m => { try { const e = JSON.parse(m.data); if (e.type in ev) ev[e.type]++; if (e.type === "status") ev.last = e; } catch {} }); } }; });
await page.goto(base); await page.getByRole("radio", { name: "Agent" }).click();
const box = page.locator("textarea").first(); await box.fill("Open https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"); await box.press("Enter");
const panel = page.locator('section[aria-label="Live browser"]');
await panel.getByRole("button", { name: /View only/ }).waitFor({ timeout: 240000 });
const hash = () => panel.locator("canvas").evaluate(c => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) | 0; return h; });
// restart the clip so it is playing now
const nav = async url => { await panel.locator("div.rounded-full > button").first().click(); const t = panel.getByRole("textbox", { name: "Address or search" }); await t.fill(url); await t.press("Enter"); };
await nav("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"); await page.waitForTimeout(2500);
const f0 = (await page.evaluate(() => window.__ev)).frame; const h1 = await hash(); await page.waitForTimeout(1500); const h2 = await hash(); const f1 = (await page.evaluate(() => window.__ev)).frame;
console.log("video: picture changing", h1 !== h2, "frames in 1.5s", f1 - f0);
await page.screenshot({ path: "test-results/production-ui/media-video.png" });
const a0 = (await page.evaluate(() => window.__ev)).audio;
await nav("https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3");
let playing = null; for (let i = 0; i < 20 && !playing; i++) { await page.waitForTimeout(250); const s = await page.evaluate(() => { const a = window.__senkoLiveAudio; return a ? { t: a.currentTime, paused: a.paused } : null; }); if (s && !s.paused && s.t > 0.2) playing = s; }
console.log("audio chunks", (await page.evaluate(() => window.__ev)).audio - a0, "panel playing", JSON.stringify(playing));
await page.waitForTimeout(2500);
console.log("sound button", await panel.getByRole("button", { name: /Mute|Unmute|Turn on sound/ }).isVisible());
await b.close();
