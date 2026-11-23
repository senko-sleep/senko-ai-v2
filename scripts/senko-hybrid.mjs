import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// One long-lived Python process keeps the neural model loaded, so successive sections don't each
// pay a cold start. Jobs run one at a time. The process exits after a few idle minutes to give
// the memory back.
const LOAD_TIMEOUT_MS = () => Number(process.env.SENKO_NEURAL_LOAD_TIMEOUT_MS) || 180_000;
const STALL_TIMEOUT_MS = () => Number(process.env.SENKO_NEURAL_STALL_TIMEOUT_MS) || 120_000;
const IDLE_EXIT_MS = () => Number(process.env.SENKO_NEURAL_IDLE_MS) || 180_000;
const STALE_TEMP_MS = 60 * 60_000;
const CLEANUP = { recursive: true, force: true, maxRetries: 8, retryDelay: 150 };

const state = (globalThis.__senkoNeural ??= { worker: null, tail: Promise.resolve(), nextId: 1 });

export function hybridPython() {
  return process.env.SENKO_NEURAL_PYTHON || path.resolve(process.cwd(), ".data/voice/neural-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}
export function hybridAvailable() {
  return existsSync(hybridPython()) && ["kokoro-v1.0.onnx", "voices-v1.0.bin", "manifest.json"].every(name => existsSync(path.resolve(process.cwd(), ".data/voice/models/senko-hybrid-v1", name)));
}

class NeuralError extends Error {
  constructor(message, retryable = false) { super(message); this.retryable = retryable; }
}

/** Temp folders from a worker that was killed before its parent could clean up. */
function sweepStaleTemp() {
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith("senko-neural-")) continue;
      const dir = path.join(tmpdir(), name);
      if (Date.now() - statSync(dir).mtimeMs > STALE_TEMP_MS) rmSync(dir, CLEANUP);
    }
  } catch { /* best effort */ }
}

function holdProcess(worker, hold) {
  // An idle worker must not keep Node (a test run, a CLI) from exiting.
  for (const handle of [worker.child, worker.child.stdin, worker.child.stdout, worker.child.stderr]) {
    if (hold) handle?.ref?.(); else handle?.unref?.();
  }
}

/** Stop a worker and make sure no new job can be handed to it while it exits. */
function retire(worker) {
  if (state.worker === worker) state.worker = null;
  worker.child.kill();
}

function startWorker() {
  sweepStaleTemp();
  const dir = mkdtempSync(path.join(tmpdir(), "senko-neural-"));
  const python = hybridPython();
  const child = spawn(python, [path.resolve(process.cwd(), "scripts/senko-hybrid.py"), "--serve"], {
    cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1", TEMP: dir, TMP: dir, TMPDIR: dir },
  });
  const worker = { child, dir, python, job: null, stderr: "", gone: false, idle: undefined, ready: null };
  let settleReady;
  worker.ready = new Promise((resolve, reject) => { settleReady = { resolve, reject }; });
  worker.ready.catch(() => {});
  const loadTimer = setTimeout(() => {
    settleReady.reject(new NeuralError("Neural voice generation timed out while loading the model", true));
    retire(worker);
  }, LOAD_TIMEOUT_MS());

  const finish = reason => {
    if (worker.gone) return;
    worker.gone = true;
    clearTimeout(loadTimer);
    clearTimeout(worker.idle);
    if (state.worker === worker) state.worker = null;
    const failure = new NeuralError(reason, true);
    settleReady.reject(failure);
    worker.job?.reject(failure);
    worker.job = null;
    // The parent owns this folder, so it's removed only after the process has really exited.
    void rm(dir, CLEANUP).catch(() => {});
  };
  child.on("error", () => finish("Neural voice generation failed to start"));
  child.on("exit", code => {
    if (worker.job && worker.stderr.trim()) console.warn("[voice] Neural worker exited during inference", worker.stderr.slice(-1500));
    finish(`Neural voice generation failed (worker exit ${code ?? "signal"})`);
  });
  child.stdin.on("error", () => {});
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", text => { worker.stderr = (worker.stderr + text).slice(-4000); });
  child.stdout.setEncoding("utf8");
  let pending = "";
  child.stdout.on("data", chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "ready") {
        clearTimeout(loadTimer);
        settleReady.resolve(worker);
      } else if (worker.job && event.id === worker.job.id) {
        if (event.type === "progress") worker.job.progress(event.progress);
        else if (event.type === "result") worker.job.resolve(event.meta);
        else if (event.type === "error") worker.job.reject(new NeuralError(event.message, !!event.recoverable));
      }
    }
  });
  state.worker = worker;
  return worker;
}

