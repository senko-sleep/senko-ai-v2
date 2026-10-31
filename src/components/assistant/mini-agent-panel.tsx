"use client";

/**
 * MiniAgentPanel — compact, collapsible live-task panel.
 *
 * Shows real execution events only. No fake animations, no simulated
 * browser activity. Each step reflects an actual server operation.
 *
 * Design: Senko-themed (--sk-accent colors, fox-mark icon), responsive,
 * non-obstructive.
 */

import { memo, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  XCircle,
  Zap,
} from "lucide-react";
import { FoxMark } from "./fox-mark";
import type { AgentStep } from "./lib";

export type { AgentStep };

export interface MiniAgentPanelProps {
  steps: AgentStep[];
  /** Whether the agent task is still actively running. */
  running: boolean;
  /** Task label shown in the header. */
  taskLabel?: string;
  /** Called when the user dismisses/collapses the panel (optional). */
  onDismiss?: () => void;
}

function StepRow({ step }: { step: AgentStep }) {
  return (
    <li className="flex items-start gap-2 py-1 text-[12px]">
      <span className="mt-px shrink-0">
        {step.status === "done" ? (
          <CheckCircle2
            size={12}
            className="text-[var(--sk-accent-ink)]"
            aria-label="Done"
          />
        ) : step.status === "error" ? (
          <XCircle
            size={12}
            className="text-[var(--sk-danger,#f87171)]"
            aria-label="Error"
          />
        ) : (
          <Loader2
            size={12}
            className="animate-spin text-[var(--sk-accent)]"
            aria-label="Running"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            step.status === "error"
              ? "text-[var(--sk-danger,#f87171)]"
              : step.status === "done"
              ? "text-[var(--sk-muted)]"
              : "text-[var(--sk-text)]"
          }
        >
          {step.label}
        </span>
        {step.detail && (
          <span className="ml-1 truncate text-[11px] text-[var(--sk-faint)]">
            — {step.detail}
          </span>
        )}
        {step.url && (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 break-all text-[11px] text-[var(--sk-accent-ink)] underline hover:opacity-80"
          >
            {(() => {
              try {
                return new URL(step.url).hostname;
              } catch {
                return step.url;
              }
            })()}
          </a>
        )}
      </span>
    </li>
  );
}

export const MiniAgentPanel = memo(function MiniAgentPanel({
  steps,
  running,
  taskLabel,
  onDismiss,
}: MiniAgentPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll step list to bottom when new steps arrive.
  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [steps, expanded]);

  const doneCount = steps.filter((s) => s.status === "done").length;
  const hasError = steps.some((s) => s.status === "error");
  const label = taskLabel || "Working on it…";
  const summary =
    steps.length === 0
      ? "Starting…"
      : running
      ? `${doneCount} of ${steps.length} step${steps.length !== 1 ? "s" : ""} done`
      : hasError
      ? "Finished with errors"
      : "All steps complete";

  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface)] text-[var(--sk-text)] shadow-sm"
      role="region"
      aria-label="Mini agent task panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Senko fox-mark icon with optional pulse while running */}
        <span
          className={`shrink-0 ${running ? "sk-thinking" : ""}`}
          aria-hidden
        >
          <FoxMark size={14} />
        </span>

        {/* Status indicator */}
        {running ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-accent)] sk-pulse"
            aria-hidden
          />
        ) : hasError ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sk-danger,#f87171)]"
            aria-hidden
          />
        ) : (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
            aria-hidden
          />
        )}

        {/* Task label */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium leading-tight">{label}</p>
          <p className="text-[10.5px] text-[var(--sk-muted)]">{summary}</p>
        </div>

        {/* Zap icon — indicates this is an active mini-agent */}
        <Zap
          size={11}
          className="shrink-0 text-[var(--sk-accent-ink)] opacity-70"
          aria-hidden
        />

        {/* Expand / collapse toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="sk-btn h-6 w-6 shrink-0 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
          aria-label={expanded ? "Collapse task steps" : "Expand task steps"}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {/* Dismiss (only when done and caller provides handler) */}
        {!running && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="sk-btn h-6 w-6 shrink-0 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
            aria-label="Dismiss panel"
            title="Dismiss"
          >
            <XCircle size={13} />
          </button>
        )}
      </div>

      {/* Step list */}
      {expanded && steps.length > 0 && (
        <div className="border-t border-[var(--sk-line)] px-3 pb-2 pt-1.5">
          <ul
            ref={listRef}
            className="max-h-44 space-y-0.5 overflow-y-auto"
            aria-live="polite"
            aria-label="Task steps"
          >
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        </div>
      )}

      {/* Progress bar at the bottom while running */}
      {running && (
        <div
          className="h-[2px] w-full bg-gradient-to-r from-[var(--sk-accent)] via-[var(--sk-accent-line)] to-transparent sk-slide"
          aria-hidden
        />
      )}
    </div>
  );
});
