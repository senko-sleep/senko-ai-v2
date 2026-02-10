"use client";

import type { VideoEmbed as VideoEmbedType } from "@/types/chat";

interface VideoEmbedProps {
  video: VideoEmbedType;
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

export function VideoEmbed({ video }: VideoEmbedProps) {
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

  // Generic video embed (mp4, webm, m3u8, etc.)
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06] bg-black/40">
      <video
        src={video.url}
        controls
        autoPlay
        playsInline
        crossOrigin="anonymous"
        className="w-full max-h-[480px]"
        preload="auto"
        onError={(e) => {
          // If video fails to load (CORS, format issues), show a fallback link
          const target = e.target as HTMLVideoElement;
          const parent = target.parentElement;
          if (parent && !parent.querySelector(".video-fallback")) {
            target.style.display = "none";
            const fallback = document.createElement("a");
            fallback.href = video.url;
            fallback.target = "_blank";
            fallback.rel = "noopener noreferrer";
            fallback.className = "video-fallback flex items-center justify-center gap-2 py-8 px-4 text-sm text-zinc-400 hover:text-[var(--senko-accent)] transition-colors";
            fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Open video in new tab`;
            parent.appendChild(fallback);
          }
        }}
      >
        Your browser does not support video.
      </video>
      {video.title && (
        <div className="px-2 py-1.5 bg-white/[0.02] flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 shrink-0"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <p className="text-[11px] text-zinc-500 truncate">{video.title}</p>
        </div>
      )}
    </div>
  );
}
