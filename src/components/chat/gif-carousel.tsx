"use client";

import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface GifItem {
  id: string;
  title: string;
  url: string;
  preview: string;
  webp: string;
  webp_preview: string;
  gif: string;
  mp4: string;
  tags: string[];
  duration: number;
  created: number;
}

interface GifCarouselProps {
  gifs: GifItem[];
  className?: string;
}

export function GifCarousel({ gifs, className }: GifCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentGif = gifs[currentIndex];

  // Reset loading/error state when navigating to a different GIF
  const goToGif = (index: number) => {
    setCurrentIndex(index);
    setIsLoading(true);
    setError(null);
  };

  const handlePrevious = () => {
    goToGif(currentIndex === 0 ? gifs.length - 1 : currentIndex - 1);
  };

  const handleNext = () => {
    goToGif(currentIndex === gifs.length - 1 ? 0 : currentIndex + 1);
  };

  const handleVideoLoad = () => {
    setIsLoading(false);
  };

  const handleVideoError = () => {
    setError("Failed to load GIF");
    setIsLoading(false);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (gifs.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative w-full", className)}>
      {/* Main GIF Display */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/40 border border-white/[0.08] backdrop-blur-sm">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-[var(--senko-accent)] rounded-full animate-pulse" />
              <div className="w-2 h-2 bg-[var(--senko-accent)] rounded-full animate-pulse delay-75" />
              <div className="w-2 h-2 bg-[var(--senko-accent)] rounded-full animate-pulse delay-150" />
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Try MP4 first (better performance), fallback to GIF */}
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          loop
          playsInline
          muted={isMuted}
          onLoadStart={handleVideoLoad}
          onError={handleVideoError}
          poster={currentGif.webp_preview}
        >
          <source src={currentGif.mp4} type="video/mp4" />
          <img
            src={currentGif.gif}
            alt={currentGif.title}
            className="w-full h-full object-cover"
            onLoad={handleVideoLoad}
            onError={handleVideoError}
          />
        </video>

        {/* Controls */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <button
            onClick={toggleMute}
            className="rounded-full bg-black/60 backdrop-blur-sm p-2 text-white/80 hover:text-white transition-all hover:bg-black/80"
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <a
            href={currentGif.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-black/60 backdrop-blur-sm p-2 text-white/80 hover:text-white transition-all hover:bg-black/80"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        {/* Navigation arrows */}
        {gifs.length > 1 && (
          <>
            <button
              onClick={handlePrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 backdrop-blur-sm p-2 text-white/80 hover:text-white transition-all hover:bg-black/80"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 backdrop-blur-sm p-2 text-white/80 hover:text-white transition-all hover:bg-black/80"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* GIF info */}
      <div className="mt-2 px-1">
        <p className="text-[12px] text-zinc-300 font-medium truncate">
          {currentGif.title}
        </p>
        {currentGif.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {currentGif.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {gifs.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          {gifs.map((gif, index) => (
            <button
              key={gif.id}
              onClick={() => goToGif(index)}
              className={cn(
                "flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all",
                index === currentIndex
                  ? "border-[var(--senko-accent)] scale-105 shadow-lg shadow-[var(--senko-accent)]/20"
                  : "border-white/[0.08] hover:border-white/[0.16]"
              )}
            >
              <img
                src={gif.webp_preview}
                alt={gif.title}
                className="w-16 h-16 object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Counter */}
      {gifs.length > 1 && (
        <div className="absolute top-2 right-2 rounded-full bg-black/60 backdrop-blur-sm px-2 py-1 text-[11px] text-white/80">
          {currentIndex + 1} / {gifs.length}
        </div>
      )}
    </div>
  );
}
