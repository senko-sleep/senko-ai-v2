import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:3000";
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("requestfailed", r => console.log("FAILED", r.method(), r.url().replace(base, ""), r.failure()?.errorText));
page.on("console", m => m.type() === "error" && console.log("console:", m.text().slice(0, 150)));
await page.goto(base); await page.getByRole("radio", { name: "Agent" }).click();
const box = page.locator("textarea").first(); await box.fill(`Open ${base}/test-fixtures/simple`); await box.press("Enter");
const panel = page.locator('section[aria-label="Live browser"]');
await panel.getByRole("button", { name: /View only/ }).waitFor({ timeout: 120000 });
for (let i = 0; i < 8; i++) {
  await panel.getByRole("button", { name: /View only/ }).click();
  await panel.getByRole("button", { name: /Interact/ }).click();
}
await page.waitForTimeout(1500);
console.log("alert:", await panel.getByRole("alert").innerText().catch(() => "none"));
await b.close();
