import { parentPort, workerData } from "node:worker_threads";
import { synthesizeSenko } from "./senko-voice-core.mjs";

try {
  const result = await synthesizeSenko(workerData);
  const audio = new Uint8Array(result.audio);
  parentPort.postMessage({ ...result, audio }, [audio.buffer]);
} catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : "Senko synthesis failed" }); }
