"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, Copy, RotateCcw, Globe, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./markdown-renderer";
import { MapEmbed } from "./map-embed";
import { ImageCarousel } from "./image-carousel";
import { VideoEmbed } from "./video-embed";
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
  const hasMap = !!message.mapEmbed;
  const hasAttachments = hasSources || hasImages || hasVideos || hasMap;
  const isRich = !isUser && hasRichContent(message.content);
  const isShort = message.content.length < 80 && !message.content.includes("\n");

  // -- Thinking state (ghost thoughts / loading process) --
  if (isThinking) {
    return (
      <div className="flex w-full px-4 py-0.5 justify-start">
        <div className="rounded-xl rounded-bl-sm bg-white/[0.02] border border-white/[0.03] px-3 py-1.5 w-fit max-w-[70%]">
          <div className="flex items-center gap-2">
            <span className="flex gap-0.5">
              <span className="inline-block h-1 w-1 rounded-full bg-[#a78bfa]/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="inline-block h-1 w-1 rounded-full bg-[#a78bfa]/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="inline-block h-1 w-1 rounded-full bg-[#a78bfa]/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            {message.content ? (
              <span className="text-[11px] text-zinc-600 italic">{message.content}</span>
            ) : (
              <span className="text-[11px] text-zinc-600 italic">thinking...</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -- User message --
  if (isUser) {
    return (
      <div className="flex w-full px-4 py-0.5 justify-end group">
        <div className={cn(
          "relative w-fit rounded-2xl rounded-br-sm px-3 py-1.5 bg-[#a78bfa]/[0.08] border border-[#a78bfa]/[0.12]",
          isShort ? "max-w-[50%]" : "max-w-[60%]"
        )}>
          {isEditing ? (
            <div className="space-y-1.5">
              <Textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[40px] resize-none rounded-lg bg-black/20 border-white/[0.06] text-sm text-zinc-200 focus-visible:ring-0 focus-visible:ring-offset-0"
                rows={2}
              />
              <div className="flex gap-1">
                <button onClick={handleSave} className="rounded px-2 py-0.5 text-[10px] font-medium text-[#c4b5fd] bg-[#a78bfa]/15 hover:bg-[#a78bfa]/25 transition-colors">
                  <Check className="inline h-2.5 w-2.5 mr-0.5" />Save
                </button>
                <button onClick={handleCancel} className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-snug text-zinc-200">
              {message.content}
            </p>
          )}
          {!isEditing && (
            <div className="absolute -bottom-5 right-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
              <button onClick={handleCopy} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors">
                {copied ? <Check className="h-2.5 w-2.5 text-[#a78bfa]" /> : <Copy className="h-2.5 w-2.5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -- Assistant message --
  return (
    <div className="flex w-full px-4 py-0.5 justify-start group">
      <div className={cn(
        "relative w-fit rounded-2xl rounded-bl-sm bg-white/[0.03] border border-white/[0.04]",
        isRich || hasAttachments ? "max-w-[80%] px-3 py-2" : "max-w-[70%] px-3 py-1.5"
      )}>
        {/* Content */}
        {isRich ? (
          <div className="text-[13px] leading-relaxed text-zinc-300">
            <MarkdownRenderer content={message.content} />
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[13px] leading-snug text-zinc-300">
            {message.content}
          </p>
        )}

        {/* Images (carousel for multiple) */}
        {hasImages && <ImageCarousel images={message.images!} />}

        {/* Videos */}
        {hasVideos && message.videos!.map((video, i) => (
          <VideoEmbed key={i} video={video} />
        ))}

        {/* Sources */}
        {hasSources && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.sources!.map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (onOpenLink) { e.preventDefault(); onOpenLink(source.url); } }}
                className="flex items-center gap-1 rounded-md bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-zinc-300 border border-white/[0.04]"
              >
                {(source.favicon || getFaviconUrl(source.url)) ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={source.favicon || getFaviconUrl(source.url)}
                    alt=""
                    className="h-2.5 w-2.5 rounded-sm"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <Globe className="h-2.5 w-2.5" />
                )}
                <span className="max-w-[100px] truncate">{source.title}</span>
                <ExternalLink className="h-2 w-2 opacity-40" />
              </a>
            ))}
          </div>
        )}

        {/* Map */}
        {hasMap && <MapEmbed map={message.mapEmbed!} />}

        {/* Action bar */}
        <div className="absolute -bottom-4 left-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleCopy} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors">
            {copied ? <Check className="h-2.5 w-2.5 text-[#a78bfa]" /> : <Copy className="h-2.5 w-2.5" />}
          </button>
          {onRegenerate && (
            <button onClick={() => onRegenerate(message.id)} className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors">
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
