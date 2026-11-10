"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { videoProxyUrl, type ChatVideo } from "@/lib/chat-video";

function hostOf(url?: string) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/** Plays a direct file or an HLS stream through our proxy (the source site sees its own page as Referer). */
function NativeVideo({ video, onFail }: { video: ChatVideo; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = videoProxyUrl(video.src, video.pageUrl);
  const poster = video.poster ? `/api/proxy?url=${encodeURIComponent(video.poster)}` : undefined;

  useEffect(() => {
    const el = ref.current;
    if (!el || video.kind !== "hls" || el.canPlayType("application/vnd.apple.mpegurl")) return;
    let hls: import("hls.js").default | null = null;
    let cancelled = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) return onFail();
      // The proxy rewrites the playlist so every piece also comes through it.
      hls = new Hls({ maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) onFail();
      });
      hls.loadSource(src);
      hls.attachMedia(el);
    });
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src, video.kind, onFail]);

  const native = video.kind === "file" || (typeof document !== "undefined" && document.createElement("video").canPlayType("application/vnd.apple.mpegurl"));
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={native ? src : undefined}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      onError={onFail}
      className="block aspect-video w-full bg-black"
    />
  );
}

function OneVideo({ video }: { video: ChatVideo }) {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const site = hostOf(video.pageUrl || video.src);
  const open = video.pageUrl || video.src;
  return (
    <figure className="overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface,#111)]">
      {failed ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center text-[13px] text-white/80">
          <span>{site || "The site"} won&apos;t let this video play outside its page.</span>
          <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[var(--sk-accent)] px-3 py-1 font-medium text-white">
            Watch on {site || "the site"} <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      ) : video.kind === "embed" ? (
        <iframe
          src={video.src}
          title={video.title || "Video"}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="block aspect-video w-full bg-black"
        />
      ) : (
        <NativeVideo video={video} onFail={fail} />
      )}
      <figcaption className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--sk-muted)]">
        <span className="min-w-0 flex-1 truncate">{video.title || site}</span>
        {open && (
          <a href={open} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 hover:text-[var(--sk-text)]">
            {site} <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </figcaption>
    </figure>
  );
}

/** Videos the agent sent into the chat, playable in place. */
export function ChatVideos({ videos }: { videos: ChatVideo[] }) {
  return (
    <div className="grid w-full max-w-[640px] gap-2">
      {videos.map((v) => (
        <OneVideo key={v.src} video={v} />
      ))}
    </div>
  );
}
