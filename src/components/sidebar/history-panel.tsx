"use client";

import { Plus, MessageSquare, Trash2, Search, Pin } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";

interface HistoryPanelProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onPinConversation?: (id: string) => void;
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const d = new Date(date);

  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

function getLastMessageSnippet(conv: Conversation): string {
  const msgs = conv.messages.filter((m) => !m.isThinking);
  if (msgs.length === 0) return "";
  const last = msgs[msgs.length - 1];
  let text = last.content
    .replace(/\[ACTION:[^\]]+\]/g, "")
    .replace(/\[STATUS:[^\]]+\]/g, "")
    .replace(/\[MEMORY:[^\]]+\]/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[#*_~`>]/g, "")
    .trim();
  if (text.length > 60) text = text.slice(0, 57) + "...";
  return text;
}

export function HistoryPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onPinConversation,
}: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const q = searchQuery.toLowerCase();
  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(q) ||
    (q.length >= 3 && c.messages.some((m) => m.content.toLowerCase().includes(q)))
  );

  // Sort: pinned first, then by updatedAt descending
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
          History
        </h2>
        <Button
          size="sm"
          onClick={onNewConversation}
          className="h-8 gap-2 rounded-xl bg-[var(--senko-accent)]/15 px-3 text-[12px] font-medium text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/25 transition-all"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="px-4 pb-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="glass-input h-9 rounded-xl pl-9 text-[13px] text-zinc-300 placeholder:text-zinc-600"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <MessageSquare className="mx-auto mb-3 h-6 w-6 text-zinc-700" />
            <p className="text-[13px] text-zinc-600">
              {searchQuery ? "No matching conversations" : "No conversations yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {(() => {
              let lastGroup = "";
              return sorted.map((conversation) => {
                const group = getDateGroup(new Date(conversation.updatedAt));
                const showGroupHeader = group !== lastGroup;
                lastGroup = group;
                const snippet = getLastMessageSnippet(conversation);
                const hasTabs = (conversation.tabs?.length || 0) > 0;

                return (
                  <div key={conversation.id}>
                    {showGroupHeader && (
                      <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                        {group}
                      </p>
                    )}
                    <button
                      onClick={() => onSelectConversation(conversation.id)}
                      className={cn(
                        "group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all",
                        activeConversationId === conversation.id
                          ? "bg-[var(--senko-accent)]/10 text-white"
                          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300"
                      )}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-zinc-600 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {conversation.pinned && (
                            <Pin className="h-3 w-3 shrink-0 text-[var(--senko-accent)]/60 -rotate-45" />
                          )}
                          <p className="truncate text-[13px] font-medium flex-1">
                            {conversation.title}
                          </p>
                          {hasTabs && (
                            <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-cyan-400/60" title="Has open tabs" />
                          )}
                        </div>
                        {snippet && (
                          <p className="truncate text-[11px] text-zinc-600 mt-0.5 leading-snug">
                            {snippet}
                          </p>
                        )}
                        <p className="text-[10px] text-zinc-700 mt-0.5">
                          {formatRelativeDate(new Date(conversation.updatedAt))}
                          {" · "}
                          {conversation.messages.length} msg{conversation.messages.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                        {onPinConversation && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPinConversation(conversation.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.stopPropagation();
                                onPinConversation(conversation.id);
                              }
                            }}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-lg p-0 cursor-pointer transition-colors",
                              conversation.pinned
                                ? "text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/10"
                                : "text-zinc-700 hover:bg-white/[0.06] hover:text-zinc-400"
                            )}
                            title={conversation.pinned ? "Unpin" : "Pin"}
                          >
                            <Pin className="h-3 w-3 -rotate-45" />
                          </span>
                        )}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conversation.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              onDeleteConversation(conversation.id);
                            }
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg p-0 text-zinc-700 hover:bg-red-500/10 hover:text-red-400 cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
