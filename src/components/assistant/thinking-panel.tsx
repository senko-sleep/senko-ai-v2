"use client";

/**
 * ThinkingPanel — the "Thinking… / Thought for 6s" dropdown above a reply.
 *
 * Shows what Senko actually did (real server steps: understanding the message, research,
 * map lookups, image checks, writing) and the model's own streamed thought summaries.
 * Open while Senko works, folds away once the answer starts, and stays available after.
 */

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Brain,
  ChevronDown,
  Compass,
  ImageIcon,
  Lightbulb,
  Loader2,
  MapPin,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
  PlayCircle,
} from "lucide-react";
import type { AgentStep } from "./lib";
import "./thinking-panel.css";

const THINK_STEP = 51;

function iconFor(step: AgentStep) {
  const l = step.label.toLowerCase();
  if (step.status === "error") return XCircle;
  if (step.id === 50) return Lightbulb;
  if (step.id === THINK_STEP) return Brain;
  if (/writ/.test(l)) return PenLine;
  if (/map|place|locat/.test(l)) return MapPin;
  if (/youtube|video/.test(l)) return PlayCircle;
  if (/image|picture|photo|gallery/.test(l)) return ImageIcon;
  if (/verif|check|valid/.test(l)) return ShieldCheck;
  if (/research|wiki|dossier/.test(l)) return BookOpen;
  if (/search|find|look/.test(l)) return Search;
  if (/compos|design|ui/.test(l)) return Sparkles;
  return Compass;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function seconds(ms: number) {
  const s = ms / 1000;
  return s < 10 ? `${Math.max(1, Math.round(s))}s` : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export interface ThinkingPanelProps {
  steps?: AgentStep[];
  thoughts?: string;
  /** Senko is still working on this reply. */
  pending: boolean;
  /** The answer has started appearing. */
  answering: boolean;
  startedAt?: number;
  thinkingMs?: number;
}

export const ThinkingPanel = memo(function ThinkingPanel({ steps = [], thoughts, pending, answering, startedAt, thinkingMs }: ThinkingPanelProps) {
  const working = pending && !answering;
  // Open while working; fold away once the answer starts, unless the reader chose otherwise.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? working;
  const [now, setNow] = useState(() => Date.now());
  const thoughtRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  // Follow the newest thought while it streams.
  useEffect(() => {
    const el = thoughtRef.current;
    if (el && working) el.scrollTop = el.scrollHeight;
  }, [thoughts, working]);

  const hasThoughts = Boolean(thoughts?.trim());
  if (!pending && !steps.length && !hasThoughts) return null;

  const current = [...steps].reverse().find((s) => s.status === "running");
  const elapsed = thinkingMs ?? (startedAt ? now - startedAt : undefined);
  const visible = steps.filter((s) => s.id !== THINK_STEP || hasThoughts || s.status === "running");
  // Latest bold heading in the thought stream ("**Analyzing Chara's Impact**") makes a good live label.
  const thoughtTitle = hasThoughts ? [...thoughts!.matchAll(/\*\*([^*\n]{3,80})\*\*/g)].pop()?.[1] : undefined;

  const label = working
    ? (current?.id === THINK_STEP && thoughtTitle) || current?.label || "Thinking"
    : hasThoughts
    ? `Thought for ${elapsed ? seconds(elapsed) : "a moment"}`
    : `Worked for ${elapsed ? seconds(elapsed) : "a moment"}`;
  const stepCount = visible.length;

  return (
    <div className="sk-think" data-working={working || undefined} data-open={open || undefined}>
      <button
        type="button"
        className="sk-think-head"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        aria-label={open ? "Hide what Senko did" : "Show what Senko did"}
      >
        <span className="sk-think-icon" aria-hidden>
          {working ? <span className="sk-think-orb" /> : <Brain size={14} />}
        </span>
        <span className={`sk-think-label${working ? " sk-think-shimmer" : ""}`} aria-live="polite">{label}</span>
        {working && elapsed !== undefined && elapsed > 1500 && <span className="sk-think-time">{seconds(elapsed)}</span>}
        {!working && stepCount > 0 && <span className="sk-think-time">· {stepCount} step{stepCount === 1 ? "" : "s"}</span>}
        <ChevronDown size={14} className="sk-think-chevron" aria-hidden />
      </button>

      <div className="sk-think-body" hidden={!open}>
        <ol className="sk-think-steps">
          {visible.map((step) => {
            const Icon = iconFor(step);
            const running = step.status === "running" && pending;
            return (
              <li key={step.id} className="sk-think-step" data-status={running ? "running" : step.status}>
                <span className="sk-think-dot" aria-hidden>
                  {running ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                </span>
                <div className="sk-think-step-text">
                  <span className="sk-think-step-label">{step.label}</span>
                  {step.detail && <span className="sk-think-step-detail">{step.detail}</span>}
                  {step.url && (
                    <a href={step.url} target="_blank" rel="noopener noreferrer" className="sk-think-chip">
                      {host(step.url)}
                    </a>
                  )}
                  {step.id === THINK_STEP && hasThoughts && (
                    <div ref={thoughtRef} className="sk-think-thoughts">
                      <ReactMarkdown>{thoughts!}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {/* Thoughts from a reply path without a "Thinking" step still get shown. */}
          {hasThoughts && !visible.some((s) => s.id === THINK_STEP) && (
            <li className="sk-think-step" data-status="done">
              <span className="sk-think-dot" aria-hidden><Brain size={12} /></span>
              <div className="sk-think-step-text">
                <span className="sk-think-step-label">Thought process</span>
                <div ref={thoughtRef} className="sk-think-thoughts"><ReactMarkdown>{thoughts!}</ReactMarkdown></div>
              </div>
            </li>
          )}
          {pending && !visible.length && !hasThoughts && (
            <li className="sk-think-step" data-status="running">
              <span className="sk-think-dot" aria-hidden><Loader2 size={12} className="animate-spin" /></span>
              <div className="sk-think-step-text"><span className="sk-think-step-label">Reading your message</span></div>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
});
