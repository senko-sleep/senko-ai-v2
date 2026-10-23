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
  MonitorPlay,
  MousePointerClick,
  OctagonX,
  Play,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import type { AgentStep } from "./lib";
import { LiveView, type LiveBus, type UserInput } from "./live-view";
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
  onNav: (n: NavAction) => void;
  onPageOp: (op: PageOp) => void;
  pageBusy: boolean;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const onHasFrame = useCallback((v: boolean) => setHasFrame(v), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [state.steps.length, state.plan.length]);

  const outcome = OUTCOME[state.outcome];
  const secure = state.url.startsWith("https://");
  const displayUrl = state.url.replace(/^https?:\/\/(www\.)?/, "");
  const navBtn = "sk-btn h-6.5 w-6.5 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]";
  const hasActivity = state.plan.length > 0 || state.steps.length > 0;

  return (
    <section aria-label="Live browser" className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--sk-line)] bg-[var(--sk-bg)] max-lg:rounded-2xl max-lg:border">
      {/* Sleek, compact browser bar */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 px-2.5">
        {controlling && (
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Navigation">
            <button type="button" onClick={() => onNav({ action: "back" })} className={navBtn} aria-label="Back" title="Back">
              <ArrowLeft size={13} />
            </button>
            <button type="button" onClick={() => onNav({ action: "forward" })} className={`${navBtn} hidden sm:inline-flex`} aria-label="Forward" title="Forward">
              <ArrowRight size={13} />
            </button>
            <button type="button" onClick={() => onNav({ action: "reload" })} className={navBtn} aria-label="Reload" title="Reload">
              <RotateCw size={12} />
            </button>
          </div>
        )}

        {controlling && editingUrl !== null ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const url = editingUrl.trim();
              if (url) onNav({ url });
              setEditingUrl(null);
            }}
          >
            <input
              autoFocus
              value={editingUrl}
              onChange={(e) => setEditingUrl(e.target.value)}
              onBlur={() => setEditingUrl(null)}
              onKeyDown={(e) => e.key === "Escape" && setEditingUrl(null)}
              aria-label="Go to address"
              placeholder="Enter URL and press Enter…"
              className="h-7 w-full rounded-md border border-[var(--sk-accent-line)] bg-white/[0.03] px-2 text-[11.5px] text-[var(--sk-text)] outline-none focus-visible:shadow-none"
            />
          </form>
        ) : (
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md bg-white/[0.03] pl-2 pr-1 transition-colors">
            <button
              type="button"
              disabled={!controlling}
              onClick={() => setEditingUrl(state.url)}
              title={controlling ? "Click to enter a URL" : state.url || "Live browser"}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11.5px] text-[var(--sk-muted)] enabled:hover:text-[var(--sk-text)] disabled:cursor-default"
            >
              {state.url ? (
                secure ? <Lock size={10.5} className="shrink-0 text-[var(--sk-ok)]" aria-label="Secure" /> : <Globe size={10.5} className="shrink-0" aria-hidden />
              ) : (
                <MonitorPlay size={11.5} className="shrink-0 text-[var(--sk-accent-ink)]" aria-hidden />
              )}
              <span className="truncate">{displayUrl || "Live browser"}</span>
            </button>
            {state.url && state.url !== "about:blank" && (
              <a
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
                className="sk-btn h-5.5 w-5.5 shrink-0 rounded text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
                title="Open page in a new tab"
                aria-label="Open this page on your device"
              >
                <ExternalLink size={11} aria-hidden />
              </a>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {!controlling && !paused && state.outcome !== "idle" && (
            <span className={`hidden shrink-0 px-1.5 text-[10.5px] font-medium xl:inline ${outcome.cls}`} aria-live="polite">
              {outcome.text}
            </span>
          )}

          {paused ? (
            <button
              type="button"
              onClick={onResume}
              className="sk-btn sk-primary h-6.5 shrink-0 rounded-md px-2 text-[11px] font-medium"
              title="Let Senko continue the task from this page"
            >
              <Play size={10} fill="currentColor" aria-hidden /> Resume
            </button>
          ) : (
            hasFrame && (
              <button
                type="button"
                onClick={onToggleControl}
                aria-pressed={controlling}
                className={`sk-btn h-6.5 shrink-0 rounded-md px-2 text-[11px] font-medium ${
                  controlling
                    ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                }`}
                title={
                  state.running
                    ? "Pause the agent and use the browser yourself"
                    : controlling
                      ? "Switch back to view-only"
                      : "Click, scroll and type in this browser"
                }
              >
                {controlling ? (
                  <>
                    <Eye size={11} aria-hidden />
                    <span>Done</span>
                  </>
                ) : state.running ? (
                  <>
                    <Hand size={11} aria-hidden />
                    <span className="hidden sm:inline">Control</span>
                  </>
                ) : (
                  <>
                    <MousePointerClick size={11} aria-hidden />
                    <span className="hidden sm:inline">Interact</span>
                  </>
                )}
              </button>
            )
          )}

          {state.running && (
            <button
              type="button"
              onClick={onStop}
              className="sk-btn h-6.5 shrink-0 rounded-md bg-[var(--sk-text)] px-2 text-[11px] font-medium text-[var(--sk-bg)] hover:bg-[var(--sk-text)] hover:opacity-90"
            >
              <Square size={9} fill="currentColor" aria-hidden /> Stop
            </button>
          )}

          <button type="button" onClick={onClose} className="sk-btn h-6.5 w-6.5 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]" aria-label="Hide browser" title="Close browser panel">
            <X size={13.5} />
          </button>
        </div>
      </div>

      {/* Main viewport + unconfined activity feed */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-2.5 pb-2.5">
        <div
          ref={viewRef}
          className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-lg border border-[var(--sk-line)] bg-black"
        >
          <LiveView bus={bus} title={state.title} onHasFrame={onHasFrame} agentRunning={state.running} interactive={controlling} onInput={onInput} />
          {!hasFrame && state.page !== undefined && <ReaderView page={state.page} busy={pageBusy} onOp={onPageOp} />}
          {!hasFrame && state.page === undefined && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-white/55 ${state.running ? "sk-scan" : ""}`}>
              {state.running ? <Loader2 size={18} className="sk-spin text-[var(--sk-accent)]" aria-hidden /> : <MonitorPlay size={18} className="opacity-50" aria-hidden />}
              <span>{state.running ? state.status || "Starting the browser…" : "Browser stream appears here when a page loads."}</span>
              {!state.running && (
                <button
                  type="button"
                  onClick={onOpenBrowser}
                  disabled={opening}
                  className="sk-btn mt-1 h-7 rounded-md bg-[var(--sk-accent)] px-3 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {opening ? <Loader2 size={11} className="sk-spin" aria-hidden /> : <MonitorPlay size={11} aria-hidden />} Open live browser
                </button>
              )}
            </div>
          )}
          {state.running && hasFrame && (
            <div className="absolute bottom-2 left-2 z-[4] flex max-w-[75%] items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-0.5 text-[11px] text-white backdrop-blur-md">
              <span className="sk-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-accent)]" aria-hidden />
              <span className="truncate">{state.status || "Working…"}</span>
            </div>
          )}
          {hasFrame && (
            <div className="absolute bottom-2 right-2 z-[4] flex gap-1">
              {hasActivity && (
                <button
                  type="button"
                  onClick={() => setShowLog((v) => !v)}
                  className="hidden h-6.5 w-6.5 items-center justify-center rounded-md bg-black/65 text-white/85 backdrop-blur-md transition hover:bg-black/85 hover:text-white lg:flex"
                  aria-label={showLog ? "Hide steps" : "Show steps"}
                  aria-pressed={!showLog}
                  title={showLog ? "Hide steps" : "Show steps"}
                >
                  <ListTree size={12.5} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const el = viewRef.current;
                  if (!el) return;
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void el.requestFullscreen?.().catch(() => {});
                }}
                className="flex h-6.5 w-6.5 items-center justify-center rounded-md bg-black/65 text-white/85 backdrop-blur-md transition hover:bg-black/85 hover:text-white"
                aria-label="Full screen"
                title="Full screen"
              >
                <Maximize2 size={12.5} />
              </button>
            </div>
          )}
        </div>

        {/* Unconfined activity stream directly on pitch-black canvas */}
        {hasActivity && showLog ? (
          <div ref={logRef} className="sk-scroll min-h-0 flex-1 overflow-y-auto px-1 py-1">
            {state.plan.length > 0 && (
              <div className="mb-3">
                <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">Plan</h3>
                <ol className="space-y-1">
                  {state.plan.map((p, i) => (
                    <li key={i} className="sk-in flex gap-2 text-[12px] text-[var(--sk-muted)]" style={{ animationDelay: `${i * 35}ms` }}>
                      <span className="mt-0.5 font-mono text-[10px] text-[var(--sk-accent-ink)]">{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">Activity ({state.steps.length})</h3>
            <ul className="space-y-1.5" aria-live="polite">
              {state.steps.map((s) => (
                <li key={s.id} className="sk-in flex items-start gap-2 text-[12px]">
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
                    <div className={s.status === "running" ? "font-medium text-[var(--sk-text)]" : "text-[var(--sk-muted)]"}>{s.label}</div>
                    {s.detail && (
                      <div className="mt-0.5 truncate text-[11px] text-[var(--sk-faint)]" title={s.detail}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {state.outcome === "stopped" && (
                <li className="sk-in flex items-center gap-1.5 text-[12px] text-[var(--sk-muted)]">
                  <OctagonX size={12.5} aria-hidden /> Stopped by you
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div className="flex items-center justify-between px-1 py-1 text-[11.5px] text-[var(--sk-faint)]">
            <span>
              {controlling
                ? "Click, scroll, or type directly inside the browser view above."
                : state.running
                  ? state.status || "Senko is working in the browser…"
                  : "Send a task in chat to watch Senko work step-by-step."}
            </span>
            {hasActivity && !showLog && (
              <button
                type="button"
                onClick={() => setShowLog(true)}
                className="ml-2 shrink-0 font-medium text-[var(--sk-accent-ink)] hover:underline"
              >
                Show {state.steps.length} steps
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
