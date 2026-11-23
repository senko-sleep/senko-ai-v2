import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { inspectWav } from "../../../scripts/windows-voice.mjs";
import { VoiceError } from "./voice-policy";

function pcmOf(wav: Buffer) {
  const info = inspectWav(wav);
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString("ascii", offset, offset + 4), length = wav.readUInt32LE(offset + 4);
    if (id === "data") return { info, data: wav.subarray(offset + 8, offset + 8 + length) };
    offset += 8 + length + (length % 2);
  }
  throw new Error("WAV has no audio data");
}

/** Join same-format PCM WAVs in order with the given silence after each; reports where each starts. */
export function joinWavs(parts: { audio: Buffer; pauseAfterMs: number }[]): { audio: Buffer; starts: number[]; seconds: number } {
  if (!parts.length) throw new VoiceError(500, "assembly_failed", "There is no audio to assemble.");
  const pcm = parts.map(part => pcmOf(part.audio));
  const { sampleRate, channels, bits } = pcm[0].info;
  if (pcm.some(p => p.info.sampleRate !== sampleRate || p.info.channels !== channels || p.info.bits !== bits)) {
    throw new VoiceError(502, "assembly_failed", "The sections were recorded in different audio formats.");
  }
  const blockAlign = channels * bits / 8, byteRate = sampleRate * blockAlign;
  const chunks: Buffer[] = [], starts: number[] = [];
  let bytes = 0;
  pcm.forEach((p, i) => {
    starts.push(bytes / byteRate);
    chunks.push(p.data);
    bytes += p.data.length;
    if (i < pcm.length - 1 && parts[i].pauseAfterMs > 0) {
      const silence = Buffer.alloc(Math.round(parts[i].pauseAfterMs / 1000 * sampleRate) * blockAlign, bits === 8 ? 0x80 : 0);
      chunks.push(silence);
      bytes += silence.length;
    }
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + bytes, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii"); header.writeUInt32LE(bytes, 40);
  const audio = Buffer.concat([header, ...chunks]);
  if (audio.length % 2) throw new VoiceError(502, "assembly_failed", "The assembled recording was malformed.");
  return { audio, starts, seconds: inspectWav(audio).seconds };
}

/** Fully decode provider audio to a portable PCM WAV and measure its sample duration. */
export async function verifyVoiceAudio(audio: Buffer, seconds: number, signal?: AbortSignal) {
  if (audio.length < 44 || audio.length > 64 * 1024 * 1024) throw new VoiceError(502, "malformed_audio", "The speech engine returned an invalid audio file.");
  let wav = audio;
  let dir: string | undefined;
  try {
    if (audio.toString("ascii", 0, 4) !== "RIFF") {
      if (!ffmpeg) throw new Error("Audio decoder unavailable");
      const decoder = ffmpeg;
      dir = await mkdtemp(path.join(tmpdir(), "senko-decode-"));
      const input = path.join(dir, "input.audio"), output = path.join(dir, "output.wav");
      await writeFile(input, audio, { mode: 0o600 });
      await new Promise<void>((resolve, reject) => execFile(decoder, ["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", input, "-t", String(seconds + 1), "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", output],
        { signal, timeout: 15000, windowsHide: true, maxBuffer: 32768 }, error => error ? reject(error) : resolve()));
      wav = await readFile(output);
    }
    const info = inspectWav(wav);
    if (info.seconds > seconds + 0.05) throw new VoiceError(422, "duration_limit", `Generated speech exceeds the ${seconds}-second limit. Ask for a shorter message.`);
    if (info.seconds <= 0 || !Number.isFinite(info.seconds)) throw new Error("Missing audio samples");
    return { audio: wav, mime: "audio/wav", seconds: info.seconds };
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    console.warn("[voice] Audio validation failed", error instanceof Error ? error.message : "decode error");
    throw new VoiceError(502, "malformed_audio", "The speech engine returned audio that could not be decoded.");
  } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
}
