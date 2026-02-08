"use client";

import { useState, useRef, useCallback } from "react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw, AlertTriangle } from "lucide-react";
import type { WebEmbed as WebEmbedType } from "@/types/chat";

interface WebEmbedProps {
  embed: WebEmbedType;
}

export function WebEmbed({ embed }: WebEmbedProps) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  let hostname = "";
  try { hostname = new URL(embed.url).hostname; } catch { /* skip */ }

  const handleLoad = useCallback(() => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    setLoaded(true);
    // Check if the iframe loaded an error page by trying to read its content
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc && doc.title && doc.title.toLowerCase().includes("error")) {
        setError(true);
      }
    } catch {
      // Cross-origin -- that's fine, it means content loaded
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLoaded(false);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = `/api/proxy?url=${encodeURIComponent(embed.url)}`;
    }
  }, [embed.url]);

  // Set a timeout to detect if the iframe never loads
  const handleIframeRef = useCallback((el: HTMLIFrameElement | null) => {
    (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = el;
    if (el) {
      loadTimerRef.current = setTimeout(() => {
        if (!loaded) {
          setLoaded(true);
          // Don't set error -- the proxy returns a styled error page on failure
        }
      }, 20000);
    }
  }, [loaded]);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-white/[0.03] px-2 py-1 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
            alt=""
            className="h-3 w-3 rounded-sm flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[10px] text-zinc-500 truncate">
            {embed.title || hostname || embed.url}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {error && (
            <button
              onClick={handleRetry}
              className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Retry"
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
            title={expanded ? "Minimize" : "Expand"}
          >
            {expanded ? <Minimize2 className="h-2.5 w-2.5" /> : <Maximize2 className="h-2.5 w-2.5" />}
          </button>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Open in browser"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>

      {/* iframe */}
      <div
        className="relative w-full bg-black transition-all"
        style={{ height: expanded ? "600px" : "350px" }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
              <div className="h-3 w-3 border-2 border-zinc-600 border-t-[#00d4ff] rounded-full animate-spin" />
              loading {hostname || "site"}...
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            <div className="text-center">
              <AlertTriangle className="h-5 w-5 text-[#00d4ff]/60 mx-auto mb-2" />
              <p className="text-xs text-zinc-500 mb-1">This site can&apos;t be embedded</p>
              <a
                href={embed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[#00d4ff] hover:text-[#66e5ff] underline underline-offset-2"
              >
                Open in browser →
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
          onError={() => { setLoaded(true); setError(true); }}
        />
      </div>
    </div>
  );
}
