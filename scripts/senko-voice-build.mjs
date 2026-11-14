import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compileVoicebank, SENKO_RENDERER_VERSION } from "./senko-voice-core.mjs";

const bank = JSON.parse(await readFile("voice/senko/voicebank.json", "utf8"));
const dir = `.data/voice/models/${bank.id}`;
await mkdir(dir, { recursive: true });
const manifest = { id: bank.id, version: bank.version, rendererVersion: SENKO_RENDERER_VERSION, fingerprint: compileVoicebank(bank).fingerprint, kind: bank.kind, engine: "eSpeak NG Emscripten 0.3.5", source: "voice/senko/voicebank.json", files: {} };
const files = { "voicebank.json": JSON.stringify(bank, null, 2) + "\n" };
for (const mood of Object.keys(bank.moods)) files[`${mood}.voice`] = compileVoicebank(bank, mood).variant;
for (const [name, data] of Object.entries(files)) {
  await writeFile(`${dir}/${name}`, data);
  manifest.files[name] = createHash("sha256").update(data).digest("hex");
}
await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${bank.id}: ${Object.keys(files).length} voicebank assets in ${dir}. No neural checkpoint or training is claimed.`);
