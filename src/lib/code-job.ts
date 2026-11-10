// Coding jobs: the model builds a project step by step in the chat's workspace instead of
// pasting code into the chat. Shared by the /api/code/step route and the browser runner.

export type CodeOp =
  | { op: "write"; path: string; content: string }
  | { op: "edit"; path: string; find: string; replace: string }
  | { op: "delete"; path: string }
  | { op: "read"; path: string }
  | { op: "run"; cmd: string }
  | { op: "inspect"; url?: string; requireMediaPlayback?: boolean; expectedText?: string[]; interactions?: { action: "click" | "type" | "viewport"; selector?: string; text?: string; width?: number; height?: number }[] }
  | { op: "youtube"; query: string }
  | { op: "fetch"; url: string }
  | { op: "search"; query: string };

export interface CodeStep {
  thought?: string;
  ops: CodeOp[];
  done?: boolean;
  /** Short message for the chat when done: what was built and how to run it. */
  summary?: string;
  /** Invalid operations are reported back to the model, never silently discarded. */
  errors?: string[];
}

export interface StepRequest {
  goal: string;
  /** Every file path with its size, so the model knows the layout without the full text. */
  files: { path: string; bytes: number }[];
  /** Full text of files the model asked to read last step (and small projects in full). */
  opened?: { path: string; content: string }[];
  /** What happened on earlier steps (writes, command output, errors), newest last. */
  history: string[];
  /** False when Node isn't available in this browser: no "run" ops. */
  canRun: boolean;
  step: number;
  maxSteps: number;
  /** Verified facts about where commands run (platform, Node, cwd), supplied by the host. */
  environment?: string;
  /** Deterministic summary of the project (stack, scripts, dependencies, entry points). */
  brief?: string;
}

export const CODE_SYSTEM = `You are a coding agent building a project in a workspace (a folder of files). You reply with JSON only. Batch as much work per reply as is safe.

Each reply: {"thought":"<one short sentence>","ops":[...],"done":false}
Ops:
- {"op":"write","path":"src/app.js","content":"<the whole file>"}  create or replace a file (always the full content)
- {"op":"edit","path":"src/app.js","find":"<exact unique existing text>","replace":"<replacement>"} targeted edit; fails if the match is missing or ambiguous. Prefer this for changes to large existing files.
- {"op":"delete","path":"old.js"}
- {"op":"read","path":"src/app.js"}  see a file's full text on the next step
- {"op":"run","cmd":"npm install"}  run a shell command in the project folder (Node.js + npm available, only when RUN is enabled). Long-running servers (npm run dev, npm start) keep running in the background; you get their first output.
- {"op":"inspect","url":"<live app URL>","interactions":[{"action":"click","selector":"#save"}],"expectedText":["Saved"]} inspect the actual app in Chromium, recording console errors, failed requests, screenshot and interactions. Actions: click (selector), type (selector,text), viewport (width,height). Omit url to inspect the workspace preview. Assert meaningful state after interactions before claiming a website works.
- {"op":"youtube","query":"LiSA Gurenge official"}  real YouTube video IDs (checked to exist). Use this for every video; never type an ID yourself.
- {"op":"fetch","url":"https://api.jikan.moe/v4/anime?q=frieren&limit=1"}  call a public URL or API and see the response (JSON or page text). Use it to check an API's real response shape before coding against it.
- {"op":"search","query":"free anime API with images"}  web search results with links.
When everything works: {"thought":"...","ops":[],"done":true,"summary":"<2-4 sentences for the user: what you built, the main files, how to run it>"}

Stack: respect the existing architecture. Choose the simplest stack that meets the actual request: a focused static HTML/CSS/JS listening site is valid; React/TypeScript/Vite suit richer applications. Do not create a backend, scraper, database or dashboard without a functional reason. Install real dependencies when the selected stack needs them.

Real data: never invent IDs, URLs, image links or API fields. Look them up with youtube / fetch / search first, and test API calls with fetch. Good free APIs without keys: Jikan (api.jikan.moe/v4, anime info and cover images), AniList GraphQL (graphql.anilist.co), iTunes Search (itunes.apple.com/search, song artwork and 30-second audio previews), MusicBrainz, Wikipedia REST. Don't put song lyrics or other copyrighted text in the project; link to official sources instead.
Full stack when asked or when it helps: a typed API server (Express or Hono, run with tsx) in server/, the React client in src/, a shared types file, and a Vite proxy from /api to the server. Use "concurrently" so "npm run dev" starts both.
Tests: when the user asks for tests (or the app has real logic), add Vitest (+ @testing-library/react and jsdom for components), a "test": "vitest run" script, and run it. Report the real result; a failing test is fixed, not described as passing.

Rules:
- Efficiency is a hard requirement. Every reply costs a model request and the provider rate-limits them. Finish the whole task in the fewest replies: ideally one reply that writes every file, installs dependencies, runs the tests and starts the app, in that order (ops execute in order; a later op sees earlier results on disk). Use further replies only to fix real failures or to read files you were not given.
- Do not write one file per reply, do not narrate, and do not read files already shown under OPEN FILES or summarized in BRIEF. Use edit ops, not rewrites, for small changes to existing files.
- Plan the layout first, then emit all files together. Keep files focused and well named. Make every file complete: no TODOs, stubs or placeholders.
- package.json: real compatible versions and appropriate scripts. Verify the chosen stack with installation and its actual type/build/test scripts when applicable, then start the live app. For music/listening requests inspect with requireMediaPlayback:true after clicking the real play control: a label saying Playing or a clean render does not prove playback. Read errors, fix the cause and rerun. Report restrictions precisely; never claim blocked media works.
- Make it look finished: real content, responsive layout, good spacing and typography, hover/focus states, no placeholder lorem ipsum.
- Don't write node_modules, lockfiles or binary files.
- Never paste code into the summary; the files are delivered with the project.
- Reply with the JSON object only, no Markdown fences.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more characters)` : s);

