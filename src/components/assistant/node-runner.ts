// Node.js in the browser. WebContainers only start on a cross-origin-isolated page, and the
// main app can't be one (it would break YouTube embeds and the live browser view). So the
// isolated /code/<chat> page hosts the runtime, and other tabs send it commands over a
// BroadcastChannel. Each chat gets its own folder: /<chatId>.

import { loadProject, type WorkspaceProject } from "./workspace-files";

const CHANNEL = "senko-node";

type Msg =
  | { type: "ping"; id: string }
  | { type: "pong"; id: string }
  | { type: "run"; id: string; chatId: string; cmd: string; timeoutMs: number }
  | { type: "result"; id: string; exitCode: number | null; output: string; url?: string }
  | { type: "output"; chatId: string; chunk: string }
  | { type: "server"; chatId: string; url: string; port: number };

export interface RunResult {
  /** null when the command is still running (a dev server) */
  exitCode: number | null;
  output: string;
  /** Preview URL when the command started a server. */
  url?: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_OUTPUT = 12000;
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n");

// ---- client side (any tab) ---------------------------------------------------------------

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
}

/** True when a runner tab is open and answering. */
export async function runnerAvailable(timeoutMs = 600): Promise<boolean> {
  if (isRunnerHere()) return true;
  const ch = channel();
  if (!ch) return false;
  const id = uid();
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(t);
      ch.close();
      resolve(v);
    };
    const t = setTimeout(() => done(false), timeoutMs);
    ch.onmessage = (e: MessageEvent<Msg>) => e.data.type === "pong" && e.data.id === id && done(true);
    ch.postMessage({ type: "ping", id } satisfies Msg);
  });
}

/** Run a shell command in the chat's project folder (in this tab if it hosts the runner). */
export async function runCommand(chatId: string, cmd: string, timeoutMs = 180_000): Promise<RunResult> {
  if (isRunnerHere()) return localRun(chatId, cmd, timeoutMs);
  const ch = channel();
  if (!ch) return { exitCode: 1, output: "Node isn't available in this browser." };
  const id = uid();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      ch.close();
      resolve({ exitCode: 1, output: "The Node workspace tab didn't answer. Is it still open?" });
    }, timeoutMs + 15_000);
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.type !== "result" || e.data.id !== id) return;
      clearTimeout(t);
      ch.close();
      resolve({ exitCode: e.data.exitCode, output: e.data.output, url: e.data.url });
    };
    ch.postMessage({ type: "run", id, chatId, cmd, timeoutMs } satisfies Msg);
  });
}

/** Live terminal output and server URLs from the runner, for a chat. */
export function onRunnerEvents(chatId: string, cb: (e: { chunk?: string; url?: string }) => void): () => void {
  const ch = channel();
  const local = (e: Event) => {
    const d = (e as CustomEvent<Msg>).detail;
    if (d.type === "output" && d.chatId === chatId) cb({ chunk: d.chunk });
    if (d.type === "server" && d.chatId === chatId) cb({ url: d.url });
  };
  window.addEventListener("senko:node", local);
  if (ch)
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.type === "output" && e.data.chatId === chatId) cb({ chunk: e.data.chunk });
      if (e.data.type === "server" && e.data.chatId === chatId) cb({ url: e.data.url });
    };
  return () => {
    window.removeEventListener("senko:node", local);
    ch?.close();
  };
}

// ---- runner side (the isolated /code page) -----------------------------------------------

type WC = import("@webcontainer/api").WebContainer;
let container: Promise<WC> | null = null;
let hosting = false;
const servers = new Map<number, string>(); // port -> url
const synced = new Map<string, Map<string, string>>(); // chatId -> path -> content written
const procs = new Map<string, { kill: () => void }[]>(); // chatId -> background processes

export function isRunnerHere() {
  return hosting;
}

function announce(msg: Msg, ch: BroadcastChannel | null) {
  window.dispatchEvent(new CustomEvent("senko:node", { detail: msg }));
  ch?.postMessage(msg);
}

