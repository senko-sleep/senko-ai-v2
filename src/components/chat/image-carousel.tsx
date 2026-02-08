"use client";

import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessageImage } from "@/types/chat";

interface ImageCarouselProps {
  images: MessageImage[];
}

export function ImageCarousel({ images }: ImageCarouselProps) {
  const [current, setCurrent] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <a
        href={images[0].url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block overflow-hidden rounded-xl border border-white/[0.06] hover:border-white/[0.12] transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[0].url}
          alt={images[0].alt || ""}
          className="h-auto max-h-[400px] w-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </a>
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
          <a
            key={i}
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "overflow-hidden border transition-all",
              images.length <= 4
                ? "rounded-lg border-white/[0.06] hover:border-white/[0.12]"
                : cn(
                    "flex-shrink-0 snap-center rounded-lg",
                    i === current
                      ? "border-[#ff9500]/30"
                      : "border-white/[0.06] hover:border-white/[0.12]"
                  )
            )}
            onClick={(e) => {
              if (images.length > 4) { e.preventDefault(); scrollTo(i); }
            }}
            onDoubleClick={() => window.open(img.url, "_blank", "noopener,noreferrer")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt || ""}
              className={cn(
                "object-cover w-full",
                images.length <= 4 ? "h-48" : "h-48 w-56"
              )}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </a>
        ))}
      </div>

      {/* Navigation arrows */}
      {current > 0 && (
        <button
          onClick={() => scrollTo(current - 1)}
          className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-0.5 text-white/70 hover:text-white transition-colors opacity-0 group-hover/carousel:opacity-100"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {current < images.length - 1 && (
        <button
          onClick={() => scrollTo(current + 1)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-0.5 text-white/70 hover:text-white transition-colors opacity-0 group-hover/carousel:opacity-100"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Dots indicator */}
      {images.length > 4 && (
        <div className="flex justify-center gap-1 mt-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className={cn(
                "h-1 rounded-full transition-all",
                i === current
                  ? "w-3 bg-[#ff9500]/60"
                  : "w-1 bg-white/10 hover:bg-white/20"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
