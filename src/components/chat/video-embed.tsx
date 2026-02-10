"use client";

import { ExternalLink } from "lucide-react";
import type { VideoEmbed as VideoEmbedType } from "@/types/chat";

interface VideoEmbedProps {
  video: VideoEmbedType;
}

export function VideoEmbed({ video }: VideoEmbedProps) {
  const isYouTube = video.platform === "youtube" && video.embedId;

  if (isYouTube) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src={`https://www.youtube.com/embed/${video.embedId}?rel=0`}
            title={video.title || "YouTube video"}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {video.title && (
          <div className="flex items-center justify-between bg-white/[0.03] px-3 py-2 border-t border-white/[0.06]">
            <span className="text-xs font-medium text-zinc-300 truncate">
              {video.title}
            </span>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-1 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all flex-shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    );
  }

  // Generic video embed
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        <iframe
          src={video.url}
          title={video.title || "Video"}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen"
          allowFullScreen
        />
      </div>
      {video.title && (
        <div className="flex items-center justify-between bg-white/[0.03] px-3 py-2 border-t border-white/[0.06]">
          <span className="text-xs font-medium text-zinc-300 truncate">
            {video.title}
          </span>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-1 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-all flex-shrink-0"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
