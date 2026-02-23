"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, Copy, RotateCcw, Globe, AlertTriangle, Grid3X3 } from "lucide-react";
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
  const hasAttachments = hasSources || hasImages || hasVideos || hasWebEmbeds || hasMap;
function hasRichContent(content: string): boolean {
  // Trigger markdown rendering for structured content including bold/italic
  return /```|^#{1,6}\s|^\s*[-*]\s\S|^\s*\d+\.\s\S|\|.+\||\*\*[^*]+\*\*|\*[^*]+\*/m.test(content);
}

  const isRich = !isUser && hasRichContent(message.content);
  const isShort = message.content.length < 80 && !message.content.includes("\n");

  // -- Thinking state (animated dots + status text like reference) --
  if (isThinking) {
    return (
      <div className="flex w-full py-4 justify-start animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <span className="thinking-dot h-2 w-2 rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
            <span className="thinking-dot h-2 w-2 rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
            <span className="thinking-dot h-2 w-2 rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[14px] text-zinc-400">
            {message.content || "thinking..."}
          </span>
        </div>
      </div>
    );
  }

  // -- User message --
  if (isUser) {
    return (
      <div className="flex w-full py-4 justify-end group">
        <div className={cn(
          "relative w-fit rounded-2xl rounded-br-sm glass-user px-6 py-4 animate-slide-in",
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
            <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-white">
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

  // -- Assistant message (ChatGPT-style clean layout) --
  const hasError = !!message.error;

  return (
    <div className="flex flex-col w-full py-6 items-start group">
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

      {/* Content - clean typography like ChatGPT */}
      {message.content && (
        <div className="w-full animate-fade-in">
          {isRich ? (
            <div className={cn("text-[15px] leading-[1.8] text-white/95", isStreaming && "typing-cursor")}>
              <MarkdownRenderer content={message.content} />
            </div>
          ) : (
            <p className={cn("whitespace-pre-wrap text-[15px] leading-[1.75] text-white/95", isStreaming && "typing-cursor")}>
              {message.content}
            </p>
          )}
        </div>
      )}

      {/* Images - horizontal carousel below content, above sources */}
      {hasImages && (
        <div className="w-full mt-6">
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
