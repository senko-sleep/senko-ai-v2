import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, Maximize, Minimize, MonitorPlay, RefreshCw, Shuffle, StretchVertical } from "lucide-react";
import type { EmbedMode, SiteEmbedCard } from "@/lib/embed/types";
import { proxiedPageUrl, useProxyToken } from "@/lib/proxy-token-client";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function frameSrc(mode: EmbedMode, url: string, token: string | null) {
  return mode === "proxy" ? proxiedPageUrl(url, token) : url;
}

const MODE_LABEL: Record<EmbedMode, string> = { direct: "Live site", proxy: "Proxied", live: "Live browser" };

/** A website embedded in a chat reply: real players and images, fullscreen, back/reload. */
export function SiteEmbedView({ card, onOpenLive }: { card: SiteEmbedCard; onOpenLive?: (url: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<EmbedMode>(card.mode);
  // No IntersectionObserver (old browsers): just load it.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [loaded, setLoaded] = useState(false);
  // The proxy said it couldn't load the page, or the frame never finished loading.
  const [failed, setFailed] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [tall, setTall] = useState(false);
  const [full, setFull] = useState(false);
  // Pseudo-fullscreen where the Fullscreen API isn't available (iPhone Safari).
  const [fakeFull, setFakeFull] = useState(false);
  const [current, setCurrent] = useState({ url: card.url, title: card.title });
  const [nonce, setNonce] = useState(0);
  // Proxied pages need the signed token (they run sandboxed, without our login cookie).
  const token = useProxyToken(mode === "proxy");

  // Mount the frame only once it's near the screen, so old chats don't load every site at once.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Proxied pages say where they are (links clicked inside the embed).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { senkoEmbed?: number; senkoEmbedError?: number; url?: string; title?: string; reason?: string } | null;
      if (d?.senkoEmbedError) {
        setFailed(typeof d.reason === "string" && d.reason ? d.reason.slice(0, 200) : "The proxy couldn't load it");
        setLoaded(true);
        return;
      }
      if (d?.senkoEmbed && typeof d.url === "string" && /^https?:\/\//.test(d.url)) {
        setCurrent({ url: d.url, title: d.title || undefined });
        // The proxied page is up (its DOM is ready), even if slow ads hold back "load".
        setLoaded(true);
        setStalled(false);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!fakeFull) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFakeFull(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fakeFull]);

  // A frame that never fires load shouldn't spin forever, or pretend it loaded: say it stalled.
  useEffect(() => {
    if (!visible || loaded) return;
    const t = setTimeout(() => setStalled(true), 15_000);
    return () => clearTimeout(t);
  }, [visible, loaded, nonce, mode]);

  const toggleFull = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (fakeFull) return setFakeFull(false);
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen({ navigationUI: "hide" });
        return;
      } catch {
        /* not allowed here: fall back */
      }
    }
    setFakeFull(true);
  }, [fakeFull]);

  const reset = () => {
    setLoaded(false);
    setFailed(null);
    setStalled(false);
  };
  const reload = () => {
    reset();
    setNonce((n) => n + 1);
  };
  const back = () => {
    // The proxied page runs sandboxed (its own opaque origin), so ask it to go back.
    frameRef.current?.contentWindow?.postMessage({ senkoEmbedCmd: "back" }, "*");
  };
  const switchMode = () => {
    setMode((m) => (m === "proxy" ? "direct" : "proxy"));
    reset();
  };

  const expanded = full || fakeFull;
  const host = hostOf(current.url);
  const btn = "sk-btn h-7 w-7 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)] hover:bg-white/[0.06]";
  // The page we're on now, not the one we started at.
  const src = frameSrc(mode, mode === card.mode ? card.url : current.url, token ?? null);
  const ready = visible && (mode !== "proxy" || token !== undefined);

  return (
    <div
      ref={wrapRef}
      className={
        expanded
          ? "fixed inset-0 z-[200] flex flex-col bg-black"
          : "flex w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface,#111)]"
      }
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--sk-line)] bg-black/30 px-2 py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="ml-1 h-4 w-4 shrink-0 rounded-xs" />
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-[12.5px] font-medium text-[var(--sk-text)]">{current.title || host}</div>
          <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--sk-faint)]">
            <span className="truncate">{host}</span>
            <span className="shrink-0 rounded-full border border-[var(--sk-line)] px-1.5 leading-[15px]">{MODE_LABEL[mode]}</span>
          </div>
        </div>
        {mode === "proxy" && (
          <button type="button" onClick={back} className={btn} aria-label="Back" title="Back">
            <ArrowLeft size={13.5} />
          </button>
        )}
        {mode !== "live" && (
          <>
            <button type="button" onClick={reload} className={btn} aria-label="Reload" title="Reload">
              <RefreshCw size={13} />
            </button>
            <button type="button" onClick={switchMode} className={`${btn} hidden sm:inline-flex`} aria-label={mode === "proxy" ? "Load the site directly" : "Load through the proxy"} title={mode === "proxy" ? "Not loading right? Try the site directly" : "Blank or blocked? Load it through the proxy"}>
              <Shuffle size={13} />
            </button>
            {!expanded && (
              <button type="button" onClick={() => setTall((t) => !t)} className={`${btn} hidden sm:inline-flex`} aria-label={tall ? "Shorter" : "Taller"} title={tall ? "Shorter" : "Taller"}>
                <StretchVertical size={13} />
              </button>
            )}
            <button type="button" onClick={() => void toggleFull()} className={btn} aria-label={expanded ? "Exit fullscreen" : "Fullscreen"} title={expanded ? "Exit fullscreen (Esc)" : "Fullscreen"}>
              {expanded ? <Minimize size={13.5} /> : <Maximize size={13.5} />}
            </button>
          </>
        )}
        <a href={current.url} target="_blank" rel="noopener noreferrer" className={`${btn} inline-flex items-center justify-center`} aria-label="Open in a new tab" title="Open in a new tab">
          <ExternalLink size={13} />
        </a>
      </div>

      {mode === "live" ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2.5 bg-black p-4 text-center text-[12.5px] text-white/70">
          <MonitorPlay size={22} className="text-[var(--sk-accent)]" aria-hidden />
          <span className="max-w-[44ch]">
            {card.liveUnavailable
              ? <>{host} won&apos;t load outside a real browser, and the live browser couldn&apos;t open it. Open it in a new tab, or try embedding it anyway.</>
              : <>{host} won&apos;t load outside a real browser, so it&apos;s open in this chat&apos;s live browser, with working videos and fullscreen there.</>}
          </span>
          {onOpenLive && (
            <button type="button" onClick={() => onOpenLive(current.url)} className="sk-btn h-8 rounded-full bg-[var(--sk-accent)] px-3.5 text-[12px] font-medium text-white hover:opacity-90">
              <MonitorPlay size={12.5} aria-hidden /> Show live browser
            </button>
          )}
          <button type="button" onClick={switchMode} className="text-[11px] text-white/45 underline-offset-2 hover:text-white/70 hover:underline">
            Try embedding it anyway
          </button>
        </div>
      ) : (
        <div className={`relative w-full bg-black ${expanded ? "flex-1" : tall ? "h-[82vh]" : "h-[min(560px,70vh)]"}`}>
          {ready && (
            <iframe
              key={`${mode}-${nonce}`}
              ref={frameRef}
              src={src}
              title={current.title || host}
              className="absolute inset-0 h-full w-full border-0"
              // No clipboard-write: fake "verify you're human" pages put a malware command there.
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              // Proxied pages are served from our address: keep them in an opaque origin (no
              // cookies, storage or API session). The real site (direct) keeps its own origin.
              // No allow-top-navigation (can't redirect the app), no allow-modals (no fake prompts).
              sandbox={
                mode === "proxy"
                  ? "allow-scripts allow-forms allow-popups allow-presentation allow-pointer-lock"
                  : "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-pointer-lock"
              }
              referrerPolicy={mode === "proxy" ? "no-referrer" : "strict-origin-when-cross-origin"}
              onLoad={() => setLoaded(true)}
            />
          )}
          {stalled && !loaded && !failed && (
            // Not finished, but whatever it has drawn stays visible: a slim note, not a cover.
            <div role="status" className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-black/85 px-3 py-2 text-center text-[11.5px] text-white/75 backdrop-blur-sm">
              <span className="inline-flex items-center gap-1.5"><AlertTriangle size={12.5} className="shrink-0 text-amber-400" aria-hidden /> {host} is still loading (slow, or it may not work inside other sites).</span>
              <span className="inline-flex gap-2">
                <button type="button" onClick={reload} className="underline-offset-2 hover:underline">Retry</button>
                <button type="button" onClick={switchMode} className="underline-offset-2 hover:underline">{mode === "proxy" ? "Load directly" : "Load through proxy"}</button>
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">New tab</a>
              </span>
            </div>
          )}
          {failed ? (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black p-4 text-center text-[12.5px] text-white/70">
              <AlertTriangle size={20} className="text-amber-400" aria-hidden />
              <span className="max-w-[46ch]">Couldn&apos;t show {host} here: {failed.replace(/[.\s]+$/, "")}.</span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={reload} className="sk-btn h-8 rounded-full border border-white/15 px-3 text-[12px] text-white/85 hover:bg-white/10">
                  <RefreshCw size={12} aria-hidden /> Retry
                </button>
                <button type="button" onClick={switchMode} className="sk-btn h-8 rounded-full border border-white/15 px-3 text-[12px] text-white/85 hover:bg-white/10">
                  <Shuffle size={12} aria-hidden /> {mode === "proxy" ? "Load directly" : "Load through proxy"}
                </button>
                {onOpenLive && (
                  <button type="button" onClick={() => onOpenLive(current.url)} className="sk-btn h-8 rounded-full bg-[var(--sk-accent)] px-3 text-[12px] font-medium text-white hover:opacity-90">
                    <MonitorPlay size={12} aria-hidden /> Live browser
                  </button>
                )}
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="sk-btn inline-flex h-8 items-center gap-1 rounded-full border border-white/15 px-3 text-[12px] text-white/85 hover:bg-white/10">
                  <ExternalLink size={12} aria-hidden /> New tab
                </a>
              </div>
            </div>
          ) : (!ready || !loaded) && !stalled && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-[11.5px] text-white/50">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[var(--sk-accent)]" />
              Loading {host}…
            </div>
          )}
        </div>
      )}

      {!expanded && (card.note || card.path?.length) ? (
        <div className="border-t border-[var(--sk-line)] px-3 py-1.5 text-[10.5px] leading-snug text-[var(--sk-faint)]">
          {card.path?.length ? <span>Went {[...card.path.map(hostOrPath), hostOrPath(card.url)].join(" → ")}. </span> : null}
          {card.note ? <span>{card.note}.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function hostOrPath(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? (u.pathname.length > 28 ? `${u.pathname.slice(0, 26)}…` : u.pathname) : "";
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url;
  }
}
