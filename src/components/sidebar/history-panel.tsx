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
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          History
        </h2>
        <Button
          size="sm"
          onClick={onNewConversation}
          className="h-7 gap-1.5 rounded-lg bg-[#a78bfa]/15 px-2.5 text-xs text-[#c4b5fd] hover:bg-[#a78bfa]/25"
        >
          <Plus className="h-3 w-3" />
          New
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="glass-input h-8 rounded-lg pl-8 text-xs text-zinc-300 placeholder:text-zinc-600"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
            <p className="text-xs text-zinc-600">
              {searchQuery ? "No matching conversations" : "No conversations yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  activeConversationId === conversation.id
                    ? "bg-[#a78bfa]/10 text-zinc-200"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {conversation.title}
                  </p>
                  <p className="text-[10px] text-zinc-600">
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
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-zinc-700 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
