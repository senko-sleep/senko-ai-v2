// Small pages the test suite points the agent at. Served at /test-fixtures/<name>.

const POPUPS = `<!doctype html>
<html><head><meta charset="utf-8"><title>Daily Gadget News</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f6;color:#222}
  header{background:#222;color:#fff;padding:14px 24px;font-size:20px}
  main{max-width:720px;margin:24px auto;background:#fff;padding:24px;border-radius:12px}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:10}
  .modal{background:#fff;padding:28px;border-radius:14px;width:380px;position:relative;text-align:center}
  .modal button.x{position:absolute;top:8px;right:10px;border:0;background:none;font-size:24px;cursor:pointer}
  .ad{background:#ffe066;padding:10px;margin:12px 0;border-radius:8px}
  a.continue{display:inline-block;margin-top:16px;padding:10px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none}
</style></head>
<body>
<header>Daily Gadget News</header>
<main id="main"></main>
<script>
  const stage = new URLSearchParams(location.search).get("stage");
  const main = document.getElementById("main");
  if (!stage) {
    // 1. Redirect hop
    main.textContent = "Redirecting…";
    setTimeout(() => location.replace(location.pathname + "?stage=landing"), 600);
  } else if (stage === "landing") {
    main.innerHTML = '<h1>Ten gadgets you need this year</h1><div class="ad">ADVERTISEMENT: You won a prize!!! Click anywhere!</div>' +
      '<p>Our editors picked the best gadgets of the year. Read the full article to see the list.</p>' +
      '<a class="continue" href="?stage=article">Continue to article</a>';
    // 2. Pop-up on first click (pop-under ad pattern)
    let fired = false;
    document.addEventListener("click", () => { if (!fired) { fired = true; window.open("about:blank#ad-popup", "_blank", "width=400,height=400"); } }, true);
    // 3. Newsletter overlay covering the page
    const o = document.createElement("div");
    o.className = "overlay";
    o.innerHTML = '<div class="modal"><button class="x" aria-label="Close">×</button><h2>Subscribe to our newsletter!</h2><p>Get gadget news every day.</p><input placeholder="Email"><button>Subscribe</button></div>';
    o.querySelector(".x").addEventListener("click", () => o.remove());
    setTimeout(() => document.body.appendChild(o), 300);
  } else {
    main.innerHTML = '<h1>Ten gadgets you need this year</h1><p>Thanks for reading. The secret code is <b>4217-KIWI</b>.</p>';
  }
</script>
</body></html>`;

const SIMPLE = `<!doctype html><html><head><meta charset="utf-8"><title>Senko test page</title></head>
<body style="font-family:system-ui;padding:40px"><h1>Senko test page</h1><p>This page exists so tests can open a known site.</p></body></html>`;

// Constant motion (like a playing video), for checking the live view's frame rate offline.
const MOTION = `<!doctype html><html><head><meta charset="utf-8"><title>Senko motion test</title>
<style>html,body{margin:0;height:100%;background:#111;color:#fff;font-family:system-ui}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas><script>
  const c = document.getElementById("c"), x = c.getContext("2d");
  let n = 0;
  function f(t) {
    c.width = innerWidth; c.height = innerHeight;
    x.fillStyle = "hsl(" + (t / 20 % 360) + ",60%,25%)"; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#ff8a3d"; x.beginPath();
    x.arc(c.width / 2 + Math.sin(t / 400) * c.width / 3, c.height / 2 + Math.cos(t / 300) * c.height / 4, 60, 0, 7); x.fill();
    x.fillStyle = "#fff"; x.font = "28px system-ui"; x.fillText("frame " + (++n), 30, 50);
    requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
</script></body></html>`;

export const FIXTURES: Record<string, string> = {
  popups: POPUPS,
  simple: SIMPLE,
  motion: MOTION,
};
