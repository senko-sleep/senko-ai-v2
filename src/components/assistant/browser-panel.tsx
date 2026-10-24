import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Eye,
  Globe,
  Hand,
  ListTree,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MonitorPlay,
  MousePointerClick,
  OctagonX,
  Play,
  RotateCw,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AgentStep } from "./lib";
import { LiveView, type LiveBus, type UserInput } from "./live-view";
import { createLiveAudio, type LiveAudioState } from "./live-audio";
import { ReaderView, type PageOp } from "./reader-view";
import type { PageSnap } from "@/lib/agent/http-session";

export interface BrowserState {
  running: boolean;
  status: string;
  url: string;
  title: string;
  plan: string[];
  steps: AgentStep[];
  outcome: "idle" | "running" | "done" | "stopped" | "error";
  inputError?: string;
  /** The page the HTTP browser is on, when there's no screencast (no Chromium on this server). */
  page?: PageSnap | null;
}

const OUTCOME: Record<BrowserState["outcome"], { text: string; cls: string }> = {
  idle: { text: "Idle", cls: "text-[var(--sk-muted)]" },
  running: { text: "Working", cls: "text-[var(--sk-accent-ink)]" },
  done: { text: "Done", cls: "text-[var(--sk-ok)]" },
  stopped: { text: "Stopped", cls: "text-[var(--sk-muted)]" },
  error: { text: "Error", cls: "text-[var(--sk-danger)]" },
};

export type NavAction = { action: "back" | "forward" | "reload" } | { url: string };

const iconBtn = "sk-btn h-7 w-7 shrink-0 rounded-md text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]";

