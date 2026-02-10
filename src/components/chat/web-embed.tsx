"use client";

import { useState, useRef, useCallback } from "react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw, AlertTriangle, Globe } from "lucide-react";
import type { WebEmbed as WebEmbedType } from "@/types/chat";

interface WebEmbedProps {
  embed: WebEmbedType;
}

export function WebEmbed({ embed }: WebEmbedProps) {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  let hostname = "";
  try {
    hostname = new URL(embed.url).hostname;
  } catch {
    /* skip */
  }

  const handleLoad = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    setLoaded(true);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc && doc.title && doc.title.toLowerCase().includes("error")) {
        setError(true);
      }
    } catch {
      // Cross-origin -- that's fine
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLoaded(false);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = `/api/proxy?url=${encodeURIComponent(embed.url)}`;
    }
  }, [embed.url]);

  const handleIframeRef = useCallback(
    (el: HTMLIFrameElement | null) => {
      (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = el;
      if (el) {
        loadTimerRef.current = setTimeout(() => {
          if (!loaded) setLoaded(true);
        }, 20000);
      }
    },
    [loaded]
  );

  const toggleFullscreen = () => {
    if (!fullscreen) {
      setFullscreen(true);
      document.body.style.overflow = "hidden";
    } else {
      setFullscreen(false);
      document.body.style.overflow = "";
    }
  };

  const embedContent = (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-black animate-in fade-in duration-200"
          : "mt-2 overflow-hidden rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-colors duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
      }
    >
      {/* Header bar */}
      <div className="flex items-center justify-between bg-white/[0.04] px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
            alt=""
            className="h-4 w-4 rounded-sm flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0">
            <span className="text-xs font-medium text-zinc-300 truncate block">
              {embed.title || hostname || embed.url}
            </span>
            {embed.title && hostname && (
              <span className="text-[10px] text-zinc-500 truncate block">
                {hostname}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {error && (
            <button
              onClick={handleRetry}
              className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
              title="Retry"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all hidden sm:flex"
            title={expanded ? "Compact" : "Expand"}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
            title="Open in browser"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* iframe container */}
      <div
        className="relative w-full bg-[#0a0a0a] transition-all duration-300 flex-1"
        style={fullscreen ? undefined : { height: expanded ? "600px" : "400px" }}
      >
        {/* Loading skeleton */}
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a] z-10 gap-3">
            <div className="relative">
              <div className="h-8 w-8 rounded-full border-2 border-white/[0.08]" />
              <div className="absolute inset-0 h-8 w-8 rounded-full border-2 border-transparent border-t-[var(--senko-accent)] animate-spin" />
            </div>
            <div className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-zinc-600" />
              <span className="text-xs text-zinc-500">
                Loading {hostname || "site"}...
              </span>
            </div>
            {/* Skeleton bars */}
            <div className="w-48 space-y-2 mt-2">
              <div className="h-2 rounded-full bg-white/[0.04] animate-pulse" />
              <div className="h-2 rounded-full bg-white/[0.03] animate-pulse w-3/4" />
              <div className="h-2 rounded-full bg-white/[0.02] animate-pulse w-1/2" />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10">
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--senko-accent)]/10 border border-[var(--senko-accent)]/20">
                <AlertTriangle className="h-5 w-5 text-[var(--senko-accent)]/70" />
              </div>
              <div>
                <p className="text-sm text-zinc-400">Can&apos;t embed this site</p>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Some sites block iframe embedding
                </p>
              </div>
              <a
                href={embed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--senko-accent)] hover:text-[#ffcc80] transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Open in browser instead
              </a>
            </div>
          </div>
        )}

        <iframe
          ref={handleIframeRef}
          src={`/api/proxy?url=${encodeURIComponent(embed.url)}`}
          title={embed.title || embed.url}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={() => {
            setLoaded(true);
            setError(true);
          }}
        />
      </div>
    </div>
  );

  return embedContent;
}
