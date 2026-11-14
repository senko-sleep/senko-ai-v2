"use client";

import { useEffect, useState } from "react";
import { AudioLines, Brain, Check, CircleAlert, Clock3, Loader2, Pause, WandSparkles } from "lucide-react";
import type { VoiceProgress } from "./lib";

const phaseCopy = {
  preparing: { title: "Preparing your voice message", detail: "Thinking through the story and writing the narration.", icon: Brain },
  queued: { title: "Your recording is queued", detail: "Waiting for a turn to generate the audio.", icon: Clock3 },
  synthesizing: { title: "Giving the story a voice", detail: "Recording each part in order.", icon: AudioLines },
  assembling: { title: "Joining the recording", detail: "Putting the completed parts into one audio message.", icon: WandSparkles },
  ready: { title: "Your recording is ready", detail: "The parts have been joined into one audio message.", icon: Check },
  error: { title: "Recording interrupted", detail: "The audio message could not be completed.", icon: CircleAlert },
};

export function VoiceGenerationProgress({ progress, pending, startedAt }: { progress: VoiceProgress; pending: boolean; startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [pending]);

  const stopped = !pending && progress.phase !== "ready" && progress.phase !== "error";
  const copy = phaseCopy[progress.phase];
  const Icon = stopped ? Pause : copy.icon;
  const total = Math.max(0, Math.floor(progress.total));
  const completed = Math.min(total, Math.max(0, Math.floor(progress.completed)));
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const working = pending && progress.phase !== "ready" && progress.phase !== "error";
  const failed = progress.phase === "error";
  const title = stopped ? "Recording stopped" : copy.title;
  const detail = stopped ? "The recording ended before all parts were joined." : progress.message || copy.detail;
  const barCount = Math.min(total, 24);

  return <section aria-label="Voice generation progress" className="my-3 max-w-xl overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-surface)] p-4">
    <div className="flex items-start gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--sk-line)] ${failed ? "text-[var(--sk-danger)]" : "text-[var(--sk-accent-ink)]"}`}>
        <Icon size={17} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-[var(--sk-text)]" role="status" aria-live="polite">{title}</p>
          {working && <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--sk-muted)]">
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden />
            <span aria-label="Elapsed time">{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}</span>
          </span>}
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-[var(--sk-muted)]">{detail}</p>
      </div>
    </div>
    {total > 0 && <div className="mt-4">
      <div role="progressbar" aria-label="Audio parts generated" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-valuetext={`${completed} of ${total} parts recorded`} className="flex h-2 gap-1 overflow-hidden rounded-sm">
        {Array.from({ length: barCount }, (_, index) => {
          const filled = (index + 1) / barCount <= completed / total;
          return <span key={index} aria-hidden className={`min-w-0 flex-1 rounded-sm ${filled ? "bg-[var(--sk-accent)]" : "bg-[var(--sk-line)]"}`} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-[var(--sk-muted)]">
        <span role="status" aria-live="polite">{completed} of {total} parts recorded</span>
        {progress.seconds !== undefined && progress.seconds > 0 && <span>{Math.floor(progress.seconds / 60)}:{String(Math.floor(progress.seconds % 60)).padStart(2, "0")} of audio</span>}
      </div>
    </div>}
  </section>;
}
