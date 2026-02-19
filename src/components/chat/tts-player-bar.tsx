"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square } from "lucide-react";
import { audioManager } from "@/lib/audio-manager";
import { cn } from "@/lib/utils";

const BAR_COUNT = 28;

export function TtsPlayerBar() {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.15));
  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    if (!audioManager) return;
    const unsub = audioManager.subscribe((s) => {
      setState(s as "idle" | "loading" | "playing" | "paused");
    });
    return unsub;
  }, []);

  // Animate waveform bars
  useEffect(() => {
    const animate = () => {
      if (state === "playing") {
        phaseRef.current += 0.12;
        const p = phaseRef.current;
        setBars(
          Array.from({ length: BAR_COUNT }, (_, i) => {
            const base = Math.sin(p + i * 0.45) * 0.35 + 0.5;
            const noise = Math.sin(p * 2.3 + i * 1.1) * 0.15;
            return Math.max(0.08, Math.min(1, base + noise));
          })
        );
      } else if (state === "paused") {
        // Freeze bars at low height
        setBars((prev) => prev.map((b) => b * 0.85 + 0.08 * 0.15));
      } else {
        phaseRef.current = 0;
        setBars(Array(BAR_COUNT).fill(0.08));
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [state]);

  if (state === "idle") return null;

  const isPlaying = state === "playing";
  const isPaused = state === "paused";
  const isLoading = state === "loading";

  const handlePlayPause = () => {
    if (!audioManager) return;
    if (isPlaying) audioManager.pause();
    else if (isPaused) audioManager.resume();
  };

  const handleStop = () => {
    if (!audioManager) return;
    audioManager.stop();
  };

  return (
    <div className={cn(
      "fixed bottom-[72px] left-0 right-0 z-50 flex sm:hidden",
      "items-center gap-3 px-4 py-3 mx-3 mb-1 rounded-2xl",
      "bg-[#0e0e10]/90 backdrop-blur-xl border border-white/[0.08]",
      "shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
      "animate-in slide-in-from-bottom-4 duration-300"
    )}>
      {/* Waveform */}
      <div className="flex-1 flex items-center gap-[2px] h-8 overflow-hidden">
        {bars.map((h, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-full transition-none",
              isPlaying
                ? "bg-[var(--senko-accent)]"
                : isPaused
                  ? "bg-zinc-500"
                  : "bg-zinc-700"
            )}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </div>

      {/* Loading spinner or play/pause */}
      {isLoading ? (
        <div className="h-8 w-8 flex items-center justify-center">
          <div className="h-4 w-4 rounded-full border-2 border-[var(--senko-accent)] border-t-transparent animate-spin" />
        </div>
      ) : (
        <button
          onClick={handlePlayPause}
          className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--senko-accent)]/15 hover:bg-[var(--senko-accent)]/30 text-[var(--senko-accent)] transition-colors active:scale-95"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>
      )}

      {/* Stop */}
      <button
        onClick={handleStop}
        className="h-8 w-8 flex items-center justify-center rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-zinc-400 hover:text-zinc-200 transition-colors active:scale-95"
      >
        <Square className="h-3.5 w-3.5 fill-current" />
      </button>
    </div>
  );
}
