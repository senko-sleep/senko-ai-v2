"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const job = fetch(`/api/images?q=${encodeURIComponent(query.trim())}&limit=20`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.json() : { images: [] }))
    .then((data: { images?: CandidateImage[] }) => {
      const list = Array.isArray(data?.images) ? data.images.filter((i) => i && typeof i.url === "string") : [];
      if (list.length) queryCache.set(key, list);
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

export type ImageDisplayStatus = "loading" | "ready" | "unavailable";

interface SmartImageProps {
  imageUrl?: string;
  imageQuery?: string;
  sourceUrl?: string;
  alt: string;
  width?: number;
  height?: number;
  aspect?: "portrait" | "video" | "square" | "auto" | "natural";
  showBookmark?: boolean;
  quietActions?: boolean;
  eager?: boolean;
  onDisplayStatus?: (status: ImageDisplayStatus) => void;
  className?: string;
}

export function SmartImage(props: SmartImageProps) {
  // A new URL or search gets a fresh attempt, including preview and bookmark state.
  return <ImageAttempt key={JSON.stringify([props.imageUrl, props.imageQuery])} {...props} />;
}

function ImageAttempt({
  imageUrl,
  imageQuery,
  sourceUrl,
  alt,
  width,
  height,
  aspect = "portrait",
  showBookmark = true,
  quietActions = false,
  eager = false,
  onDisplayStatus,
  className = "",
}: SmartImageProps) {
  const [candidates, setCandidates] = useState<CandidateImage[]>(() =>
    imageUrl ? [{ url: imageUrl }] : []
  );
  const [attempt, setAttempt] = useState({ index: 0, retries: 2 });
  const [searching, setSearching] = useState(Boolean(imageQuery));
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closePreviewRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!imageQuery) return;
    let active = true;
    resolveImageQuery(imageQuery).then((fetched) => {
      if (!active) return;
      const distinct = new Map<string, CandidateImage>();
      if (imageUrl) distinct.set(imageUrl, { url: imageUrl });
      for (const item of fetched) {
        if (!distinct.has(item.url)) distinct.set(item.url, item);
      }
      setCandidates([...distinct.values()]);
      setSearching(false);
    });
    return () => {
      active = false;
    };
  }, [imageUrl, imageQuery]);

  const idx = attempt.index;
  const current = candidates[idx];
  const currentUrl = current?.url;
  const currentSource = current?.source || (currentUrl === imageUrl ? sourceUrl : undefined);
  const imgLoaded = Boolean(currentUrl && loadedUrl === currentUrl);
  const status: ImageDisplayStatus = imgLoaded ? "ready" : currentUrl || searching ? "loading" : "unavailable";

  useEffect(() => {
    onDisplayStatus?.(status);
  }, [onDisplayStatus, status]);

  useEffect(() => {
    setSaved(currentUrl ? isBookmarked(currentUrl) : false);
  }, [currentUrl]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!previewOpen || !dialog || dialog.open) return;
    dialog.showModal();
    closePreviewRef.current?.focus({ preventScroll: true });
  }, [previewOpen]);

  const handleError = useCallback(() => {
    setAttempt((prev) => prev !== attempt ? prev : {
      index: prev.retries > 0 ? prev.index + 1 : -1,
      retries: prev.retries - 1,
    });
  }, [attempt]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !currentUrl || imgLoaded) return;
    // The image may have finished while React was hydrating server-rendered markup.
    if (image.complete) {
      if (image.naturalWidth > 0) setLoadedUrl(currentUrl);
      else handleError();
      return;
    }
    // Lazy images only start their deadline once the browser is close to showing them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = !eager && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        timer = setTimeout(handleError, 9_000);
      }, { rootMargin: "200px" })
      : undefined;
    if (observer) observer.observe(image);
    else timer = setTimeout(handleError, 9_000);
    return () => {
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [currentUrl, eager, handleError, imgLoaded]);

  const cycleImage = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (candidates.length <= 1) return;
      setAttempt((prev) => ({ index: (prev.index + 1) % candidates.length, retries: 2 }));
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
      : aspect === "natural"
      ? "min-h-24"
      : "min-h-[180px] max-h-[360px]";

  return (
    <>
      <div
        style={aspect === "natural" && width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
        className={`group/img relative w-full overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-raised)] ${aspectCls} ${className}`}
      >
        {status === "loading" && (
          <div className="sk-skel absolute inset-0 flex items-center justify-center">
            <span className="sr-only">Loading {alt}</span>
          </div>
        )}

        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={currentUrl}
            ref={imageRef}
            src={currentUrl}
            alt={alt}
            width={width}
            height={height}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoadedUrl(currentUrl)}
            onError={handleError}
            className={`${aspect === "natural" ? "block h-auto w-full" : "h-full w-full object-cover"} motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:group-hover/img:scale-[1.015] ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : status === "unavailable" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center text-[var(--sk-muted)]">
            <ImageOff size={20} className="opacity-50" aria-hidden />
            <span className="text-[11.5px] font-medium" title={alt}>Image unavailable</span>
          </div>
        ) : null}

        {imgLoaded && (
          <button
            ref={previewRef}
            type="button"
            aria-haspopup="dialog"
            aria-label={`Open preview for ${alt}`}
            onClick={() => setPreviewOpen(true)}
            className="absolute inset-0 cursor-zoom-in rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sk-accent)]"
          />
        )}

        {/* Top-right floating action controls (Bookmark like ChatGPT screenshot + cycle image) */}
        {currentUrl && imgLoaded && (
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
                    : quietActions
                      ? "bg-black/55 text-white/90 hover:bg-black/75 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/img:opacity-100 focus-visible:opacity-100"
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
        {imgLoaded && (
          <div className="pointer-events-none absolute bottom-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 backdrop-blur-sm transition group-hover/img:opacity-100">
            <Expand size={11} />
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {previewOpen && currentUrl && (
        <dialog
          ref={dialogRef}
          className="m-auto max-h-[92dvh] max-w-[min(92vw,64rem)] overflow-auto rounded-2xl border border-white/15 bg-[#0e0a08] p-2 text-white backdrop:bg-black/85"
          onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
          onClose={() => {
            setPreviewOpen(false);
            previewRef.current?.focus({ preventScroll: true });
          }}
          aria-label={alt}
        >
          <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              alt={alt}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="max-h-[78dvh] max-w-full rounded-xl object-contain"
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
                {currentSource && (
                  <a
                    href={currentSource}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10"
                  >
                    Source <ExternalLink size={11} />
                  </a>
                )}
                <button
                  ref={closePreviewRef}
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-white/10 hover:bg-white/20"
                  aria-label="Close preview"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