async function renderOnce(request, signal, onProgress) {
  if (state.worker && state.worker.python !== hybridPython()) retire(state.worker);
  const worker = state.worker && !state.worker.gone ? state.worker : startWorker();
  clearTimeout(worker.idle);
  holdProcess(worker, true);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      reject(new NeuralError("Neural voice generation cancelled"));
      retire(worker); // The only way to stop an inference that's already running.
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  aborted.catch(() => {});
  let stall;
  try {
    await Promise.race([worker.ready, aborted]);
    return await Promise.race([aborted, new Promise((resolve, reject) => {
      const id = state.nextId++;
      const resetStall = () => {
        clearTimeout(stall);
        stall = setTimeout(() => {
          reject(new NeuralError("Neural voice generation timed out", true));
          retire(worker);
        }, STALL_TIMEOUT_MS());
      };
      worker.job = {
        id, resolve, reject,
        progress: value => {
          resetStall();
          try { onProgress?.(value); } catch (error) { reject(error); retire(worker); }
        },
      };
      resetStall();
      worker.child.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
    })]);
  } finally {
    clearTimeout(stall);
    signal?.removeEventListener("abort", onAbort);
    if (!worker.gone) {
      worker.job = null;
      holdProcess(worker, false);
      worker.idle = setTimeout(() => worker.child.stdin.end(), IDLE_EXIT_MS());
      worker.idle.unref?.();
    }
  }
}

/** Stop the loaded model now (tests, shutdown). The next job starts a fresh worker. */
export function stopHybridWorker() {
  if (state.worker) retire(state.worker);
}

export async function hybridSpeech({ text, emotion, plan, durationSeconds = 60, signal, onProgress }) {
  signal?.throwIfAborted();
  // Jobs take turns: the model renders one request at a time.
  const previous = state.tail;
  let release;
  state.tail = new Promise(resolve => { release = resolve; });
  const dir = await mkdtemp(path.join(tmpdir(), "senko-hybrid-"));
  try {
    await previous;
    if (signal?.aborted) throw new NeuralError("Neural voice generation cancelled");
    const output = path.join(dir, "speech.wav");
    const request = { text, emotion, plan, durationSeconds, output };
    for (let attempt = 0; ; attempt++) {
      try {
        const meta = await renderOnce(request, signal, onProgress);
        return { ...meta, audio: await readFile(output), mime: "audio/wav" };
      } catch (error) {
        if (signal?.aborted) throw new Error("Neural voice generation cancelled");
        const message = error instanceof Error ? error.message : String(error);
        if (/duration limit/.test(message)) throw new Error("Generated speech exceeds the selected duration limit");
        // Only a crash, stall or filesystem error is worth one retry on a fresh process.
        if (error instanceof NeuralError && error.retryable && attempt === 0 && existsSync(hybridPython())) {
          console.warn("[voice] Neural worker failed; retrying once", message);
          stopHybridWorker();
          continue;
        }
        console.warn("[voice] Neural inference failed", message);
        throw new Error(/timed out/.test(message) ? "Neural voice generation timed out" : "Neural voice generation failed");
      }
    }
  } finally {
    release();
    await rm(dir, CLEANUP).catch(() => {});
  }
}
