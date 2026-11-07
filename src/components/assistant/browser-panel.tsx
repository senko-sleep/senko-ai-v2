import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
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
  Plus,
  RotateCw,
  ShieldAlert,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AgentStep, BrowserTabInfo, VerificationInfo } from "./lib";
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
  chatId,
  state,
  bus,
  controlling,
  paused,
  pauseReason,
  verification,
  tabs = [],
  onSwitchTab,
  onCloseTab,
  onNewTab,
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
  chatId?: string | null;
  state: BrowserState;
  bus: LiveBus;
  /** You're driving the browser (clicks/typing go to the page). */
  controlling: boolean;
  /** The agent was paused because you took control or a site asked for verification; it can continue. */
  paused: boolean;
  pauseReason?: string | null;
  verification?: VerificationInfo | null;
  tabs?: BrowserTabInfo[];
  onSwitchTab?: (index: number) => void;
  onCloseTab?: (index: number) => void;
  onNewTab?: () => void;
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
  const [expandedShotId, setExpandedShotId] = useState<string | null>(null);
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
  const doneSteps = state.steps.filter((s) => s.status === "done").length;

  const isVerificationChallenge =
    Boolean(verification?.active) ||
    Boolean(paused && pauseReason && /robot|verify|verification|captcha|cloudflare|security check/i.test(pauseReason));

  const lastDoneOrErr = [...state.steps].reverse().find((s) => s.status !== "running");
  const activePhase: "observing" | "planning" | "acting" | "verifying" | "recovering" | "waiting" | null =
    paused || isVerificationChallenge
      ? "waiting"
      : !state.running
        ? null
        : /planning/i.test(state.status) || /planning/i.test(current?.label || "")
          ? "planning"
          : lastDoneOrErr?.status === "error"
            ? "recovering"
            : /thinking|looking|checking/i.test(state.status)
              ? state.steps.length > 0 ? "verifying" : "observing"
              : current
                ? "acting"
                : "observing";

  return (
    <section
      ref={rootRef}
      aria-label="Live browser"
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--sk-line)] bg-black max-lg:rounded-xl max-lg:border"
    >
      {/* Multi-Tab Strip when session tabs are present */}
      {tabs.length > 0 && (
        <div className="sk-scroll flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--sk-line)] bg-[var(--sk-bg-2)] px-2">
          {tabs.map((tab) => {
            const tabLabel = tab.title || tab.url.replace(/^https?:\/\/(www\.)?/, "") || `Tab ${tab.index + 1}`;
            return (
              <div
                key={tab.index}
                className={`group flex h-6 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors ${
                  tab.active
                    ? "bg-[var(--sk-surface-2)] text-[var(--sk-text)] border border-[var(--sk-line-strong)]"
                    : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSwitchTab?.(tab.index)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title={tab.url || tabLabel}
                >
                  <Globe size={10.5} className={tab.active ? "shrink-0 text-[var(--sk-accent-ink)]" : "shrink-0 opacity-60"} />
                  <span className="truncate">{tabLabel}</span>
                </button>
                {tabs.length > 1 && onCloseTab && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.index);
                    }}
                    className="rounded p-0.5 opacity-50 hover:bg-white/10 hover:opacity-100"
                    aria-label={`Close ${tabLabel}`}
                    title="Close tab"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
          {onNewTab && (
            <button
              type="button"
              onClick={onNewTab}
              className="sk-btn h-6 w-6 shrink-0 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
              title="Open new tab"
              aria-label="Open new tab"
            >
              <Plus size={12} />
            </button>
          )}
        </div>
      )}

      {/* Navigation, Address, Control, and Sound Toolbar */}
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

      {/* Agent status: one line, current phase only */}
      {activePhase && (
        <div
          role="status"
          aria-label="Agent status"
          className="flex h-6 shrink-0 items-center gap-1.5 border-b border-[var(--sk-line)] px-3 text-[11px] text-[var(--sk-muted)]"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${activePhase === "recovering" || activePhase === "waiting" ? "bg-[var(--sk-accent)]" : "bg-[var(--sk-faint)] animate-pulse"}`}
            aria-hidden
          />
          <span className="font-medium text-[var(--sk-text)]">
            {({ observing: "Looking", planning: "Planning", acting: "Working", verifying: "Checking", recovering: "Retrying", waiting: "Paused" } as Record<string, string>)[activePhase] || activePhase}
          </span>
          {state.status && (
            <span className="min-w-0 truncate text-[var(--sk-faint)]" title={state.status}>
              · {state.status}
            </span>
          )}
        </div>
      )}

      {/* Prominent Human Verification / Challenge Handoff Banner */}
      {isVerificationChallenge && (
        <div
          role="region"
          aria-label="Human verification required"
          className="sk-verification-banner flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ShieldAlert size={15} className="shrink-0 text-[var(--sk-accent-ink)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--sk-text)]">
                <span>Verification Required{verification?.host ? ` on ${verification.host}` : ""}</span>
                {verification?.provider && (
                  <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-[var(--sk-accent-ink)]">
                    {verification.provider}
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-[var(--sk-muted)]">
                {verification?.summary || pauseReason || "Complete the check directly in the live browser below; session cookies are preserved."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!controlling && hasFrame && (
              <button
                type="button"
                onClick={onToggleControl}
                className="sk-btn h-7 border border-[var(--sk-accent-line)] bg-black/40 px-2.5 text-[11px] text-[var(--sk-text)]"
              >
                <MousePointerClick size={11} />
                <span>Interact</span>
              </button>
            )}
            {paused && (
              <button
                type="button"
                onClick={onResume}
                className="sk-btn sk-primary h-7 px-2.5 text-[11px] font-semibold"
              >
                <Play size={10} fill="currentColor" />
                <span>Solved — Resume</span>
              </button>
            )}
          </div>
        </div>
      )}

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
            className="absolute bottom-2 left-2 z-[4] flex max-w-[78%] items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-left text-[11px] text-white shadow-lg backdrop-blur-md"
          >
            <span className="sk-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-accent)]" aria-hidden />
            <span className="truncate font-medium">{current ? `${current.label}…` : state.status || "Working…"}</span>
            {state.steps.length > 0 && (
              <span className="sk-tabular shrink-0 rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-white/70">
                {doneSteps}/{state.steps.length}
              </span>
            )}
          </button>
        )}

        {/* Steps & Evidence Timeline Overlay */}
        {hasActivity && showLog && (
          <div className="sk-in absolute inset-x-2 bottom-2 z-[5] flex max-h-[62%] flex-col overflow-hidden rounded-xl border border-white/12 bg-black/85 shadow-2xl backdrop-blur-xl sm:left-auto sm:w-[370px]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-white/75">
                  {state.running ? "Active Operation" : outcome.text}
                </span>
                <span className="sk-tabular rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60">
                  {doneSteps}/{state.steps.length} steps
                </span>
              </div>
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
              className="sk-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2.5"
            >
              {state.plan.length > 0 && (
                <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2">
                  <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sk-accent-ink)]">
                    Execution Plan
                  </div>
                  <ol className="space-y-1">
                    {state.plan.map((p, i) => (
                      <li key={i} className="flex gap-2 text-[11px] text-white/65">
                        <span className="mt-0.5 font-mono text-[10px] text-[var(--sk-accent-ink)]">{i + 1}.</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <ul className="space-y-2" aria-live="polite">
                {state.steps.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 text-[12px]">
                    <div className="flex items-start gap-2">
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
                        <div className="flex items-center justify-between gap-1">
                          <span className={s.status === "running" ? "font-medium text-white" : "text-white/80"}>{s.label}</span>
                          {s.shotId && chatId && (
                            <button
                              type="button"
                              onClick={() => setExpandedShotId(expandedShotId === s.shotId ? null : s.shotId!)}
                              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--sk-accent-ink)] hover:bg-white/10"
                              title="Inspect step screenshot"
                            >
                              <Camera size={10} />
                              <span>Shot</span>
                            </button>
                          )}
                        </div>
                        {s.detail && <div className="mt-0.5 truncate text-[11px] text-white/45" title={s.detail}>{s.detail}</div>}
                      </div>
                    </div>
                    {s.shotId && chatId && expandedShotId === s.shotId && (
                      <div className="ml-5 overflow-hidden rounded-lg border border-white/10 bg-black/50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/sessions/${encodeURIComponent(chatId)}/screenshots/${encodeURIComponent(s.shotId)}`}
                          alt={`Step screenshot: ${s.label}`}
                          className="max-h-40 w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}
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