export function BrowserPanel({
  state,
  bus,
  controlling,
  paused,
  onStop,
  onClose,
  onOpenBrowser,
  opening,
  onToggleControl,
  onResume,
  onInput,
  onViewport,
  agentName,
  onNav,
  onPageOp,
  pageBusy,
}: {
  state: BrowserState;
  bus: LiveBus;
  /** You're driving the browser (clicks/typing go to the page). */
  controlling: boolean;
  /** The agent was paused because you took control; it can continue. */
  paused: boolean;
  onStop: () => void;
  onClose: () => void;
  /** Start (or reconnect to) the live browser when nothing is streaming. */
  onOpenBrowser: () => void;
  opening: boolean;
  onToggleControl: () => void;
  onResume: () => void;
  onInput: (e: UserInput) => void;
  onViewport?: (size: { width: number; height: number }) => void;
  agentName?: string;
  onNav: (n: NavAction) => void;
  onPageOp: (op: PageOp) => void;
  pageBusy: boolean;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const rootRef = useRef<HTMLElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sound, setSound] = useState<LiveAudioState>({ active: false, heard: false, blocked: false, muted: false });
  const audioRef = useRef<ReturnType<typeof createLiveAudio> | null>(null);
  const onHasFrame = useCallback((v: boolean) => setHasFrame(v), []);

  useEffect(() => {
    if (followLog.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.steps.length, state.plan.length, showLog]);

  // The page's sound arrives on the same live stream as the picture.
  useEffect(() => {
    const audio = createLiveAudio(setSound);
    audioRef.current = audio;
    const unsub = bus.subscribe((e) => {
      if (e.type === "audio") audio.handle(e);
    });
    return () => {
      unsub();
      audio.dispose();
      audioRef.current = null;
    };
  }, [bus]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const outcome = OUTCOME[state.outcome];
  const secure = state.url.startsWith("https://");
  const displayUrl = state.url.replace(/^https?:\/\/(www\.)?/, "");
  const hasActivity = state.plan.length > 0 || state.steps.length > 0;
  const current = [...state.steps].reverse().find((s) => s.status === "running");

  return (
    <section
      ref={rootRef}
      aria-label="Live browser"
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--sk-line)] bg-black max-lg:rounded-xl max-lg:border"
    >
      {/* One slim toolbar: navigation, address, control, sound */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--sk-line)] bg-[var(--sk-bg)] px-1.5">
        <div className="flex shrink-0 items-center" role="group" aria-label="Navigation">
          <button type="button" onClick={() => onNav({ action: "back" })} disabled={!hasFrame} className={`${iconBtn} disabled:opacity-40`} aria-label="Back" title="Back">
            <ArrowLeft size={14} />
          </button>
          <button type="button" onClick={() => onNav({ action: "forward" })} disabled={!hasFrame} className={`${iconBtn} hidden disabled:opacity-40 sm:inline-flex`} aria-label="Forward" title="Forward">
            <ArrowRight size={14} />
          </button>
          <button type="button" onClick={() => onNav({ action: "reload" })} disabled={!hasFrame} className={`${iconBtn} disabled:opacity-40`} aria-label="Reload" title="Reload">
            <RotateCw size={12.5} />
          </button>
        </div>

        {editingUrl !== null ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const url = editingUrl.trim();
              if (url) onNav({ url: /^[\w-]+(\.[\w-]+)+(\/|$)|^https?:\/\//i.test(url) ? url : `https://duckduckgo.com/?q=${encodeURIComponent(url)}` });
              setEditingUrl(null);
            }}
          >
            <input
              autoFocus
              value={editingUrl}
              onChange={(e) => setEditingUrl(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setEditingUrl(null)}
              onKeyDown={(e) => e.key === "Escape" && setEditingUrl(null)}
              aria-label="Address or search"
              placeholder="Search or enter address"
              className="h-7 w-full rounded-full border border-[var(--sk-accent-line)] bg-white/[0.05] px-3 text-[12px] text-[var(--sk-text)] outline-none focus-visible:shadow-none"
            />
          </form>
        ) : (
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-full bg-white/[0.05] pl-3 pr-1 transition-colors hover:bg-white/[0.08]">
            <button
              type="button"
              disabled={!hasFrame}
              onClick={() => setEditingUrl(state.url === "about:blank" ? "" : state.url)}
              title={state.url || "Search or enter address"}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-[var(--sk-muted)] enabled:hover:text-[var(--sk-text)] disabled:cursor-default"
            >
              {state.url && state.url !== "about:blank" ? (
                secure ? <Lock size={11} className="shrink-0 text-[var(--sk-ok)]" aria-label="Secure" /> : <Globe size={11} className="shrink-0" aria-hidden />
              ) : (
                <MonitorPlay size={12} className="shrink-0 text-[var(--sk-accent-ink)]" aria-hidden />
              )}
              <span className="truncate">{state.url && state.url !== "about:blank" ? displayUrl : "Search or enter address"}</span>
            </button>
            {state.url && state.url !== "about:blank" && (
              <a href={state.url} target="_blank" rel="noopener noreferrer" className="sk-btn h-5.5 w-5.5 shrink-0 rounded-full text-[var(--sk-faint)] hover:text-[var(--sk-text)]" title="Open this page on your device" aria-label="Open this page on your device">
                <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          {!controlling && !paused && state.outcome !== "idle" && (
            <span className={`hidden shrink-0 px-1.5 text-[10.5px] font-medium xl:inline ${outcome.cls}`} aria-live="polite">
              {outcome.text}
            </span>
          )}
          {sound.heard && (
            <button
              type="button"
              onClick={() => (sound.blocked ? audioRef.current?.unblock() : audioRef.current?.setMuted(!sound.muted))}
              className={`${iconBtn} ${sound.blocked ? "text-[var(--sk-accent-ink)]" : ""}`}
              aria-label={sound.blocked ? "Turn on sound" : sound.muted ? "Unmute" : "Mute"}
              title={sound.blocked ? "Click to hear this page" : sound.muted ? "Unmute" : "Mute"}
            >
              {sound.muted || sound.blocked ? <VolumeX size={14} /> : <Volume2 size={14} className={sound.active ? "text-[var(--sk-accent-ink)]" : ""} />}
            </button>
          )}
          {paused && (
            <button type="button" onClick={onResume} className="sk-btn sk-primary h-7 shrink-0 rounded-md px-2 text-[11px] font-medium" title="Let Senko continue the task from this page">
              <Play size={10} fill="currentColor" aria-hidden /> Resume
            </button>
          )}
          {hasFrame && (
            <button
              type="button"
              onClick={onToggleControl}
              data-browser-control
              aria-pressed={controlling}
              className={`sk-btn h-7 shrink-0 rounded-md px-2 text-[11px] font-medium ${
                controlling ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]" : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
              }`}
              title={state.running ? "Pause the agent and use the browser yourself" : controlling ? "Switch to view-only" : "Click, scroll and type in this browser"}
            >
              {controlling ? (
                <><Eye size={11} aria-hidden /><span className="hidden sm:inline">View only</span></>
              ) : state.running ? (
                <><Hand size={11} aria-hidden /><span className="hidden sm:inline">Take control</span></>
              ) : (
                <><MousePointerClick size={11} aria-hidden /><span className="hidden sm:inline">Interact</span></>
              )}
            </button>
          )}
          {state.running && (
            <button type="button" onClick={onStop} className="sk-btn h-7 shrink-0 rounded-md bg-[var(--sk-text)] px-2 text-[11px] font-medium text-[var(--sk-bg)] hover:opacity-90">
              <Square size={9} fill="currentColor" aria-hidden /> Stop
            </button>
          )}
          {hasActivity && (
            <button type="button" onClick={() => setShowLog((v) => !v)} className={`${iconBtn} ${showLog ? "text-[var(--sk-accent-ink)]" : ""}`} aria-label={showLog ? "Hide steps" : "Show steps"} aria-pressed={showLog} title={showLog ? "Hide steps" : `Show steps (${state.steps.length})`}>
              <ListTree size={13.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void rootRef.current?.requestFullscreen?.().catch(() => {}))}
            className={`${iconBtn} hidden sm:inline-flex`}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Hide browser" title="Close browser panel">
            <X size={14} />
          </button>
        </div>
      </div>

      {state.inputError && (
        <div role="alert" className="shrink-0 bg-[var(--sk-bg)] px-3 py-1.5 text-[11px] text-[var(--sk-danger)]">
          {state.inputError}
        </div>
      )}

      {/* The live page: fills all remaining space, edge to edge */}
      <div className="relative min-h-0 flex-1">
        <LiveView bus={bus} title={state.title} onHasFrame={onHasFrame} agentRunning={state.running} agentName={agentName} interactive={controlling} onInput={onInput} onViewport={onViewport} />
        {!hasFrame && state.page !== undefined && <ReaderView page={state.page} busy={pageBusy} onOp={onPageOp} />}
        {!hasFrame && state.page === undefined && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-white/55 ${state.running ? "sk-scan" : ""}`}>
            {state.running || opening ? <Loader2 size={18} className="sk-spin text-[var(--sk-accent)]" aria-hidden /> : <MonitorPlay size={18} className="opacity-50" aria-hidden />}
            <span>{state.running ? state.status || "Starting the browser…" : opening ? "Starting Chromium…" : "The live browser appears here."}</span>
            {!state.running && (
              <button type="button" onClick={onOpenBrowser} disabled={opening} className="sk-btn mt-1 h-7 rounded-md bg-[var(--sk-accent)] px-3 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-60">
                {opening ? <Loader2 size={11} className="sk-spin" aria-hidden /> : <MonitorPlay size={11} aria-hidden />} Open live browser
              </button>
            )}
          </div>
        )}

        {/* What the agent is doing right now (small, out of the way) */}
        {state.running && hasFrame && !showLog && (
          <button
            type="button"
            onClick={() => hasActivity && setShowLog(true)}
            className="absolute bottom-2 left-2 z-[4] flex max-w-[75%] items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-left text-[11px] text-white backdrop-blur-md"
          >
            <span className="sk-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-accent)]" aria-hidden />
            <span className="truncate">{current ? `${current.label}…` : state.status || "Working…"}</span>
          </button>
        )}

        {/* Steps: an overlay you can open, so the page keeps all the space */}
        {hasActivity && showLog && (
          <div className="sk-in absolute inset-x-2 bottom-2 z-[5] flex max-h-[55%] flex-col overflow-hidden rounded-xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-xl sm:left-auto sm:w-[340px]">
            <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
                {state.running ? "Working" : outcome.text} · {state.steps.length} steps
              </span>
              <button type="button" onClick={() => setShowLog(false)} className="sk-btn h-6 w-6 rounded-md text-white/60 hover:text-white" aria-label="Hide steps">
                <X size={12.5} />
              </button>
            </div>
            <div
              ref={logRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
              }}
              className="sk-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            >
              {state.plan.length > 0 && (
                <ol className="mb-2.5 space-y-1">
                  {state.plan.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[11.5px] text-white/60">
                      <span className="mt-0.5 font-mono text-[10px] text-[var(--sk-accent-ink)]">{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              )}
              <ul className="space-y-1.5" aria-live="polite">
                {state.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[12px]">
                    <span className="mt-0.5 shrink-0">
                      {s.status === "running" ? (
                        <Loader2 size={12.5} className="sk-spin text-[var(--sk-accent)]" aria-label="Running" />
                      ) : s.status === "done" ? (
                        <Check size={12.5} className="text-[var(--sk-ok)]" aria-label="Done" />
                      ) : (
                        <X size={12.5} className="text-[var(--sk-danger)]" aria-label="Failed" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={s.status === "running" ? "font-medium text-white" : "text-white/70"}>{s.label}</div>
                      {s.detail && <div className="mt-0.5 truncate text-[11px] text-white/40" title={s.detail}>{s.detail}</div>}
                    </div>
                  </li>
                ))}
                {state.outcome === "stopped" && (
                  <li className="flex items-center gap-1.5 text-[12px] text-white/60">
                    <OctagonX size={12.5} aria-hidden /> Stopped by you
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
