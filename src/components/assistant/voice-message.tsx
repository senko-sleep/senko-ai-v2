import { useState } from "react";
import type { VoiceNote } from "./lib";

export function VoiceMessage({ voice }: { voice: VoiceNote }) {
  const [status, setStatus] = useState("Audio ready");
  const [seconds, setSeconds] = useState(voice.seconds || 0);
  const src = `/api/uploads/${encodeURIComponent(voice.audioId)}`;
  return <section className="my-2 rounded-xl border border-[var(--sk-line)] p-3" aria-label="Voice message">
    <p className="mb-2 text-xs text-[var(--sk-muted)]">{voice.voice} · {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, "0")}</p>
    <audio controls preload="metadata" src={src} aria-label={`${voice.voice} voice message`} className="w-full max-w-sm"
      onLoadStart={() => setStatus("Loading audio")}
      onLoadedMetadata={e => { if (Number.isFinite(e.currentTarget.duration)) setSeconds(e.currentTarget.duration); setStatus("Audio ready"); }}
      onWaiting={() => setStatus("Loading audio")}
      onPlaying={() => setStatus("Playing")}
      onPause={() => setStatus("Paused")}
      onEnded={() => setStatus("Audio ready")}
      onError={() => setStatus("Audio playback failed. Try downloading the audio.")} />
    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--sk-muted)]">
      <span role="status">{status}</span><a href={src} download>Download audio</a>
    </div>
  </section>;
}
