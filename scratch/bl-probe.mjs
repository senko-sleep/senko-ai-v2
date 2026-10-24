import { config } from "dotenv"; config({ path: ".env.local", quiet: true });
import { chromium } from "playwright";
const u = new URL("wss://production-sfo.browserless.io"); u.searchParams.set("token", process.env.BROWSERLESS_TOKEN || ""); u.searchParams.set("timeout", process.argv[2] || "120000");
try {
  const b = await chromium.connectOverCDP(u.toString(), { timeout: 30000 });
  const ctx = b.contexts()[0] || await b.newContext(); const p = await ctx.newPage();
  await p.goto("https://ipinfo.io/json", { timeout: 30000 });
  const j = JSON.parse(await p.evaluate(() => document.body.innerText));
  console.log("browserless ok", b.version(), j.city, j.region, j.country);
  const cdp = await ctx.newCDPSession(p); let n = 0; cdp.on("Page.screencastFrame", f => { n++; cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await p.goto("https://senko-ai.wasmer.app/test-fixtures/motion"); await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60 }); await p.waitForTimeout(3000); console.log("screencast fps (to this PC)", n / 3);
  await b.close();
} catch (e) { console.log("browserless failed:", String(e.message).split("\n")[0]); }
