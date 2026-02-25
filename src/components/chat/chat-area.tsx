"use client";

import { useRef, useEffect, useState } from "react";
import {
  Square, ArrowDown, Search, Globe, Gamepad2,
  Smile, Frown, Angry, PartyPopper, Moon, Utensils,
  Heart, Skull, Coffee, Brain, Music,
  Sparkles, Flame, Droplets, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput, type AgentMode } from "./chat-input";
import type { Message, SenkoStatus, Activity } from "@/types/chat";

const STATUS_ICON_MAP: Record<string, LucideIcon> = {
  happy: Smile, sad: Frown, angry: Angry, excited: PartyPopper,
  sleepy: Moon, hungry: Utensils, flustered: Heart, scared: Skull,
  chill: Coffee, thinking: Brain, love: Heart, gaming: Gamepad2,
  music: Music, sparkle: Sparkles, fire: Flame, crying: Droplets, shocked: Zap,
};

function StatusPill({ status }: { status: SenkoStatus }) {
  const IconComponent = STATUS_ICON_MAP[status.icon] || Sparkles;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 border transition-all duration-500"
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
}

const DEFAULT_STATUS: SenkoStatus = { icon: "chill", text: "Ready", color: "#00d4ff" };

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

  // Check if there's active work happening
  const hasActiveWork = activities.some(a => a.status === "active") || isStreaming;

  return (
    <div className="flex h-full flex-col">
      {/* Mood status pill - only when idle with messages */}
      {!hasActiveWork && messages.length > 0 && (
        <div className="shrink-0 flex justify-center py-2.5">
          <StatusPill status={currentStatus} />
        </div>
      )}

      {/* Chat area: scrollable messages */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6">
              {/* Simple, elegant greeting */}
              <div className="text-center max-w-lg">
                <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-[var(--foreground)] mb-4">
                  What can I help you with?
                </h1>
                <p className="text-[15px] text-[var(--muted-foreground)] leading-relaxed">
                  Search the web, browse sites, play games, or just chat
                </p>
              </div>

              {/* Suggestion cards with icons */}
              <div className="mt-12 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: "Research", text: "Latest anime news", Icon: Search },
                  { label: "Browse", text: "YouTube trending", Icon: Globe },
                  { label: "Play", text: "20 questions", Icon: Gamepad2 },
                ].map((item) => (
                  <button
                    key={item.text}
                    onClick={() => onSendMessage(item.text)}
                    className="group flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all hover:bg-[var(--accent)] border border-transparent hover:border-[var(--border)]"
                  >
                    <item.Icon className="h-6 w-6 text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors" />
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] group-hover:text-[var(--primary)]">
                        {item.label}
                      </span>
                      <p className="text-[14px] text-[var(--foreground)] mt-0.5">
                        {item.text}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
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
                      isStreaming={isLastAssistant && isStreaming && !message.isThinking}
                    />
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
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 gap-1.5 rounded-full bg-[var(--card)] px-4 text-[12px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] border border-[var(--border)]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Scroll down
          </Button>
        )}
      </div>

      {/* Stop / Continue bar */}
      {(isStreaming || showContinue) && (
        <div className="shrink-0 flex justify-center gap-3 py-3">
          {isStreaming && onStopGeneration && (
            <Button
              size="sm"
              onClick={onStopGeneration}
              className="h-9 gap-2 rounded-xl bg-red-500/10 px-4 text-[13px] text-red-400 hover:bg-red-500/20 border border-red-500/20 font-medium transition-all"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          {showContinue && onContinueGeneration && (
            <Button
              size="sm"
              onClick={onContinueGeneration}
              className="h-9 gap-2 rounded-xl bg-[var(--primary)]/10 px-4 text-[13px] text-[var(--primary)] hover:bg-[var(--primary)]/20 border border-[var(--primary)]/20 font-medium transition-all"
            >
              Continue
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
