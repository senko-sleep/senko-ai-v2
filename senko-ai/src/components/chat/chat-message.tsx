"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, Copy, RotateCcw, Globe, AlertTriangle, Grid3X3 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { MapEmbed } from "./map-embed";
import { ImageCarousel } from "./image-carousel";
import { ImageGallery } from "./image-gallery";
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

export function ChatMessage({ message, onEdit, onRegenerate, onOpenLink }: ChatMessageProps) {
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
  const hasAttachments = hasSources || hasImages || hasVideos || hasWebEmbeds || hasMap;
  const isRich = !isUser && hasRichContent(message.content);
  const isShort = message.content.length < 80 && !message.content.includes("\n");

  // -- Thinking state (ghost thoughts / loading process) --
  if (isThinking) {
    return (
      <div className="flex w-full px-3 py-2 mb-1 justify-start sm:px-6 relative z-0">
        <div className="thinking-shimmer thinking-glow rounded-2xl rounded-bl-sm border border-[var(--senko-accent)]/[0.12] px-5 py-3.5 w-fit max-w-[85%] sm:px-6 sm:py-4 sm:max-w-[70%] animate-slide-in">
          <div className="flex items-center gap-3.5">
            <span className="flex items-center gap-1.5">
              <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--senko-accent)]" style={{ animationDelay: "0s" }} />
              <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[#ffb347]" style={{ animationDelay: "0.2s" }} />
              <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--senko-accent)]" style={{ animationDelay: "0.4s" }} />
            </span>
            {message.content ? (
              <span className="text-[14px] text-[var(--senko-accent)]/80 font-medium tracking-wide">{message.content}</span>
            ) : (
              <span className="text-[14px] text-[var(--senko-accent)]/80 font-medium tracking-wide">thinking...</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -- User message --
  if (isUser) {
    return (
      <div className="flex flex-col w-full px-3 py-1.5 items-end group sm:px-6">
        <div className={cn(
          "relative w-fit rounded-2xl rounded-br-sm glass-user px-5 py-3 animate-slide-in",
          isShort ? "max-w-[60%]" : "max-w-[70%]"
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
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white">
              {message.content}
            </p>
          )}
        </div>
        {!isEditing && (
          <TooltipProvider delayDuration={400}>
            <div className="flex gap-1 mt-1 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                    className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="glass-panel-solid text-[11px] px-2 py-1">
                  Edit
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={handleCopy} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all">
                    {copied ? <Check className="h-3.5 w-3.5 text-[var(--senko-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="glass-panel-solid text-[11px] px-2 py-1">
                  {copied ? "Copied!" : "Copy"}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        )}
      </div>
    );
  }

  // -- Assistant message --
  const hasError = !!message.error;

  return (
    <div className="flex flex-col w-full px-3 py-2 items-start group sm:px-6">
      {/* Message bubble */}
      <div className={cn(
        "relative rounded-2xl rounded-bl-md glass-bubble animate-slide-in overflow-hidden",
        hasWebEmbeds ? "w-full sm:w-[90%]" : hasAttachments ? "w-full sm:w-auto sm:min-w-[340px]" : "w-fit",
        hasError
          ? "max-w-[95%] sm:max-w-[85%] !border-red-500/[0.15]"
          : hasWebEmbeds
            ? "max-w-[98%] sm:max-w-[92%] depth-shadow-lg"
            : isRich || hasAttachments
              ? "max-w-[95%] sm:max-w-[85%] depth-shadow-lg"
              : "max-w-[92%] sm:max-w-[78%] depth-shadow"
      )}>
        {/* Inner padding wrapper — only render if there's content or an error */}
        {(message.content || hasError) && (
          <div className={cn(
            "relative",
            hasAttachments || isRich ? "px-6 py-5" : "px-5 py-4"
          )}>
            {/* Error banner */}
            {hasError && (
              <div className="mb-4 flex items-start gap-3 rounded-xl bg-red-500/[0.08] border border-red-500/[0.12] px-4 py-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-red-400">Something went wrong</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-red-400/70 break-words">{message.error}</p>
                </div>
              </div>
            )}

            {/* Content */}
            {message.content && (isRich ? (
              <div className="text-[15px] leading-[1.75] text-white/95">
                <MarkdownRenderer content={message.content} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-[1.7] text-white/95">
                {message.content}
              </p>
            ))}
          </div>
        )}

        {/* Videos */}
        {hasVideos && (
          <div className="relative px-5 pb-5 space-y-3">
            {message.videos!.map((video, i) => (
              <VideoEmbed key={i} video={video} />
            ))}
          </div>
        )}

        {/* Web Embeds (live iframes) */}
        {hasWebEmbeds && (
          <div className="relative px-5 pb-5 space-y-3">
            {message.webEmbeds!.map((embed, i) => (
              <WebEmbed key={i} embed={embed} />
            ))}
          </div>
        )}

        {/* Sources - pill UI inside bubble */}
        {hasSources && (
          <div className={cn(
            "relative px-5 py-4 sm:px-6 sm:py-4",
            message.content ? "border-t border-white/[0.06]" : ""
          )}>
            <div className="flex items-center gap-2.5 mb-3">
              <Globe className="h-4 w-4 text-[var(--senko-accent)]/60" />
              <span className="text-[12px] font-bold uppercase tracking-[0.15em] text-zinc-400">Sources</span>
              <span className="text-[11px] text-zinc-500 ml-auto font-medium">{message.sources!.length}</span>
            </div>
            <div className="flex flex-wrap gap-2 overflow-hidden">
              {message.sources!.slice(0, 8).map((source, i) => (
                <a
                  key={i}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { if (onOpenLink) onOpenLink(source.url); }}
                  className="group/source glass-pill flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-zinc-300 max-w-[200px] shrink-0 cursor-pointer hover:bg-white/[0.06] transition-colors"
                  title={source.snippet || source.title}
                >
                  <span className="relative h-4 w-4 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={source.favicon || getFaviconUrl(source.url)}
                      alt=""
                      className="h-4 w-4 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
                    />
                    <Globe className="h-4 w-4 text-zinc-500 absolute inset-0 hidden" />
                  </span>
                  <span className="truncate font-medium">{source.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Map */}
        {hasMap && (
          <div className="relative px-5 pb-5">
            <MapEmbed map={message.mapEmbed!} />
          </div>
        )}

      </div>

      {/* Action bar — outside bubble so overflow-hidden doesn't clip it */}
      <TooltipProvider delayDuration={400}>
        <div className="flex gap-1 mt-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={handleCopy} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all">
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--senko-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="glass-panel-solid text-[11px] px-2 py-1">
              {copied ? "Copied!" : "Copy"}
            </TooltipContent>
          </Tooltip>
          {onRegenerate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => onRegenerate(message.id)} className="rounded-lg p-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.06] transition-all">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="glass-panel-solid text-[11px] px-2 py-1">
                Regenerate
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      {/* Images - full chat width */}
      {hasImages && (
        <div className="w-full mt-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[11px] text-zinc-500 font-medium">{message.images!.length} image{message.images!.length !== 1 ? "s" : ""}</span>
            <button
              onClick={() => setShowGallery(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-[var(--senko-accent)] bg-white/[0.04] hover:bg-[var(--senko-accent)]/10 border border-white/[0.06] hover:border-[var(--senko-accent)]/30 rounded-lg transition-all"
            >
              <Grid3X3 className="h-3 w-3" />
              Gallery
            </button>
          </div>
          <ImageCarousel images={message.images!} />
        </div>
      )}

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
