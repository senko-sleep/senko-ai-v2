"use client";

import { MessageSquare, Trash2, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";

interface HistoryPanelProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
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
}: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const q = searchQuery.toLowerCase();
  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(q) ||
    (q.length >= 3 && c.messages.some((m) => m.content.toLowerCase().includes(q)))
  );

  const sorted = [...filtered].sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-2 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="h-10 rounded-xl border-[var(--border)] bg-[var(--card)] pl-10 text-[13px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-1 focus-visible:ring-[var(--primary)]/50"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessageSquare className="mx-auto mb-3 h-6 w-6 text-[var(--muted-foreground)]/50" />
            <p className="text-[13px] text-[var(--muted-foreground)]">
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
                      <p className="px-2 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        {group}
                      </p>
                    )}
                    <button
                      onClick={() => onSelectConversation(conversation.id)}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all",
                        activeConversationId === conversation.id
                          ? "bg-[var(--primary)]/10 text-[var(--foreground)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[14px] font-medium flex-1">
                            {conversation.title}
                          </p>
                          {hasTabs && (
                            <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--primary)]/60" title="Has open tabs" />
                          )}
                        </div>
                        {snippet && (
                          <p className="truncate text-[12px] text-[var(--muted-foreground)] mt-1 leading-snug">
                            {snippet}
                          </p>
                        )}
                        <p className="text-[11px] text-[var(--muted-foreground)]/60 mt-1">
                          {formatRelativeDate(new Date(conversation.updatedAt))}
                        </p>
                      </div>
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
                        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg p-0 text-[var(--muted-foreground)] hover:bg-red-500/10 hover:text-red-400 cursor-pointer transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
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
