"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Columns2, ExternalLink, Maximize2, Minimize2, Rows3, ZoomIn, ZoomOut } from "lucide-react";
import { comicImageUrl, comicReferer, type ComicCard as Card, type ComicChapter, type ComicPage } from "@/lib/comics/types";

type ReaderCard = Extract<Card, { stage: "reader" }>;

function SourcePicker({ card, onPick }: { card: Extract<Card, { stage: "sources" }>; onPick?: (text: string) => void }) {
  return (
    <div className="grid w-full max-w-[640px] gap-2 sm:grid-cols-2">
      {card.sources.map((s, i) => (
        <button
          key={s.id}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(s.name)}
          className="flex flex-col items-start gap-1 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface,transparent)] p-3 text-left transition hover:border-[var(--sk-accent)] disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--sk-text)]">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--sk-accent)] text-[11px] text-white">{i + 1}</span>
            {s.name}
            {s.adult && <span className="rounded-full bg-[var(--sk-danger,#c33)] px-1.5 text-[10px] font-semibold text-white">18+</span>}
          </span>
          <span className="text-[12px] leading-snug text-[var(--sk-muted)]">{s.blurb}</span>
        </button>
      ))}
    </div>
  );
}

function ResultGrid({ card, onPick }: { card: Extract<Card, { stage: "results" }>; onPick?: (text: string) => void }) {
  const referer = comicReferer(card.source);
  return (
    <div className="grid w-full max-w-[760px] grid-cols-2 gap-2.5 sm:grid-cols-4">
      {card.results.map((s, i) => (
        <button
          key={s.id}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(`#${i + 1} ${s.title}`)}
          title={s.description || s.title}
          className="group flex flex-col overflow-hidden rounded-xl border border-[var(--sk-line)] text-left transition hover:border-[var(--sk-accent)] disabled:opacity-70"
        >
          <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/20">
            {s.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={comicImageUrl(s.cover, referer)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
            ) : (
              <BookOpen className="absolute inset-0 m-auto text-[var(--sk-muted)]" size={28} aria-hidden />
            )}
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 text-[11px] font-semibold text-white">#{i + 1}</span>
            {s.mature && !card.adult && <span className="absolute right-1.5 top-1.5 rounded-full bg-[var(--sk-danger,#c33)] px-1.5 text-[10px] font-semibold text-white">Mature</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 p-2">
            <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-[var(--sk-text)]">{s.title}</span>
            <span className="truncate text-[11px] text-[var(--sk-muted)]">{[s.author, s.stat].filter(Boolean).join(" · ")}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

const ZOOMS = [60, 75, 90, 100];

function storeKey(card: ReaderCard) {
  return `senko.comic.${card.source}.${card.series.id}`;
}

function Reader({ card }: { card: ReaderCard }) {
  const referer = card.referer || comicReferer(card.source);
  const [chapters] = useState<ComicChapter[]>(card.chapters);
  const [chapterId, setChapterId] = useState(card.chapterId);
  const [pages, setPages] = useState<ComicPage[]>(card.pages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"scroll" | "page">("scroll");
  const [pageIdx, setPageIdx] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [full, setFull] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, ComicPage[]>([[card.chapterId, card.pages]]));

  const at = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[at];

  const loadPages = useCallback(async (id: string) => {
    const hit = cache.current.get(id);
    if (hit) return hit;
    const res = await fetch(`/api/comics?source=${card.source}&op=pages&id=${encodeURIComponent(id)}`);
    const data = (await res.json().catch(() => ({}))) as { pages?: ComicPage[]; error?: string };
    if (!res.ok || !data.pages) throw new Error(data.error || `Couldn't load pages (${res.status})`);
    cache.current.set(id, data.pages);
    return data.pages;
  }, [card.source]);

  const openChapter = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const next = await loadPages(id);
      setChapterId(id);
      setPages(next);
      setPageIdx(0);
      scrollRef.current?.scrollTo({ top: 0 });
      try { localStorage.setItem(storeKey(card), id); } catch { /* storage off */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [card, loadPages]);

  // Pick up where this viewer left off.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(storeKey(card)); } catch { /* storage off */ }
    if (saved && saved !== card.chapterId && card.chapters.some((c) => c.id === saved)) void openChapter(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the next chapter so "Next" is instant.
  useEffect(() => {
    const next = chapters[at + 1];
    if (next) void loadPages(next.id).catch(() => undefined);
  }, [at, chapters, loadPages]);

  // Which page is on screen in scroll mode.
  useEffect(() => {
    if (mode !== "scroll" || !scrollRef.current) return;
    const root = scrollRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setPageIdx(Number((e.target as HTMLElement).dataset.i));
      },
      { root, threshold: 0.35 }
    );
    root.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [mode, pages]);

  const prevChapter = at > 0 ? chapters[at - 1] : undefined;
  const nextChapter = at < chapters.length - 1 ? chapters[at + 1] : undefined;

  const step = useCallback((d: number) => {
    if (mode === "page") {
      const n = pageIdx + d;
      if (n < 0) { if (prevChapter) void openChapter(prevChapter.id); return; }
      if (n >= pages.length) { if (nextChapter) void openChapter(nextChapter.id); return; }
      setPageIdx(n);
    } else {
      scrollRef.current?.scrollBy({ top: d * (scrollRef.current.clientHeight * 0.85), behavior: "smooth" });
    }
  }, [mode, pageIdx, pages.length, prevChapter, nextChapter, openChapter]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "f") toggleFull();
  };

  const toggleFull = () => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => setFull((v) => !v));
  };
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const img = (p: ComicPage, i: number, eager = false) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={p.src}
      data-i={i}
      src={comicImageUrl(p.src, referer)}
      alt={`Page ${i + 1}`}
      loading={eager || i < 3 ? "eager" : "lazy"}
      width={p.width}
      height={p.height}
      className="mx-auto block h-auto w-full select-none"
      style={{ maxWidth: `${zoom}%` }}
      draggable={false}
    />
  );

  const btn = "grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[var(--sk-muted)] transition hover:bg-white/10 hover:text-[var(--sk-text)] disabled:opacity-40";
  const pagesDone = useMemo(() => pages.length, [pages]);

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKey}
      className={`flex w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface,#111)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sk-accent)] ${full ? "fixed inset-0 z-50 max-w-none rounded-none" : ""}`}
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--sk-line)] p-2.5">
        {card.series.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={comicImageUrl(card.series.cover, referer)} alt="" className="h-11 w-9 shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-[var(--sk-text)]">{card.series.title}</div>
          <div className="truncate text-[11.5px] text-[var(--sk-muted)]">
            {[card.series.author, card.sourceName, `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <a href={chapter?.url || card.series.url} target="_blank" rel="noopener noreferrer" className={btn} title={`Open on ${card.sourceName}`}>
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--sk-line)] px-2 py-1.5 text-[12px]">
        <button type="button" className={btn} disabled={!prevChapter || loading} onClick={() => prevChapter && void openChapter(prevChapter.id)} title="Previous chapter">
          <ChevronLeft size={15} aria-hidden />
        </button>
        <select
          value={chapterId}
          onChange={(e) => void openChapter(e.target.value)}
          disabled={loading}
          className="h-7 min-w-0 max-w-[260px] flex-1 truncate rounded-md border border-[var(--sk-line)] bg-transparent px-1.5 text-[12px] text-[var(--sk-text)]"
          aria-label="Chapter"
        >
          {chapters.map((c) => (
            <option key={c.id} value={c.id} className="bg-[#111]">
              {c.index}. {c.title}
            </option>
          ))}
        </select>
        <button type="button" className={btn} disabled={!nextChapter || loading} onClick={() => nextChapter && void openChapter(nextChapter.id)} title="Next chapter">
          <ChevronRight size={15} aria-hidden />
        </button>
        <span className="ml-1 tabular-nums text-[var(--sk-muted)]">
          {loading ? "Loading…" : pagesDone ? `${Math.min(pageIdx + 1, pagesDone)} / ${pagesDone}` : "No pages"}
        </span>
        <span className="flex-1" />
        <button type="button" className={btn} onClick={() => setMode(mode === "scroll" ? "page" : "scroll")} title={mode === "scroll" ? "One page at a time" : "Scroll all pages"}>
          {mode === "scroll" ? <Columns2 size={14} aria-hidden /> : <Rows3 size={14} aria-hidden />}
        </button>
        <button type="button" className={btn} disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} title="Smaller">
          <ZoomOut size={14} aria-hidden />
        </button>
        <button type="button" className={btn} disabled={zoom === 100} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} title="Bigger">
          <ZoomIn size={14} aria-hidden />
        </button>
        <button type="button" className={btn} onClick={toggleFull} title="Full screen (F)">
          {full ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
        </button>
      </div>

      {error && <div className="px-3 py-2 text-[12px] text-[var(--sk-danger,#e55)]">{error}</div>}

      {mode === "scroll" ? (
        <div ref={scrollRef} className={`overflow-y-auto bg-black ${full ? "flex-1" : "max-h-[78vh]"}`}>
          {pages.map((p, i) => img(p, i))}
          {!pages.length && !loading && <div className="p-6 text-center text-[13px] text-white/70">This chapter has no pages I can show.</div>}
          {nextChapter && pages.length > 0 && (
            <button
              type="button"
              onClick={() => void openChapter(nextChapter.id)}
              className="mx-auto my-4 flex items-center gap-1 rounded-full bg-[var(--sk-accent)] px-4 py-2 text-[13px] font-medium text-white"
            >
              Next: {nextChapter.title} <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className={`relative grid place-items-center overflow-auto bg-black ${full ? "flex-1" : "h-[78vh]"}`}>
          {pages[pageIdx] && <div className="w-full">{img(pages[pageIdx], pageIdx, true)}</div>}
          <button type="button" aria-label="Previous page" onClick={() => step(-1)} className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize" />
          <button type="button" aria-label="Next page" onClick={() => step(1)} className="absolute inset-y-0 right-0 w-1/3 cursor-e-resize" />
          {/* Preload the next page */}
          {pages[pageIdx + 1] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={comicImageUrl(pages[pageIdx + 1].src, referer)} alt="" className="hidden" />
          )}
        </div>
      )}
    </div>
  );
}

/** The in-chat comic flow: site picker, top results, then the reader. */
export function ComicCardView({ card, onSendMessage }: { card: Card; onSendMessage?: (text: string) => void }) {
  if (card.stage === "sources") return <SourcePicker card={card} onPick={onSendMessage} />;
  if (card.stage === "results") return <ResultGrid card={card} onPick={onSendMessage} />;
  return <Reader card={card} />;
}
