"use client";

import { useRef, useEffect, useState } from "react";
import {
  Bot, Square, ArrowDown,
  Smile, Frown, Angry, PartyPopper, Moon, Utensils,
  Heart, Skull, Coffee, Brain, Gamepad2, Music,
  Sparkles, Flame, Droplets, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput, type AgentMode } from "./chat-input";
import { ActivityFeed } from "./activity-feed";
import { TabBar } from "./tab-bar";
import type { Message, SenkoStatus, Activity, SenkoTab } from "@/types/chat";

const STATUS_ICON_MAP: Record<string, LucideIcon> = {
  happy: Smile,
  sad: Frown,
  angry: Angry,
  excited: PartyPopper,
  sleepy: Moon,
  hungry: Utensils,
  flustered: Heart,
  scared: Skull,
  chill: Coffee,
  thinking: Brain,
  love: Heart,
  gaming: Gamepad2,
  music: Music,
  sparkle: Sparkles,
  fire: Flame,
  crying: Droplets,
  shocked: Zap,
};

interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onEditMessage: (id: string, newContent: string) => void;
  onRegenerateMessage?: (id: string) => void;
  onStopGeneration?: () => void;
  onContinueGeneration?: () => void;
  onOpenLink?: (url: string) => void;
  sendWithEnter?: boolean;
  isStreaming?: boolean;
  tokenCount?: number;
  wasCutOff?: boolean;
  status?: SenkoStatus;
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  activities?: Activity[];
  tabs?: SenkoTab[];
  onCloseTab?: (tabId: string) => void;
  onSwitchTab?: (tabId: string) => void;
}

function StatusPill({ status, activities }: { status: SenkoStatus; activities: Activity[] }) {
  // Dual-mode: show active operation status when busy, mood when idle
  const activeActivity = activities.find((a) => a.status === "active");

  if (activeActivity) {
    // Action mode: show what the AI is doing
    const ACTIVITY_STATUS_ICONS: Record<string, LucideIcon> = {
      search: Sparkles, browse: Sparkles, read: Brain, extract: Sparkles,
      write: Brain, scrape: Sparkles, think: Brain,
    };
    const ACTIVITY_STATUS_COLORS: Record<string, string> = {
      search: "#a1a1aa", browse: "#a1a1aa", read: "#a1a1aa", extract: "#a1a1aa",
      write: "#a1a1aa", scrape: "#a1a1aa", think: "#a1a1aa",
    };
    const ActionIcon = ACTIVITY_STATUS_ICONS[activeActivity.type] || Brain;
    const actionColor = ACTIVITY_STATUS_COLORS[activeActivity.type] || "#60a5fa";

    return (
      <div
        className="flex items-center gap-2.5 rounded-full px-4 py-2 border transition-all duration-300"
        style={{ backgroundColor: `${actionColor}0a`, borderColor: `${actionColor}22` }}
      >
        <ActionIcon className="h-4 w-4 shrink-0 animate-pulse" style={{ color: actionColor }} />
        <span className="text-[13px] font-medium" style={{ color: `${actionColor}cc` }}>
          {activeActivity.label}
        </span>
      </div>
    );
  }

  // Mood mode: show AI personality status
  const IconComponent = STATUS_ICON_MAP[status.icon] || Sparkles;
  return (
    <div
      className="flex items-center gap-2.5 rounded-full px-4 py-2 border transition-all duration-500"
      style={{
        backgroundColor: `${status.color}0a`,
        borderColor: `${status.color}22`,
      }}
    >
      <IconComponent
        className="h-4 w-4 shrink-0"
        style={{ color: status.color }}
      />
      <span
        className="text-[13px] italic font-medium"
        style={{ color: `${status.color}cc` }}
      >
        {status.text}
      </span>
    </div>
  );
}

const DEFAULT_STATUS: SenkoStatus = { icon: "chill", text: "just vibin~", color: "#00d4ff" };

