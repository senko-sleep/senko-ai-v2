const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const URL = "https://hanime.tv/videos/hentai/asa-kara-zusshiri-milk-pot-2";

(async () => {
  const b = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const p = await b.newPage();
  await p.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Track ALL .mp4/.m3u8 network requests
  const vids = [];
  const seen = new Set();
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url();
    if (/\.mp4\b|\.m3u8\b|\.webm\b/i.test(u) && !/blank|black_screen/i.test(u)) {
      if (!seen.has(u)) {
        seen.add(u);
        vids.push(u);
        console.log("[NET]", u.slice(0, 200));
      }
    }
    r.continue();
  });

  console.log("1. Navigating...");
  await p.goto(URL, { waitUntil: "networkidle2", timeout: 25000 }).catch(() => console.log("timeout"));

  console.log("2. Wait 5s for Vue app to decode manifest...");
  await new Promise((r) => setTimeout(r, 5000));

  // Strategy A: Try to extract decrypted URL from Vue app state
  console.log("3. Extracting from Vue state...");
  const vueResult = await p.evaluate(() => {
    try {
      const app = document.querySelector("#app");
      if (!app || !app.__vue__) return { err: "no vue app" };
      const vue = app.__vue__;

      // Walk children to find the video component
      function findVideoComponent(comp) {
        if (comp.selected_video_stream) return comp;
        if (comp.normalized_sources) return comp;
        if (comp.$children) {
          for (const child of comp.$children) {
            const found = findVideoComponent(child);
            if (found) return found;
          }
        }
        return null;
      }

      const videoComp = findVideoComponent(vue);
      if (videoComp) {
        return {
          selectedStream: videoComp.selected_video_stream
            ? { url: videoComp.selected_video_stream.url, slug: videoComp.selected_video_stream.slug }
            : null,
          sources: videoComp.normalized_sources
            ? videoComp.normalized_sources.map((s) => ({ src: s.src, type: s.type }))
            : null,
          allStreams: videoComp.all_useable_video_streams
            ? videoComp.all_useable_video_streams.map((s) => ({ url: s.url, height: s.height, slug: s.slug }))
            : null,
        };
      }

      // Try accessing store directly
      const store = vue.$store;
      if (store && store.state && store.state.data && store.state.data.video) {
        const manifest = store.state.data.video.videos_manifest;
        return {
          manifest: manifest ? JSON.stringify(manifest).slice(0, 2000) : "no manifest",
          storeKeys: Object.keys(store.state.data.video),
        };
      }

      return { err: "no video component found", childCount: vue.$children?.length };
    } catch (e) {
      return { err: e.message };
    }
  });
  console.log("Vue result:", JSON.stringify(vueResult, null, 2));

  // Strategy B: Click play in omni-player iframe and wait for video to load
  console.log("4. Clicking play in omni-player...");
  for (const f of p.frames()) {
    if (f.url().includes("omni-player")) {
      try {
        await f.evaluate(() => {
          const els = document.querySelectorAll(
            "video, .vjs-big-play-button, .vjs-poster, [class*='play'], button"
          );
          els.forEach((e) => e.click());
        });
        console.log("   Clicked in omni-player!");
      } catch (e) {
        console.log("   Click error:", e.message?.slice(0, 100));
      }
    }
  }

  console.log("5. Waiting 15s for video to load after click...");
  await new Promise((r) => setTimeout(r, 15000));

  // Check Vue state again after video loads
  const vueResult2 = await p.evaluate(() => {
    try {
      const app = document.querySelector("#app");
      if (!app || !app.__vue__) return { err: "no vue" };
      function findVideoComponent(comp) {
        if (comp.selected_video_stream) return comp;
        if (comp.$children) {
          for (const child of comp.$children) {
            const found = findVideoComponent(child);
            if (found) return found;
          }
        }
        return null;
      }
      const vc = findVideoComponent(app.__vue__);
      if (vc) {
        return {
          selectedUrl: vc.selected_video_stream?.url,
          sources: vc.normalized_sources?.map((s) => ({ src: s.src, type: s.type })),
          allStreams: vc.all_useable_video_streams?.map((s) => ({ url: s.url, height: s.height })),
        };
      }
      return { err: "still no video comp" };
    } catch (e) {
      return { err: e.message };
    }
  });
  console.log("Vue result after click:", JSON.stringify(vueResult2, null, 2));

  console.log("\n6. Network videos found:", vids.length);
  const real = vids.filter((u) => !/adtng|afcpatrk|aftrk/i.test(u));
  console.log("Real (non-ad) videos:", real);
  console.log("All videos:", vids);

  await b.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
