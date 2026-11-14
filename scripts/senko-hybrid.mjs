import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function hybridPython() {
  return process.env.SENKO_NEURAL_PYTHON || path.resolve(process.cwd(), ".data/voice/neural-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}
export function hybridAvailable() {
  return existsSync(hybridPython()) && ["kokoro-v1.0.onnx", "voices-v1.0.bin", "manifest.json"].every(name => existsSync(path.resolve(process.cwd(), ".data/voice/models/senko-hybrid-v1", name)));
}
export async function hybridSpeech({ text, emotion, plan, durationSeconds = 30, signal, onProgress }) {
  signal?.throwIfAborted();
  const dir = await mkdtemp(path.join(tmpdir(), "senko-hybrid-"));
  try {
    const request = path.join(dir, "request.json"), output = path.join(dir, "speech.wav");
    await writeFile(request, JSON.stringify({ text, emotion, plan, durationSeconds }), { mode: 0o600 });
    const meta = await new Promise((resolve, reject) => {
      let idleTimer, timedOut = false, pending = "";
      const child = execFile(hybridPython(), [path.resolve(process.cwd(), "scripts/senko-hybrid.py"), request, output],
        { signal, timeout: 240000, windowsHide: true, maxBuffer: 65536, env: { ...process.env, PYTHONUTF8: "1" } }, (error, stdout, stderr) => {
          clearTimeout(idleTimer);
          if (error) {
            console.warn("[voice] Neural inference failed", stderr.slice(-1500));
            reject(new Error(signal?.aborted ? "Neural voice generation cancelled" : /duration limit/.test(stderr) ? "Generated speech exceeds the selected duration limit" : timedOut || error.killed ? "Neural voice generation timed out" : "Neural voice generation failed"));
          } else {
            try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { reject(new Error("The neural voice returned invalid metadata")); }
          }
        });
      // A longer message may contain many parts, but any single stalled part is
      // still stopped after sixty seconds without model progress.
      const resetDeadline = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      };
      resetDeadline();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "progress") {
            resetDeadline();
            try { onProgress?.(event.progress); } catch (error) { child.kill(); reject(error); }
          }
        }
      });
    });
    return { ...meta, audio: await readFile(output), mime: "audio/wav" };
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}
