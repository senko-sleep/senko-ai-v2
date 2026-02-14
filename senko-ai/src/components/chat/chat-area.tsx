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
import type { Message, SenkoStatus } from "@/types/chat";

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
}

function StatusPill({ status }: { status: SenkoStatus }) {
  const IconComponent = STATUS_ICON_MAP[status.icon] || Sparkles;
  return (
    <div
      className="flex items-center gap-2.5 rounded-full px-4 py-2 border transition-all duration-700 ease-out"
      style={{
        backgroundColor: `${status.color}0a`,
        borderColor: `${status.color}22`,
      }}
    >
      <IconComponent
        className="h-4 w-4 shrink-0 transition-colors duration-500"
        style={{ color: status.color }}
      />
      <span
        className="text-[13px] italic font-medium transition-colors duration-500"
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
          <StatusPill status={currentStatus} />
          {tokenCount > 0 && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600 font-medium hidden sm:block">
              {tokenCount.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>

      {/* ── CHAT AREA: scrollable messages ── */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-5 sm:gap-5">
              <div className="glass-panel depth-shadow-lg flex h-18 w-18 items-center justify-center rounded-2xl sm:h-20 sm:w-20 glow-accent animate-float">
                <Bot className="h-9 w-9 text-[var(--senko-accent)] sm:h-10 sm:w-10" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold sm:text-2xl bg-gradient-to-r from-[#ffcc80] via-[var(--senko-accent)] to-[#ffb347] bg-clip-text text-transparent">
                  Hii~ I&apos;m Senko!
                </h2>
                <p className="mt-2 max-w-md text-[14px] text-zinc-500 sm:text-[15px] leading-relaxed">
                  Talk to me about anything~ I can search stuff, vibe,
                  play games, or just hang out ^w^
                </p>
              </div>
              <div className="mt-3 grid w-full max-w-lg grid-cols-1 gap-2.5 sm:mt-5 sm:grid-cols-2">
                {[
                  "Tell me something interesting",
                  "Let's play a game!",
                  "I had the worst day ever...",
                  "Look up the latest anime news",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => onSendMessage(suggestion)}
                    className="glass-panel rounded-xl px-4 py-3.5 text-left text-[14px] text-zinc-400 transition-all hover:bg-white/[0.06] hover:text-zinc-300 active:bg-white/[0.08] hover:border-white/[0.12] hover:translate-y-[-1px]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl px-1 py-4 sm:px-0 sm:py-5">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onEdit={onEditMessage}
                  onRegenerate={
                    message.role === "assistant"
                      ? onRegenerateMessage
                      : undefined
                  }
                  onOpenLink={onOpenLink}
                />
              ))}
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && messages.length > 0 && (
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-7 w-7 rounded-full bg-white/[0.10] p-0 text-zinc-400 hover:bg-white/[0.16] hover:text-zinc-200 backdrop-blur-md border border-white/[0.08] shadow-lg shadow-black/30 animate-fade-in transition-colors"
          >
            <ArrowDown className="h-3.5 w-3.5" />
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
