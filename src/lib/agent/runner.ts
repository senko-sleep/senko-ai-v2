// The agent loop, running inside a chat's persistent browser session.
//   plan -> (observe page + screenshot -> model checks last step & picks one action -> act) ... -> done
// No step or time limit: it runs until the goal is done or you press Stop.
// Every step's outcome is checked against a fresh screenshot (when a vision model is
// available) plus a direct check of any <video> element.
import type { Page } from "playwright";
import { complete, type ImagePart, type LlmMessage } from "@/lib/llm";
import { sessions, type BrowserSession } from "./sessions";
import { isPrivateUrl } from "./safety";
import { agentVoice } from "@/lib/server/persona";
import { saveImage } from "@/lib/server/chats";
import { stashImage, listStash, clearStash, stashStats } from "./image-store";
import { makeCollage } from "./collage";

export type RunEvent =
  | { type: "status"; text: string }
  | { type: "plan"; steps: string[] }
  | { type: "step"; id: number; label: string; status: "running" | "done" | "error"; detail?: string; url?: string }
  | { type: "done"; answer: string; url?: string; imageIds: string[]; provider?: string; model?: string }
  | { type: "paused"; reason: string }
  | { type: "error"; message: string }
  | { type: "stopped" };

export interface RunOptions {
  chatId: string;
  ownerId: string;
  goal: string;
  provider?: string;
  signal: AbortSignal;
  emit: (e: RunEvent) => void;
  /** Recent chat turns, so "pause it" / "the second one" resolve. */
  context?: string;
  /** Tests only. */
  simulateFail?: string[];
}

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 0); // 0 = no limit
const SEARCH_URL = (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&safeSearch=Off`;

// ---- run registry (one run per chat; takeover pauses it) --------------------------------

interface ActiveRun {
  ctl: AbortController;
  goal: string;
}
const g = globalThis as unknown as { __agentRuns2?: Map<string, ActiveRun>; __pausedGoals?: Map<string, string> };
const runs = (g.__agentRuns2 ??= new Map());
const pausedGoals = (g.__pausedGoals ??= new Map());

export function registerRun(chatId: string, goal: string): AbortController {
  runs.get(chatId)?.ctl.abort("replaced");
  const ctl = new AbortController();
  runs.set(chatId, { ctl, goal });
  return ctl;
}
export function finishRun(chatId: string, ctl: AbortController) {
  if (runs.get(chatId)?.ctl === ctl) runs.delete(chatId);
}
export function stopRun(chatId: string): boolean {
  const r = runs.get(chatId);
  if (!r) return false;
  r.ctl.abort("stopped");
  runs.delete(chatId);
  return true;
}
export function pauseAgentForTakeover(chatId: string) {
  const r = runs.get(chatId);
  if (!r) return;
  pausedGoals.set(chatId, r.goal);
  r.ctl.abort("takeover");
  runs.delete(chatId);
}
export function takePausedGoal(chatId: string): string | undefined {
  const goal = pausedGoals.get(chatId);
  pausedGoals.delete(chatId);
  return goal;
}
export function isRunning(chatId: string) {
  return runs.has(chatId);
}

// ---- page observation ------------------------------------------------------------------

interface Element {
  id: number;
  tag: string;
  type: string;
  text: string;
  href: string;
}
interface VideoState {
  present: boolean;
  playing: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  width: number;
  readyState: number;
  error: string;
  muted: boolean;
  fullscreen: boolean;
}
interface Observation {
  url: string;
  title: string;
  elements: Element[];
  images: { url: string; alt: string; col: number; row: number }[];
  text: string;
  atBottom: boolean;
  tabs: string;
  video: VideoState | null;
  screenshot?: Buffer;
}

const OBSERVE_SCRIPT = () => {
  document.querySelectorAll("[data-agent-id]").forEach((e) => e.removeAttribute("data-agent-id"));
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type=hidden]), textarea, select, video, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [onclick], [aria-label][tabindex]'
    )
  );
  const out: { id: number; tag: string; type: string; text: string; href: string }[] = [];
  const seen = new Set<string>();
  let id = 0;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > window.innerHeight * 1.3 || r.right < 0 || r.left > window.innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) continue;
    const input = el as HTMLInputElement;
    let text = (el.getAttribute("aria-label") || el.innerText || input.value || input.placeholder || el.title || el.getAttribute("alt") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) text = (el.querySelector("img[alt]") as HTMLImageElement | null)?.alt?.trim() || "";
    const tag = el.tagName.toLowerCase();
    const isField = tag === "input" || tag === "textarea" || tag === "select" || tag === "video";
    if (!text && !isField) continue;
    const href = (el as HTMLAnchorElement).href || "";
    const key = `${text}|${href}`;
    if (!isField && seen.has(key)) continue;
    seen.add(key);
    id++;
    el.setAttribute("data-agent-id", String(id));
    out.push({ id, tag, type: input.type || "", text: text.slice(0, 90), href: href.slice(0, 4096) });
    if (out.length >= 60) break;
  }
  const body = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 20;
  const images = Array.from(document.images).filter((img) => {
    const rect = img.getBoundingClientRect();
    return img.complete && img.naturalWidth >= 80 && img.naturalHeight >= 60 && rect.width >= 60 && rect.height >= 40
      && rect.bottom > 0 && rect.top < window.innerHeight * 1.5 && rect.right > 0 && rect.left < window.innerWidth
      && getComputedStyle(img).visibility !== 'hidden' && /^https?:\/\//.test(img.currentSrc || img.src);
  }).slice(0, 24).map((img) => {
    const rect = img.getBoundingClientRect();
    const cols = 4, rows = 4;
    const col = Math.min(cols - 1, Math.floor(rect.left / (window.innerWidth / cols)));
    const row = Math.min(rows - 1, Math.floor(rect.top / (window.innerHeight / rows)));
    return { url: img.currentSrc || img.src, alt: (img.alt || img.title || '').slice(0, 160), col, row };
  });
  return { elements: out, images, text: body.slice(0, 1500), atBottom };
};

/** Directly check the main <video>: is it really playing (time advancing, has frames, no error)? */
export async function videoState(page: Page): Promise<VideoState | null> {
  const read = () =>
    page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll("video"));
      const v = vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!v || v.clientWidth < 50) return null;
      const err = v.error ? `media error ${v.error.code}${v.error.message ? `: ${v.error.message}` : ""}` : "";
      return {
        t: v.currentTime,
        paused: v.paused,
        duration: isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth,
        readyState: v.readyState,
        error: err,
        muted: v.muted,
        fullscreen: !!document.fullscreenElement,
      };
    });
  const a = await read().catch(() => null);
  if (!a) return null;
  if (a.paused) {
    return { present: true, playing: false, paused: true, currentTime: a.t, duration: a.duration, width: a.width, readyState: a.readyState, error: a.error, muted: a.muted, fullscreen: a.fullscreen };
  }
  await page.waitForTimeout(1200);
  const b = (await read().catch(() => null)) || a;
  const playing = !b.paused && b.t > a.t + 0.3 && b.width > 0 && !b.error;
  return { present: true, playing, paused: b.paused, currentTime: b.t, duration: b.duration, width: b.width, readyState: b.readyState, error: b.error, muted: b.muted, fullscreen: b.fullscreen };
}

function describeVideo(v: VideoState | null): string {
  if (!v) return "Video: none on this page";
  if (v.error) return `Video: ERROR (${v.error})`;
  const time = `${Math.floor(v.currentTime / 60)}:${String(Math.floor(v.currentTime % 60)).padStart(2, "0")}${v.duration ? ` / ${Math.floor(v.duration / 60)}:${String(Math.floor(v.duration % 60)).padStart(2, "0")}` : ""}`;
  const state = v.playing ? "PLAYING (time is advancing)" : v.paused ? "paused" : v.width === 0 ? "NOT PLAYING (no video frames yet / still loading or blocked)" : "NOT ADVANCING (stalled or buffering)";
  return `Video: ${state} at ${time}${v.muted ? ", muted" : ""}${v.fullscreen ? ", fullscreen" : ""}`;
}

function formatObservation(o: Observation): string {
  const els = o.elements
    .map((e) => {
      const kind = e.tag === "a" ? "link" : e.tag === "input" ? `input${e.type ? `:${e.type}` : ""}` : e.tag;
      let href = "";
      if (e.href && !e.href.startsWith("javascript:")) {
        try {
          const u = new URL(e.href);
          if (u.protocol === 'https:' || u.protocol === 'http:') href = ` -> ${u.href}`;
        } catch {
          /* ignore */
        }
      }
      return `[${e.id}] ${kind} "${e.text}"${href}`;
    })
    .join("\n");
  return [
    `URL: ${o.url}`,
    `Title: ${o.title}`,
    `Tabs: ${o.tabs}`,
    describeVideo(o.video),
    `Interactive elements:\n${els || "(none visible)"}`,
    `Visible images (use exact URLs; col/row = approx grid position 0-3 from top-left):\n${o.images.map((img, i) => `  [img${i}] col=${img.col} row=${img.row} alt="${img.alt}" url=${img.url}`).join("\n") || "(none)"}`,
    `Visible text (truncated):\n${o.text.slice(0, 1200)}${o.atBottom ? "\n(end of page)" : ""}`,
  ].join("\n");
}

// ---- actions ---------------------------------------------------------------------------

type Action =
  | { action: "search"; query: string }
  | { action: "goto"; url: string }
  | { action: "click"; id: number }
  | { action: "type"; id: number; text: string; submit?: boolean }
  | { action: "press"; key: string }
  | { action: "scroll"; direction?: "up" | "down" }
  | { action: "back" }
  | { action: "wait"; seconds?: number }
  | { action: "new_tab"; url?: string }
  | { action: "switch_tab"; index: number }
  | { action: "close_tab"; index: number }
  | { action: "media"; op: "play" | "pause" | "toggle" | "fullscreen" | "exit_fullscreen" | "mute" | "unmute" | "seek" | "skip"; seconds?: number }
  | { action: "dismiss" }
  | { action: "screenshot"; label?: string }
  | { action: "fetch_image"; url: string; alt?: string }
  | { action: "make_collage"; ids?: string[]; label?: string }
  | { action: "clear_stash" }
  | { action: "examine_images"; description: string }
  | { action: "done"; answer: string; url?: string };

type Decision = Action & { thought?: string; check?: { ok?: boolean; note?: string } };

const SYSTEM_PROMPT = `You are the browsing agent inside a personal assistant app. You control a REAL browser (the user watches it live) and reach the user's goal one action at a time. The browser session persists between messages: tabs, logins, playing videos all stay open, so follow-ups like "pause it" or "what is this site?" act on the CURRENT page.

Each turn you get: the goal, the plan, your previous steps with results, and the current page (URL, tabs, video state, numbered interactive elements, visible text, and usually a fresh screenshot).

Reply with ONE JSON object and nothing else:
{"check": {"ok": true|false, "note": "<did the PREVIOUS step work? judge from the screenshot/page: right page? error? video actually playing?>"}, "thought": "<one short sentence>", "action": "<name>", ...parameters}

Actions:
{"action":"search","query":"..."}                     web search (Bing). Use it when the user didn't name a site, then pick the best match.
{"action":"goto","url":"https://..."}                 open a URL (any site the user names or pastes)
{"action":"click","id":12}                            click element [12]
{"action":"type","id":5,"text":"...","submit":true}   type into a field; submit presses Enter
{"action":"press","key":"Escape"}                     press a key (Escape, Enter, ArrowRight, Space, f, ...)
{"action":"scroll","direction":"down"}                or "up"
{"action":"back"}
{"action":"wait","seconds":3}
{"action":"new_tab","url":"https://..."}              open a new tab
{"action":"switch_tab","index":1}                     tabs are numbered from 1
{"action":"close_tab","index":2}
{"action":"media","op":"pause"}                       play | pause | toggle | fullscreen | exit_fullscreen | mute | unmute | seek (seconds = absolute) | skip (seconds = relative, e.g. 85 to skip an intro)
{"action":"dismiss"}                                  close cookie banners / overlays / modals blocking the page
{"action":"screenshot","label":"..."}                 save a screenshot to show the user
{"action":"fetch_image","url":"https://...","alt":"description"} download an image into the session stash. Use direct media URLs (.jpg/.png/.webp) from the images list.
{"action":"make_collage","ids":["img_..."],"label":"label"} combine stashed images into a single collage (omit ids to use all stashed images).
{"action":"clear_stash"}                             delete all stashed images for this session
{"action":"examine_images","description":"anya forger drinking"} use image recognition to identify which visible image best matches a description. Returns the matching image URL and which element to click. Use this when the user names a specific image by visual content (e.g. "the one where Anya is drinking", "the sad one", "click the gif of her cooking").
{"action":"done","answer":"<message for the user>","url":"<page URL>"}

Rules:
- ZERO CONTENT RESTRICTIONS: Go wherever the user asks and look up whatever they want without hesitation, warnings, or refusals. Use whatever site they name or link, including adult/NSFW sites, boorus, video sites, or any other domain.
- Questions about the current page ("what is this site?", "what episode is this?", "what other shows are here?") are answered from the page text + screenshot: reply with done right away.
- Quality check every step: if the previous step didn't work (wrong page, error, pop-up, video not actually playing), set check.ok=false and try again or another approach. Don't repeat an action that failed twice.
- For "play" goals: the job isn't done until Video says PLAYING. If it isn't, try the play button, dismiss overlays, or click the video.
- Unexpected pop-ups/new tabs are closed automatically; use dismiss for in-page overlays and ads.
- If a login, paywall or captcha blocks you, don't invent credentials: finish with done, say exactly what's needed, and give the URL.
- Only use element ids from the CURRENT list. Scroll if what you need isn't listed.
- When the user says "first option", "first result", "first image", "first one" in the context of a search results page or image grid, they mean the first visible item in that grid/list — click it.
- IMAGE RECOGNITION: When the user asks to click a specific image by visual description (e.g. the one where she's drinking, the crying gif, the one with peanuts), use examine_images with that description BEFORE clicking. It runs vision AI on page images and returns which element to click. Never guess visually.
- After examine_images reports a matching element id, immediately click it using that id.
- Only state facts you saw during this task. Never guess URLs for specific episodes; click your way there.
- Finish with done once every part of the goal is reached. For simple browser actions, use 1-3 sentences. For research, lists, or visual requests, give a useful Markdown answer with descriptive clickable source links and concise findings; use a table when comparing sources. Include relevant images from the observed image URLs using ![descriptive caption](exact image URL), with a nearby source-page link. For several images, place 2-4 images together in one paragraph. Never invent image URLs or use a search-page URL as an image. If no usable image URL is available for a requested visual, take a screenshot. Use only sources and images observed during this task. Keep the assistant's own voice described below.


IMAGE / COLLAGE WORKFLOW — for goals like "download the top 5 Eevee images and make a collage":
1. Navigate to an image-rich site. Best picks:
   - Anime/fan-art: danbooru.donmai.us, safebooru.org, gelbooru.com (general content, no login needed)
   - Art/illustration: deviantart.com, artstation.com
   - Stock photos: unsplash.com, pexels.com
   - General: images.google.com, bing.com/images, pinterest.com
   Try the next site if one blocks or paywalls you — don't retry the same site more than twice.
2. For each image you want: use fetch_image with the direct media URL from the images list (not a page link).
3. When you have enough images in STASH, call make_collage.
4. Call done once the collage is saved and visible to the user.`;

function parseJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function describe(a: Action, obs: Observation | null): string {
  const el = "id" in a ? obs?.elements.find((e) => e.id === Number(a.id)) : undefined;
  const name = el ? `“${el.text.slice(0, 50) || el.tag}”` : `element ${"id" in a ? a.id : ""}`;
  switch (a.action) {
    case "search":
      return `Searching “${a.query}”`;
    case "goto":
      return `Opening ${host(a.url)}`;
    case "click":
      return `Clicking ${name}`;
    case "type":
      return `Typing “${String(a.text).slice(0, 40)}”`;
    case "press":
      return `Pressing ${a.key}`;
    case "scroll":
      return `Scrolling ${a.direction === "up" ? "up" : "down"}`;
    case "back":
      return "Going back";
    case "wait":
      return "Waiting for the page";
    case "new_tab":
      return a.url ? `Opening ${host(a.url)} in a new tab` : "Opening a new tab";
    case "switch_tab":
      return `Switching to tab ${a.index}`;
    case "close_tab":
      return `Closing tab ${a.index}`;
    case "media":
      return { play: "Playing the video", pause: "Pausing the video", toggle: "Toggling play/pause", fullscreen: "Going fullscreen", exit_fullscreen: "Leaving fullscreen", mute: "Muting", unmute: "Unmuting", seek: `Jumping to ${a.seconds}s`, skip: `Skipping ${a.seconds}s` }[a.op] || `Media: ${a.op}`;
    case "dismiss":
      return "Closing an overlay";
    case "screenshot":
      return "Taking a screenshot";
    case "fetch_image":
      return `Fetching image${a.alt ? ` "${a.alt}"` : ""}`;
    case "make_collage":
      return "Building image collage";
    case "clear_stash":
      return "Clearing image stash";
    case "examine_images":
      return `Identifying image: "${a.description}"`;
    case "done":
      return "Finished";
  }
}

// ---- the loop ----------------------------------------------------------------------------

export async function runAgent(opts: RunOptions): Promise<void> {
  const { chatId, ownerId, goal, provider, signal, emit, context: chatContext, simulateFail } = opts;
  let stepId = 0;
  let session: BrowserSession | null = null;
  const imageIds: string[] = [];
  const aborted = () => signal.aborted;
  let visionOff = false;
  let lastProvider: { provider?: string; model?: string } = {};

  const step = (label: string) => {
    const id = ++stepId;
    const at = Date.now();
    emit({ type: "step", id, label, status: "running", url: session?.active().url() });
    session?.emit({ type: "step", id, label, status: "running", url: session.active().url(), at });
    return {
      done: (detail?: string, shotId?: string) => {
        emit({ type: "step", id, label, status: "done", detail, url: session?.active().url() });
        session?.emit({ type: "step", id, label, status: "done", detail, url: session.active().url(), at: Date.now(), shotId });
      },
      fail: (detail: string, shotId?: string) => {
        emit({ type: "step", id, label, status: "error", detail, url: session?.active().url() });
        session?.emit({ type: "step", id, label, status: "error", detail, url: session.active().url(), at: Date.now(), shotId });
      },
    };
  };

  const ask = async (messages: LlmMessage[], maxTokens = 1500) => {
    // Agent runs take many AI calls in a row, which quickly hits free-tier per-minute limits.
    // Wait for a model to free up (up to 90s) instead of failing the whole task.
    const onWait = (ms: number) => {
      const text = `AI is rate-limited, waiting ~${Math.ceil(ms / 1000)}s…`;
      emit({ type: "status", text });
      session?.log(text, "warn");
    };
    const llmOpts = { provider, signal, json: true, temperature: 0.2, maxTokens, simulateFail, maxWaitMs: 90_000, onWait, fast: process.env.AGENT_FAST !== "0" };
    try {
      const r = await complete(messages, llmOpts);
      lastProvider = { provider: r.providerLabel, model: r.model };
      return r.text;
    } catch (e) {
      // No vision model reachable right now: continue with text-only observations.
      const hasImages = messages.some((m) => m.images?.length);
      if (hasImages && !aborted()) {
        visionOff = true;
        session?.log("No image-capable AI model available right now, so steps are checked from page text only.", "warn");
        const r = await complete(
          messages.map((m) => ({ ...m, images: undefined })),
          llmOpts
        );
        lastProvider = { provider: r.providerLabel, model: r.model };
        return r.text;
      }
      throw e;
    }
  };

  const settle = async (page: Page) => {
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => {});
    for (let i = 0; i < 6 && !aborted(); i++) {
      const title = await page.title().catch(() => "");
      if (!/just a moment|checking your browser|attention required|verify you are human/i.test(title)) break;
      if (i === 0) emit({ type: "status", text: "Waiting for a security check…" });
      await page.waitForTimeout(2000);
    }
    // Pages that render their text late: wait while the text is still growing, not on short pages that are done.
    let prev = -1;
    for (let i = 0; i < 6 && !aborted(); i++) {
      const len = await page.evaluate(() => document.body?.innerText.length || 0).catch(() => 0);
      if (len > 400 || (len > 0 && len === prev)) break;
      prev = len;
      await page.waitForTimeout(500);
    }
  };

  const observe = async (s: BrowserSession, withShot: boolean): Promise<Observation> => {
    const p = s.active();
    const r = await p.evaluate(OBSERVE_SCRIPT).catch(async () => {
      await p.waitForTimeout(1000);
      return p.evaluate(OBSERVE_SCRIPT).catch(() => ({ elements: [], images: [], text: "", atBottom: false }));
    });
    const tabs = (await s.tabs()).map((t) => `${t.index + 1}. ${t.title.slice(0, 50)}${t.active ? " (active)" : ""}`).join(" | ");
    const video = await videoState(p);
    const screenshot = withShot ? await s.screenshot(55).catch(() => undefined) : undefined;
    return { url: p.url(), title: await p.title().catch(() => ""), tabs, video, screenshot, ...r };
  };

  /** Show the agent's cursor gliding to an element, with a highlight box. */
  const pointAt = async (s: BrowserSession, sel: string) => {
    const box = await s.active().locator(sel).first().boundingBox().catch(() => null);
    if (!box) return null;
    const vp = s.viewport();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    s.emit({ type: "cursor", x, y, kind: "move", box: { x: box.x, y: box.y, w: box.width, h: box.height }, width: vp.width, height: vp.height });
    await s.active().waitForTimeout(450);
    return { x, y, vp, box };
  };

  const makePlan = (startObs: Observation | null) =>
    ask(
      [
        {
          role: "system",
          content:
            'You plan tasks for a browser agent. Break the goal into 1-6 short, concrete steps. If the goal is a simple question about the current page or a single action (pause, next episode, switch tab), one step is enough. Reply with JSON: {"steps": ["...", "..."]}',
        },
        {
          role: "user",
          content: [
            chatContext ? `Recent conversation:\n${chatContext}` : "",
            startObs ? `Browser is currently on: ${startObs.title} (${startObs.url}). Tabs: ${startObs.tabs}. ${describeVideo(startObs.video)}` : "Browser: blank.",
            `Goal: ${goal}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      800
    );

  try {
    // 1. Session --------------------------------------------------------------------
    const start = step("Connecting to the browser");
    // Plan while the browser connects (a fresh session has nothing to look at yet).
    const liveBefore = sessions.get(chatId);
    let planJob: Promise<string> | null = liveBefore?.isActive() ? null : makePlan(null);
    planJob?.catch(() => {});
    session = await sessions.open(chatId, ownerId);
    session.running = true;
    session.replay = [];
    session.emitStatus();
    await session.startCast();
    start.done(session.isActive() ? `Continuing on ${host(session.active().url())}` : "New browser session");
    const voice = await agentVoice(ownerId).catch(() => "");
    const system = `${SYSTEM_PROMPT}\n\nASSISTANT'S VOICE (for the done answer):\n${voice}`;

    // 2. Plan -----------------------------------------------------------------------
    emit({ type: "status", text: "Planning…" });
    const planStep = step("Planning the steps");
    if (!planJob) planJob = makePlan(session.isActive() ? await observe(session, false) : null);
    const planRaw = await planJob;
    const plan = (parseJson<{ steps?: string[] }>(planRaw)?.steps || []).filter((x) => typeof x === "string").slice(0, 8);
    if (plan.length) {
      emit({ type: "plan", steps: plan });
      session.emit({ type: "plan", steps: plan });
    }
    planStep.done(plan.length ? `${plan.length} step${plan.length > 1 ? "s" : ""}` : undefined);

    // 3. Act ------------------------------------------------------------------------
    const history: string[] = [];
    const visitedSources = new Map<string, { title: string; images: Observation['images'] }>();
    let lastKey = "";
    let repeats = 0;
    let parseFailures = 0;

    for (let i = 0; MAX_STEPS === 0 || i < MAX_STEPS; i++) {
      if (aborted()) break;
      const s = session;
      const page = s.pages.length ? s.active() : await s.openTab();
      const blank = page.url() === "about:blank";
      const obs = blank ? null : await observe(s, !visionOff);
      if (obs) visitedSources.set(obs.url, { title: obs.title, images: obs.images });

      emit({ type: "status", text: "Thinking…" });
      const stash = stashStats(chatId);
      const userText = [
        chatContext ? `Recent conversation:\n${chatContext}` : "",
        `Goal: ${goal}`,
        plan.length ? `Plan:\n${plan.map((p, n) => `${n + 1}. ${p}`).join("\n")}` : "",
        history.length ? `Previous steps:\n${history.slice(-10).join("\n")}` : "Previous steps: none yet",
        stash.count > 0 ? `STASH (${stash.count}/${process.env.AGENT_STASH_MAX ?? 20} images, expires in ~30min):\n${stash.images.map((img) => `  ${img.id} — ${img.alt || img.url} (${(img.bytes / 1024).toFixed(0)} KB)`).join("\n")}` : "STASH: empty",
        visitedSources.size ? `Observed source pages and images for your final answer:\n${JSON.stringify([...visitedSources.entries()].slice(-12).map(([url, data]) => ({ url, ...data })))}` : '',
        repeats >= 2 ? "WARNING: you are repeating the same action. Try a different approach, or finish with done and explain." : "",
        obs ? `Current page:\n${formatObservation(obs)}${obs.screenshot ? "\n(Screenshot of the current page attached.)" : ""}` : "Current page: blank tab (start with search or goto).",
      ]
        .filter(Boolean)
        .join("\n\n");
      const images: ImagePart[] = obs?.screenshot ? [{ mime: "image/jpeg", data: obs.screenshot.toString("base64") }] : [];
      const raw = await ask([
        { role: "system", content: system },
        { role: "user", content: userText, images },
      ]);
      if (aborted()) break;

      const d = parseJson<Decision>(raw);
      if (!d || typeof d.action !== "string") {
        parseFailures++;
        console.warn(`[agent] unparseable reply: ${JSON.stringify(raw.slice(0, 300))}`);
        history.push(`${i + 1}. (your reply wasn't a single JSON object; reply with JSON only)`);
        if (parseFailures >= 4) throw new Error("The AI kept replying in a format the agent can't use. Try again, or choose a different model in the menu.");
        continue;
      }
      parseFailures = 0;

      // Quality check of the previous step, as judged by the model.
      if (d.check && history.length) {
        const note = String(d.check.note || "").slice(0, 160);
        if (d.check.ok === false) {
          s.log(`Check: last step didn't work${note ? ` (${note})` : ""}. Trying another way.`, "warn");
          history[history.length - 1] += ` [CHECK FAILED: ${note}]`;
        } else if (note) {
          history[history.length - 1] += ` [verified: ${note}]`;
        }
      }

      const key = JSON.stringify({ ...d, thought: undefined, check: undefined });
      repeats = key === lastKey ? repeats + 1 : 0;
      lastKey = key;

      if (d.action === "done") {
        const fin = step("Finished");
        const shotId = await s.recordShot("Final result");
        fin.done(undefined, shotId);
        await s.persist().catch(() => {});
        emit({
          type: "done",
          answer: String(d.answer || "Done."),
          url: d.url || (blank ? undefined : s.active().url()),
          imageIds,
          ...lastProvider,
        });
        return;
      }

      const st = step(describe(d, obs));
      let result = "";
      let ok = true;
      try {
        const p = s.active();
        switch (d.action) {
          case "search":
            await p.goto(SEARCH_URL(String(d.query)), { waitUntil: "domcontentloaded", timeout: 45_000 });
            result = `Searched "${d.query}"`;
            break;
          case "goto": {
            const url = /^[a-z]+:\/\//i.test(d.url) ? d.url : `https://${d.url}`;
            if (isPrivateUrl(url)) {
              ok = false;
              result = "Blocked: private/internal network addresses can't be opened from the server's browser.";
              break;
            }
            const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
            const code = resp?.status() || 0;
            result = code >= 400 ? `Loaded ${host(p.url())} but the server answered HTTP ${code}` : `Opened ${host(p.url())}`;
            if (code >= 400) ok = false;
            break;
          }
          case "click": {
            const sel = `[data-agent-id="${Number(d.id)}"]`;
            if ((await p.locator(sel).count()) === 0) {
              ok = false;
              result = `Element ${d.id} isn't on the page anymore.`;
              break;
            }
            await p.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            const at = await pointAt(s, sel);
            if (at) {
              s.emit({ type: "cursor", x: at.x, y: at.y, kind: "click", box: null, width: at.vp.width, height: at.vp.height });
              await p.mouse.click(at.x, at.y);
            } else {
              await p.locator(sel).first().click({ timeout: 6000, force: true });
            }
            const el = obs?.elements.find((e) => e.id === Number(d.id));
            result = `Clicked ${el ? `"${el.text.slice(0, 50)}"` : d.id}`;
            break;
          }
          case "type": {
            const sel = `[data-agent-id="${Number(d.id)}"]`;
            if ((await p.locator(sel).count()) === 0) {
              ok = false;
              result = `Element ${d.id} isn't on the page anymore.`;
              break;
            }
            const at = await pointAt(s, sel);
            if (at) s.emit({ type: "cursor", x: at.x, y: at.y, kind: "click", box: null, width: at.vp.width, height: at.vp.height });
            await p.locator(sel).first().click({ timeout: 4000 }).catch(() => {});
            await p.locator(sel).first().fill(String(d.text ?? ""), { timeout: 5000 });
            if (d.submit !== false) await p.locator(sel).first().press("Enter");
            result = `Typed "${d.text}"`;
            break;
          }
          case "press":
            await p.keyboard.press(String(d.key));
            result = `Pressed ${d.key}`;
            break;
          case "scroll":
            await p.mouse.wheel(0, d.direction === "up" ? -650 : 650);
            result = `Scrolled ${d.direction === "up" ? "up" : "down"}`;
            break;
          case "back":
            await p.goBack({ timeout: 15_000 }).catch(() => {});
            result = "Went back";
            break;
          case "wait":
            await p.waitForTimeout(Math.min(30, Math.max(1, Number(d.seconds) || 2)) * 1000);
            result = "Waited";
            break;
          case "new_tab":
            await s.openTab(d.url && !isPrivateUrl(d.url) ? d.url : undefined);
            result = d.url ? `Opened ${host(d.url)} in a new tab` : "Opened a new tab";
            break;
          case "switch_tab":
            await s.switchTab(Number(d.index) - 1);
            result = `Switched to tab ${d.index}: ${await s.active().title().catch(() => "")}`;
            break;
          case "close_tab":
            await s.closeTab(Number(d.index) - 1);
            result = `Closed tab ${d.index}`;
            break;
          case "media":
            result = await mediaControl(p, d.op, d.seconds);
            if (result.startsWith("No video")) ok = false;
            break;
          case "dismiss":
            result = await dismissOverlays(p);
            break;
          case "screenshot": {
            const buf = await s.screenshot(80);
            imageIds.push(await saveImage(ownerId, "image/jpeg", buf));
            await s.recordShot(d.label || "Screenshot", buf);
            result = "Saved a screenshot for the user";
            break;
          }
          case "fetch_image": {
            const imgUrl = String(d.url || "").trim();
            if (!imgUrl) { ok = false; result = "fetch_image requires a url"; break; }
            try {
              const referer = obs?.url;
              const stashed = await stashImage(chatId, imgUrl, String(d.alt || ""), referer);
              result = `Stashed image ${stashed.id} (${(stashed.data.length / 1024).toFixed(0)} KB, alt: "${stashed.alt || "none"}")`;
            } catch (e) {
              ok = false;
              result = `Could not fetch image: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }
          case "make_collage": {
            const allStashed = listStash(chatId);
            const desired = Array.isArray(d.ids) && d.ids.length
              ? d.ids.map((id: string) => allStashed.find((img) => img.id === id)).filter(Boolean) as typeof allStashed
              : allStashed;
            if (!desired.length) { ok = false; result = "No images in stash to make a collage from. Use fetch_image first."; break; }
            try {
              emit({ type: "status", text: `Building collage from ${desired.length} image${desired.length > 1 ? "s" : ""}…` });
              const collage = await makeCollage({
                images: desired.map((img) => ({ data: img.data, mime: img.mime, label: img.alt })),
              });
              const collageId = await saveImage(ownerId, collage.mime, collage.data);
              imageIds.push(collageId);
              await s.recordShot(d.label || `Collage (${desired.length} images)`, collage.data);
              result = `Collage created from ${collage.cellCount} image${collage.cellCount > 1 ? "s" : ""} (${collage.width}×${collage.height}px). Saved for the user.`;
            } catch (e) {
              ok = false;
              result = `Collage failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }
          case "clear_stash":
            clearStash(chatId);
            result = "Stash cleared.";
            break;
          case "examine_images": {
            // Fetch up to 6 visible images in parallel, then ask the vision model which one matches
            const candidates = (obs?.images ?? []).slice(0, 6);
            if (!candidates.length) { ok = false; result = "No images visible on the page yet. Scroll or wait, then try again."; break; }
            emit({ type: "status", text: `Examining ${candidates.length} images for "${d.description}"…` });
            try {
              // Fetch each candidate into the stash (parallel, ignore failures)
              const fetched = await Promise.all(
                candidates.map((img) =>
                  stashImage(chatId, img.url, img.alt, obs?.url).catch(() => null)
                )
              );
              const valid = fetched.filter((x): x is NonNullable<typeof x> => !!x);
              if (!valid.length) { ok = false; result = "Couldn't download any of the visible images to examine them."; break; }

              // Ask vision model: which image matches the description?
              const imageParts: ImagePart[] = valid.map((img) => ({
                mime: img.mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: img.data.toString("base64"),
              }));
              const matchRaw = await complete(
                [
                  {
                    role: "system",
                    content: "You are an image recognition assistant. The user is looking for a specific image. Reply with ONLY a JSON object: {\"index\": <0-based index of best match or -1 if none match>, \"reason\": \"<one sentence>\"}",
                  },
                  {
                    role: "user",
                    content: `I am looking for: "${d.description}"\n\nI am showing you ${valid.length} images (indices 0 to ${valid.length - 1}). Which image best matches my description? Reply with the JSON only.`,
                    images: imageParts,
                  },
                ],
                { temperature: 0.1, maxTokens: 120 }
              );
              const match = (() => { try { const s = matchRaw.text.indexOf("{"); const e = matchRaw.text.lastIndexOf("}"); return s >= 0 ? JSON.parse(matchRaw.text.slice(s, e + 1)) as { index: number; reason: string } : null; } catch { return null; } })();
              if (!match || match.index < 0 || match.index >= valid.length) {
                result = `None of the ${valid.length} visible images appear to match "${d.description}". Reason: ${match?.reason ?? "no match found"}. Try scrolling to see more images.`;
                ok = false;
                break;
              }
              const winner = valid[match.index];
              // Find the nearest clickable element wrapping this image
              const clickSel = await s.active().evaluate((url: string) => {
                const imgs = Array.from(document.images).filter((i) => (i.currentSrc || i.src) === url);
                if (!imgs.length) return null;
                const img = imgs[0];
                // Walk up to find a link or button ancestor
                let el: HTMLElement | null = img;
                while (el && el.tagName !== "BODY") {
                  if (el.tagName === "A" || el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
                    const id = el.getAttribute("data-agent-id");
                    return id ? parseInt(id, 10) : null;
                  }
                  el = el.parentElement;
                }
                return null;
              }, winner.url).catch(() => null);
              result = `Found matching image at index ${match.index}: "${winner.alt || winner.url}". Reason: ${match.reason}.${clickSel != null ? ` It is element [${clickSel}] — click that to open it.` : ` No clickable element wraps it; try clicking the image directly via its URL.`}`;
            } catch (e) {
              ok = false;
              result = `Image examination failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }
          default:
            ok = false;
            result = `Unknown action "${(d as { action: string }).action}"`;
        }
        if (!["wait", "screenshot", "switch_tab", "close_tab", "fetch_image", "make_collage", "clear_stash", "examine_images"].includes(d.action)) await settle(s.active());
      } catch (e) {
        if (aborted()) break;
        ok = false;
        result = `Failed: ${friendlyError(e)}`;
      }
      const shotId = d.action === "screenshot" ? undefined : await s.recordShot(describe(d, obs));
      if (ok) st.done(d.thought ? String(d.thought).slice(0, 160) : undefined, shotId);
      else st.fail(result, shotId);
      history.push(`${i + 1}. ${JSON.stringify({ ...d, thought: undefined, check: undefined })} -> ${result}`);
      s.schedulePersist();
    }

    if (aborted()) return;
    emit({ type: "done", answer: `I reached the step limit you set (AGENT_MAX_STEPS=${MAX_STEPS}) before finishing.`, url: session.active().url(), imageIds, ...lastProvider });
  } catch (e) {
    if (!aborted()) emit({ type: "error", message: friendlyError(e) });
  } finally {
    if (aborted()) {
      const reason = String(signal.reason || "stopped");
      if (reason === "takeover") emit({ type: "paused", reason: "You took control. Hand it back and I'll continue." });
      else if (reason !== "replaced") emit({ type: "stopped" });
    }
    if (session) {
      session.running = false;
      session.emitStatus();
      void session.persist().catch(() => {});
    }
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const first = msg.split("\n")[0];
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return "That address doesn't exist (the domain name couldn't be found).";
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/.test(msg)) return "The site refused or dropped the connection.";
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(msg)) return "The server lost its internet connection.";
  if (/ERR_CERT/.test(msg)) return "The site's security certificate is invalid.";
  if (/ERR_ABORTED|blockedbyclient/i.test(msg)) return "The page load was blocked or cancelled.";
  if (/Timeout \d+ms exceeded/.test(msg)) return "The page took too long to respond.";
  if (/Target (page, context or browser )?(has been )?closed/i.test(msg)) return "The browser tab was closed.";
  if (/Every AI provider|No AI provider|rate limit/i.test(msg)) return msg;
  return first.slice(0, 300);
}

async function mediaControl(page: Page, op: string, seconds?: number): Promise<string> {
  const res = await page.evaluate(
    async ({ op, seconds }) => {
      const v = Array.from(document.querySelectorAll("video")).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!v) return "No video on this page.";
      switch (op) {
        case "play":
          await v.play().catch(() => {});
          return v.paused ? "Tried to play, but the video is still paused." : "Video playing.";
        case "pause":
          v.pause();
          return "Video paused.";
        case "toggle":
          if (v.paused) await v.play().catch(() => {});
          else v.pause();
          return v.paused ? "Video paused." : "Video playing.";
        case "fullscreen": {
          const target = (v.closest("[class*=player], [id*=player]") as HTMLElement) || v;
          await target.requestFullscreen().catch(() => {});
          return document.fullscreenElement ? "Fullscreen on." : "The site blocked fullscreen; try its fullscreen button.";
        }
        case "exit_fullscreen":
          if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
          return "Fullscreen off.";
        case "mute":
          v.muted = true;
          return "Muted.";
        case "unmute":
          v.muted = false;
          return "Unmuted.";
        case "seek":
          v.currentTime = Math.max(0, Number(seconds) || 0);
          return `Jumped to ${Math.round(v.currentTime)}s.`;
        case "skip":
          v.currentTime = Math.max(0, v.currentTime + (Number(seconds) || 85));
          return `Skipped to ${Math.round(v.currentTime)}s.`;
      }
      return `Unknown media op ${op}`;
    },
    { op, seconds }
  );
  return res;
}

/** Close common overlays: cookie banners, modals, "skip ad" buttons. */
async function dismissOverlays(page: Page): Promise<string> {
  await page.keyboard.press("Escape").catch(() => {});
  const clicked = await page
    .evaluate(() => {
      const words = /^(accept( all)?|agree|i agree|got it|ok(ay)?|close|dismiss|no,? thanks|not now|skip( ads?)?|×|✕|x|reject( all)?|continue|enter|i am (18|over 18|an adult).*|yes,? i am.*|18\+)$/i;
      const els = Array.from(document.querySelectorAll<HTMLElement>("button, [role=button], a, [aria-label]"));
      let n = 0;
      for (const el of els) {
        const label = (el.getAttribute("aria-label") || el.innerText || "").trim();
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || !label || label.length > 30) continue;
        if (words.test(label) || /^(close|dismiss)/i.test(el.getAttribute("aria-label") || "")) {
          el.click();
          n++;
          if (n >= 3) break;
        }
      }
      return n;
    })
    .catch(() => 0);
  return clicked ? `Closed ${clicked} overlay button${clicked > 1 ? "s" : ""}` : "Pressed Escape (no obvious overlay buttons found)";
}
