import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { senkoSpeech } from "./senko-voice.mjs";
import { inspectWav } from "./windows-voice.mjs";

const bank = JSON.parse(await readFile("voice/senko/voicebank.json", "utf8"));
const evaluation = JSON.parse(await readFile("voice/senko/evaluation.json", "utf8"));
const dir = ".data/voice/original/evaluation";
await mkdir(dir, { recursive: true });
const cases = [];
for (const mood of evaluation.moods) {
  for (let i = 0; i < evaluation.heldOut.length; i++) {
    const text = evaluation.heldOut[i];
    const start = performance.now();
    const result = await senkoSpeech({ text, emotion: mood, bank });
    const file = `${dir}/${mood}-${i}.wav`;
    await writeFile(file, result.audio);
    cases.push({ file, text, mood, model: result.model, fingerprint: result.fingerprint, synthesisMs: Math.round(performance.now() - start), ...inspectWav(result.audio) });
  }
  console.log(`Rendered ${mood}: ${evaluation.heldOut.length} actual speech samples`);
}
await writeFile(`${dir}/manifest.json`, JSON.stringify({ cases, evaluation }, null, 2));
await new Promise((resolve, reject) => {
  const child = execFile("python", ["scripts/senko-voice-evaluate.py", `${dir}/manifest.json`], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (stderr) process.stderr.write(stderr);
    process.stdout.write(stdout);
    if (error) reject(error); else resolve();
  });
  child.stdout?.on("data", () => {});
});
