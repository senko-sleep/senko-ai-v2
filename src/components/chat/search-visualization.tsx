"use client";

import { useState, useEffect } from "react";
import { Search, Globe, Loader2, ExternalLink, CheckCircle2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchResult {
  title: string;
  url: string;
  status: "loading" | "done";
}

interface SearchVisualizationProps {
  query: string;
  status: "typing" | "searching" | "reading" | "done";
  results?: SearchResult[];
  currentUrl?: string;
}

export function SearchVisualization({
  query,
  status,
  results = [],
  currentUrl,
}: SearchVisualizationProps) {
  const [typedQuery, setTypedQuery] = useState("");
  const [showCursor, setShowCursor] = useState(true);

  // Typing animation
  useEffect(() => {
    if (status === "typing" && query) {
      let i = 0;
      const interval = setInterval(() => {
        if (i <= query.length) {
          setTypedQuery(query.slice(0, i));
          i++;
        } else {
          clearInterval(interval);
        }
      }, 40);
      return () => clearInterval(interval);
    } else {
      setTypedQuery(query);
    }
  }, [query, status]);

  // Cursor blink
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden animate-fade-in">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--muted)]">
        {/* Traffic lights */}
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-2 rounded-lg bg-[var(--background)] border border-[var(--border)] px-3 py-1.5">
          {status === "searching" || status === "reading" ? (
            <Loader2 className="h-3.5 w-3.5 text-[var(--primary)] animate-spin" />
          ) : status === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Search className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          )}
          <span className="text-[13px] text-[var(--foreground)] font-mono truncate">
            {currentUrl || `search: ${typedQuery}`}
            {status === "typing" && showCursor && (
              <span className="text-[var(--primary)]">|</span>
            )}
          </span>
        </div>
      </div>

      {/* Search content area */}
      <div className="p-4 space-y-3 min-h-[120px]">
        {status === "typing" && (
          <div className="flex items-center gap-3 text-[var(--muted-foreground)]">
            <Search className="h-5 w-5" />
            <span className="text-sm">
              Searching for <span className="text-[var(--foreground)] font-medium">{typedQuery}</span>
              {showCursor && <span className="text-[var(--primary)]">|</span>}
            </span>
          </div>
        )}

        {status === "searching" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
              <span>Searching the web...</span>
            </div>
            {/* Skeleton results */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5 animate-pulse" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="h-4 w-3/4 rounded bg-[var(--muted)]" />
                <div className="h-3 w-1/2 rounded bg-[var(--muted)]" />
              </div>
            ))}
          </div>
        )}

        {(status === "reading" || status === "done") && results.length > 0 && (
          <div className="space-y-2.5">
            {results.map((result, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-3 rounded-xl p-2.5 transition-all",
                  result.status === "loading"
                    ? "bg-[var(--primary)]/5 border border-[var(--primary)]/20"
                    : "bg-[var(--muted)]/50"
                )}
              >
                <div className="shrink-0 mt-0.5">
                  {result.status === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
                  ) : (
                    <Globe className="h-4 w-4 text-[var(--muted-foreground)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--foreground)] truncate">
                    {result.title}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] truncate flex items-center gap-1">
                    {result.url}
                    {result.status === "loading" && (
                      <span className="text-[var(--primary)]">— reading...</span>
                    )}
                  </div>
                </div>
                {result.status === "done" && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}

        {status === "done" && results.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            <span>Search complete</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ThinkingVisualization({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n").filter(Boolean);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted)] transition-colors"
      >
        <div className="relative">
          <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Brain className="h-5 w-5 text-purple-400" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-purple-500 animate-pulse" />
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-[var(--foreground)]">Thinking...</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {lines.length > 0 ? lines[0].slice(0, 50) + "..." : "Processing your request"}
          </div>
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-[var(--border)]">
          <div className="mt-3 space-y-2 text-sm text-[var(--foreground)]/80 font-mono text-[13px] leading-relaxed">
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[var(--muted-foreground)] select-none">{i + 1}.</span>
                <span>{line}</span>
              </div>
            ))}
            <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

export function CompactSearchIndicator({ query, status }: { query: string; status: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full px-4 py-2 border border-[var(--border)] bg-[var(--card)]">
      {status === "searching" ? (
        <Loader2 className="h-4 w-4 text-[var(--primary)] animate-spin" />
      ) : status === "reading" ? (
        <Globe className="h-4 w-4 text-[var(--primary)] animate-pulse" />
      ) : (
        <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
      )}
      <span className="text-[13px] text-[var(--foreground)]">
        {status === "searching" && "Searching..."}
        {status === "reading" && "Reading results..."}
        {status === "done" && "Done"}
        {!["searching", "reading", "done"].includes(status) && query}
      </span>
    </div>
  );
}