/** Boot Node in this tab and serve commands for every chat. Call once, on the isolated page. */
export async function hostRunner(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (hosting) return { ok: true };
  if (typeof window === "undefined" || !window.crossOriginIsolated) {
    return { ok: false, reason: "This page isn't cross-origin isolated, so Node can't start here." };
  }
  try {
    const { WebContainer } = await import("@webcontainer/api");
    container ??= WebContainer.boot({ workdirName: "senko" });
    const wc = await container;
    hosting = true;
    const ch = channel();
    wc.on("server-ready", (port, url) => {
      servers.set(port, url);
      for (const chatId of procs.keys()) announce({ type: "server", chatId, url, port }, ch);
    });
    if (ch)
      ch.onmessage = async (e: MessageEvent<Msg>) => {
        const m = e.data;
        if (m.type === "ping") ch.postMessage({ type: "pong", id: m.id } satisfies Msg);
        if (m.type === "run") {
          const r = await localRun(m.chatId, m.cmd, m.timeoutMs);
          ch.postMessage({ type: "result", id: m.id, ...r } satisfies Msg);
        }
      };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Copy the chat's project files into its folder, writing only what changed. */
async function syncFiles(wc: WC, chatId: string, project: WorkspaceProject) {
  const root = `/${safeDir(chatId)}`;
  const seen = synced.get(chatId) || new Map<string, string>();
  await wc.fs.mkdir(root, { recursive: true });
  const live = new Set(project.files.map((f) => f.path));
  for (const [path] of seen) {
    if (!live.has(path)) {
      await wc.fs.rm(`${root}/${path}`, { force: true }).catch(() => {});
      seen.delete(path);
    }
  }
  for (const f of project.files) {
    if (seen.get(f.path) === f.code) continue;
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    if (dir) await wc.fs.mkdir(`${root}/${dir}`, { recursive: true });
    await wc.fs.writeFile(`${root}/${f.path}`, f.code);
    seen.set(f.path, f.code);
  }
  synced.set(chatId, seen);
  return root;
}

const safeDir = (chatId: string) => chatId.replace(/[^\w-]/g, "_").slice(0, 64) || "project";
const LONG_RUNNING = /\b(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve|preview)\b|\b(vite|next dev|nodemon|http-server|serve)\b|node\s+\S*server/i;

async function localRun(chatId: string, cmd: string, timeoutMs: number): Promise<RunResult> {
  if (!container) return { exitCode: 1, output: "Node isn't running in this tab." };
  const wc = await container;
  const ch = channel();
  const cwd = await syncFiles(wc, chatId, loadProject(chatId));
  const background = LONG_RUNNING.test(cmd);
  if (background) {
    // One server per chat: stop the previous one first.
    for (const p of procs.get(chatId) || []) p.kill();
    procs.set(chatId, []);
  }
  const proc = await wc.spawn("jsh", ["-c", `cd ${cwd} && ${cmd}`], { env: { CI: "1", FORCE_COLOR: "0" } });
  let output = "";
  let url: string | undefined;
  const reader = proc.output.getReader();
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) break;
      const chunk = stripAnsi(String(value ?? ""));
      output = (output + chunk).slice(-MAX_OUTPUT);
      announce({ type: "output", chatId, chunk }, ch);
    }
  })();

  if (background) {
    procs.get(chatId)!.push({ kill: () => proc.kill() });
    const before = new Set(servers.values());
    const started = await new Promise<string | undefined>((resolve) => {
      const t = setTimeout(() => resolve(undefined), Math.min(timeoutMs, 60_000));
      const off = wc.on("server-ready", (_port, u) => {
        if (before.has(u)) return;
        clearTimeout(t);
        off();
        resolve(u);
      });
      proc.exit.then(() => {
        clearTimeout(t);
        resolve(undefined);
      });
    });
    url = started;
    ch?.close();
    return { exitCode: null, output: output || "(no output yet)", url };
  }

  const exitCode = await Promise.race([proc.exit, new Promise<number>((r) => setTimeout(() => r(-1), timeoutMs))]);
  if (exitCode === -1) {
    proc.kill();
    output += `\n(stopped after ${Math.round(timeoutMs / 1000)}s)`;
  }
  await Promise.race([pump, new Promise((r) => setTimeout(r, 300))]);
  ch?.close();
  return { exitCode, output: output.trim() || "(no output)" };
}

/** Files Node wrote (e.g. a build folder), for the zip. Skips node_modules. */
export async function listGenerated(chatId: string, dir = "dist"): Promise<{ path: string; content: Uint8Array }[]> {
  if (!container) return [];
  const wc = await container;
  const root = `/${safeDir(chatId)}`;
  const out: { path: string; content: Uint8Array }[] = [];
  const walk = async (rel: string) => {
    const entries = await wc.fs.readdir(`${root}/${rel}`, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "node_modules") await walk(p);
      } else out.push({ path: p, content: await wc.fs.readFile(`${root}/${p}`) });
    }
  };
  await walk(dir);
  return out;
}
