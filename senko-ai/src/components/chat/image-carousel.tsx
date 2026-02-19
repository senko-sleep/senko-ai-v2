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

  // Single image: hero display
  if (images.length === 1) {
    return (
      <>
        <button
          onClick={() => setLightboxImage(images[0])}
          className="group/img relative mt-2 block w-full overflow-hidden rounded-2xl border border-white/[0.08] hover:border-[var(--senko-accent)]/40 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-[var(--senko-accent)]/20"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[0].url}
            alt={images[0].alt || ""}
            className={cn(
              "h-auto max-h-[420px] w-full transition-all duration-500 group-hover/img:scale-[1.03]",
              /\.gif(\?|$)/i.test(images[0].url) ? 'object-contain bg-black/20' : 'object-cover'
            )}
            loading={/\.gif(\?|$)/i.test(images[0].url) ? undefined : "lazy"}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-300" />
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

  // Horizontal scrollable carousel - saves vertical space
  return (
    <>
      <div className="mt-2 relative">
        {/* Horizontal scroll container */}
        <div 
          className="flex gap-2.5 overflow-x-auto scrollbar-thin pb-2 snap-x snap-mandatory scroll-smooth"
          style={{ 
            scrollbarWidth: "thin", 
            scrollbarColor: "rgba(var(--senko-accent-rgb, 0, 212, 255), 0.3) transparent"
          }}
        >
          {images.map((img, i) => (
            <button
              key={i}
              className="group/img relative flex-shrink-0 snap-center overflow-hidden rounded-xl border border-white/[0.08] hover:border-[var(--senko-accent)]/40 transition-all duration-300 cursor-pointer shadow-md hover:shadow-lg hover:shadow-[var(--senko-accent)]/10"
              onClick={() => setLightboxImage(img)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt || ""}
                className={cn(
                  "h-48 w-auto max-w-[280px] transition-all duration-500 group-hover/img:scale-[1.04]",
                  /\.gif(\?|$)/i.test(img.url) ? "object-contain bg-black/20" : "object-cover"
                )}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).closest("button")!.style.display = "none";
                }}
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-300" />
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
