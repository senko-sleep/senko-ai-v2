import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = path.join(root, ".data/voice/neural-venv");
const python = process.env.SENKO_NEURAL_PYTHON || path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (process.env.SENKO_NEURAL_PYTHON && !existsSync(python)) throw new Error("SENKO_NEURAL_PYTHON points to an unavailable interpreter.");
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: "inherit", windowsHide: true });
let uv = true;
try { execFileSync("uv", ["--version"], { stdio: "ignore", windowsHide: true }); } catch { uv = false; }
if (!existsSync(python)) {
  await mkdir(path.dirname(venv), { recursive: true });
  if (uv) run("uv", ["venv", "--python", "3.13", venv]);
  else run(process.platform === "win32" ? "py" : "python3", [...(process.platform === "win32" ? ["-3.13"] : []), "-m", "venv", venv]);
}
const lock = path.join(root, "voice/senko/neural-requirements.lock.txt");
if (uv) run("uv", ["pip", "sync", "--python", python, lock]);
else run(python, ["-m", "pip", "install", "-r", lock]);
run(python, ["scripts/neural-voice-setup.py"]);
// Only select the engine after a real cold inference succeeds.
run(process.execPath, ["--input-type=module", "-e", "import {hybridSpeech} from './scripts/senko-hybrid.mjs';const r=await hybridSpeech({text:'Welcome back. Let us make something worth sharing.',durationSeconds:30});console.log('Neural speech verified:',r.audio.length,'bytes,',r.seconds,'seconds.');"]);
const envFile = path.join(root, ".env.local");
let env = await readFile(envFile, "utf8").catch(() => "");
const key = "SENKO_VOICE_ENGINE";
env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=senko-hybrid`) : `${env}\n${key}=senko-hybrid\n`;
// A single local inference slot fits this laptop. Keep explicit administrator settings.
if (!/^SENKO_VOICE_GLOBAL_CONCURRENT=/m.test(env)) env += "\nSENKO_VOICE_GLOBAL_CONCURRENT=1\n";
await writeFile(envFile, env);
console.log("Senko neural hybrid is installed, tested and selected. Restart the app if it is not watching .env.local.");
