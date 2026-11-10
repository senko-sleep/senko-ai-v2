import { chromium } from "playwright";
import fs from "node:fs";
// Screenshot a saved UI reply through the real renderer: node scripts/screenshot-ui.mjs <case> <outPrefix> [widths]
// COOKIE=path/to/cookie.json lets the browser load an owner's stored images.
const [,, name = "chat-path", out = "scratch/ui", widths = "1280,390"] = process.argv;
const browser = await chromium.launch();
for (const w of widths.split(",").map(Number)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: "dark" });
  if (process.env.COOKIE) { const c = JSON.parse(fs.readFileSync(process.env.COOKIE, "utf8")); await ctx.addCookies([{ ...c, url: `http://localhost:${process.env.PORT || 3000}` }]); }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:${process.env.PORT || 3000}/test-fixtures/ui-renderer?case=${name}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=artifact-scope]")?.textContent?.startsWith("Loading"), null, { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  const unavailable = await page.locator("text=Image unavailable").count();
  await page.screenshot({ path: `${out}-${w}.png`, fullPage: true });
  // TABS="Story,Connections,Gallery" also captures each profile tab.
  for (const tab of (process.env.TABS || "").split(",").filter(Boolean)) {
    const button = page.getByRole("tab", { name: new RegExp(`^${tab}`) }).first();
    if (!(await button.count())) continue;
    await button.click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    await page.locator(".pf").first().screenshot({ path: `${out}-${w}-${tab.toLowerCase()}.png` });
  }
  console.log(JSON.stringify({ w, images: await page.evaluate(() => document.images.length), broken, unavailable, errors: errors.slice(0, 5) }));
}
await browser.close();
