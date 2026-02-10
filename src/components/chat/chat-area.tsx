"use client";

import { useRef, useEffect } from "react";
import {
  Bot, Square, ArrowDown, X, Globe,
  Smile, Frown, Angry, PartyPopper, Moon, Utensils,
  Heart, Skull, Coffee, Brain, Gamepad2, Music,
  Sparkles, Flame, Droplets, Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { Message, SenkoStatus, SenkoTab, AgentMode } from "@/types/chat";

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
  tabs?: SenkoTab[];
  onCloseTab?: (tabId: string) => void;
  onSwitchTab?: (tabId: string) => void;
  agentMode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
}

function TabBar({ tabs, onClose, onSwitch }: { tabs: SenkoTab[]; onClose?: (id: string) => void; onSwitch?: (id: string) => void }) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-1 px-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSwitch?.(tab.id)}
          className={`group/tab flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] cursor-pointer transition-all shrink-0 max-w-[180px] border ${tab.active
              ? "bg-[var(--senko-accent)]/[0.08] border-[var(--senko-accent)]/20 text-white"
              : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-300"
            }`}
        >
          {tab.favicon ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={tab.favicon}
              alt=""
              className="h-3 w-3 rounded-sm shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <Globe className="h-3 w-3 shrink-0 text-zinc-500" />
          )}
          <span className="truncate">{tab.title}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(tab.id); }}
            className="ml-auto rounded p-0.5 opacity-0 group-hover/tab:opacity-100 hover:bg-white/[0.08] transition-all shrink-0"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: SenkoStatus }) {
  const IconComponent = STATUS_ICON_MAP[status.icon] || Sparkles;
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-4 py-2 border transition-all duration-500 backdrop-blur-md shadow-lg"
      style={{
        backgroundColor: "rgba(16, 185, 129, 0.08)",
        borderColor: "rgba(16, 185, 129, 0.25)",
        boxShadow: "0 2px 12px rgba(16, 185, 129, 0.1), 0 0 0 1px rgba(16, 185, 129, 0.08)",
      }}
    >
      <IconComponent
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: "#10b981" }}
      />
      <span
        className="text-[11px] italic font-medium"
        style={{ color: "rgba(16, 185, 129, 0.85)" }}
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
  tabs = [],
  onCloseTab,
  onSwitchTab,
  agentMode = "standard",
  onModeChange,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    if (scrollRef.current && isAtBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      isAtBottom.current = true;
    }
  };

  const showContinue = !isStreaming && wasCutOff;
  const currentStatus = status || DEFAULT_STATUS;

  return (
    <div className="flex h-full flex-col">
      {/* Token counter bar - hidden on mobile */}
      {tokenCount > 0 && (
        <div className="hidden sm:flex items-center justify-end border-b border-white/[0.04] px-4 py-1.5">
          <span className="text-[10px] text-zinc-600">
            Context: {tokenCount.toLocaleString()} tokens
          </span>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {/* Fixed status pill + tab bar overlay — z-30 so it never blends with chat */}
        {messages.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none bg-gradient-to-b from-black/90 via-black/60 to-transparent pb-8">
            <div className="flex justify-center py-2.5">
              <div className="pointer-events-auto">
                <StatusPill status={currentStatus} />
              </div>
            </div>
            {tabs.length > 0 && (
              <div className="pointer-events-auto">
                <TabBar tabs={tabs} onClose={onCloseTab} onSwitch={onSwitchTab} />
              </div>
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            /* ─── Welcome Screen ─── */
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4 sm:gap-6">
              {/* Logo */}
              <div className="relative animate-scale-in">
                <div className="glass-panel depth-shadow flex h-16 w-16 items-center justify-center rounded-2xl sm:h-20 sm:w-20">
                  <Bot className="h-8 w-8 text-[var(--senko-accent)] sm:h-10 sm:w-10" />
                </div>
                <div className="absolute -inset-3 rounded-3xl bg-[var(--senko-accent)]/[0.06] blur-xl -z-10" />
              </div>

              {/* Hero text */}
              <div className="text-center animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  Hii~ I&apos;m <span className="text-[var(--senko-accent)]">Senko</span>!
                </h2>
                <p className="mt-2 max-w-md text-sm text-zinc-500 leading-relaxed">
                  Talk to me about anything~ I can search stuff, vibe,
                  play games, or just hang out ^w^
                </p>
              </div>

              {/* Status pill */}
              <div className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
                <StatusPill status={currentStatus} />
              </div>

              {/* Suggestion cards */}
              <div className="mt-2 grid w-full max-w-lg grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
                {[
                  { text: "Tell me something interesting", icon: "✨" },
                  { text: "Let's play a game!", icon: "🎮" },
                  { text: "I had the worst day ever...", icon: "💭" },
                  { text: "Look up the latest anime news", icon: "🔍" },
                ].map((suggestion) => (
                  <button
                    key={suggestion.text}
                    onClick={() => onSendMessage(suggestion.text)}
                    className="glass-panel rounded-xl px-4 py-3 text-left text-sm text-zinc-400 transition-all hover:bg-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12] active:bg-white/[0.08] group"
                  >
                    <span className="mr-2 opacity-60 group-hover:opacity-100 transition-opacity">{suggestion.icon}</span>
                    {suggestion.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl px-1 pt-16 pb-3 sm:px-0 sm:pt-18 sm:pb-4">
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
        {!isAtBottom.current && messages.length > 0 && (
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 h-8 gap-1.5 rounded-full bg-white/[0.08] px-4 text-[11px] text-zinc-400 hover:bg-white/[0.12] backdrop-blur-sm border border-white/[0.06] animate-fade-in-up"
          >
            <ArrowDown className="h-3 w-3" />
            Scroll down
          </Button>
        )}
      </div>

      {/* Stop / Continue bar */}
      {(isStreaming || showContinue) && (
        <div className="flex justify-center gap-2 border-t border-white/[0.04] py-2">
          {isStreaming && onStopGeneration && (
            <Button
              size="sm"
              onClick={onStopGeneration}
              className="h-8 gap-1.5 rounded-lg bg-red-500/10 px-4 text-xs text-red-400 hover:bg-red-500/20 border border-red-500/25"
            >
              <Square className="h-3 w-3" />
              Stop generating
            </Button>
          )}
          {showContinue && onContinueGeneration && (
            <Button
              size="sm"
              onClick={onContinueGeneration}
              className="h-8 gap-1.5 rounded-lg bg-[var(--senko-accent)]/10 px-4 text-xs text-[var(--senko-accent)] hover:bg-[var(--senko-accent)]/20 border border-[var(--senko-accent)]/20"
            >
              Continue generating
            </Button>
          )}
        </div>
      )}

      <ChatInput
        onSend={onSendMessage}
        sendWithEnter={sendWithEnter}
        disabled={isStreaming}
        agentMode={agentMode}
        onModeChange={onModeChange}
      />
    </div>
  );
}
