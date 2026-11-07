// Runs a coding job in the browser: asks /api/code/step what to do, applies file changes to
// the chat's project, runs commands through the Node runner when one is open, and repeats
// until the model says it's done. Several jobs (and the browser agent) can run at once.

import { strToU8, zipSync } from "fflate";
import { writablePath, applyExactEdit, completionBlockers, selectProjectContext, type JobEvidence, type CodeStep, type StepRequest } from "@/lib/code-job";
import { loadProject, normalizePath, updateProject } from "./workspace-files";
import { listGenerated, runCommand, runnerAvailable } from "./node-runner";
import { codingRequirements } from "@/lib/agent/coding-playbooks";

export type JobStatus = "running" | "done" | "failed" | "stopped" | "unverified";

export interface JobState {
  id: string; // the assistant message that asked for it
  chatId: string;
  goal: string;
  status: JobStatus;
  /** Latest one-line progress, e.g. "Writing 3 files" */
  activity: string;
  step: number;
  filesChanged: string[];
  summary?: string;
  error?: string;
  previewUrl?: string;
  usedNode: boolean;
  updatedAt: number;
  checkpoint?: { history: string[]; opened: { path: string; content: string }[]; revision: number; evidence: JobEvidence[] };
}

const MAX_STEPS = 24;
const KEY = (id: string) => `senko.codejob.${id}`;
const listeners = new Set<() => void>();
const running = new Map<string, AbortController>();

export function getJob(id: string): JobState | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as JobState) : null;
  } catch {
    return null;
  }
}

function putJob(job: JobState) {
  try {
    localStorage.setItem(KEY(job.id), JSON.stringify({ ...job, updatedAt: Date.now() }));
  } catch {
    /* storage full: the job still runs, the card just won't survive a reload */
  }
  listeners.forEach((l) => l());
}

export function onJobsChange(cb: () => void): () => void {
  listeners.add(cb);
  const storage = (e: StorageEvent) => e.key?.startsWith("senko.codejob.") && cb();
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", storage);
  };
}

export function isJobRunningHere(id: string) {
  return running.has(id);
}

export function stopJob(id: string) {
  running.get(id)?.abort();
}

/** Start (or restart) the job for a message. Returns right away; progress goes to onJobsChange. */
export function startJob(id: string, chatId: string, goal: string) {
  if (running.has(id)) return;
  const ctrl = new AbortController();
  running.set(id, ctrl);
  void runJob(id, chatId, goal, ctrl.signal).finally(() => running.delete(id));
}

