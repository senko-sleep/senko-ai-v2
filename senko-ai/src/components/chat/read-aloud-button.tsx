"use client";

import { useState, useEffect, useMemo } from "react";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { audioManager } from "@/lib/audio-manager";
import { cn } from "@/lib/utils";

interface ReadAloudButtonProps {
  messageId: string;
  text: string;
  className?: string;
}

export function ReadAloudButton({ messageId, text, className }: ReadAloudButtonProps) {
  const initialState = useMemo(() => {
    if (!audioManager) return "idle" as const;
    const { state, messageId: activeId } = audioManager.getState();
    return activeId === messageId ? state : "idle" as const;
  }, [messageId]);

  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">(initialState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!audioManager) return;
    const unsubscribe = audioManager.subscribe((newState, activeMessageId) => {
      if (activeMessageId === messageId) {
        setState(newState as "idle" | "loading" | "playing" | "paused");
        if (newState === "idle") setError(null);
      } else {
        setState("idle");
      }
    });
    return unsubscribe;
  }, [messageId]);

  const handleClick = async () => {
    if (!audioManager) { setError("Audio not available"); return; }
    setError(null);
    try {
      await audioManager.toggle(messageId, text);
    } catch (err) {
      setError((err as Error).message || "TTS failed");
      setTimeout(() => setError(null), 3000);
    }
  };

  const isLoading = state === "loading";
  const isPlaying = state === "playing";
  const isPaused = state === "paused";
  const isActive = isLoading || isPlaying || isPaused;

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          "rounded-lg p-2 transition-all",
          isActive
            ? "text-[var(--senko-accent)] bg-[var(--senko-accent)]/10 hover:bg-[var(--senko-accent)]/20"
            : "text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06]",
          isPlaying && "animate-pulse",
          className
        )}
        title={isPlaying ? "Stop" : isPaused ? "Stop" : isLoading ? "Loading..." : "Read aloud"}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isActive ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>

      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
}
