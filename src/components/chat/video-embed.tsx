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

  // Generic video embed
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
      <video
        src={video.url}
        controls
        className="w-full max-h-64"
        preload="metadata"
      >
        Your browser does not support video.
      </video>
    </div>
  );
}