async function runJob(id: string, chatId: string, goal: string, signal: AbortSignal) {
  const previous = getJob(id);
  let job: JobState = { id, chatId, goal, activity: "Starting", step: 0, filesChanged: [], usedNode: false, updatedAt: Date.now(), ...(previous?.goal === goal ? previous : {}), status: "running" };
  const set = (patch: Partial<JobState>) => putJob((job = { ...job, ...patch }));
  set({});

  const history: string[] = [...(job.checkpoint?.history || [])];
  let opened: { path: string; content: string }[] = job.checkpoint?.opened || [];
  let revision = (job.checkpoint?.revision || 0) + 1;
  const evidence: JobEvidence[] = []; // Reverify after reload; external processes may have stopped.
  const changed = new Set<string>(job.filesChanged);
  const workspaceEndpoint = `/api/chats/${encodeURIComponent(chatId)}/workspace`;
  const browserRunner = await runnerAvailable();
  const serverRunner = await fetch(workspaceEndpoint, { signal }).then((r) => r.ok).catch(() => false);
  const canRun = browserRunner || serverRunner;
  const workspaceAction = async (body: Record<string, unknown>) => {
    const response = await fetch(workspaceEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Workspace action failed (HTTP ${response.status}).`);
    return result;
  };
  const syncToServer = async () => {
    for (const file of loadProject(chatId).files) await workspaceAction({ action: "write_file", path: file.path, content: file.code });
  };
  set({ usedNode: canRun });

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal.aborted) return set({ status: "stopped", activity: "Stopped" });
      const project = loadProject(chatId);
      // Small projects go in whole, so the model doesn't waste steps reading.
      const total = project.files.reduce((n, f) => n + f.code.length, 0);
      const files = project.files.map((f) => ({ path: f.path, bytes: f.code.length }));
      const context = selectProjectContext(project.files.map((f) => ({ path: f.path, content: f.code })), `${goal} ${history.at(-1) || ""}`);
      const explicitPaths = new Set(opened.map((f) => f.path));
      const openNow = total < 24_000 ? project.files.map((f) => ({ path: f.path, content: f.code })) : [...opened, ...context.files.filter((f) => !explicitPaths.has(f.path))];
      set({ step, activity: step === 1 ? "Planning" : "Thinking" });

      const req: StepRequest = { goal, files, opened: openNow, history, canRun, step, maxSteps: MAX_STEPS };
      const res = await fetch("/api/code/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal });
      const data = (await res.json().catch(() => null)) as (CodeStep & { error?: string }) | null;
      if (!res.ok || !data) {
        history.push(`Step ${step}: your reply couldn't be used (${data?.error || res.status}). Reply with the JSON object only.`);
        continue;
      }

      opened = [];
      const notes: string[] = [...(data.errors || [])];
      let operationFailed = Boolean(data.errors?.length);
      const writes = data.ops.filter((o) => o.op === "write" || o.op === "edit" || o.op === "delete");
      if (writes.length) set({ activity: `Writing ${writes.length} file${writes.length > 1 ? "s" : ""}` });
      for (const op of data.ops) {
        if (signal.aborted) break;
        try {
        if (op.op === "write" || op.op === "edit" || op.op === "delete") {
          if (!writablePath(op.path)) {
            notes.push(`skipped ${op.path} (not allowed)`);
            operationFailed = true;
            continue;
          }
          const path = normalizePath(op.path);
          const oldFile = loadProject(chatId).files.find((f) => f.path === path);
          let content = op.op === "write" ? op.content : "";
          if (op.op === "edit") {
            try {
              if (!oldFile) throw new Error("File does not exist; read it before editing.");
              content = applyExactEdit(oldFile.code, op.find, op.replace);
            } catch (error) { operationFailed = true; notes.push(`edit ${path} failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
          }
          if (serverRunner) await workspaceAction(op.op !== "delete" ? { action: "write_file", path, content } : { action: "delete_file", path });
          updateProject(chatId, (p) =>
            op.op !== "delete"
              ? { ...p, files: p.files.some((f) => f.path === path) ? p.files.map((f) => (f.path === path ? { ...f, code: content, edited: false, sourceId: undefined } : f)) : [...p.files, { path, code: content }] }
              : { ...p, files: p.files.filter((f) => f.path !== path) },
          );
          changed.add(path);
          revision++;
          notes.push(`${op.op === "write" ? "wrote" : "deleted"} ${path}`);
        } else if (op.op === "read") {
          const f = loadProject(chatId).files.find((x) => x.path === normalizePath(op.path));
          if (f) opened.push({ path: f.path, content: f.code });
          else { operationFailed = true; notes.push(`${op.path} doesn't exist`); }
        } else if (op.op === "youtube" || op.op === "fetch" || op.op === "search") {
          const what = op.op === "fetch" ? op.url : op.query;
          set({ activity: op.op === "fetch" ? `Checking ${what.replace(/^https?:\/\//, "").slice(0, 40)}` : `Looking up ${what.slice(0, 40)}` });
          const r = await fetch("/api/code/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(op.op === "fetch" ? { tool: "fetch", url: op.url } : { tool: op.op, query: op.query }),
            signal,
          })
            .then((x) => x.json() as Promise<{ result?: string; error?: string }>)
            .catch((e): { result?: string; error?: string } => ({ result: `Lookup failed: ${e instanceof Error ? e.message : String(e)}` }));
          notes.push(`${op.op} ${what}:\n${r.result || r.error || "(no result)"}`);
        } else if (op.op === "run") {
          if (!canRun) {
            notes.push(`can't run "${op.cmd}": Node isn't available`);
            operationFailed = true;
            continue;
          }
          set({ activity: `Running ${op.cmd}` });
          let r: { exitCode: number | null; output: string; url?: string };
          if (browserRunner) r = await runCommand(chatId, op.cmd, /install/.test(op.cmd) ? 300_000 : 180_000);
          else {
            await syncToServer();
            if (/^(npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve|preview)\b/.test(op.cmd)) {
              const { server } = await workspaceAction({ action: "start_server", command: op.cmd });
              r = { exitCode: server.status === "running" ? null : 1, output: `${server.stdout}\n${server.stderr}`, url: server.status === "running" ? server.url : undefined };
            } else {
              const { record, ledger } = await workspaceAction({ action: "run_command", command: op.cmd });
              r = { exitCode: record.blockedReason ? 1 : record.exitCode, output: `${record.stdout}\n${record.stderr}` };
              const serverFiles = Object.values(ledger.files) as { path: string; code: string }[];
              const before = loadProject(chatId);
              if (serverFiles.length !== before.files.length || serverFiles.some((f) => !before.files.some((old) => old.path === f.path && old.code === f.code))) {
                revision++;
                updateProject(chatId, (project) => ({ ...project, files: serverFiles.map((f) => ({ path: f.path, code: f.code })) }));
              }
            }
          }
          evidence.push({ command: op.cmd, exitCode: r.exitCode, revision });
          if (r.url) set({ previewUrl: r.url });
          notes.push(`$ ${op.cmd}\n${r.exitCode === null ? "(still running in the background)" : `exit ${r.exitCode}`}${r.url ? ` · server at ${r.url}` : ""}\n${r.output.slice(-4000)}`);
        } else if (op.op === "inspect") {
          if (!serverRunner) { operationFailed = true; notes.push("Browser inspection is unavailable: server runtime not connected."); continue; }
          set({ activity: "Inspecting actual app in Chromium" });
          await syncToServer();
          const { inspection } = await workspaceAction({ action: "inspect_browser", url: op.url || job.previewUrl, interactions: op.interactions, expectedText: op.expectedText, requireMediaPlayback: codingRequirements(goal).playback || op.requireMediaPlayback });
          evidence.push({ command: "inspect", exitCode: inspection.passed ? 0 : 1, revision, browserPassed: inspection.passed, mediaPlaybackPassed: inspection.mediaPlayback?.some((media: { verified: boolean }) => media.verified) });
          notes.push(`Browser: ${JSON.stringify({ passed: inspection.passed, pageErrors: inspection.pageErrors, consoleErrors: inspection.consoleErrors, failedRequests: inspection.failedRequests, layoutIssues: inspection.layoutIssues, interactions: inspection.interactions })}`);
        }
        } catch (error) { operationFailed = true; notes.push(`${op.op} failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      set({ filesChanged: [...changed] });
      history.push(`Step ${step}${data.thought ? ` (${data.thought})` : ""}: ${notes.join("\n") || "no changes"}`);
      set({ checkpoint: { history: history.slice(-50), opened, revision, evidence } });

      if (data.done) {
        const blockers = completionBlockers(loadProject(chatId).files, evidence, revision, canRun, codingRequirements(goal));
        if (!canRun) return set({ status: "unverified", activity: "Files saved; execution unavailable", summary: "Project files were saved. Execution and functional behavior have not been verified." });
        if (blockers.length || operationFailed) { history.push(`Completion rejected: ${blockers.join(" ")} ${operationFailed ? "Resolve the failed tool operations." : ""}`); continue; }
        return set({ status: "done", activity: "Finished", summary: data.summary || "Done." });
      }
    }
    set({ status: "unverified", activity: "Step limit reached; incomplete", summary: `Reached the ${MAX_STEPS}-step limit. Saved files and task context are available; resume to continue verification.` });
  } catch (err) {
    if (signal.aborted) return set({ status: "stopped", activity: "Stopped" });
    set({ status: "failed", activity: "Failed", error: err instanceof Error ? err.message : String(err) });
  }
}

/** The chat's project (plus any build output Node produced) as a .zip download. */
export async function downloadProjectZip(chatId: string, name = "project") {
  const files: Record<string, Uint8Array> = {};
  for (const f of loadProject(chatId).files) files[f.path] = strToU8(f.code);
  for (const g of await listGenerated(chatId).catch(() => [])) files[g.path.replace(/^\//, "")] ??= g.content;
  const blob = new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, "-").slice(0, 40) || "project"}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
