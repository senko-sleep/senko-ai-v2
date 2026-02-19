"use client";

import { useState, useCallback, useRef } from "react";
import type { VideoEmbed as VideoEmbedType } from "@/types/chat";

interface VideoEmbedProps {
  video: VideoEmbedType;
}

// Sites known to block direct video access (CORS/referer/hotlink protection)
// These get routed through the video proxy immediately instead of waiting for failure
const NEEDS_PROXY_PATTERN = /\b(xvideos|pornhub|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|hentaihaven|hanime|iwara|spankwire|xtube|thumbzilla|keezmovies)\b/i;

function needsProxy(url: string): boolean {
  return NEEDS_PROXY_PATTERN.test(url);
}

function getProxyUrl(url: string): string {
  return `/api/video-proxy?url=${encodeURIComponent(url)}`;
}

function getYouTubeEmbedUrl(video: VideoEmbedType): string | null {
  if (video.embedId) {
    return `https://www.youtube-nocookie.com/embed/${video.embedId}`;
  }
  const url = video.url;
  // youtube.com/watch?v=ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return `https://www.youtube-nocookie.com/embed/${watchMatch[1]}`;
  // youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return `https://www.youtube-nocookie.com/embed/${shortMatch[1]}`;
  // youtube.com/embed/ID
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return `https://www.youtube-nocookie.com/embed/${embedMatch[1]}`;
  return null;
}

type VideoState = "loading" | "playing" | "proxy-retry" | "failed";

export function VideoEmbed({ video }: VideoEmbedProps) {
  // For known blocked sites, start with proxy URL immediately
  const startWithProxy = needsProxy(video.url);
  const [state, setState] = useState<VideoState>("loading");
  const [currentSrc, setCurrentSrc] = useState(
    startWithProxy ? getProxyUrl(video.url) : video.url
  );
  const [isProxied, setIsProxied] = useState(startWithProxy);
  const retryCount = useRef(0);

  const handleError = useCallback(() => {
    if (!isProxied && retryCount.current === 0) {
      // First failure on direct URL — retry through proxy
      console.log(`[VideoEmbed] Direct load failed, retrying through proxy: ${video.url.slice(0, 80)}`);
      retryCount.current = 1;
      setState("proxy-retry");
      setIsProxied(true);
      setCurrentSrc(getProxyUrl(video.url));
    } else {
      // Proxy also failed — show fallback
      console.log(`[VideoEmbed] Proxy also failed, showing fallback: ${video.url.slice(0, 80)}`);
      setState("failed");
    }
  }, [video.url, isProxied]);

  const handleCanPlay = useCallback(() => {
    setState("playing");
  }, []);

  if (video.platform === "youtube") {
    const embedUrl = getYouTubeEmbedUrl(video);
    if (!embedUrl) return null;

    return (
      <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src={embedUrl}
            title={video.title || "YouTube video"}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {video.title && (
          <div className="px-2 py-1 bg-white/[0.02]">
            <p className="text-[11px] text-zinc-500 truncate">{video.title}</p>
          </div>
        )}
      </div>
    );
  }

  // Generic video embed (mp4, webm, m3u8, etc.) with automatic proxy retry
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
      {state === "failed" ? (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-8 px-4 text-sm text-zinc-400 hover:text-[var(--senko-accent)] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Open video in new tab
        </a>
      ) : (
        <>
          {state === "proxy-retry" && (
            <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-zinc-500">
              <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
              Retrying through proxy...
            </div>
          )}
          <video
            key={currentSrc}
            src={currentSrc}
            controls
            autoPlay
            playsInline
            className="w-full max-h-[480px]"
            preload="auto"
            onError={handleError}
            onCanPlay={handleCanPlay}
          >
            Your browser does not support video.
          </video>
        </>
      )}
      {video.title && (
        <div className="px-2 py-1.5 bg-white/[0.02] flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 shrink-0"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p className="text-[11px] text-zinc-500 truncate">
            {video.title}
            {isProxied && state === "playing" && <span className="ml-1 text-zinc-600">(proxied)</span>}
          </p>
        </div>
      )}
    </div>
  );
}
