"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X, Grid3X3, Filter, ExternalLink, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./image-lightbox";
import type { MessageImage } from "@/types/chat";

interface ImageGalleryProps {
  images: MessageImage[];
  query?: string;
  onClose: () => void;
}

const ENGINE_LABELS: Record<string, string> = {
  rule34: "Rule34",
  gelbooru: "Gelbooru",
  e621: "e621",
  bing: "Bing",
  google: "Google",
  ddg: "DuckDuckGo",
};

const ENGINE_COLORS: Record<string, string> = {
  rule34: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  gelbooru: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  e621: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  bing: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  google: "bg-green-500/20 text-green-300 border-green-500/30",
  ddg: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

function isImageDuplicate(url: string, list: MessageImage[]): boolean {
  const norm = url.split("?")[0];
  return list.some((img) => img.url.split("?")[0] === norm);
}

export function ImageGallery({
  images: initialImages,
  query,
  onClose,
}: ImageGalleryProps) {
  const [allImages, setAllImages] = useState<MessageImage[]>(initialImages);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt?: string } | null>(null);
  const [activeEngine, setActiveEngine] = useState<string | null>(null);
  const [columns, setColumns] = useState(3);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(!!query);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Get unique engines from images
  const engines = Array.from(new Set(allImages.map((img) => img.engine).filter(Boolean))) as string[];

  // Filter images by active engine
  const filteredImages = activeEngine
    ? allImages.filter((img) => img.engine === activeEngine)
    : allImages;

  // Fetch next page of images
  const loadMore = useCallback(async () => {
    if (!query || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await fetch(`/api/images?q=${encodeURIComponent(query)}&page=${nextPage}`);
      const data = await res.json();
      if (data.images && data.images.length > 0) {
        setAllImages((prev) => {
          const incoming: MessageImage[] = data.images
            .filter((img: MessageImage) => !isImageDuplicate(img.url, prev))
            .map((img: { url: string; alt?: string; source?: string; engine?: string }) => ({
              url: img.url,
              alt: img.alt || query,
              source: img.source || "",
              engine: img.engine || "",
            }));
          if (incoming.length === 0) {
            setHasMore(false);
            return prev;
          }
          setHasMore(data.hasMore);
          return [...prev, ...incoming];
        });
      } else {
        setHasMore(false);
      }
      setPage(nextPage);
    } catch {
      setHasMore(false);
    }
    setIsLoadingMore(false);
  }, [query, page, isLoadingMore, hasMore]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) {
          loadMore();
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, isLoadingMore, hasMore]);

  // Distribute images into columns for masonry layout
  const getColumns = useCallback(() => {
    const cols: MessageImage[][] = Array.from({ length: columns }, () => []);
    filteredImages.forEach((img, i) => {
      cols[i % columns].push(img);
    });
    return cols;
  }, [filteredImages, columns]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxImage) setLightboxImage(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, lightboxImage]);

  const engineCounts = engines.reduce<Record<string, number>>((acc, eng) => {
    acc[eng] = allImages.filter((img) => img.engine === eng).length;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-black/60 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <Grid3X3 className="h-5 w-5 text-[var(--senko-accent)] flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-white/90 truncate">
              Gallery{query ? ` — ${query}` : ""}
            </h2>
            <p className="text-xs text-white/40">
              {filteredImages.length} image{filteredImages.length !== 1 ? "s" : ""}
              {activeEngine && ` from ${ENGINE_LABELS[activeEngine] || activeEngine}`}
              {!activeEngine && engines.length > 1 && ` from ${engines.length} sources`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Column toggle */}
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.06]">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setColumns(n)}
                className={cn(
                  "px-2 py-1 text-xs rounded-md transition-all",
                  columns === n
                    ? "bg-[var(--senko-accent)]/20 text-[var(--senko-accent)] font-medium"
                    : "text-white/40 hover:text-white/60"
                )}
              >
                {n}col
              </button>
            ))}
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Source filter pills */}
      {engines.length > 1 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/[0.04] overflow-x-auto scrollbar-none">
          <Filter className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
          <button
            onClick={() => setActiveEngine(null)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-full border transition-all flex-shrink-0",
              !activeEngine
                ? "bg-[var(--senko-accent)]/20 text-[var(--senko-accent)] border-[var(--senko-accent)]/30 font-medium"
                : "bg-white/[0.04] text-white/50 border-white/[0.06] hover:text-white/70 hover:border-white/10"
            )}
          >
            All ({allImages.length})
          </button>
          {engines.map((eng) => (
            <button
              key={eng}
              onClick={() => setActiveEngine(activeEngine === eng ? null : eng)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-full border transition-all flex-shrink-0",
                activeEngine === eng
                  ? ENGINE_COLORS[eng] || "bg-white/10 text-white/80 border-white/20"
                  : "bg-white/[0.04] text-white/50 border-white/[0.06] hover:text-white/70 hover:border-white/10"
              )}
            >
              {ENGINE_LABELS[eng] || eng} ({engineCounts[eng]})
            </button>
          ))}
        </div>
      )}

      {/* Masonry grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
      >
        {filteredImages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            No images found{activeEngine ? ` from ${ENGINE_LABELS[activeEngine] || activeEngine}` : ""}
          </div>
        ) : (
          <div className="flex gap-2" style={{ alignItems: "flex-start" }}>
            {getColumns().map((col, colIdx) => (
              <div key={colIdx} className="flex-1 flex flex-col gap-2 min-w-0">
                {col.map((img, imgIdx) => (
                  <div
                    key={img.url}
                    className="group relative overflow-hidden rounded-lg border border-white/[0.06] hover:border-[var(--senko-accent)]/30 transition-all cursor-pointer bg-white/[0.02]"
                    onClick={() => setLightboxImage({ url: img.url, alt: img.alt })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.alt || ""}
                      className={cn(
                        "w-full h-auto transition-transform duration-300 group-hover:scale-[1.03]",
                        /\.gif(\?|$)/i.test(img.url) ? "object-contain bg-black/20" : "object-cover"
                      )}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).closest("div")!.style.display = "none";
                      }}
                    />

                    {/* Overlay with source info */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-8 opacity-0 group-hover:opacity-100 transition-opacity">
                      {img.alt && (
                        <p className="text-[10px] text-white/70 truncate mb-1">{img.alt}</p>
                      )}
                      <div className="flex items-center gap-1.5">
                        {img.engine && (
                          <span
                            className={cn(
                              "text-[9px] px-1.5 py-0.5 rounded-full border",
                              ENGINE_COLORS[img.engine] || "bg-white/10 text-white/60 border-white/20"
                            )}
                          >
                            {ENGINE_LABELS[img.engine] || img.engine}
                          </span>
                        )}
                        {img.source && (
                          <a
                            href={img.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[9px] text-white/40 hover:text-white/70 flex items-center gap-0.5 transition-colors"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            source
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            {isLoadingMore ? (
              <div className="flex items-center gap-2 text-white/30 text-xs">
                <div className="h-4 w-4 border-2 border-white/20 border-t-[var(--senko-accent)] rounded-full animate-spin" />
                Loading more...
              </div>
            ) : (
              <button
                onClick={loadMore}
                className="flex items-center gap-1 text-xs text-white/30 hover:text-white/50 transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Load more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.url}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}
