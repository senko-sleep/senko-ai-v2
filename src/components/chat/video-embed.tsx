"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Play, Pause, Maximize2, Volume2, VolumeX, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
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
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return `https://www.youtube-nocookie.com/embed/${watchMatch[1]}`;
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return `https://www.youtube-nocookie.com/embed/${shortMatch[1]}`;
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return `https://www.youtube-nocookie.com/embed/${embedMatch[1]}`;
  return null;
}

type VideoState = "loading" | "playing" | "proxy-retry" | "failed";

export function VideoEmbed({ video }: VideoEmbedProps) {
  // For known blocked sites, start with proxy URL immediately
  const startWithProxy = needsProxy(video.url);
  const [state, setState] = useState<VideoState>(startWithProxy ? "loading" : "loading");
  const [currentSrc, setCurrentSrc] = useState(
    startWithProxy ? getProxyUrl(video.url) : video.url
  );
  const [isProxied, setIsProxied] = useState(startWithProxy);
  const retryCount = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // YouTube embed
  if (video.platform === "youtube") {
    const embedUrl = getYouTubeEmbedUrl(video);
    if (!embedUrl) return null;

    return (
      <div className="mt-2 overflow-hidden rounded-2xl border border-white/[0.06] relative group/video">
        <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[var(--senko-accent)]/20 via-transparent to-[var(--senko-accent)]/10 pointer-events-none" />
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
          <div className="px-3 py-2 bg-white/[0.02] border-t border-white/[0.06]">
            <p className="text-[12px] text-zinc-400 truncate">{video.title}</p>
          </div>
        )}
      </div>
    );
  }

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

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(handleError);
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [handleError]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) {
      v.requestFullscreen();
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
    setDuration(v.duration);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    v.currentTime = x * v.duration;
  }, []);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (state === "failed") {
    return (
      <div className="mt-2 overflow-hidden rounded-2xl relative">
        <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-red-500/20 via-transparent to-red-500/10 pointer-events-none" />
        <div className="relative bg-black/80 rounded-2xl px-6 py-8 flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <p className="text-sm text-zinc-400 font-medium">Couldn't load this video</p>
          <p className="text-xs text-zinc-600">The video may be unavailable or in an unsupported format</p>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--senko-accent)] hover:text-[#ffcc80] transition-colors font-medium"
          >
            Open in browser
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-2 overflow-hidden rounded-2xl relative group/video"
      onMouseMove={showControlsTemporarily}
      onMouseEnter={() => setShowControls(true)}
    >
      {/* Gradient border */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[var(--senko-accent)]/30 via-white/[0.08] to-[var(--senko-accent)]/10 pointer-events-none z-10" />

      <div className="relative bg-black rounded-2xl overflow-hidden">
        {/* Loading overlay */}
        {(state === "loading" || state === "proxy-retry") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 text-[var(--senko-accent)] animate-spin" />
              <span className="text-xs text-zinc-500">
                {state === "proxy-retry" ? "Retrying through proxy..." : "Loading video..."}
              </span>
            </div>
          </div>
        )}

        {/* Video element */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={currentSrc}
          className="w-full max-h-[70vh] cursor-pointer"
          preload="metadata"
          playsInline
          crossOrigin="anonymous"
          onClick={togglePlay}
          onCanPlay={handleCanPlay}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => { setPlaying(false); setShowControls(true); }}
          onError={handleError}
        />

        {/* Play button overlay (when paused) */}
        {!playing && (state === "playing") && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
            onClick={togglePlay}
          >
            <div className="h-16 w-16 rounded-full bg-[var(--senko-accent)]/20 backdrop-blur-sm border border-[var(--senko-accent)]/30 flex items-center justify-center hover:bg-[var(--senko-accent)]/30 transition-all hover:scale-110">
              <Play className="h-7 w-7 text-[var(--senko-accent)] ml-1" />
            </div>
          </div>
        )}

        {/* Controls bar */}
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300 z-20 ${showControls || !playing ? "opacity-100" : "opacity-0"
            }`}
        >
          {/* Progress bar */}
          <div
            className="w-full h-1 bg-white/10 rounded-full mb-3 cursor-pointer group/progress"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-[var(--senko-accent)] rounded-full relative transition-all"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-[var(--senko-accent)] opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-lg" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="text-white hover:text-[var(--senko-accent)] transition-colors"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button
                onClick={toggleMute}
                className="text-white hover:text-[var(--senko-accent)] transition-colors"
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              {duration > 0 && (
                <span className="text-[11px] text-zinc-400 font-mono">
                  {formatTime((progress / 100) * duration)} / {formatTime(duration)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                className="text-white hover:text-[var(--senko-accent)] transition-colors"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-[var(--senko-accent)] transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Title bar */}
        {video.title && (
          <div className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent px-4 pt-3 pb-8 transition-opacity duration-300 z-20 ${showControls || !playing ? "opacity-100" : "opacity-0"
            }`}>
            <p className="text-[13px] text-white/90 font-medium truncate">{video.title}</p>
          </div>
        )}
      </div>
    </div>
  );
}
