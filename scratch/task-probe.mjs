// Runs one agent task through the real UI and reports the answer, final URL and a screenshot.
import { chromium } from "playwright";
const [base, goal, shotName] = [process.argv[2], process.argv[3], process.argv[4] || "task"];
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.addInitScript(() => { window.__last = null; const ES = window.EventSource; window.EventSource = class extends ES { constructor(u, o) { super(u, o); this.addEventListener("message", m => { try { const e = JSON.parse(m.data); if (e.type === "status") window.__last = e; } catch {} }); } }; });
const t0 = Date.now();
await page.goto(base); await page.getByRole("radio", { name: "Agent" }).click();
const box = page.locator("textarea").first(); await box.fill(goal); await box.press("Enter");
const panel = page.locator('section[aria-label="Live browser"]');
await panel.getByRole("button", { name: /Stop/ }).waitFor({ timeout: 60000 });
await panel.getByRole("button", { name: /Stop/ }).waitFor({ state: "hidden", timeout: 300000 });
await page.waitForTimeout(1500);
const steps = await panel.locator("li").allInnerTexts().catch(() => []);
const answer = (await page.locator("main").innerText()).split("\n").slice(-12).join(" | ");
const url = await page.evaluate(() => window.__last?.tabs?.find(t => t.active)?.url);
const title = await page.locator("main header").innerText().catch(() => "");
await page.screenshot({ path: `test-results/production-ui/${shotName}.png` });
console.log(JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), url, title: title.split("\n")[0], answer: answer.slice(0, 600) }, null, 1));
await b.close();
