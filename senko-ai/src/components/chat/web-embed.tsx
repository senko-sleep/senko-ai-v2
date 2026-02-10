"use client";

import { useState, useRef, useCallback } from "react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw, AlertTriangle, Play, Globe } from "lucide-react";
import type { WebEmbed as WebEmbedType } from "@/types/chat";

// Sites whose JS-driven video players / heavy dynamic content break through the HTML proxy.
// For these, show a clean link card instead of a broken iframe.
const UNEMBEDDABLE_PATTERNS = [
  /rule34video\./i,
  /rule34\.xxx/i,
  /xvideos\./i,
  /xnxx\./i,
  /pornhub\./i,
  /xhamster\./i,
  /redtube\./i,
  /youporn\./i,
  /spankbang\./i,
  /eporner\./i,
  /tnaflix\./i,
  /hentaihaven\./i,
  /hanime\./i,
  /nhentai\./i,
  /e621\./i,
  /gelbooru\./i,
  /danbooru\./i,
  /sankaku/i,
  /hitomi\.la/i,
  /iwara\./i,
  /newgrounds\.com/i,
  /dailymotion\./i,
  /vimeo\./i,
  /twitch\.tv/i,
  /tiktok\./i,
  /instagram\./i,
  /facebook\.com\/.*video/i,
  /twitter\.com/i,
  /x\.com/i,
];

function isUnembeddable(url: string): boolean {
  return UNEMBEDDABLE_PATTERNS.some((p) => p.test(url));
}

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

  const skipIframe = isUnembeddable(embed.url);

  // For sites that can't be proxied, render a compact link card
  if (skipIframe) {
    return (
      <div className="mt-2 w-full max-w-md overflow-hidden rounded-2xl relative group/embed">
        <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[var(--senko-accent)]/30 via-white/[0.08] to-[var(--senko-accent)]/10 pointer-events-none" />
        <a
          href={embed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center gap-4 rounded-2xl bg-black hover:bg-white/[0.03] transition-colors px-5 py-4"
        >
          <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-[var(--senko-accent)]/10 flex items-center justify-center">
            <Play className="h-5 w-5 text-[var(--senko-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-zinc-200 font-medium truncate">
              {embed.title || "Open link"}
            </p>
            <p className="text-[11px] text-zinc-500 truncate mt-0.5 flex items-center gap-1.5">
              <Globe className="h-3 w-3 flex-shrink-0" />
              {hostname}
            </p>
          </div>
          <ExternalLink className="h-4 w-4 text-zinc-500 flex-shrink-0" />
        </a>
      </div>
    );
  }

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
    <div className="mt-2 w-full overflow-hidden rounded-2xl relative group/embed">
      {/* Gradient border effect */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[var(--senko-accent)]/30 via-white/[0.08] to-[var(--senko-accent)]/10 pointer-events-none" />
      <div className="relative rounded-2xl overflow-hidden bg-black">
        {/* Header bar */}
        <div className="flex items-center justify-between bg-gradient-to-r from-white/[0.04] to-white/[0.02] px-4 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
              alt=""
              className="h-4 w-4 rounded-sm flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="min-w-0">
              <span className="text-[12px] text-zinc-300 font-medium truncate block">
                {embed.title || hostname || "Web page"}
              </span>
              <span className="text-[10px] text-zinc-600 truncate block">
                {hostname}
              </span>
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
              className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all"
              title={expanded ? "Minimize" : "Expand"}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-1.5 text-zinc-500 hover:text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/10 transition-all"
              title="Open in browser"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* iframe */}
        <div
          className="relative w-full bg-black transition-all duration-300"
          style={{ height: expanded ? "85vh" : "500px" }}
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/95 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="h-5 w-5 border-2 border-zinc-700 border-t-[var(--senko-accent)] rounded-full animate-spin" />
                <span className="text-xs text-zinc-500">Loading {hostname || "site"}...</span>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/95 z-10">
              <div className="text-center space-y-3">
                <div className="mx-auto h-10 w-10 rounded-xl bg-[var(--senko-accent)]/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-[var(--senko-accent)]/60" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400 font-medium">Can&apos;t embed this site</p>
                  <p className="text-xs text-zinc-600 mt-1">The site may block iframe embedding</p>
                </div>
                <a
                  href={embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--senko-accent)] hover:text-[#ffcc80] transition-colors font-medium"
                >
                  Open in browser
                  <ExternalLink className="h-3 w-3" />
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
    </div>
  );
}
