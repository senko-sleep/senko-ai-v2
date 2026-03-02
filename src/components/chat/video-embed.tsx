"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { RefreshCw, ExternalLink, Play } from "lucide-react";
import Hls from "hls.js";
import type { VideoEmbed as VideoEmbedType } from "@/types/chat";

interface VideoEmbedProps {
  video: VideoEmbedType;
}

// Sites known to block direct video access (CORS/referer/hotlink protection)
// These get routed through the video proxy immediately instead of waiting for failure
const NEEDS_PROXY_PATTERN = /\b(xvideos|pornhub|phncdn|xhamster|redtube|tube8|spankbang|xnxx|youporn|eporner|tnaflix|rule34video|hentaihaven|hanime|iwara|spankwire|xtube|thumbzilla|keezmovies|boomio-cdn|remote_control|streamable\.cloud)\b/i;

// Detect m3u8/HLS URLs
function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(url);
}

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

// HLS player component — uses hls.js to play m3u8 streams through our proxy
function HlsPlayer({ url, useProxy, onCanPlay, onError }: {
  url: string;
  useProxy: boolean;
  onCanPlay: () => void;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // If the browser natively supports HLS (Safari), use native playback
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = useProxy ? getProxyUrl(url) : url;
      return;
    }

    if (!Hls.isSupported()) {
      console.error("[HlsPlayer] HLS.js not supported in this browser");
      onError();
      return;
    }

    const hls = new Hls({
      // Route all HLS requests (manifests + segments) through our proxy
      xhrSetup: useProxy
        ? (xhr: XMLHttpRequest, hlsUrl: string) => {
            const proxied = getProxyUrl(hlsUrl);
            xhr.open("GET", proxied, true);
          }
        : undefined,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });

    hlsRef.current = hls;

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.error("[HlsPlayer] Fatal HLS error:", data.type, data.details);
        hls.destroy();
        onError();
      }
    });

    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [url, useProxy, onError]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      playsInline
      className="w-full max-h-[560px]"
      preload="auto"
      onCanPlay={onCanPlay}
      onError={onError}
    />
  );
}

export function VideoEmbed({ video }: VideoEmbedProps) {
  // For known blocked sites, start with proxy URL immediately
  const startWithProxy = needsProxy(video.url);
  const isHls = isHlsUrl(video.url);
  const [state, setState] = useState<VideoState>("loading");
  const [currentSrc, setCurrentSrc] = useState(
    !isHls && startWithProxy ? getProxyUrl(video.url) : video.url
  );
  const [isProxied, setIsProxied] = useState(startWithProxy);
  const [hlsUseProxy, setHlsUseProxy] = useState(startWithProxy);
  const retryCount = useRef(0);

  const handleError = useCallback(() => {
    if (isHls) {
      // HLS: first try direct, then proxy, then fail
      if (!hlsUseProxy && retryCount.current === 0) {
        console.log(`[VideoEmbed] HLS direct failed, retrying with proxy: ${video.url.slice(0, 80)}`);
        retryCount.current = 1;
        setState("proxy-retry");
        setHlsUseProxy(true);
        setIsProxied(true);
      } else {
        console.log(`[VideoEmbed] HLS proxy also failed: ${video.url.slice(0, 80)}`);
        setState("failed");
      }
    } else if (!isProxied && retryCount.current === 0) {
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
  }, [video.url, isProxied, isHls, hlsUseProxy]);

  const handleCanPlay = useCallback(() => {
    setState("playing");
  }, []);

  if (video.platform === "youtube") {
    const embedUrl = getYouTubeEmbedUrl(video);
    if (!embedUrl) return null;

    return (
      <div className="overflow-hidden rounded-2xl border border-white/[0.1] shadow-xl">
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
          <div className="px-4 py-2.5 bg-white/[0.03] border-t border-white/[0.06]">
            <p className="text-[12px] text-zinc-400 truncate font-medium">{video.title}</p>
          </div>
        )}
      </div>
    );
  }

  // Generic video embed (mp4, webm, m3u8, etc.) with automatic proxy retry
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-black/40 shadow-xl">
      {state === "failed" ? (
        <div className="flex flex-col items-center justify-center gap-4 py-10 px-6">
          <div className="h-14 w-14 rounded-2xl bg-zinc-800/80 flex items-center justify-center">
            <Play className="h-7 w-7 text-zinc-500" />
          </div>
          <div className="text-center">
            <p className="text-sm text-zinc-300 font-medium">Video couldn&apos;t load</p>
            <p className="text-xs text-zinc-600 mt-1">The source may be blocking playback</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                retryCount.current = 0;
                setState("loading");
                setIsProxied(false);
                setHlsUseProxy(false);
                setCurrentSrc(video.url);
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-[var(--senko-accent)]/10 hover:bg-[var(--senko-accent)]/20 text-[var(--senko-accent)] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Play on site
            </a>
          </div>
        </div>
      ) : (
        <>
          {state === "loading" && (
            <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
              <div className="absolute inset-0 bg-zinc-900 animate-pulse rounded-sm">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent animate-[senko-shimmer_2s_ease-in-out_infinite]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-12 w-12 rounded-full bg-white/[0.06] flex items-center justify-center">
                    <Play className="h-5 w-5 text-zinc-600" />
                  </div>
                </div>
              </div>
            </div>
          )}
          {state === "proxy-retry" && (
            <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-zinc-500">
              <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
              Retrying through proxy...
            </div>
          )}
          {isHls ? (
            <HlsPlayer
              key={`${video.url}-${hlsUseProxy}`}
              url={video.url}
              useProxy={hlsUseProxy}
              onCanPlay={handleCanPlay}
              onError={handleError}
            />
          ) : (
            <video
              key={currentSrc}
              src={currentSrc}
              controls
              autoPlay
              playsInline
              className="w-full max-h-[560px]"
              preload="auto"
              onError={handleError}
              onCanPlay={handleCanPlay}
            >
              Your browser does not support video.
            </video>
          )}
        </>
      )}
      {video.title && (
        <div className="px-4 py-2.5 bg-white/[0.03] border-t border-white/[0.06] flex items-center gap-2.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 shrink-0"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p className="text-[12px] text-zinc-400 truncate font-medium">
            {video.title}
            {isProxied && state === "playing" && <span className="ml-1.5 text-zinc-600">(proxied)</span>}
          </p>
        </div>
      )}
    </div>
  );
}
