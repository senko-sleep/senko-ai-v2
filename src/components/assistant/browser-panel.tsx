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

export interface BrowserState {
  running: boolean;
  status: string;
  url: string;
  title: string;
  plan: string[];
  steps: AgentStep[];
  outcome: "idle" | "running" | "done" | "stopped" | "error";
}

const OUTCOME: Record<BrowserState["outcome"], { text: string; cls: string }> = {
  idle: { text: "Idle", cls: "text-[var(--sk-muted)] bg-[var(--sk-hover)]" },
  running: { text: "Working", cls: "text-[var(--sk-accent-ink)] bg-[var(--sk-accent-soft)]" },
  done: { text: "Done", cls: "text-[var(--sk-ok)] bg-[var(--sk-hover)]" },
  stopped: { text: "Stopped", cls: "text-[var(--sk-muted)] bg-[var(--sk-hover)]" },
  error: { text: "Error", cls: "text-[var(--sk-danger)] bg-[var(--sk-danger-soft)]" },
};

export type NavAction = { action: "back" | "forward" | "reload" } | { url: string };

export function BrowserPanel({
  state,
  bus,
  controlling,
  paused,
  onStop,
  onClose,
  onToggleControl,
  onResume,
  onInput,
  onNav,
}: {
  state: BrowserState;
  bus: LiveBus;
  /** You're driving the browser (clicks/typing go to the page). */
  controlling: boolean;
  /** The agent was paused because you took control; it can continue. */
  paused: boolean;
  onStop: () => void;
  onClose: () => void;
  onToggleControl: () => void;
  onResume: () => void;
  onInput: (e: UserInput) => void;
  onNav: (n: NavAction) => void;
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
  const navBtn = "sk-btn h-7 w-7 shrink-0 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]";
  const hasActivity = state.plan.length > 0 || state.steps.length > 0;

  return (
    <section aria-label="Live browser" className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--sk-line)] bg-[var(--sk-panel)] max-lg:rounded-2xl max-lg:border">
      {/* Compact, non-overflowing browser toolbar */}
      <div className="flex h-13 shrink-0 items-center gap-1.5 border-b border-[var(--sk-line)] px-3">
        {controlling && (
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Navigation">
            <button type="button" onClick={() => onNav({ action: "back" })} className={navBtn} aria-label="Back" title="Back">
              <ArrowLeft size={14} />
            </button>
            <button type="button" onClick={() => onNav({ action: "forward" })} className={`${navBtn} hidden sm:inline-flex`} aria-label="Forward" title="Forward">
              <ArrowRight size={14} />
            </button>
            <button type="button" onClick={() => onNav({ action: "reload" })} className={navBtn} aria-label="Reload" title="Reload">
              <RotateCw size={13} />
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
              className="h-8 w-full rounded-lg border border-[var(--sk-accent-line)] bg-[var(--sk-bg)] px-2.5 text-[12.5px] text-[var(--sk-text)] outline-none focus-visible:shadow-none"
            />
          </form>
        ) : (
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-bg)] pl-2.5 pr-1 transition-colors focus-within:border-[var(--sk-accent-line)]">
            <button
              type="button"
              disabled={!controlling}
              onClick={() => setEditingUrl(state.url)}
              title={controlling ? "Click to enter a URL" : state.url || "Live browser"}
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12.5px] text-[var(--sk-muted)] enabled:hover:text-[var(--sk-text)] disabled:cursor-default"
            >
              {state.url ? (
                secure ? <Lock size={11.5} className="shrink-0 text-[var(--sk-ok)]" aria-label="Secure" /> : <Globe size={11.5} className="shrink-0" aria-hidden />
              ) : (
                <MonitorPlay size={12.5} className="shrink-0" aria-hidden />
              )}
              <span className="truncate">{displayUrl || "Live browser"}</span>
            </button>
            {state.url && state.url !== "about:blank" && (
              <a
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
                className="sk-btn h-6 w-6 shrink-0 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
                title="Open page in a new tab"
                aria-label="Open this page on your device"
              >
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {!controlling && !paused && state.outcome !== "idle" && (
            <span className={`hidden shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium xl:inline ${outcome.cls}`} aria-live="polite">
              {outcome.text}
            </span>
          )}

          {paused ? (
            <button
              type="button"
              onClick={onResume}
              className="sk-btn sk-primary h-7.5 shrink-0 rounded-lg px-2.5 text-xs font-medium"
              title="Let Senko continue the task from this page"
            >
              <Play size={11} fill="currentColor" aria-hidden /> Resume
            </button>
          ) : (
            hasFrame && (
              <button
                type="button"
                onClick={onToggleControl}
                aria-pressed={controlling}
                className={`sk-btn h-7.5 shrink-0 rounded-lg border px-2.5 text-xs font-medium ${
                  controlling
                    ? "border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "border-[var(--sk-line)] bg-[var(--sk-solid)] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
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
                    <Eye size={12} aria-hidden />
                    <span>Done</span>
                  </>
                ) : state.running ? (
                  <>
                    <Hand size={12} aria-hidden />
                    <span className="hidden sm:inline">Take control</span>
                  </>
                ) : (
                  <>
                    <MousePointerClick size={12} aria-hidden />
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
              className="sk-btn h-7.5 shrink-0 rounded-lg bg-[var(--sk-text)] px-2.5 text-xs font-medium text-[var(--sk-bg)] hover:bg-[var(--sk-text)] hover:opacity-90"
            >
              <Square size={10} fill="currentColor" aria-hidden /> Stop
            </button>
          )}

          <button type="button" onClick={onClose} className="sk-btn h-7.5 w-7.5 shrink-0 rounded-lg text-[var(--sk-muted)] hover:text-[var(--sk-text)]" aria-label="Hide browser" title="Close browser panel">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Main viewport + activity feed */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div
          ref={viewRef}
          className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[#0a0a0c] shadow-sm"
        >
          <LiveView bus={bus} title={state.title} onHasFrame={onHasFrame} agentRunning={state.running} interactive={controlling} onInput={onInput} />
          {controlling && hasFrame && (
            <div className="pointer-events-none absolute left-2.5 top-2.5 z-[4] flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
              <span className="sk-pulse h-1.5 w-1.5 rounded-full bg-[var(--sk-accent)]" aria-hidden />
              Interactive mode
            </div>
          )}
          {!hasFrame && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center text-[13px] text-white/60 ${state.running ? "sk-scan" : ""}`}>
              {state.running ? <Loader2 size={20} className="sk-spin text-[var(--sk-accent)]" aria-hidden /> : <MonitorPlay size={20} className="opacity-60" aria-hidden />}
              <span>{state.running ? state.status || "Starting the browser…" : "Browser stream will appear here when a page loads."}</span>
            </div>
          )}
          {state.running && hasFrame && (
            <div className="absolute bottom-2.5 left-2.5 z-[4] flex max-w-[75%] items-center gap-2 rounded-full bg-black/75 px-3 py-1 text-[11.5px] text-white backdrop-blur-md">
              <span className="sk-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-accent)]" aria-hidden />
              <span className="truncate">{state.status || "Working…"}</span>
            </div>
          )}
          {hasFrame && (
            <div className="absolute bottom-2.5 right-2.5 z-[4] flex gap-1.5">
              {hasActivity && (
                <button
                  type="button"
                  onClick={() => setShowLog((v) => !v)}
                  className="hidden h-7.5 w-7.5 items-center justify-center rounded-lg bg-black/65 text-white/85 backdrop-blur-md transition hover:bg-black/85 hover:text-white lg:flex"
                  aria-label={showLog ? "Hide steps" : "Show steps"}
                  aria-pressed={!showLog}
                  title={showLog ? "Hide steps" : "Show steps"}
                >
                  <ListTree size={14} />
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
                className="flex h-7.5 w-7.5 items-center justify-center rounded-lg bg-black/65 text-white/85 backdrop-blur-md transition hover:bg-black/85 hover:text-white"
                aria-label="Full screen"
                title="Full screen"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Activity log: only expands into a full card when steps or a plan exist */}
        {hasActivity && showLog ? (
          <div ref={logRef} className="sk-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--sk-line)] bg-[var(--sk-bg)]/60 p-3.5">
            {state.plan.length > 0 && (
              <div className="mb-3.5">
                <h3 className="mb-2 text-[11px] font-medium text-[var(--sk-faint)]">Plan</h3>
                <ol className="space-y-1.5">
                  {state.plan.map((p, i) => (
                    <li key={i} className="sk-in flex gap-2 text-[12.5px] text-[var(--sk-muted)]" style={{ animationDelay: `${i * 40}ms` }}>
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--sk-hover)] font-mono text-[10px] text-[var(--sk-faint)]">{i + 1}</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <h3 className="mb-2 text-[11px] font-medium text-[var(--sk-faint)]">Activity ({state.steps.length})</h3>
            <ul className="space-y-2" aria-live="polite">
              {state.steps.map((s) => (
                <li key={s.id} className="sk-in flex items-start gap-2.5 text-[12.5px]">
                  <span className="mt-0.5 shrink-0">
                    {s.status === "running" ? (
                      <Loader2 size={13.5} className="sk-spin text-[var(--sk-accent)]" aria-label="Running" />
                    ) : s.status === "done" ? (
                      <Check size={13.5} className="text-[var(--sk-ok)]" aria-label="Done" />
                    ) : (
                      <X size={13.5} className="text-[var(--sk-danger)]" aria-label="Failed" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={s.status === "running" ? "font-medium text-[var(--sk-text)]" : "text-[var(--sk-muted)]"}>{s.label}</div>
                    {s.detail && (
                      <div className="mt-0.5 truncate text-[11.5px] text-[var(--sk-faint)]" title={s.detail}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {state.outcome === "stopped" && (
                <li className="sk-in flex items-center gap-2 text-[12.5px] text-[var(--sk-muted)]">
                  <OctagonX size={13.5} aria-hidden /> Stopped by you
                </li>
              )}
            </ul>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-[var(--sk-line)] bg-[var(--sk-bg)]/40 px-3.5 py-2.5 text-[12px] text-[var(--sk-faint)]">
            <span>
              {controlling
                ? "Click, scroll, or type directly inside the browser view above."
                : state.running
                  ? state.status || "Senko is working in the browser…"
                  : "Send a task in the chat to watch Senko work step-by-step."}
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