export function buildStepPrompt(r: StepRequest): string {
  const files = r.files.length ? r.files.map((f) => `- ${f.path} (${f.bytes} bytes)`).join("\n") : "(empty project)";
  const opened = (r.opened || []).map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  const history = r.history.slice(-14).map((h) => clip(h, 3000)).join("\n");
  return [
    `GOAL:\n${r.goal}`,
    `STEP ${r.step} of at most ${r.maxSteps}. RUN is ${r.canRun ? "enabled" : "DISABLED (no Node here: don't use run ops; make it work as static files where possible, or write the Node project and say in the summary that it needs npm install)"}.`,
    r.environment && `ENVIRONMENT:\n${r.environment}`,
    r.brief && `BRIEF:\n${r.brief}`,
    `FILES:\n${files}`,
    opened && `OPEN FILES:\n${opened}`,
    history && `HISTORY:\n${history}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Lenient: accepts fenced JSON and stray text around the object. Returns null when unusable. */
export function parseStep(text: string): CodeStep | null {
  const body = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    // Some small models escape the entire JSON document once. Decode only when both
    // JSON parsers succeed; never evaluate JavaScript or guess missing file contents.
    try {
      const encoded = body.slice(start, end + 1).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
      raw = JSON.parse(JSON.parse(`"${encoded}"`));
    } catch { return null; }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.ops)) return null;
  const ops: CodeOp[] = [];
  const errors: string[] = [];
  for (const [index, item] of o.ops.entries()) {
    if (!item || typeof item !== "object") { errors.push(`Operation ${index + 1} must be an object.`); continue; }
    const x = item as Record<string, unknown>;
    const path = typeof x.path === "string" ? x.path.trim() : "";
    if ((x.op === "write" || x.op === "edit" || x.op === "delete" || x.op === "read") && !(x.op === "read" ? readablePath(path) : writablePath(path))) {
      errors.push(`Operation ${index + 1}: invalid or restricted project path.`);
      continue;
    }
    if (x.op === "write" && path && typeof x.content === "string") ops.push({ op: "write", path, content: x.content });
    else if (x.op === "edit" && path && typeof x.find === "string" && x.find.length > 0 && typeof x.replace === "string") ops.push({ op: "edit", path, find: x.find, replace: x.replace });
    else if ((x.op === "delete" || x.op === "read") && path) ops.push({ op: x.op, path });
    else if (x.op === "run" && typeof x.cmd === "string" && x.cmd.trim()) ops.push({ op: "run", cmd: x.cmd.trim() });
    else if (x.op === "inspect" && (x.requireMediaPlayback === undefined || typeof x.requireMediaPlayback === "boolean") && (x.url === undefined || (typeof x.url === "string" && /^https?:\/\//i.test(x.url))) &&
      (x.expectedText === undefined || (Array.isArray(x.expectedText) && x.expectedText.every((text) => typeof text === "string"))) &&
      (x.interactions === undefined || (Array.isArray(x.interactions) && x.interactions.every((act) => {
        if (!act || typeof act !== "object") return false;
        if (act.action === "viewport") return Number.isInteger(act.width) && act.width > 0 && Number.isInteger(act.height) && act.height > 0;
        return (act.action === "click" || (act.action === "type" && typeof act.text === "string")) && typeof act.selector === "string" && !!act.selector.trim();
      })))) ops.push({ op: "inspect", ...(typeof x.url === "string" ? { url: x.url } : {}),
        ...(typeof x.requireMediaPlayback === "boolean" ? { requireMediaPlayback: x.requireMediaPlayback } : {}),
        ...(x.expectedText ? { expectedText: x.expectedText as string[] } : {}),
        ...(x.interactions ? { interactions: x.interactions as Extract<CodeOp, { op: "inspect" }>["interactions"] } : {}) });
    else if ((x.op === "youtube" || x.op === "search") && typeof x.query === "string" && x.query.trim()) ops.push({ op: x.op, query: x.query.trim().slice(0, 200) });
    else if (x.op === "fetch" && typeof x.url === "string" && /^https?:\/\//i.test(x.url.trim())) ops.push({ op: "fetch", url: x.url.trim() });
    else errors.push(`Operation ${index + 1}: unsupported tool or invalid arguments for ${String(x.op)}.`);
  }
  return {
    thought: typeof o.thought === "string" ? o.thought.slice(0, 300) : undefined,
    ops,
    done: o.done === true && errors.length === 0,
    ...(errors.length ? { errors } : {}),
    summary: typeof o.summary === "string" ? o.summary.slice(0, 2000) : undefined,
  };
}

/** Paths the model must not write: dependency folders, lockfiles, escapes. */
export function writablePath(path: string): boolean {
  return readablePath(path) && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path.replace(/\\/g, "/"));
}

export function readablePath(path: string): boolean {
  const clean = path.replace(/\\/g, "/");
  return !!clean && !/^(\/|[a-z]:|~)/i.test(clean) && !/[\0\r\n]/.test(clean) &&
    !clean.split("/").some((p) => !p || p === "." || p === ".." || /^(node_modules|\.git|\.senko|\.env(?:\..*)?)$/i.test(p));
}

export function applyExactEdit(source: string, find: string, replacement: string): string {
  const at = source.indexOf(find);
  if (!find || at < 0) throw new Error("Edit target was not found; read the current file before retrying.");
  if (source.indexOf(find, at + 1) >= 0) throw new Error("Edit target is ambiguous; provide a unique surrounding snippet.");
  return source.slice(0, at) + replacement + source.slice(at + find.length);
}

/** Validate untrusted request bodies before constructing model context. */
export function validateStepRequest(value: unknown): value is StepRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as StepRequest;
  return typeof r.goal === "string" && r.goal.trim().length > 0 && r.goal.length <= 32_000 &&
    typeof r.canRun === "boolean" && Number.isInteger(r.step) && r.step >= 1 &&
    Number.isInteger(r.maxSteps) && r.maxSteps >= r.step && r.maxSteps <= 100 &&
    Array.isArray(r.files) && r.files.length <= 5000 && r.files.every((f) =>
      f && typeof f.path === "string" && Number.isFinite(f.bytes) && f.bytes >= 0) &&
    Array.isArray(r.history) && r.history.length <= 200 && r.history.every((h) => typeof h === "string") &&
    (r.opened === undefined || (Array.isArray(r.opened) && r.opened.every((f) =>
      f && typeof f.path === "string" && typeof f.content === "string") &&
      r.opened.reduce((n, f) => n + f.content.length, 0) <= 200_000));
}

/** Prioritize error/task files and their direct imports; show omitted paths explicitly. */
export function selectProjectContext<T extends { path: string; content: string }>(files: T[], query: string, budget = 80_000): { files: T[]; omitted: string[] } {
  const words = new Set(query.toLowerCase().match(/[\w.-]{3,}/g) || []);
  const ranked = files.map((file, index) => ({ file, index, score:
    (query.includes(file.path) ? 100 : 0) +
    (/^(package\.json|tsconfig\.json|vite\.config\.|README)/i.test(file.path) ? 20 : 0) +
    [...words].filter((w) => file.path.toLowerCase().includes(w)).length * 10 +
    [...words].filter((w) => file.content.toLowerCase().includes(w)).length,
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: T[] = [];
  let remaining = budget;
  for (const { file } of ranked) {
    if (file.content.length > remaining) continue;
    selected.push(file); remaining -= file.content.length;
  }
  const included = new Set(selected.map((f) => f.path));
  return { files: selected, omitted: files.filter((f) => !included.has(f.path)).map((f) => f.path) };
}

export interface JobEvidence { command: string; exitCode: number | null; revision: number; browserPassed?: boolean; mediaPlaybackPassed?: boolean }

/** Completion is determined from execution records for the current file revision. */
export function completionBlockers(files: { path: string; code: string }[], evidence: JobEvidence[], revision: number, canRun: boolean, requirements?: { playback: boolean }): string[] {
  if (!files.length) return ["No project files exist."];
  if (!canRun) return ["Execution is unavailable; files are unverified."];
  const current = evidence.filter((e) => e.revision === revision);
  const failures: string[] = [];
  const latestCommands = new Map(current.map((record) => [record.command, record]));
  for (const record of latestCommands.values()) if (record.exitCode !== null && record.exitCode !== 0) failures.push(`Resolve the failed check: ${record.command}.`);
  const pkgFile = files.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.code) as { scripts?: Record<string, string> };
      for (const script of ["typecheck", "lint", "build", "test"]) {
        if (!pkg.scripts?.[script]) continue;
        const matches = current.filter((e) => new RegExp(`\\b(?:npm\\s+(?:run\\s+)?|pnpm\\s+(?:run\\s+)?|yarn\\s+(?:run\\s+)?)${script}\\b`).test(e.command));
        if (matches.at(-1)?.exitCode !== 0) failures.push(`Run and pass the ${script} script after the latest file edits.`);
      }
    } catch { failures.push("package.json is invalid JSON."); }
  }
  if (!current.some((e) => e.exitCode === 0 && e.command !== "inspect")) failures.push("No successful command has run after the latest edits.");
  if (files.some((f) => /\.(html?|tsx|jsx)$/i.test(f.path)) && current.filter((e) => e.command === "inspect").at(-1)?.browserPassed !== true) failures.push("Inspect the current website in Chromium and resolve reported issues.");
  if (requirements?.playback && current.filter((e) => e.command === "inspect").at(-1)?.mediaPlaybackPassed !== true) failures.push("The primary listening/playback requirement is unverified. Verify real unmuted playback or report the external restriction; a decorative player is incomplete.");
  return failures;
}

/**
 * Deterministic project summary built locally (no model call). It replaces the exploratory
 * reads a model would otherwise spend requests on: stack, scripts, dependencies, entry points
 * and test layout. Everything reported is read from the files; nothing is inferred beyond that.
 */
export function buildProjectBrief(files: { path: string; content: string }[], limit = 2400): string {
  if (!files.length) return "Empty project: nothing exists yet. Create the full project in your first reply.";
  const lines: string[] = [];
  const manifest = files.find((f) => f.path === "package.json");
  let deps: string[] = [];
  if (manifest) {
    try {
      const pkg = JSON.parse(manifest.content) as { name?: string; type?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
      lines.push(`package: ${pkg.name || "(unnamed)"}${pkg.type ? `, module type ${pkg.type}` : ""}`);
      const scripts = Object.entries(pkg.scripts || {}).map(([name, cmd]) => `${name}=${cmd}`);
      if (scripts.length) lines.push(`scripts: ${scripts.join("; ")}`);
      if (deps.length) lines.push(`declared dependencies: ${deps.join(", ")}`);
    } catch { lines.push("package.json exists but is not valid JSON: fix it first."); }
  }
  const has = (name: string) => deps.includes(name);
  const stack = [
    has("next") && "Next.js", has("vite") && "Vite", has("react") && "React", has("express") && "Express", has("hono") && "Hono",
    has("vitest") && "Vitest", has("jest") && "Jest", has("typescript") && "TypeScript",
    files.some((f) => /\.test\.[cm]?[jt]s$/.test(f.path)) && !has("vitest") && !has("jest") && "node:test files",
  ].filter(Boolean);
  if (stack.length) lines.push(`stack: ${stack.join(", ")}`);
  const entries = files.filter((f) => /^(index\.html|server\.[cm]?[jt]s|src\/(main|index)\.[jt]sx?|app\/(page|layout)\.[jt]sx?|src\/app\/(page|layout)\.[jt]sx?)$/.test(f.path)).map((f) => f.path).sort();
  if (entries.length) lines.push(`entry points: ${entries.join(", ")}`);
  const tests = files.filter((f) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\./.test(f.path)).map((f) => f.path);
  if (tests.length) lines.push(`tests (${tests.length}): ${tests.slice(0, 8).join(", ")}${tests.length > 8 ? ", ..." : ""}`);
  const imported = new Set<string>();
  for (const f of files) for (const m of f.content.matchAll(/(?:from\s+|require\()["']([^"'./][^"']*)["']/g)) imported.add(m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0]);
  const builtin = new Set(["fs", "path", "os", "http", "https", "net", "url", "util", "crypto", "stream", "events", "child_process", "assert", "zlib", "readline", "buffer"]);
  const undeclared = [...imported].filter((name) => !name.startsWith("node:") && !builtin.has(name) && !deps.includes(name));
  if (manifest && undeclared.length) lines.push(`imported but not declared in package.json: ${undeclared.slice(0, 12).join(", ")}`);
  const dirs = new Map<string, number>();
  for (const f of files) { const top = f.path.includes("/") ? f.path.split("/")[0] : "."; dirs.set(top, (dirs.get(top) || 0) + 1); }
  lines.push(`layout: ${[...dirs].map(([dir, count]) => `${dir} (${count})`).join(", ")}`);
  const out = lines.join("\n");
  return out.length > limit ? out.slice(0, limit) + "\n..." : out;
}
