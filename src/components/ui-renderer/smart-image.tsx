"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, Expand, ImageOff, RefreshCw, X, ExternalLink } from "lucide-react";

interface CandidateImage {
  url: string;
  alt?: string;
  source?: string;
}

const queryCache = new Map<string, CandidateImage[]>();
const inflightQueries = new Map<string, Promise<CandidateImage[]>>();

const SAVED_IMAGES_KEY = "senko.saved_images.v1";

function isBookmarked(url: string): boolean {
  if (typeof window === "undefined" || !url) return false;
  try {
    const raw = localStorage.getItem(SAVED_IMAGES_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return list.includes(url);
  } catch {
    return false;
  }
}

function toggleBookmarkStorage(url: string): boolean {
  if (typeof window === "undefined" || !url) return false;
  try {
    const raw = localStorage.getItem(SAVED_IMAGES_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    const exists = list.includes(url);
    const next = exists ? list.filter((u) => u !== url) : [url, ...list].slice(0, 200);
    localStorage.setItem(SAVED_IMAGES_KEY, JSON.stringify(next));
    return !exists;
  } catch {
    return false;
  }
}

async function resolveImageQuery(query: string): Promise<CandidateImage[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  if (queryCache.has(key)) return queryCache.get(key)!;
  if (inflightQueries.has(key)) return inflightQueries.get(key)!;

  const job = fetch(`/api/images?q=${encodeURIComponent(query.trim())}&limit=20`)
    .then((r) => (r.ok ? r.json() : { images: [] }))
    .then((data: { images?: CandidateImage[] }) => {
      const list = Array.isArray(data?.images) ? data.images.filter((i) => i && typeof i.url === "string") : [];
      queryCache.set(key, list);
      return list;
    })
    .catch(() => [])
    .finally(() => {
      inflightQueries.delete(key);
    });

  inflightQueries.set(key, job);
  return job;
}

export function seedUIImageCache(map?: Record<string, string[]>) {
  if (!map) return;
  for (const [q, urls] of Object.entries(map)) {
    const key = q.trim().toLowerCase();
    if (key && Array.isArray(urls) && urls.length && !queryCache.has(key)) {
      queryCache.set(
        key,
        urls.map((url) => ({ url, alt: q }))
      );
    }
  }
}

export function SmartImage({
  imageUrl,
  imageQuery,
  alt,
  aspect = "portrait",
  showBookmark = true,
  className = "",
}: {
  imageUrl?: string;
  imageQuery?: string;
  alt: string;
  aspect?: "portrait" | "video" | "square" | "auto";
  showBookmark?: boolean;
  className?: string;
}) {
  const [candidates, setCandidates] = useState<CandidateImage[]>(() =>
    imageUrl ? [{ url: imageUrl, alt }] : []
  );
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(!imageUrl && Boolean(imageQuery));
  const [imgLoaded, setImgLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let active = true;
    const initial: CandidateImage[] = imageUrl ? [{ url: imageUrl, alt }] : [];
    setCandidates(initial);
    setIdx(0);
    setImgLoaded(false);

    if (imageQuery) {
      if (!imageUrl) setLoading(true);
      resolveImageQuery(imageQuery).then((fetched) => {
        if (!active) return;
        const combined = [...initial];
        for (const item of fetched) {
          if (!combined.some((c) => c.url === item.url)) combined.push(item);
        }
        setCandidates(combined);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => {
      active = false;
    };
  }, [imageUrl, imageQuery, alt]);

  const current = candidates[idx];
  const currentUrl = current?.url;

  useEffect(() => {
    setSaved(currentUrl ? isBookmarked(currentUrl) : false);
  }, [currentUrl]);

  const handleError = useCallback(() => {
    setImgLoaded(false);
    setIdx((prev) => (prev + 1 < candidates.length ? prev + 1 : candidates.length));
  }, [candidates.length]);

  const cycleImage = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (candidates.length <= 1) return;
      setImgLoaded(false);
      setIdx((prev) => (prev + 1) % candidates.length);
    },
    [candidates.length]
  );

  const aspectCls =
    aspect === "portrait"
      ? "aspect-[3/4]"
      : aspect === "video"
      ? "aspect-video"
      : aspect === "square"
      ? "aspect-square"
      : "min-h-[180px] max-h-[360px]";

  return (
    <>
      <div
        onClick={() => currentUrl && setLightbox(true)}
        className={`group/img relative w-full overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-raised)] ${
          currentUrl ? "cursor-pointer" : ""
        } ${aspectCls} ${className}`}
      >
        {/* Shimmer while loading */}
        {(loading || (currentUrl && !imgLoaded)) && (
          <div className="sk-skel absolute inset-0 flex items-center justify-center">
            <span className="sr-only">Loading {alt}</span>
          </div>
        )}

        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={currentUrl}
            src={currentUrl}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setImgLoaded(true)}
            onError={handleError}
            className={`h-full w-full object-cover transition-all duration-300 group-hover/img:scale-[1.015] ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : !loading ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-[var(--sk-muted)]">
            <ImageOff size={20} className="opacity-50" aria-hidden />
            <span className="text-[11.5px] font-medium">{alt}</span>
          </div>
        ) : null}

        {/* Top-right floating action controls (Bookmark like ChatGPT screenshot + cycle image) */}
        {currentUrl && (
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
            {candidates.length > 1 && (
              <button
                type="button"
                onClick={cycleImage}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/80 opacity-0 backdrop-blur-md transition hover:bg-black/75 hover:text-white group-hover/img:opacity-100 focus-visible:opacity-100"
                title="Try another image"
                aria-label="Try another image"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {showBookmark && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSaved(toggleBookmarkStorage(currentUrl));
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${
                  saved
                    ? "bg-[var(--sk-accent)] text-white opacity-100"
                    : "bg-black/55 text-white/85 opacity-85 hover:bg-black/75 hover:text-white group-hover/img:opacity-100"
                }`}
                title={saved ? "Saved" : "Save image"}
                aria-label={saved ? "Saved image" : "Save image"}
                aria-pressed={saved}
              >
                <Bookmark size={13} fill={saved ? "currentColor" : "none"} />
              </button>
            )}
          </div>
        )}

        {/* Subtle expand icon on hover */}
        {currentUrl && (
          <div className="pointer-events-none absolute bottom-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 backdrop-blur-sm transition group-hover/img:opacity-100">
            <Expand size={11} />
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightbox && currentUrl && (
        <div
          className="sk-fade fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          <div
            className="relative flex max-h-[90vh] max-w-4xl flex-col items-center overflow-hidden rounded-2xl border border-white/15 bg-[#0e0a08] p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              alt={alt}
              referrerPolicy="no-referrer"
              className="max-h-[78vh] w-auto rounded-xl object-contain"
            />
            <div className="mt-2 flex w-full items-center justify-between gap-3 px-2 py-1 text-xs text-white/80">
              <span className="truncate font-medium">{alt}</span>
              <div className="flex items-center gap-2">
                {candidates.length > 1 && (
                  <button
                    type="button"
                    onClick={cycleImage}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10"
                  >
                    <RefreshCw size={11} /> Next image ({idx + 1}/{candidates.length})
                  </button>
                )}
                {current?.source && (
                  <a
                    href={current.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10"
                  >
                    Source <ExternalLink size={11} />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setLightbox(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-white/10 hover:bg-white/20"
                  aria-label="Close preview"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
