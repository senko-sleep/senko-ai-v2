"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, Copy, RotateCcw, Globe, ExternalLink, AlertTriangle, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { MapEmbed } from "./map-embed";
import { ImageCarousel } from "./image-carousel";
import { VideoEmbed } from "./video-embed";
import { WebEmbed } from "./web-embed";
import type { Message } from "@/types/chat";

interface ChatMessageProps {
  message: Message;
  onEdit: (id: string, newContent: string) => void;
  onRegenerate?: (id: string) => void;
  onOpenLink?: (url: string) => void;
}

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
  } catch {
    return "";
  }
}

function hasRichContent(content: string): boolean {
  return /```|^\s*[-*]\s|^\s*\d+\.\s|^#{1,3}\s|\*\*|__|\|.*\|/m.test(content);
}

/* ─── Collapsible Thinking Block ─── */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="thinking-block mb-3 animate-fade-in-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left group"
      >
        <Brain className="h-3.5 w-3.5 text-[var(--senko-accent)]/60 flex-shrink-0" />
        <span className="text-[11px] font-medium text-[var(--senko-accent)]/70">Thinking</span>
        <span className="text-[10px] text-zinc-600 ml-auto">
          {expanded ? "collapse" : "expand"}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-600" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-600" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 animate-fade-in">
          <div className="thinking-block-content whitespace-pre-wrap">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, onEdit, onRegenerate, onOpenLink }: ChatMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [copied, setCopied] = useState(false);
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
  const hasThinkingContent = !!message.thinkingContent;
  const hasAttachments = hasSources || hasImages || hasVideos || hasWebEmbeds || hasMap;
  const isRich = !isUser && hasRichContent(message.content);
  const isShort = message.content.length < 80 && !message.content.includes("\n");

  // -- Thinking state (ghost thoughts / loading process) --
  if (isThinking) {
    return (
      <div className="flex w-full px-3 py-1 justify-start sm:px-4 animate-fade-in-up">
        <div className="thinking-shimmer thinking-glow rounded-2xl rounded-bl-sm border border-[var(--senko-accent)]/[0.12] px-3.5 py-2.5 w-fit max-w-[85%] sm:px-4 sm:py-3 sm:max-w-[70%]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="thinking-dot inline-block h-[5px] w-[5px] rounded-full bg-[var(--senko-accent)]" style={{ animationDelay: "0ms" }} />
              <span className="thinking-dot inline-block h-[5px] w-[5px] rounded-full bg-[#ffb347]" style={{ animationDelay: "0.2s" }} />
              <span className="thinking-dot inline-block h-[5px] w-[5px] rounded-full bg-[var(--senko-accent)]" style={{ animationDelay: "0.4s" }} />
            </span>
            {message.content ? (
              <span className="text-[11px] text-[var(--senko-accent)]/80 font-medium tracking-wide">{message.content}</span>
            ) : (
              <span className="text-[11px] text-[var(--senko-accent)]/80 font-medium tracking-wide">thinking...</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -- User message --
  if (isUser) {
    return (
      <div className="flex w-full px-3 py-0.5 justify-end group sm:px-4 animate-slide-in-right">
        <div className={cn(
          "relative w-fit rounded-2xl rounded-br-sm px-3.5 py-2 bg-[var(--accent-subtle)] border border-[var(--senko-accent)]/[0.15]",
          isShort ? "max-w-[55%]" : "max-w-[70%] sm:max-w-[65%]"
        )}>
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[40px] resize-none rounded-lg bg-black/20 border-white/[0.06] text-sm text-zinc-200 focus-visible:ring-0 focus-visible:ring-offset-0"
                rows={2}
              />
              <div className="flex gap-1.5">
                <button onClick={handleSave} className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--senko-accent)] bg-[var(--senko-accent)]/15 hover:bg-[var(--senko-accent)]/25 transition-colors">
                  <Check className="inline h-3 w-3 mr-0.5" />Save
                </button>
                <button onClick={handleCancel} className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white">
              {message.content}
            </p>
          )}
          {!isEditing && (
            <div className="absolute -bottom-6 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                className="rounded-md p-1 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-colors"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button onClick={handleCopy} className="rounded-md p-1 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-colors">
                {copied ? <Check className="h-3 w-3 text-[var(--senko-accent)]" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -- Assistant message --
  const hasError = !!message.error;

  return (
    <div className="flex flex-col w-full px-3 py-1 items-start group sm:px-4 animate-slide-in-left">
      {/* Message bubble */}
      <div className={cn(
        "relative w-fit rounded-2xl rounded-bl-md overflow-hidden",
        hasError
          ? "max-w-[95%] sm:max-w-[85%] bg-red-500/[0.04] border border-red-500/[0.15] shadow-[0_1px_3px_rgba(239,68,68,0.06)]"
          : isRich || hasAttachments
            ? "max-w-[95%] sm:max-w-[85%] bg-[var(--surface-elevated)] border border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
            : "max-w-[92%] sm:max-w-[75%] bg-[var(--surface-elevated)] border border-white/[0.06]"
      )}>
        {/* Inner padding wrapper — only render if there's actual content to show */}
        {(hasError || hasThinkingContent || message.content) && (
          <div className={cn(
            hasAttachments || isRich ? "px-4 py-3.5" : "px-3.5 py-2.5"
          )}>
            {/* Error banner */}
            {hasError && (
              <div className="mb-2.5 flex items-start gap-2 rounded-lg bg-red-500/[0.08] border border-red-500/[0.10] px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-red-400">Something went wrong</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-red-400/70 break-words">{message.error}</p>
                </div>
              </div>
            )}

            {/* Thinking block (collapsible) */}
            {hasThinkingContent && (
              <ThinkingBlock content={message.thinkingContent!} />
            )}

            {/* Content */}
            {message.content && (isRich ? (
              <div className="text-[13px] leading-[1.75] text-white">
                <MarkdownRenderer content={message.content} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white">
                {message.content}
              </p>
            ))}
          </div>
        )}

        {/* Videos */}
        {hasVideos && (
          <div className="px-3 pb-3 space-y-2">
            {message.videos!.map((video, i) => (
              <VideoEmbed key={i} video={video} />
            ))}
          </div>
        )}

        {/* Web Embeds */}
        {hasWebEmbeds && (
          <div className="px-3 pb-3 space-y-2">
            {message.webEmbeds!.map((embed, i) => (
              <WebEmbed key={i} embed={embed} />
            ))}
          </div>
        )}

        {/* Sources - pill UI */}
        {hasSources && (
          <div className={cn(
            "px-3.5 py-2.5 sm:px-4 sm:py-3",
            (hasError || hasThinkingContent || message.content) ? "border-t border-white/[0.06]" : "min-w-[200px]"
          )}>
            <div className="flex items-center gap-1.5 mb-2">
              <Globe className="h-3 w-3 text-[var(--senko-accent)]/60" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Sources</span>
              <span className="text-[9px] text-zinc-500 ml-auto">{message.sources!.length}</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible sm:pb-0 scrollbar-none">
              {message.sources!.map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { if (onOpenLink) { e.preventDefault(); onOpenLink(source.url); } }}
                  className="group/source flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-zinc-300 transition-all hover:bg-[var(--senko-accent)]/[0.08] hover:text-white border border-white/[0.06] hover:border-[var(--senko-accent)]/25 max-w-[220px] sm:max-w-[240px] shrink-0 sm:shrink active:bg-[var(--senko-accent)]/[0.12]"
                  title={source.snippet || source.title}
                >
                  {(source.favicon || getFaviconUrl(source.url)) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={source.favicon || getFaviconUrl(source.url)}
                      alt=""
                      className="h-3.5 w-3.5 rounded-sm shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  )}
                  <span className="truncate font-medium">{source.title}</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover/source:opacity-50 shrink-0 transition-opacity" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Map */}
        {hasMap && (
          <div className="px-3 pb-3">
            <MapEmbed map={message.mapEmbed!} />
          </div>
        )}

        {/* Action bar */}
        <div className="absolute -bottom-6 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleCopy} className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-colors">
            {copied ? <Check className="h-3 w-3 text-[var(--senko-accent)]" /> : <Copy className="h-3 w-3" />}
          </button>
          {onRegenerate && (
            <button onClick={() => onRegenerate(message.id)} className="rounded-md p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04] transition-colors">
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Images - full chat width */}
      {hasImages && (
        <div className="w-full mt-2">
          <ImageCarousel images={message.images!} />
        </div>
      )}
    </div>
  );
}
