"use client";

import { useEffect, useCallback } from "react";
import { X, Download, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 3));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.5));
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    // Prevent layout shift: compensate for scrollbar width before hiding overflow
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    };
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in"
      onClick={handleBackdropClick}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <span className="text-sm text-zinc-400 truncate max-w-[60%]">
          {alt || "Image preview"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
            className="rounded-lg p-2 text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
            className="rounded-lg p-2 text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
            title="Open original"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:text-white hover:bg-white/10 transition-all ml-1"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Image */}
      <div className="flex items-center justify-center w-full h-full p-12 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || ""}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-transform duration-200"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 backdrop-blur-sm px-3 py-1.5 text-xs text-zinc-300 border border-white/10">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
}
