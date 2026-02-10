"use client";

import { Plus, MessageSquare, Trash2, Search } from "lucide-react";
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

export function HistoryPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <div className="space-y-1">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all",
                  activeConversationId === conversation.id
                    ? "bg-[var(--senko-accent)]/10 text-white"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300"
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-zinc-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {conversation.title}
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    {formatRelativeDate(new Date(conversation.updatedAt))}
                    {" -- "}
                    {conversation.messages.length} msg
                    {conversation.messages.length !== 1 ? "s" : ""}
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
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg p-0 text-zinc-700 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
