const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = []; p.on("console", m => { if (m.type()==="error") errs.push(m.text().slice(0,200)); });
  await p.goto("http://localhost:3001/code/demo", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: "scratch/ws-before.png" });
  console.log(JSON.stringify(errs.slice(0,5)));
  await b.close();
})();
