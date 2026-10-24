// Picks the lightest layer that can do the job, and escalates when it can't:
//   0. web      an HTTP browsing session (cookies, history, links, forms; light.ts + http-session.ts).
//               No browser, any host, ~seconds. Handles search, reading, following links, forms, simple log-ins.
//   1. remote   a hosted Chromium over CDP (Browserbase or BROWSER_CDP_URL).
//   2. local    Chromium on this machine (Docker or your PC).
// Layers 1-2 are the same agent (runner.ts); getBrowser() decides which one it gets.
// Browserbase lets even browserless app hosts (such as Wasmer Edge) run the full browser agent.
import { getBrowser } from "./browser";
import { runAgent, type RunOptions } from "./runner";
import { runLight } from "./light";
import { sessions } from "./sessions";

// Goals that can't be done without a real browser.
const HARD =
  /\b(play|pause|resume|skip|fullscreen|volume|mute|watch|stream|episode|video|tab|screenshot|download|upload|captcha|manual control)\b/i;
// Interactive goals: a real browser does them best, the HTTP session handles the simple cases.
const SOFT = /\b(click|log ?in|sign ?in|sign ?up|fill|type (in|into)|scroll|add to cart|checkout|buy|book|my account)\b/i;

let browserDown: { at: number; why: string } | null = null;

export async function browserProblem(): Promise<string | null> {
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
  const { goal, chatId, emit, signal } = opts;
  // Default: the real browser (live view, cursor, clicks) whenever one is reachable.
  // AGENT_LAYERS=fast answers reading questions over HTTP first instead.
  if (process.env.AGENT_LAYERS !== "fast" && !(await browserProblem())) return runAgent(opts);
  const forced = process.env.AGENT_LAYERS === "browser";
  // A chat that already has a browser open keeps using it ("pause it", "the second one").
  const hasBrowser = !!sessions.get(chatId);
  const hard = forced || hasBrowser || HARD.test(goal);
  const soft = SOFT.test(goal);

  // Real browser first when the goal needs one, or when it's interactive and one exists.
  if (hard || soft) {
    const problem = await browserProblem();
    if (!problem) return runAgent(opts);
    // No browser on this server: the HTTP session does what it can and says what it couldn't.
    const r = await runLight(opts, { noBrowser: problem });
    if (r === "done" || signal.aborted) return;
    emit({ type: "error", message: `That needs a real browser, which isn't available on this server (${problem}).` });
    return;
  }

  if ((await runLight(opts)) === "done" || signal.aborted) return;
  emit({ type: "status", text: "That needs a real browser, switching…" });
  const problem = await browserProblem();
  if (problem) {
    emit({ type: "error", message: `That page needs a real browser, which isn't available on this server (${problem}).` });
    return;
  }
  await runAgent(opts);
}
