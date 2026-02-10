"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Maximize2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessageImage } from "@/types/chat";

interface ImageCarouselProps {
  images: MessageImage[];
}

/* ─── Fullscreen Lightbox ─── */
function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: MessageImage[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      if (e.key === "ArrowRight" && index < images.length - 1) onNavigate(index + 1);
    },
    [index, images.length, onClose, onNavigate]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const img = images[index];

  return (
    <div
      className="lightbox-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-sm font-medium text-white/80">
          {images.length > 1 && `${index + 1} / ${images.length}`}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm"
            title="Open original"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Image */}
      <div className="relative flex items-center justify-center w-full h-full p-8 sm:p-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt={img.alt || ""}
          className={cn(
            "max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-transform duration-300 select-none",
            zoomed ? "scale-150 cursor-zoom-out" : "cursor-zoom-in"
          )}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(!zoomed);
          }}
          draggable={false}
        />
      </div>

      {/* Navigation arrows */}
      {index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index - 1);
            setZoomed(false);
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index + 1);
            setZoomed(false);
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all backdrop-blur-sm"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      {/* Dot indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(i);
                setZoomed(false);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === index
                  ? "w-5 bg-white"
                  : "w-1.5 bg-white/30 hover:bg-white/50"
              )}
            />
          ))}
        </div>
      )}

      {/* Caption */}
      {img.alt && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 max-w-md text-center">
          <p className="text-xs text-white/60 bg-black/30 rounded-lg px-3 py-1.5 backdrop-blur-sm">
            {img.alt}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Main Carousel ─── */
export function ImageCarousel({ images }: ImageCarouselProps) {
  const [current, setCurrent] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) return null;

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
  };

  /* Single image — large card */
  if (images.length === 1) {
    return (
      <>
        <div
          onClick={() => openLightbox(0)}
          className="group/img mt-2 block overflow-hidden rounded-xl border border-white/[0.08] hover:border-[var(--senko-accent)]/30 transition-all duration-300 cursor-pointer relative"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[0].url}
            alt={images[0].alt || ""}
            className="h-auto max-h-[500px] w-full object-cover transition-transform duration-500 group-hover/img:scale-[1.02]"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-300" />
          <div className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-all duration-300 translate-y-1 group-hover/img:translate-y-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white/80 backdrop-blur-sm">
              <Maximize2 className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
        {lightboxIndex !== null && (
          <Lightbox
            images={images}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={(i) => setLightboxIndex(i)}
          />
        )}
      </>
    );
  }

  const scrollTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, images.length - 1));
    setCurrent(clamped);
    if (scrollRef.current) {
      const child = scrollRef.current.children[clamped] as HTMLElement;
      if (child) {
        child.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  };

  return (
    <>
      <div className="mt-2 relative group/carousel">
        {/* Grid for small sets, scrollable for large sets */}
        <div
          ref={scrollRef}
          className={cn(
            images.length <= 4
              ? "grid gap-1.5 rounded-xl overflow-hidden"
              : "flex gap-2 overflow-x-auto scrollbar-none snap-x snap-mandatory rounded-xl pb-1",
            images.length === 2 && "grid-cols-2",
            images.length === 3 && "grid-cols-3",
            images.length === 4 && "grid-cols-2"
          )}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {images.map((img, i) => (
            <div
              key={i}
              onClick={() => openLightbox(i)}
              className={cn(
                "group/img overflow-hidden border transition-all duration-300 cursor-pointer relative",
                images.length <= 4
                  ? "rounded-xl border-white/[0.08] hover:border-[var(--senko-accent)]/30"
                  : cn(
                      "flex-shrink-0 snap-center rounded-xl",
                      i === current
                        ? "border-[var(--senko-accent)]/30 shadow-[0_0_12px_rgba(255,149,0,0.1)]"
                        : "border-white/[0.08] hover:border-white/[0.15]"
                    )
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt || ""}
                className={cn(
                  "object-cover w-full transition-transform duration-500 group-hover/img:scale-[1.03]",
                  images.length <= 4 ? "h-64 sm:h-72" : "h-64 w-64 sm:h-72 sm:w-72"
                )}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-300" />
              <div className="absolute bottom-2 right-2 opacity-0 group-hover/img:opacity-100 transition-all duration-300 translate-y-1 group-hover/img:translate-y-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white/80 backdrop-blur-sm">
                  <Maximize2 className="h-3 w-3" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Navigation arrows for scrollable sets */}
        {images.length > 4 && current > 0 && (
          <button
            onClick={() => scrollTo(current - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-xl bg-black/60 p-1.5 text-white/80 hover:text-white hover:bg-black/80 transition-all opacity-0 group-hover/carousel:opacity-100 backdrop-blur-sm"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {images.length > 4 && current < images.length - 1 && (
          <button
            onClick={() => scrollTo(current + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-black/60 p-1.5 text-white/80 hover:text-white hover:bg-black/80 transition-all opacity-0 group-hover/carousel:opacity-100 backdrop-blur-sm"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Dots indicator */}
        {images.length > 4 && (
          <div className="flex justify-center gap-1.5 mt-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === current
                    ? "w-4 bg-[var(--senko-accent)]/70"
                    : "w-1.5 bg-white/10 hover:bg-white/25"
                )}
              />
            ))}
          </div>
        )}

        {/* Image count badge */}
        <div className="absolute top-2 right-2 opacity-0 group-hover/carousel:opacity-100 transition-opacity">
          <span className="text-[10px] font-medium text-white/70 bg-black/50 rounded-md px-2 py-0.5 backdrop-blur-sm">
            {images.length} images
          </span>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(i) => setLightboxIndex(i)}
        />
      )}
    </>
  );
}
