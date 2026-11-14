import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { inspectWav } from "../../../scripts/windows-voice.mjs";
import { VoiceError } from "./voice-policy";

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
