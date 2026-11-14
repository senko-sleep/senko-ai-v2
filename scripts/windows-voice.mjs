import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function windowsSpeech(text, signal) {
  const dir = await mkdtemp(path.join(tmpdir(), "senko-voice-"));
  try {
    const input = path.join(dir, "input.json");
    const output = path.join(dir, "output.wav");
    await writeFile(input, JSON.stringify({ text }), { mode: 0o600 });
    const name = await new Promise((resolve, reject) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.resolve(process.cwd(), "scripts/windows-voice.ps1"), "-InputFile", input, "-OutputFile", output],
        { windowsHide: true, signal, timeout: 60_000, maxBuffer: 32_768 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    });
    return { audio: await readFile(output), mime: "audio/wav", voice: `${name} (fallback voice)` };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Decode PCM WAV structure rather than trusting MIME headers or a reported duration. */
export function inspectWav(audio) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE" || audio.readUInt32LE(4) + 8 !== audio.length) throw new Error("Invalid WAV file");
  let format, sampleRate, channels, bits, blockAlign, byteRate, size = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("ascii", offset, offset + 4);
    const length = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > audio.length) throw new Error("Truncated WAV data");
    if (id === "fmt " && length >= 16) {
      format = audio.readUInt16LE(start); channels = audio.readUInt16LE(start + 2);
      sampleRate = audio.readUInt32LE(start + 4); byteRate = audio.readUInt32LE(start + 8);
      blockAlign = audio.readUInt16LE(start + 12); bits = audio.readUInt16LE(start + 14);
    }
    if (id === "data") size += length;
    offset = start + length + (length % 2);
  }
  if (format !== 1 || ![1, 2].includes(channels) || ![8, 16, 24, 32].includes(bits) || sampleRate < 8000 || sampleRate > 96000 || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign || !size || size % blockAlign) throw new Error("Unsupported or malformed PCM WAV");
  return { seconds: size / byteRate, sampleRate, channels, bits, bytes: audio.length };
}
