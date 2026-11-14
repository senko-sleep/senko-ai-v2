import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storage = path.join(root, ".data/voice");
for (const name of ["recordings", "models", "datasets"]) await mkdir(path.join(storage, name), { recursive: true });
try {
  await writeFile(path.join(storage, "config.json"), JSON.stringify({ modelModule: null, workers: [], maxConcurrent: 2, timeoutMs: 80000 }, null, 2) + "\n", { flag: "wx" });
} catch (error) { if (error.code !== "EEXIST") throw error; }
const envPath = path.join(root, ".env.local");
let env = await readFile(envPath, "utf8").catch(() => "");
for (const [key, value] of Object.entries({ SENKO_VOICE_ENGINE: "custom", SENKO_VOICE_URL: "http://127.0.0.1:7861/synthesize" })) {
  if (!new RegExp(`^\\s*${key}\\s*=`, "m").test(env)) env += `\n${key}=${value}\n`;
}
await writeFile(envPath, env);
console.log("Voice storage and local connection ready at .data/voice. Existing settings preserved.");
