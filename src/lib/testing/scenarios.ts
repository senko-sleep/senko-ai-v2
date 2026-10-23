// The test suite: real AI providers, real browser, real database. Each scenario is
// run from the hidden Test Panel (/tests) or from the command line (npm run test:e2e).
import { complete, listProviders } from "@/lib/llm";
import { parseBrowserCommand } from "@/lib/browser-commands";
import { sessions, liveInfo } from "@/lib/agent/sessions";
import { getBrowser } from "@/lib/agent/browser";
import { registerRun, finishRun, runAgent, videoState, type RunEvent } from "@/lib/agent/runner";
import { createChat, saveImage } from "@/lib/server/chats";
import { reply } from "@/lib/server/reply";
import { audioAvailable, probeAudio } from "@/lib/agent/audio";

export type TestStatus = "pass" | "fail" | "skip";

export interface TestCtx {
  ownerId: string;
  log: (msg: string) => void;
  shot: (label: string, jpegOrPng: Buffer, mime?: string) => void;
  fixtureUrl: (name: string, query?: string) => string;
  signal: AbortSignal;
  params: Record<string, string>;
}

export interface Scenario {
  id: string;
  group: "Chat" | "Images" | "Browser actions" | "Agent" | "Sessions" | "Video";
  title: string;
  description: string;
  /** Rough duration, shown in the panel. */
  expected: string;
  run: (ctx: TestCtx) => Promise<{ status: TestStatus; summary: string }>;
}

// ---- helpers ---------------------------------------------------------------------------

async function newChat(ctx: TestCtx, title: string) {
  return (await createChat(ctx.ownerId, `[test] ${title}`)).id;
}

async function say(ctx: TestCtx, chatId: string, content: string, imageIds: string[] = [], simulateFail?: string[]) {
  ctx.log(`You: ${content}${imageIds.length ? ` (+${imageIds.length} image)` : ""}`);
  const m = await reply({ ownerId: ctx.ownerId, chatId, content, imageIds, signal: ctx.signal, simulateFail });
  if (m.meta.error && !m.content) throw new Error(m.meta.error);
  ctx.log(`AI (${m.meta.providerLabel} · ${m.meta.model}): ${m.content.slice(0, 400)}`);
  return m;
}

interface AgentResult {
  answer: string;
  url?: string;
  imageIds: string[];
  steps: { label: string; status: string; detail?: string }[];
  error?: string;
}

async function agent(ctx: TestCtx, chatId: string, goal: string): Promise<AgentResult> {
  ctx.log(`Agent goal: ${goal}`);
  const ctl = registerRun(chatId, goal);
  const stopOnAbort = () => ctl.abort("stopped");
  ctx.signal.addEventListener("abort", stopOnAbort, { once: true });
  const res: AgentResult = { answer: "", imageIds: [], steps: [] };
  const emit = (e: RunEvent) => {
    if (e.type === "step" && e.status !== "running") {
      res.steps.push({ label: e.label, status: e.status, detail: e.detail });
      ctx.log(`  ${e.status === "done" ? "✓" : "✗"} ${e.label}${e.detail ? ` — ${e.detail}` : ""}`);
    }
    if (e.type === "plan") ctx.log(`  Plan: ${e.steps.join(" → ")}`);
    if (e.type === "done") {
      res.answer = e.answer;
      res.url = e.url;
      res.imageIds = e.imageIds;
    }
    if (e.type === "error") res.error = e.message;
  };
  try {
    await runAgent({ chatId, ownerId: ctx.ownerId, goal, signal: ctl.signal, emit });
  } finally {
    finishRun(chatId, ctl);
    ctx.signal.removeEventListener("abort", stopOnAbort);
  }
  const s = sessions.get(chatId);
  if (s) ctx.shot("Browser after the task", await s.screenshot(70).catch(() => Buffer.alloc(0)));
  ctx.log(`Agent answer: ${res.answer || res.error}`);
  if (res.error) throw new Error(res.error);
  return res;
}

