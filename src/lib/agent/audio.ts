// Live audio from the agent's browser (server/Docker only).
// Chrome plays into a PulseAudio null sink; ffmpeg reads that sink's monitor and
// encodes MP3, which the app plays with a plain <audio> element.
// AUDIO_SOURCE is set by the Docker entrypoint (e.g. "senko.monitor").
import { spawn } from "node:child_process";

export function audioAvailable(): boolean {
  return process.platform === "linux" && !!process.env.AUDIO_SOURCE;
}

/** Start an MP3 stream of whatever the browser is playing. */
export function audioStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  const ff = spawn(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "pulse", "-i", process.env.AUDIO_SOURCE || "default",
      "-ac", "2", "-ar", "44100",
      "-c:a", "libmp3lame", "-b:a", process.env.AUDIO_BITRATE || "128k",
      "-flush_packets", "1", "-f", "mp3", "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const kill = () => {
    if (!ff.killed) ff.kill("SIGKILL");
  };
  signal.addEventListener("abort", kill, { once: true });
  ff.stderr.on("data", (d) => console.warn(`[audio] ${String(d).trim()}`));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      ff.stdout.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          kill();
        }
      });
      ff.on("close", () => {
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel: kill,
  });
}

/** Read the audio stream for `ms` and return how many bytes arrived (used by tests). */
export async function probeAudio(ms: number): Promise<number> {
  if (!audioAvailable()) return 0;
  const ctl = new AbortController();
  const reader = audioStream(ctl.signal).getReader();
  let bytes = 0;
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
  } catch {
    /* aborted */
  } finally {
    clearTimeout(timer);
  }
  return bytes;
}
