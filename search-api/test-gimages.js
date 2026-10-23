const puppeteer = require('puppeteer');
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function googleImagesViaBrowser(query, pageNum = 1) {
  const results = [];
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const bpage = await browser.newPage();
    await bpage.setUserAgent(UA);
    await bpage.setViewport({ width: 1366, height: 900 });
    const offset = (pageNum - 1) * 100;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&hl=en&start=${offset}&safe=off&udm=2`;
    console.log('navigating', url);
    await bpage.goto(url, { waitUntil: "networkidle2", timeout: 25000 }).catch((e) => console.log('goto err', e.message));
    await new Promise((r) => setTimeout(r, 3000));
    const data = await bpage.evaluate(() => {
      const out = [];
      const scripts = Array.from(document.querySelectorAll("script")).map((s) => s.textContent || "");
      const blob = scripts.join("\n");
      const re = /"ou":"(https?:\/\/[^"]+)"/g;
      let m;
      while ((m = re.exec(blob)) !== null) out.push(m[1]);
      document.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        if (/^https?:\/\//.test(src) && !/encrypted-tbn|gstatic\.com/.test(src)) out.push(src);
      });
      return { ou: out, bodyLen: document.body ? document.body.innerHTML.length : 0, title: document.title };
    });
    console.log('title:', data.title, 'bodyLen:', data.bodyLen, 'ou candidates:', data.ou.length);
    const valid = (u) => /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(u) && !/encrypted-tbn|gstatic\.com|googleusercontent/.test(u);
    const seen = new Set();
    for (const u of data.ou) {
      if (valid(u) && !seen.has(u)) { seen.add(u); results.push(u); }
    }
    console.log('VALID GOOGLE IMAGES:', results.length);
    results.slice(0, 5).forEach((u) => console.log('  ', u.slice(0, 90)));
  } finally {
    await browser.close();
  }
  return results;
}

googleImagesViaBrowser('cowgirl porn', 1).then((r) => {
  console.log('DONE total', r.length);
  process.exit(0);
}).catch((e) => { console.log('FATAL', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 60000);