const has = (text: string, ...needles: (string | RegExp)[]) =>
  needles.every((n) => (typeof n === "string" ? text.toLowerCase().includes(n.toLowerCase()) : n.test(text)));

function verdict(ok: boolean, pass: string, fail: string) {
  return { status: (ok ? "pass" : "fail") as TestStatus, summary: ok ? pass : fail };
}

/** Render HTML to a PNG (used to make test images with known content). */
async function render(html: string, w = 640, h = 400): Promise<Buffer> {
  const b = await getBrowser();
  const c = await b.newContext({ viewport: { width: w, height: h } });
  try {
    const p = await c.newPage();
    await p.setContent(html);
    return await p.screenshot({ type: "png" });
  } finally {
    await c.close();
  }
}

async function upload(ctx: TestCtx, buf: Buffer, mime: string, label: string) {
  ctx.shot(label, buf, mime);
  return saveImage(ctx.ownerId, mime, buf);
}

async function closeSession(chatId: string) {
  await sessions.close(chatId).catch(() => {});
}

// ---- scenarios ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  // Chat ---------------------------------------------------------------------------
  {
    id: "chat-simple",
    group: "Chat",
    title: "Simple question gets a reply",
    description: "Ask “What is 12 × 12?” and expect 144.",
    expected: "~5s",
    async run(ctx) {
      const chat = await newChat(ctx, "simple");
      const m = await say(ctx, chat, "What is 12 times 12? Reply with just the number.");
      return verdict(has(m.content, "144"), `Replied “${m.content.slice(0, 60)}” via ${m.meta.providerLabel}`, `Reply didn't contain 144: “${m.content.slice(0, 120)}”`);
    },
  },
  {
    id: "chat-context",
    group: "Chat",
    title: "Remembers context across 5 messages",
    description: "Share a name, a color and a pet over several messages, then ask about all three.",
    expected: "~20s",
    async run(ctx) {
      const chat = await newChat(ctx, "context");
      await say(ctx, chat, "Hi! My name is Zephyrine. Just say hi back briefly.");
      await say(ctx, chat, "My favorite color is teal. Short reply please.");
      await say(ctx, chat, "I have a hamster called Biscuit. Short reply please.");
      await say(ctx, chat, "What's 3 plus 4? Short reply.");
      const m = await say(ctx, chat, "Quick quiz: what's my name, my favorite color, and my pet's name?");
      return verdict(has(m.content, "zephyrine", "teal", "biscuit"), "Remembered name, color and pet", `Missing something in: “${m.content.slice(0, 200)}”`);
    },
  },
  {
    id: "chat-fallback",
    group: "Chat",
    title: "Provider fallback",
    description: "Simulate the first provider (Gemini when configured) failing; a reply must still arrive from another provider.",
    expected: "~10s",
    async run(ctx) {
      const first = (await listProviders()).find((p) => p.available);
      if (!first) return { status: "fail", summary: "No AI provider is configured at all." };
      const fail = ["gemini", first.id];
      ctx.log(`Simulating failure of: ${[...new Set(fail)].join(", ")}`);
      const chat = await newChat(ctx, "fallback");
      const m = await say(ctx, chat, "Reply with exactly the word: fallback-ok", [], fail);
      const ok = !!m.content && !fail.includes(m.meta.provider || "");
      return verdict(ok, `Answered by ${m.meta.providerLabel} (${m.meta.model}) while ${[...new Set(fail)].join("/")} “failed”`, `Reply came from ${m.meta.provider} or was empty`);
    },
  },

  // Images -----------------------------------------------------------------------------
  {
    id: "image-photo",
    group: "Images",
    title: "Describes a photo",
    description: "Upload a photo of a dog (Wikimedia Commons) and ask what it shows.",
    expected: "~10s",
    async run(ctx) {
      const r = await fetch("https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/500px-YellowLabradorLooking_new.jpg", {
        headers: { "User-Agent": "SenkoAI-tests/1.0 (personal test suite)" },
      });
      if (!r.ok) return { status: "fail", summary: `Couldn't download the test photo (HTTP ${r.status})` };
      const id = await upload(ctx, Buffer.from(await r.arrayBuffer()), "image/jpeg", "Test photo");
      const chat = await newChat(ctx, "photo");
      const m = await say(ctx, chat, "What animal is in this photo? Describe it in one sentence.", [id]);
      return verdict(has(m.content, /dog|labrador|retriever|puppy/i), `Described it: “${m.content.slice(0, 120)}”`, `Didn't identify a dog: “${m.content.slice(0, 160)}”`);
    },
  },
  {
    id: "image-text",
    group: "Images",
    title: "Reads text in a screenshot",
    description: "Upload a rendered invoice screenshot and ask for the invoice number and total.",
    expected: "~10s",
    async run(ctx) {
      const png = await render(
        `<body style="font-family:Arial;padding:30px;background:#fff"><h2>ACME Supplies</h2><p style="font-size:22px">Invoice #4821</p><p style="font-size:22px">Total due: $73.50</p><p>Due date: March 3</p></body>`
      );
      const id = await upload(ctx, png, "image/png", "Invoice screenshot");
      const chat = await newChat(ctx, "ocr");
      const m = await say(ctx, chat, "Read this screenshot: what's the invoice number and the total due?", [id]);
      return verdict(has(m.content, "4821", "73.50"), `Read it: “${m.content.slice(0, 120)}”`, `Missed the text: “${m.content.slice(0, 160)}”`);
    },
  },
  {
    id: "image-compare",
    group: "Images",
    title: "Compares two images",
    description: "Upload a red circle and a blue square; ask how they differ.",
    expected: "~10s",
    async run(ctx) {
      const a = await render(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh"><div style="width:220px;height:220px;border-radius:50%;background:#e11"></div></body>`);
      const b = await render(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh"><div style="width:220px;height:220px;background:#12e"></div></body>`);
      const ids = [await upload(ctx, a, "image/png", "Image A"), await upload(ctx, b, "image/png", "Image B")];
      const chat = await newChat(ctx, "compare");
      const m = await say(ctx, chat, "Compare these two images: what shape and color is in each?", ids);
      return verdict(
        has(m.content, /red/i, /blue/i, /circle|round/i, /square/i),
        `Compared them: “${m.content.slice(0, 140)}”`,
        `Comparison missed shape/color: “${m.content.slice(0, 200)}”`
      );
    },
  },
  {
    id: "image-followup",
    group: "Images",
    title: "Follow-up about an earlier image",
    description: "Send an image with a number, chat about other things for 2 messages, then ask about the image.",
    expected: "~25s",
    async run(ctx) {
      const png = await render(`<body style="margin:0;background:#fef3c7;display:grid;place-items:center;height:100vh;font:bold 140px Arial;color:#7c2d12">58</body>`);
      const id = await upload(ctx, png, "image/png", "Image with a number");
      const chat = await newChat(ctx, "followup");
      await say(ctx, chat, "Here's a picture, just say you got it.", [id]);
      await say(ctx, chat, "What's the capital of Japan? Short answer.");
      await say(ctx, chat, "And of Canada? Short answer.");
      const m = await say(ctx, chat, "Going back to the picture I sent at the start: what number was on it, and what color was the background?");
      return verdict(has(m.content, "58"), `Remembered: “${m.content.slice(0, 120)}”`, `Couldn't recall the image: “${m.content.slice(0, 160)}”`);
    },
  },

  // Browser actions -------------------------------------------------------------------------
  {
    id: "action-youtube",
    group: "Browser actions",
    title: "“Open YouTube and search MrBeast”",
    description: "The command parser builds the YouTube results URL; the test opens it in a real browser to confirm it loads.",
    expected: "~15s",
    async run(ctx) {
      const cmd = parseBrowserCommand("Open YouTube and search MrBeast");
      ctx.log(`Parsed: ${JSON.stringify(cmd)}`);
      if (cmd?.url !== "https://www.youtube.com/results?search_query=mrbeast") return { status: "fail", summary: `Wrong URL: ${cmd?.url}` };
      const chat = await newChat(ctx, "yt-action");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto(cmd.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await s.active().waitForTimeout(2500);
      ctx.shot("Opened page", await s.screenshot());
      const url = s.active().url();
      await closeSession(chat);
      return verdict(url.includes("youtube.com/results") && url.includes("mrbeast"), `Opened ${url}`, `Ended up on ${url}`);
    },
  },
  {
    id: "action-wikipedia",
    group: "Browser actions",
    title: "“Open Wikipedia's page on Japan”",
    description: "Parser should produce a Wikipedia URL that lands on the Japan article.",
    expected: "~15s",
    async run(ctx) {
      const cmd = parseBrowserCommand("Open Wikipedia's page on Japan");
      ctx.log(`Parsed: ${JSON.stringify(cmd)}`);
      if (!cmd) return { status: "fail", summary: "Not recognized as a browser command" };
      const chat = await newChat(ctx, "wiki-action");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto(cmd.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      ctx.shot("Opened page", await s.screenshot());
      const url = s.active().url();
      await closeSession(chat);
      return verdict(/wikipedia\.org\/wiki\/Japan$/.test(url), `Landed on ${url}`, `Landed on ${url} instead of /wiki/Japan`);
    },
  },

  // Agent ----------------------------------------------------------------------------------
  {
    id: "agent-wikipedia",
    group: "Agent",
    title: "Wikipedia: who created Spy x Family",
    description: "“Go to Wikipedia, search Spy x Family, and tell me who created it” → Tatsuya Endo.",
    expected: "~1 min",
    async run(ctx) {
      const chat = await newChat(ctx, "agent-wiki");
      const r = await agent(ctx, chat, "Go to Wikipedia, search Spy x Family, and tell me who created it");
      await closeSession(chat);
      return verdict(has(r.answer, /endo/i), `Answer: “${r.answer.slice(0, 140)}”`, `Expected Tatsuya Endo, got: “${r.answer.slice(0, 160)}”`);
    },
  },
  {
    id: "agent-lofi",
    group: "Agent",
    title: "YouTube lo-fi video + screenshot",
    description: "“Search YouTube for a lo-fi music video, open the first result, and take a screenshot.”",
    expected: "~1–2 min",
    async run(ctx) {
      const chat = await newChat(ctx, "agent-lofi");
      const r = await agent(ctx, chat, "Search YouTube for a lo-fi music video, open the first result, and take a screenshot");
      const url = sessions.get(chat)?.active().url() || r.url || "";
      await closeSession(chat);
      const ok = /youtube\.com\/(watch|live)/.test(url) && r.imageIds.length > 0;
      return verdict(ok, `On ${url}, ${r.imageIds.length} screenshot(s) taken`, `URL ${url}, screenshots: ${r.imageIds.length}`);
    },
  },
  {
    id: "agent-weather",
    group: "Agent",
    title: "Weather in Fort Wayne",
    description: "“Go to a weather site and tell me today's forecast for Fort Wayne, Indiana.”",
    expected: "~1–2 min",
    async run(ctx) {
      const chat = await newChat(ctx, "agent-weather");
      const r = await agent(ctx, chat, "Go to a weather site and tell me today's forecast for Fort Wayne, Indiana");
      await closeSession(chat);
      return verdict(has(r.answer, /\d+\s*(°|degrees|º|F\b)/i), `Forecast: “${r.answer.slice(0, 160)}”`, `No temperature in: “${r.answer.slice(0, 160)}”`);
    },
  },
  {
    id: "agent-popups",
    group: "Agent",
    title: "Pop-ups and redirects",
    description: "A test page that redirects, covers the content with a newsletter overlay, and opens a pop-up on first click. The agent must get through and read the secret code.",
    expected: "~1 min",
    async run(ctx) {
      const chat = await newChat(ctx, "agent-popups");
      const url = ctx.fixtureUrl("popups");
      const s = await sessions.open(chat, ctx.ownerId);
      const logs: string[] = [];
      const unsub = s.subscribe((e) => {
        if (e.type === "log") logs.push(e.text);
      });
      try {
        const r = await agent(ctx, chat, `Open ${url}, get past any pop-ups or overlays, continue to the article, and tell me the secret code.`);
        for (const l of logs) ctx.log(`  [browser] ${l}`);
        const popupClosed = logs.some((l) => /pop-up/i.test(l));
        return verdict(
          has(r.answer, "4217"),
          `Got the code${popupClosed ? " and closed the pop-up" : ""}: “${r.answer.slice(0, 100)}”`,
          `Didn't find 4217: “${r.answer.slice(0, 160)}”`
        );
      } finally {
        unsub();
        await closeSession(chat);
      }
    },
  },
  {
    id: "agent-broken-url",
    group: "Agent",
    title: "Broken URL is detected and reported",
    description: "Send the agent to a domain that doesn't exist; it should notice the error, try again or another way, and explain clearly.",
    expected: "~1 min",
    async run(ctx) {
      const chat = await newChat(ctx, "agent-broken");
      const r = await agent(ctx, chat, "Open https://this-site-does-not-exist-senko-test.invalid/ and tell me what's on the page");
      await closeSession(chat);
      const failedSteps = r.steps.filter((s) => s.status === "error").length;
      const attempts = r.steps.filter((s) => /invalid|Opening|Searching/i.test(s.label)).length;
      ctx.log(`Failed steps: ${failedSteps}, attempts to load/search: ${attempts}`);
      const reported = has(r.answer, /(doesn'?t|does not|couldn'?t|could not|can'?t|cannot|not|no such|invalid|error|unable|fail)/i);
      return verdict(failedSteps >= 1 && reported, `Detected ${failedSteps} failed step(s), ${attempts} attempt(s); told you: “${r.answer.slice(0, 140)}”`, `Steps failed: ${failedSteps}; answer: “${r.answer.slice(0, 160)}”`);
    },
  },

  // Sessions -----------------------------------------------------------------------------------
  {
    id: "session-pause",
    group: "Sessions",
    title: "“Pause it” acts on the playing video",
    description: "Play a YouTube video, then send “pause it”. The video must pause without the page reloading.",
    expected: "~2 min",
    async run(ctx) {
      const chat = await newChat(ctx, "session-pause");
      await agent(ctx, chat, "Go to YouTube, search for lofi hip hop, and play the first video");
      const s = sessions.get(chat);
      if (!s) return { status: "fail", summary: "No browser session after the first task" };
      const before = await videoState(s.active());
      ctx.log(`Before: ${JSON.stringify(before)}`);
      await s.active().evaluate(() => ((window as unknown as { __senkoMarker: number }).__senkoMarker = 42)).catch(() => {});
      const urlBefore = s.active().url();
      await agent(ctx, chat, "pause it");
      const after = await videoState(s.active());
      const marker = await s.active().evaluate(() => (window as unknown as { __senkoMarker?: number }).__senkoMarker).catch(() => undefined);
      ctx.log(`After: ${JSON.stringify(after)}; same page object: ${marker === 42}`);
      await closeSession(chat);
      ctx.log(`URL before: ${urlBefore}`);
      const ok = !!before?.playing && !!after?.paused && marker === 42;
      return verdict(
        ok,
        `Paused at ${Math.round(after?.currentTime || 0)}s without reloading the page`,
        `Was playing: ${before?.playing}, paused after: ${after?.paused}, same page (no reload): ${marker === 42}`
      );
    },
  },
  {
    id: "session-about",
    group: "Sessions",
    title: "“What is this site about?” uses the live page",
    description: "Open python.org, then ask in chat what the site is about. The answer must come from the live page.",
    expected: "~30s",
    async run(ctx) {
      const chat = await newChat(ctx, "session-about");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto("https://www.python.org/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      ctx.shot("Live page", await s.screenshot());
      const m = await say(ctx, chat, "What is this site about?");
      await closeSession(chat);
      return verdict(has(m.content, /python/i), `“${m.content.slice(0, 140)}”`, `Didn't describe python.org: “${m.content.slice(0, 160)}”`);
    },
  },
  {
    id: "session-tabs",
    group: "Sessions",
    title: "Two tabs, “switch to the first tab”",
    description: "Open two sites in separate tabs, then ask the agent to switch to the first tab.",
    expected: "~1 min",
    async run(ctx) {
      const chat = await newChat(ctx, "session-tabs");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto("https://en.wikipedia.org/wiki/Cat", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await s.openTab("https://en.wikipedia.org/wiki/Dog");
      ctx.log(`Tabs: ${(await s.tabs()).map((t) => `${t.index + 1}. ${t.title}${t.active ? " *" : ""}`).join(" | ")}`);
      await agent(ctx, chat, "switch to the first tab");
      const tabs = await s.tabs();
      ctx.log(`Tabs now: ${tabs.map((t) => `${t.index + 1}. ${t.title}${t.active ? " *" : ""}`).join(" | ")}`);
      await closeSession(chat);
      return verdict(tabs[0]?.active === true && /Cat/.test(tabs[0].title), "First tab (Cat) is active", "The first tab didn't become active");
    },
  },
  {
    id: "session-restart",
    group: "Sessions",
    title: "Session restores after a restart",
    description:
      "Open a page, then drop the session from memory exactly like a server restart does (the saved copy in the database is kept), and reconnect. It must come back on the same page. (A real restart uses the same restore path.)",
    expected: "~30s",
    async run(ctx) {
      const chat = await newChat(ctx, "session-restart");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto("https://en.wikipedia.org/wiki/Fort_Wayne,_Indiana", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await s.active().evaluate(() => window.scrollTo(0, 1200));
      const before = s.active().url();
      await sessions.dropFromMemory(chat);
      ctx.log(`Dropped from memory. Status now: ${(await sessions.status(chat)).status}`);
      const back = await sessions.open(chat, ctx.ownerId);
      const after = back.active().url();
      const scroll = await back.active().evaluate(() => window.scrollY).catch(() => 0);
      ctx.shot("Restored page", await back.screenshot());
      await closeSession(chat);
      return verdict(after === before, `Restored ${after} (scroll ${Math.round(scroll)}px)`, `Was ${before}, restored ${after}`);
    },
  },
  {
    id: "session-idle",
    group: "Sessions",
    title: "Still there after 30 minutes idle",
    description: "Open a page and leave the session untouched for 30 minutes (change with ?minutes=). It must still be open on the same page.",
    expected: "30 min",
    async run(ctx) {
      const minutes = Number(ctx.params.minutes || process.env.IDLE_TEST_MINUTES || 30);
      const chat = await newChat(ctx, "session-idle");
      const s = await sessions.open(chat, ctx.ownerId);
      await s.active().goto("https://en.wikipedia.org/wiki/Sloth", { waitUntil: "domcontentloaded", timeout: 45_000 });
      const before = s.active().url();
      ctx.log(`Waiting ${minutes} minute(s)…`);
      const end = Date.now() + minutes * 60_000;
      while (Date.now() < end) {
        if (ctx.signal.aborted) return { status: "skip", summary: "Cancelled" };
        await new Promise((r) => setTimeout(r, Math.min(30_000, end - Date.now())));
      }
      const still = sessions.get(chat);
      const after = still ? still.active().url() : "(session gone)";
      if (still) ctx.shot("After waiting", await still.screenshot());
      await closeSession(chat);
      return verdict(!!still && after === before, `Still open on ${after} after ${minutes} min`, `After ${minutes} min: ${after}`);
    },
  },

  // Video ----------------------------------------------------------------------------------------
  {
    id: "video-playing",
    group: "Video",
    title: "Video is really playing",
    description: "Open a YouTube video. The quality check must confirm playback (time advancing, real frames, no codec error) and the vision model must see a playing video, not a black screen.",
    expected: "~1–2 min",
    async run(ctx) {
      const chat = await newChat(ctx, "video-playing");
      await agent(ctx, chat, "Go to YouTube, search for 'big buck bunny 60fps', and play the first video");
      const s = sessions.get(chat);
      if (!s) return { status: "fail", summary: "No browser session" };
      const v = await videoState(s.active());
      ctx.log(`DOM check: ${JSON.stringify(v)}`);
      const shot = await s.screenshot(70);
      ctx.shot("Video frame", shot);
      let vision = "(no vision model available)";
      try {
        const r = await complete(
          [{ role: "user", content: 'Is a video visibly playing in this screenshot (real picture, not a black screen, error message, or loading spinner)? Reply JSON {"playing": true|false, "reason": "..."}', images: [{ mime: "image/jpeg", data: shot.toString("base64") }] }],
          { maxTokens: 400 }
        );
        vision = r.text;
      } catch (e) {
        vision = `vision check unavailable: ${e instanceof Error ? e.message.split("\n")[0] : e}`;
      }
      ctx.log(`Vision check: ${vision}`);
      await closeSession(chat);
      const visionNo = /"playing"\s*:\s*false/i.test(vision);
      return verdict(!!v?.playing && !visionNo, `Playing at ${Math.round(v?.currentTime || 0)}s, ${v?.width}px wide; vision agrees`, `DOM playing=${v?.playing} error=${v?.error || "none"}; vision: ${vision.slice(0, 120)}`);
    },
  },
  {
    id: "video-live-view",
    group: "Video",
    title: "Live view is smooth, with audio",
    description: "With a video playing, count live-view frames for 8 seconds (need at least 4 fps) and check the audio stream produces sound data (server/Docker only).",
    expected: "~1–2 min",
    async run(ctx) {
      const chat = await newChat(ctx, "video-live");
      await agent(ctx, chat, "Go to YouTube, search for 'nature 4k relaxing', and play the first video");
      const s = sessions.get(chat);
      if (!s) return { status: "fail", summary: "No browser session" };
      let frames = 0;
      const unsub = s.subscribe((e) => {
        if (e.type === "frame") frames++;
      });
      await new Promise((r) => setTimeout(r, 8000));
      unsub();
      const fps = frames / 8;
      ctx.log(`Live view: ${frames} frames in 8s (${fps.toFixed(1)} fps), mode ${liveInfo().mode}`);
      let audioNote = "audio: not available here (needs the Docker image with PulseAudio)";
      let audioOk: boolean | null = null;
      if (audioAvailable()) {
        const bytes = await probeAudio(5000);
        audioOk = bytes > 2000;
        audioNote = `audio: ${bytes} bytes of MP3 in 5s`;
      }
      ctx.log(audioNote);
      await closeSession(chat);
      if (fps < 4) return { status: "fail", summary: `Only ${fps.toFixed(1)} fps; ${audioNote}` };
      if (audioOk === false) return { status: "fail", summary: `${fps.toFixed(1)} fps but no audio data` };
      return { status: audioOk ? "pass" : "skip", summary: `${fps.toFixed(1)} fps live view; ${audioNote}` };
    },
  },
];

export function scenario(id: string) {
  return SCENARIOS.find((s) => s.id === id);
}
