// Picks the lightest layer that can do the job, and escalates when it can't:
//   0. light    plain HTTP search/read/answer. No browser, any host, ~seconds.
//   1. remote   a hosted Chromium over CDP (BROWSER_CDP_URL) or the Vercel Sandbox (AGENT_HOST=sandbox).
//   2. local    Chromium on this machine (Docker/Render/your PC).
// Layers 1-2 are the same agent (runner.ts); getBrowser() decides which one it gets.
import { getBrowser } from "./browser";
import { runAgent, type RunOptions } from "./runner";
import { runLight } from "./light";
import { sessions } from "./sessions";

// Goals that are about doing things on a page, not reading it.
const NEEDS_BROWSER =
  /\b(click|log ?in|sign ?in|sign ?up|fill|type (in|into)|scroll|play|pause|resume|skip|fullscreen|volume|mute|watch|stream|episode|video|tab|screenshot|download|upload|add to cart|checkout|buy|book|captcha|manual control|my account)\b/i;

let browserDown: { at: number; why: string } | null = null;

async function browserProblem(): Promise<string | null> {
  if (browserDown && Date.now() - browserDown.at < 60_000) return browserDown.why;
  try {
    await getBrowser();
    browserDown = null;
    return null;
  } catch (e) {
    const why = e instanceof Error ? e.message.split("\n")[0] : String(e);
    browserDown = { at: Date.now(), why };
    return why;
  }
}

export async function runLayered(opts: RunOptions): Promise<void> {
  const { goal, chatId, emit } = opts;
  // A chat that already has a browser open keeps using it ("pause it", "the second one").
  const wantsBrowser = process.env.AGENT_LAYERS === "browser" || NEEDS_BROWSER.test(goal) || !!sessions.get(chatId);

  if (!wantsBrowser) {
    if ((await runLight(opts)) === "done") return;
    if (opts.signal.aborted) return;
    emit({ type: "status", text: "That needs a real browser, switching…" });
  }

  const problem = await browserProblem();
  if (problem) {
    emit({
      type: "error",
      message: `This task needs a real browser, and none is available on this server (${problem}). Set BROWSER_CDP_URL to a hosted Chromium, or AGENT_HOST=sandbox with VERCEL_TOKEN, or run on the Docker deploy.`,
    });
    return;
  }
  await runAgent(opts);
}
