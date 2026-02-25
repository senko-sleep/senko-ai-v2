"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Brain, 
  Search, 
  Globe, 
  Loader2, 
  FileText, 
  CheckCircle2,
  Zap,
  Lock,
  RefreshCw,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity, SenkoStatus } from "@/types/chat";

type AIState = "idle" | "thinking" | "searching" | "browsing" | "reading" | "generating";

interface AIStatusDisplayProps {
  status: SenkoStatus;
  activities: Activity[];
  isStreaming: boolean;
  thinkingContent?: string;
  searchQuery?: string;
}

function deriveState(activities: Activity[], isStreaming: boolean): AIState {
  const activeActivity = activities.find(a => a.status === "active");
  if (activeActivity) {
    switch (activeActivity.type) {
      case "think": return "thinking";
      case "search": return "searching";
      case "browse": return "browsing";
      case "read": return "reading";
      case "scrape": return "browsing";
      case "extract": return "reading";
      case "write": return "generating";
      default: break;
    }
  }
  if (isStreaming) return "generating";
  return "idle";
}

// ── Browser-style search visualization ──
function BrowserSearchViz({ query, activities }: { query: string; activities: Activity[] }) {
  const [typedQuery, setTypedQuery] = useState("");
  const [phase, setPhase] = useState<"typing" | "loading" | "results">("typing");
  const [dots, setDots] = useState(0);
  const completedActivities = activities.filter(a => a.status === "done");
  const activeActivity = activities.find(a => a.status === "active");

  // Type the query letter by letter
  useEffect(() => {
    setTypedQuery("");
    setPhase("typing");
    let i = 0;
    const interval = setInterval(() => {
      if (i <= query.length) {
        setTypedQuery(query.slice(0, i));
        i++;
      } else {
        setPhase("loading");
        clearInterval(interval);
      }
    }, 35);
    return () => clearInterval(interval);
  }, [query]);

  // Animate loading dots
  useEffect(() => {
    if (phase !== "loading") return;
    const interval = setInterval(() => setDots(d => (d + 1) % 4), 400);
    return () => clearInterval(interval);
  }, [phase]);

  // Switch to results when activities complete
  useEffect(() => {
    if (completedActivities.length > 0) setPhase("results");
  }, [completedActivities.length]);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3">
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden bg-[var(--card)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--muted)] border-b border-[var(--border)]">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/60" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
            <span className="h-3 w-3 rounded-full bg-green-500/60" />
          </div>
          {/* URL bar */}
          <div className="flex-1 flex items-center gap-2 rounded-lg bg-[var(--background)] border border-[var(--border)] px-3 py-1.5 mx-2">
            <Lock className="h-3 w-3 text-emerald-500 shrink-0" />
            <span className="text-[12px] text-[var(--muted-foreground)] truncate">
              senko-search://web
            </span>
          </div>
          <RefreshCw className={cn("h-3.5 w-3.5 text-[var(--muted-foreground)]", phase === "loading" && "animate-spin")} />
        </div>

        {/* Search input area */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)]/10 shrink-0">
              <Search className="h-4 w-4 text-[var(--primary)]" />
            </div>
            <div className="flex-1 rounded-xl bg-[var(--background)] border border-[var(--border)] px-4 py-2.5">
              <span className="text-[14px] text-[var(--foreground)]">
                {typedQuery}
                {phase === "typing" && (
                  <span className="inline-block w-0.5 h-4 bg-[var(--primary)] animate-pulse ml-0.5 align-middle" />
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Loading / Results area */}
        {phase !== "typing" && (
          <div className="px-4 pb-4 space-y-2">
            {/* Loading bar */}
            {phase === "loading" && !completedActivities.length && (
              <div className="space-y-3">
                <div className="h-1 rounded-full bg-[var(--muted)] overflow-hidden">
                  <div className="h-full bg-[var(--primary)] rounded-full animate-loading-bar" 
                    style={{ width: "60%", animation: "loading-bar 1.5s ease-in-out infinite" }} />
                </div>
                <div className="flex items-center gap-2 text-[13px] text-[var(--muted-foreground)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--primary)]" />
                  <span>{activeActivity?.label || `Searching${".".repeat(dots)}`}</span>
                </div>
              </div>
            )}

            {/* Activity log */}
            {activities.filter(a => a.status === "done" || a.status === "active").map((activity) => (
              <div key={activity.id} className="flex items-center gap-2.5 text-[13px] py-1">
                {activity.status === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--primary)] shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
                <span className={activity.status === "done" ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}>
                  {activity.label}
                </span>
                {activity.detail && (
                  <span className="text-[11px] text-[var(--muted-foreground)] ml-auto">
                    {activity.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Thinking mode visualization ──
function ThinkingViz({ content, activities }: { content?: string; activities: Activity[] }) {
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeActivity = activities.find(a => a.status === "active");

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 100);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll thinking content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  const lines = content?.split("\n").filter(Boolean) || [];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3">
      <div className="rounded-2xl border border-purple-500/20 overflow-hidden bg-purple-500/[0.03]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-purple-500/10">
          <div className="relative">
            <Brain className="h-5 w-5 text-purple-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-purple-400">
              Reasoning
            </span>
            {activeActivity && (
              <p className="text-xs text-purple-400/60 truncate mt-0.5">
                {activeActivity.label}
              </p>
            )}
          </div>
          <span className="text-xs text-purple-400/50 tabular-nums">
            {elapsed}s
          </span>
        </div>

        {/* Thinking content stream */}
        <div 
          ref={scrollRef}
          className="px-4 py-3 max-h-[160px] overflow-y-auto scrollbar-thin"
        >
          {lines.length > 0 ? (
            <div className="space-y-1.5 font-mono text-[12px] leading-relaxed text-purple-300/70">
              {lines.slice(-8).map((line, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex items-start gap-2 transition-opacity duration-300",
                    i === lines.slice(-8).length - 1 ? "opacity-100 text-purple-300" : "opacity-50"
                  )}
                >
                  <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-purple-500/40" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[13px] text-purple-400/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Processing your request...</span>
            </div>
          )}
          {/* Animated cursor */}
          <div className="flex gap-1.5 mt-3">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact generating indicator ──
function GeneratingViz({ activities }: { activities: Activity[] }) {
  const [elapsed, setElapsed] = useState(0);
  const activeActivity = activities.find(a => a.status === "active");

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--primary)]/[0.03] px-4 py-3">
        <Zap className="h-4 w-4 text-[var(--primary)] animate-pulse" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-[var(--primary)]">
            Generating
          </span>
          {activeActivity && activeActivity.label !== "Generating response" && (
            <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
              {activeActivity.label}
            </p>
          )}
        </div>
        <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {elapsed}s
        </span>
      </div>
    </div>
  );
}

// ── Browsing/Reading indicator ──
function BrowsingViz({ activities, state }: { activities: Activity[]; state: AIState }) {
  const [elapsed, setElapsed] = useState(0);
  const activeActivity = activities.find(a => a.status === "active");
  const isReading = state === "reading";

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3">
      <div className={cn(
        "rounded-2xl border overflow-hidden",
        isReading ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-cyan-500/20 bg-cyan-500/[0.03]"
      )}>
        <div className="flex items-center gap-3 px-4 py-3">
          {isReading ? (
            <FileText className="h-4 w-4 text-emerald-400" />
          ) : (
            <Globe className="h-4 w-4 text-cyan-400" />
          )}
          <div className="flex-1 min-w-0">
            <span className={cn("text-sm font-medium", isReading ? "text-emerald-400" : "text-cyan-400")}>
              {isReading ? "Reading" : "Browsing"}
            </span>
            {activeActivity && (
              <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
                {activeActivity.label}
              </p>
            )}
          </div>
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            {elapsed}s
          </span>
        </div>
        {/* Activity log */}
        {activities.filter(a => a.status === "done").length > 0 && (
          <div className="px-4 pb-3 space-y-1.5 border-t border-[var(--border)]/30 pt-2">
            {activities.filter(a => a.status === "done").map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                <span className="truncate">{a.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ──
export function AIStatusDisplay({ 
  status, 
  activities, 
  isStreaming,
  thinkingContent,
  searchQuery 
}: AIStatusDisplayProps) {
  const state = deriveState(activities, isStreaming);

  if (state === "idle") return null;

  // Search: show browser-style visualization
  if (state === "searching" && searchQuery) {
    return <BrowserSearchViz query={searchQuery} activities={activities} />;
  }

  // Thinking: show reasoning process
  if (state === "thinking") {
    return <ThinkingViz content={thinkingContent} activities={activities} />;
  }

  // Browsing/Reading: show page activity
  if (state === "browsing" || state === "reading") {
    return <BrowsingViz activities={activities} state={state} />;
  }

  // Generating: compact indicator
  return <GeneratingViz activities={activities} />;
}

export function CompactStatus({ 
  activities, 
  isStreaming 
}: { activities: Activity[]; isStreaming: boolean }) {
  const state = deriveState(activities, isStreaming);
  if (state === "idle") return null;

  const labels: Record<AIState, string> = {
    idle: "Ready", thinking: "Thinking", searching: "Searching",
    browsing: "Browsing", reading: "Reading", generating: "Generating",
  };

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-[var(--primary)]/10 text-[var(--primary)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="font-medium">{labels[state]}</span>
    </div>
  );
}
