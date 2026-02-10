"use client";

import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./image-lightbox";
import type { MessageImage } from "@/types/chat";

interface ImageCarouselProps {
  images: MessageImage[];
}

export function ImageCarousel({ images }: ImageCarouselProps) {
  const [current, setCurrent] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <>
        <button
          onClick={() => setLightboxImage(images[0])}
          className="mt-1 block w-full overflow-hidden rounded-xl border border-white/[0.06] hover:border-[var(--senko-accent)]/30 transition-all cursor-pointer group/img"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[0].url}
            alt={images[0].alt || ""}
            className={`h-auto max-h-[400px] w-full transition-transform duration-300 group-hover/img:scale-[1.02] ${/\.gif(\?|$)/i.test(images[0].url) ? 'object-contain bg-black/20' : 'object-cover'}`}
            loading={/\.gif(\?|$)/i.test(images[0].url) ? undefined : "lazy"}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </button>
        {lightboxImage && (
          <ImageLightbox
            src={lightboxImage.url}
            alt={lightboxImage.alt}
            onClose={() => setLightboxImage(null)}
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
        child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  };

  return (
    <>
      <div className="mt-1 relative group/carousel">
        {/* Grid for small sets, scrollable for large sets */}
        <div
          ref={scrollRef}
          className={cn(
            images.length <= 4
              ? "grid gap-1.5 rounded-xl overflow-hidden"
              : "flex gap-1.5 overflow-x-auto scrollbar-none snap-x snap-mandatory rounded-xl",
            images.length === 2 && "grid-cols-2",
            images.length === 3 && "grid-cols-3",
            images.length === 4 && "grid-cols-2"
          )}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {images.map((img, i) => (
            <button
              key={i}
              className={cn(
                "overflow-hidden border transition-all cursor-pointer group/img text-left",
                images.length <= 4
                  ? "rounded-lg border-white/[0.06] hover:border-[var(--senko-accent)]/30"
                  : cn(
                      "flex-shrink-0 snap-center rounded-lg",
                      i === current
                        ? "border-[var(--senko-accent)]/30 ring-1 ring-[var(--senko-accent)]/20"
                        : "border-white/[0.06] hover:border-[var(--senko-accent)]/30"
                    )
              )}
              onClick={() => {
                if (images.length > 4) {
                  scrollTo(i);
                }
                setLightboxImage(img);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt || ""}
                className={cn(
                  "w-full transition-transform duration-300 group-hover/img:scale-[1.03]",
                  /\.gif(\?|$)/i.test(img.url) ? "object-contain bg-black/20" : "object-cover",
                  images.length <= 4 ? "h-48" : "h-48 w-56"
                )}
                loading={/\.gif(\?|$)/i.test(img.url) ? undefined : "lazy"}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </button>
          ))}
        </div>

        {/* Navigation arrows */}
        {current > 0 && (
          <button
            onClick={() => scrollTo(current - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/70 backdrop-blur-sm p-1.5 text-white/70 hover:text-white transition-all opacity-0 group-hover/carousel:opacity-100 hover:bg-black/90"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {current < images.length - 1 && (
          <button
            onClick={() => scrollTo(current + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/70 backdrop-blur-sm p-1.5 text-white/70 hover:text-white transition-all opacity-0 group-hover/carousel:opacity-100 hover:bg-black/90"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Dots indicator */}
        {images.length > 4 && (
          <div className="flex justify-center gap-1 mt-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === current
                    ? "w-4 bg-[var(--senko-accent)]/70"
                    : "w-1.5 bg-white/10 hover:bg-white/25"
                )}
              />
            ))}
          </div>
        )}
      </div>

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.url}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  );
}
