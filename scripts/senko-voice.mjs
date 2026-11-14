import { Worker } from "node:worker_threads";
import path from "node:path";

/** CPU synthesis runs in a terminable worker, away from the app event loop. */
export async function senkoSpeech({ text, emotion, bank, maxSeconds = 120, signal }) {
  signal?.throwIfAborted();
  const worker = new Worker(path.resolve(process.cwd(), "scripts/senko-voice-worker.mjs"), {
    workerData: { text, emotion, bank, maxSeconds }, resourceLimits: { maxOldGenerationSizeMb: 192 },
    execArgv: [], // Do not inherit tsx, test runners or --input-type flags.
  });
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new Error("Senko voice generation cancelled"));
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", message => {
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve({ ...message, audio: Buffer.from(message.audio) });
      });
      worker.once("error", error => { cleanup(); reject(error); });
      worker.once("exit", code => { cleanup(); reject(new Error(`Senko voice worker exited before a result (${code})`)); });
      if (signal?.aborted) abort();
    });
  } finally { await worker.terminate(); }
}
