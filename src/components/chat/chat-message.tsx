"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, Copy, RotateCcw, Globe, AlertTriangle, Grid3X3, Brain, ChevronDown, ChevronRight, Search, FileText, Sparkles, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { ReadAloudButton } from "./read-aloud-button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { MapEmbed } from "./map-embed";
import { ImageCarousel } from "./image-carousel";
import { ImageGallery } from "./image-gallery";
import { VideoEmbed } from "./video-embed";
import { WebEmbed } from "./web-embed";
import type { Message } from "@/types/chat";

// ── Rich inline search/activity visualization ──
function SearchActivityCard({ content }: { content: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [typedChars, setTypedChars] = useState(0);

  // Parse the thinking message text to determine phase and query
  const queryMatch = content.match(/(?:searching|reading.*?for|writing.*?on|browsing)\s+"?([^"]+?)"?\s*\.{3}$/i)
    || content.match(/searching\s+"([^"]+)"/i)
    || content.match(/for\s+"([^"]+)"/i)
    || content.match(/on\s+"([^"]+)"/i);
  const query = queryMatch ? queryMatch[1] : "";

  const isSearching = /^searching/i.test(content);
  const isReading = /^reading/i.test(content);
  const isWriting = /^writing/i.test(content);
  const isBrowsing = /^browsing/i.test(content);

  // Extract source count from "reading N sources"
  const sourceCountMatch = content.match(/reading\s+(\d+)\s+sources/i);
  const sourceCount = sourceCountMatch ? parseInt(sourceCountMatch[1], 10) : 0;

  // Typing animation for query
  useEffect(() => {
    if (!query) return;
    setTypedChars(0);
    const interval = setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= query.length) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 35);
    return () => clearInterval(interval);
  }, [query]);

  // Elapsed timer
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(interval);
  }, []);

  // Build step list
  const steps: { label: string; icon: React.ReactNode; done: boolean; active: boolean; color: string }[] = [];
  if (isSearching) {
    steps.push({ label: `Searching for "${query}"`, icon: <Search className="h-3.5 w-3.5" />, done: false, active: true, color: "text-cyan-400" });
    steps.push({ label: "Read & analyze sources", icon: <FileText className="h-3.5 w-3.5" />, done: false, active: false, color: "text-zinc-600" });
    steps.push({ label: "Write research summary", icon: <Sparkles className="h-3.5 w-3.5" />, done: false, active: false, color: "text-zinc-600" });
  } else if (isReading) {
    steps.push({ label: `Found results for "${query}"`, icon: <Search className="h-3.5 w-3.5" />, done: true, active: false, color: "text-emerald-400" });
    steps.push({ label: `Reading ${sourceCount} sources`, icon: <FileText className="h-3.5 w-3.5" />, done: false, active: true, color: "text-amber-400" });
    steps.push({ label: "Write research summary", icon: <Sparkles className="h-3.5 w-3.5" />, done: false, active: false, color: "text-zinc-600" });
  } else if (isWriting) {
    steps.push({ label: `Found results for "${query}"`, icon: <Search className="h-3.5 w-3.5" />, done: true, active: false, color: "text-emerald-400" });
    steps.push({ label: `Read sources`, icon: <FileText className="h-3.5 w-3.5" />, done: true, active: false, color: "text-emerald-400" });
    steps.push({ label: "Writing research summary", icon: <Sparkles className="h-3.5 w-3.5" />, done: false, active: true, color: "text-purple-400" });
  } else if (isBrowsing) {
    steps.push({ label: content, icon: <Globe className="h-3.5 w-3.5" />, done: false, active: true, color: "text-cyan-400" });
  } else {
    steps.push({ label: content, icon: <Brain className="h-3.5 w-3.5" />, done: false, active: true, color: "text-[var(--primary)]" });
  }

  return (
    <div className="flex w-full py-4 justify-start animate-fade-in">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg shadow-black/10">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-3.5 py-2 bg-[var(--muted)]/30 border-b border-[var(--border)]">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
          </div>
          {/* Search/URL bar */}
          <div className="flex-1 flex items-center gap-2 ml-2 px-3 py-1 rounded-lg bg-[var(--background)] border border-[var(--border)]">
            <Search className="h-3 w-3 text-[var(--muted-foreground)] shrink-0" />
            <span className="text-[12px] text-[var(--foreground)] font-mono truncate">
              {query ? query.slice(0, typedChars) : content}
              {typedChars < query.length && <span className="inline-block w-[1px] h-[14px] bg-[var(--primary)] ml-0.5 animate-pulse" />}
            </span>
          </div>
          <RefreshCw className={cn("h-3 w-3 text-[var(--muted-foreground)]", (isSearching || isReading) && "animate-spin")} style={{ animationDuration: "2s" }} />
        </div>

        {/* Loading bar */}
        <div className="h-[2px] bg-[var(--muted)]">
          <div className="h-full bg-[var(--primary)] animate-loading-bar" style={{ width: "40%" }} />
        </div>

        {/* Steps list */}
        <div className="px-4 py-3 space-y-2">
          {steps.map((step, i) => (
            <div key={i} className={cn("flex items-center gap-2.5 transition-all", step.active ? "opacity-100" : step.done ? "opacity-70" : "opacity-30")}>
              {step.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : step.active ? (
                <div className={cn("shrink-0", step.color)}>
                  {step.icon}
                </div>
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border border-zinc-600 shrink-0" />
              )}
              <span className={cn(
                "text-[12px] font-medium truncate",
                step.done ? "text-emerald-400/80" : step.active ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
              )}>
                {step.label}
              </span>
              {step.active && (
                <div className="flex gap-0.5 ml-auto shrink-0">
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--primary)]" style={{ animationDelay: "0ms" }} />
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--primary)]" style={{ animationDelay: "150ms" }} />
                  <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--primary)]" style={{ animationDelay: "300ms" }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer - elapsed time */}
        <div className="px-4 pb-2.5 flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {elapsed}s elapsed
          </span>
          {sourceCount > 0 && (
            <span className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" />
              {sourceCount} sources
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Completed search card - shows actual results like a real browser ──
function CompletedSearchCard({ activity }: { activity: { query: string; sourceCount: number; duration: number; phase: string; results?: { title: string; url: string; favicon?: string; snippet?: string }[] } }) {
  const [expanded, setExpanded] = useState(true);

  const getHostname = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  };

  const results = activity.results || [];

  return (
    <div className="w-full mb-4">
      {/* Collapsed toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full max-w-2xl rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] overflow-hidden hover:bg-emerald-500/[0.06] transition-colors"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="flex-1 text-left">
            <div className="text-[13px] font-medium text-emerald-400">
              Searched "{activity.query}"
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              {results.length} results found • {activity.duration}s
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-emerald-400/50 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-emerald-400/50 shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded: actual search results like a browser */}
      {expanded && results.length > 0 && (
        <div className="mt-2 w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-lg shadow-black/10">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-3.5 py-2 bg-[var(--muted)]/30 border-b border-[var(--border)]">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
            </div>
            <div className="flex-1 flex items-center gap-2 ml-2 px-3 py-1 rounded-lg bg-[var(--background)] border border-[var(--border)]">
              <Search className="h-3 w-3 text-[var(--muted-foreground)] shrink-0" />
              <span className="text-[12px] text-[var(--foreground)] font-mono truncate">
                {activity.query}
              </span>
            </div>
            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
          </div>

          {/* Search results list */}
          <div className="divide-y divide-[var(--border)]">
            {results.map((r, i) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 px-4 py-3 hover:bg-[var(--muted)]/20 transition-colors group"
              >
                {/* Favicon */}
                <div className="mt-0.5 shrink-0">
                  {r.favicon ? (
                    <img src={r.favicon} alt="" className="h-4 w-4 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <Globe className="h-4 w-4 text-[var(--muted-foreground)]" />
                  )}
                </div>
                {/* Result content */}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                    {getHostname(r.url)}
                  </div>
                  <div className="text-[13px] font-medium text-blue-400 group-hover:underline truncate mt-0.5">
                    {r.title}
                  </div>
                  {r.snippet && (
                    <div className="text-[12px] text-[var(--muted-foreground)] mt-1 line-clamp-2 leading-relaxed">
                      {r.snippet}
                    </div>
                  )}
                </div>
                <ExternalLink className="h-3 w-3 text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
              </a>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 flex items-center justify-between border-t border-[var(--border)] bg-[var(--muted)]/10">
            <span className="text-[10px] text-[var(--muted-foreground)]">
              Completed in {activity.duration}s
            </span>
            <span className="text-[10px] text-emerald-400/60 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {results.length} sources read
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const lines = content.split("\n").filter(Boolean);

  return (
    <div className="w-full mb-4 rounded-xl border border-purple-500/15 bg-purple-500/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left hover:bg-purple-500/[0.05] transition-colors"
      >
        <Brain className="h-4 w-4 text-purple-400 shrink-0" />
        <span className="text-[13px] font-medium text-purple-400">Reasoning</span>
        <span className="text-[11px] text-purple-400/50 ml-1">{lines.length} steps</span>
        {isStreaming && (
          <div className="flex gap-1 ml-2">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <div className="ml-auto">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-purple-400/50" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-purple-400/50" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 max-h-[240px] overflow-y-auto scrollbar-thin">
          <div className="space-y-1 font-mono text-[12px] leading-relaxed text-purple-300/60">
            {lines.map((line, i) => (
              <div key={i} className={cn(
                "py-0.5",
                i === lines.length - 1 && isStreaming ? "text-purple-300" : ""
              )}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatMessageProps {
  message: Message;
  onEdit: (id: string, newContent: string) => void;
  onRegenerate?: (id: string) => void;
  onOpenLink?: (url: string) => void;
  isStreaming?: boolean;
}

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
  } catch {
    return "";
  }
}


export function ChatMessage({ message, onEdit, onRegenerate, onOpenLink, isStreaming }: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editContent.trim()) {
      onEdit(message.id, editContent.trim());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") handleCancel();
  };

  const isUser = message.role === "user";
  const isThinking = message.isThinking;
  const hasSources = message.sources && message.sources.length > 0;
  const hasImages = message.images && message.images.length > 0;
  const hasVideos = message.videos && message.videos.length > 0;
  const hasWebEmbeds = message.webEmbeds && message.webEmbeds.length > 0;
  const hasMap = !!message.mapEmbed;
function hasRichContent(content: string): boolean {
  // Trigger markdown rendering for any structured content
  return /```|^#{1,6}\s|^\s*[-*]\s\S|^\s*\d+\.\s\S|\|.+\||\*\*[^*]+\*\*|\*[^*]+\*|^>\s|[\u2022\u2023\u25E6]|\/\/\/<|\[.+\]\(.+\)/m.test(content);
}

  const isRich = !isUser && hasRichContent(message.content);
  const isShort = message.content.length < 80 && !message.content.includes("\n");

  // -- Thinking/activity state - rich inline search visualization --
  if (isThinking) {
    return <SearchActivityCard content={message.content || "thinking..."} />;
  }

  // -- User message --
  if (isUser) {
    return (
      <div className="flex w-full py-4 justify-end group">
        <div className={cn(
          "relative w-fit rounded-2xl px-5 py-3.5 bg-[var(--primary)]/10 border border-[var(--primary)]/20 animate-slide-in",
          isShort ? "max-w-[75%]" : "max-w-[85%]"
        )}>
          {isEditing ? (
            <div className="space-y-3">
              <Textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[48px] resize-none rounded-xl bg-black/20 border-white/[0.06] text-[15px] text-zinc-200 focus-visible:ring-0 focus-visible:ring-offset-0"
                rows={2}
              />
              <div className="flex gap-2">
                <button onClick={handleSave} className="rounded-xl px-4 py-2 text-[13px] font-semibold text-[var(--senko-accent)] bg-[var(--senko-accent)]/15 hover:bg-[var(--senko-accent)]/25 transition-all">
                  <Check className="inline h-3.5 w-3.5 mr-1.5" />Save
                </button>
                <button onClick={handleCancel} className="rounded-xl px-4 py-2 text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--foreground)]">
              {message.content}
            </p>
          )}
          {!isEditing && (
            <div className="absolute -bottom-8 right-0 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={handleCopy} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all">
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--senko-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -- Assistant message - clean, spacious layout --
  const hasError = !!message.error;

  return (
    <div className="flex flex-col w-full py-3 items-start group">
      {/* Error banner */}
      {hasError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-red-500/[0.08] border border-red-500/[0.12] px-4 py-3 max-w-[95%]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-red-400">Something went wrong</p>
            <p className="mt-1 text-[13px] leading-relaxed text-red-400/70 break-words">{message.error}</p>
          </div>
        </div>
      )}

      {/* Thinking block - collapsible reasoning section */}
      {message.thinkingBlock && (
        <ThinkingBlock content={message.thinkingBlock} isStreaming={isStreaming} />
      )}

      {/* Content - clean typography like ChatGPT */}
      {message.content && (
        <div className="w-full animate-fade-in">
          {isRich ? (
            <div className={cn("text-[15px] leading-[1.8] text-[var(--foreground)]/95", isStreaming && "typing-cursor")}>
              <MarkdownRenderer content={message.content} />
            </div>
          ) : (
            <p className={cn("whitespace-pre-wrap text-[15px] leading-[1.75] text-[var(--foreground)]/95", isStreaming && "typing-cursor")}>
              {message.content}
            </p>
          )}
        </div>
      )}

      {/* Images - horizontal carousel below content, above sources */}
      {hasImages && (
        <div className="w-full mt-4">
          <ImageCarousel images={message.images!} />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[12px] text-zinc-500">{message.images!.length} images</span>
            <button
              onClick={() => setShowGallery(true)}
              className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-[var(--senko-accent)] transition-colors"
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              View Gallery
            </button>
          </div>
        </div>
      )}

      {/* Completed search visualization - below content and images */}
      {message.searchActivity && (
        <div className="mt-3">
          <CompletedSearchCard activity={message.searchActivity} />
        </div>
      )}

      {/* Sources - small inline pills like ChatGPT's Wikipedia citations */}
      {hasSources && (() => {
        // Deduplicate sources by title
        const seenTitles = new Set<string>();
        const uniqueSources = message.sources!.filter(source => {
          const title = source.title.toLowerCase().trim();
          if (seenTitles.has(title)) return false;
          seenTitles.add(title);
          return true;
        });
        
        return (
          <div className="mt-6 w-full">
            <div className="flex items-center gap-2.5 mb-3">
              <Globe className="h-4 w-4 text-zinc-500" />
              <span className="text-[12px] font-medium uppercase tracking-wider text-zinc-500">Sources</span>
              <span className="text-[11px] text-zinc-600">{uniqueSources.length}</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {uniqueSources.slice(0, 8).map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { if (onOpenLink) onOpenLink(source.url); }}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] text-zinc-400 bg-zinc-800/60 hover:bg-zinc-700/60 hover:text-zinc-200 transition-all"
                  title={source.snippet || source.title}
                >
                  <span className="relative h-3.5 w-3.5 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={source.favicon || getFaviconUrl(source.url)}
                      alt=""
                      className="h-3.5 w-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
                    />
                    <Globe className="h-3.5 w-3.5 text-zinc-500 absolute inset-0 hidden" />
                  </span>
                  <span className="truncate max-w-[180px]">{source.title}</span>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Videos */}
      {hasVideos && (
        <div className="w-full mt-6 space-y-4">
          {message.videos!.map((video, i) => (
            <VideoEmbed key={i} video={video} />
          ))}
        </div>
      )}

      {/* Web Embeds */}
      {hasWebEmbeds && (
        <div className="w-full mt-6 space-y-4">
          {message.webEmbeds!.map((embed, i) => (
            <WebEmbed key={i} embed={embed} />
          ))}
        </div>
      )}

      {/* Map */}
      {hasMap && (
        <div className="mt-6 w-full">
          <MapEmbed map={message.mapEmbed!} />
        </div>
      )}

      {/* Action bar - subtle */}
      <div className="flex gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button onClick={handleCopy} className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-all">
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--senko-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {message.content && (
          <ReadAloudButton messageId={message.id} text={message.content} />
        )}
        {onRegenerate && (
          <button onClick={() => onRegenerate(message.id)} className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-all">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Gallery Mode Overlay */}
      {showGallery && hasImages && (
        <ImageGallery
          images={message.images!}
          query={message.searchQuery}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  );
}