export function ChatArea({
  messages,
  onSendMessage,
  onEditMessage,
  onRegenerateMessage,
  onStopGeneration,
  onContinueGeneration,
  onOpenLink,
  sendWithEnter = true,
  isStreaming = false,
  tokenCount = 0,
  wasCutOff = false,
  status,
  agentMode,
  onAgentModeChange,
  activities = [],
  tabs = [],
  onCloseTab,
  onSwitchTab,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    if (scrollRef.current && !showScrollBtn) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showScrollBtn]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 80);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setShowScrollBtn(false);
    }
  };

  const showContinue = !isStreaming && wasCutOff;
  const currentStatus = status || DEFAULT_STATUS;

  return (
    <div className="flex h-full flex-col">
      {/* ── HEADER BAR: status pill + tabs + token count ── */}
      {/* This is a proper fixed header, NOT floating over chat */}
      <div className="shrink-0 border-b border-white/[0.06] bg-black/90 backdrop-blur-md">
        {/* Status pill row */}
        <div className="relative flex items-center justify-center py-2 px-4">
          <StatusPill status={currentStatus} activities={activities} />
          {tokenCount > 0 && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600 font-medium hidden sm:block">
              {tokenCount.toLocaleString()} tokens
            </span>
          )}
        </div>

        {/* Activity feed — shows live operations */}
        <ActivityFeed activities={activities} />

        {/* Browser tab bar removed — tabs no longer shown in header */}
      </div>

      {/* ── CHAT AREA: scrollable messages ── */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-5 sm:gap-6">
              {/* Avatar */}
              <div className="relative">
                <div className="glass-panel depth-shadow flex h-16 w-16 items-center justify-center rounded-2xl sm:h-18 sm:w-18">
                  <Bot className="h-8 w-8 text-zinc-300 sm:h-9 sm:w-9" />
                </div>
              </div>

              {/* Greeting */}
              <div className="text-center">
                <h2 className="text-xl font-semibold text-white sm:text-2xl">
                  Senko AI
                </h2>
                <p className="mt-2 max-w-md text-[14px] text-zinc-500 sm:text-[15px] leading-relaxed">
                  Search the web, browse sites, research topics, or just chat.
                </p>
              </div>

              {/* Categorized suggestions */}
              <div className="mt-2 grid w-full max-w-lg grid-cols-1 gap-2 sm:mt-3 sm:grid-cols-2">
                {[
                  { icon: "search", label: "Research", text: "Look up the latest anime news" },
                  { icon: "globe", label: "Browse", text: "Open YouTube and find trending videos" },
                  { icon: "gamepad", label: "Play", text: "Let's play 20 questions!" },
                  { icon: "heart", label: "Chat", text: "I had the worst day ever..." },
                ].map((suggestion) => (
                  <button
                    key={suggestion.text}
                    onClick={() => onSendMessage(suggestion.text)}
                    className="glass-panel group rounded-xl px-4 py-3 text-left transition-all hover:bg-white/[0.04] hover:text-zinc-300 active:bg-white/[0.06]"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 group-hover:text-[var(--senko-accent)]/70 transition-colors">
                      {suggestion.label}
                    </span>
                    <p className="mt-0.5 text-[13px] text-zinc-400 group-hover:text-zinc-300 transition-colors leading-snug">
                      {suggestion.text}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl px-1 py-4 sm:px-0 sm:py-5">
              {messages.map((message, idx) => {
                const isLastAssistant = message.role === "assistant" && idx === messages.length - 1;
                return (
                  <div key={message.id}>
                    <ChatMessage
                      message={message}
                      onEdit={onEditMessage}
                      onRegenerate={
                        message.role === "assistant"
                          ? onRegenerateMessage
                          : undefined
                      }
                      onOpenLink={onOpenLink}
                    />
                    {/* Streaming indicator — pulsing accent bar under the last assistant message */}
                    {isLastAssistant && isStreaming && !message.isThinking && (
                      <div className="px-3 sm:px-6 pb-1">
                        <div className="h-0.5 w-16 rounded-full bg-zinc-600/50 animate-pulse" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && messages.length > 0 && (
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 gap-1.5 rounded-full bg-white/[0.08] px-4 text-[12px] text-zinc-400 hover:bg-white/[0.12] backdrop-blur-sm border border-white/[0.06]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Scroll down
          </Button>
        )}
      </div>

      {/* ── STOP / CONTINUE BAR ── */}
      {(isStreaming || showContinue) && (
        <div className="shrink-0 flex justify-center gap-3 border-t border-white/[0.04] py-3">
          {isStreaming && onStopGeneration && (
            <Button
              size="sm"
              onClick={onStopGeneration}
              className="h-9 gap-2 rounded-xl bg-red-500/10 px-4 text-[13px] text-red-400 hover:bg-red-500/20 border border-red-500/20 font-medium transition-all"
            >
              <Square className="h-3.5 w-3.5" />
              Stop generating
            </Button>
          )}
          {showContinue && onContinueGeneration && (
            <Button
              size="sm"
              onClick={onContinueGeneration}
              className="h-9 gap-2 rounded-xl bg-[var(--senko-accent)]/10 px-4 text-[13px] text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/20 border border-[var(--senko-accent)]/20 font-medium transition-all"
            >
              Continue generating
            </Button>
          )}
        </div>
      )}

      {/* ── INPUT BAR ── */}
      <ChatInput
        onSend={onSendMessage}
        sendWithEnter={sendWithEnter}
        disabled={isStreaming}
        agentMode={agentMode}
        onAgentModeChange={onAgentModeChange}
      />
    </div>
  );
}
