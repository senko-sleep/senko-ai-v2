"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ImageLightbox } from "./image-lightbox";
import type { MessageImage } from "@/types/chat";

interface ImageCarouselProps {
  images: MessageImage[];
}

export function ImageCarousel({ images }: ImageCarouselProps) {
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt?: string } | null>(null);

  if (images.length === 0) return null;

  // Single image display
  if (images.length === 1) {
    return (
      <>
        <button
          onClick={() => setLightboxImage(images[0])}
          className="group/img relative block overflow-hidden rounded-2xl border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[0].url}
            alt=""
            className={cn(
              "h-auto max-h-[400px] w-auto max-w-full transition-transform duration-300 group-hover/img:scale-[1.02]",
              /\.gif(\?|$)/i.test(images[0].url) ? 'object-contain bg-black/30' : 'object-cover'
            )}
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

  // Horizontal scrollable carousel
  return (
    <>
      <div className="relative">
        {/* Scroll indicator bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.06] rounded-full overflow-hidden z-10">
          <div className="h-full w-1/3 bg-[var(--senko-accent)]/60 rounded-full" />
        </div>
        {/* Horizontal scroll container */}
        <div 
          className="flex gap-3 overflow-x-auto scrollbar-none pb-3 snap-x snap-mandatory scroll-smooth"
        >
          {images.map((img, i) => (
            <button
              key={i}
              className="group/img relative flex-shrink-0 snap-start overflow-hidden rounded-xl border border-white/[0.08] hover:border-white/[0.15] transition-all duration-200 cursor-pointer"
              onClick={() => setLightboxImage(img)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                className={cn(
                  "h-32 w-auto max-w-[200px] transition-transform duration-200 group-hover/img:scale-[1.03]",
                  /\.gif(\?|$)/i.test(img.url) ? "object-contain bg-black/30" : "object-cover"
                )}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).closest("button")!.style.display = "none";
                }}
              />
            </button>
          ))}
        </div>
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
