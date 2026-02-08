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
import type { Message, SenkoStatus, SenkoTab } from "@/types/chat";

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
}

function TabBar({ tabs, onClose, onSwitch }: { tabs: SenkoTab[]; onClose?: (id: string) => void; onSwitch?: (id: string) => void }) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-1 px-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSwitch?.(tab.id)}
          className={`group/tab flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] cursor-pointer transition-all shrink-0 max-w-[180px] border ${
            tab.active
              ? "bg-[#ff9500]/[0.08] border-[#ff9500]/20 text-white"
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
      className="flex items-center gap-2 rounded-full px-3.5 py-1.5 border transition-all duration-500"
      style={{
        backgroundColor: `${status.color}08`,
        borderColor: `${status.color}20`,
      }}
    >
      <IconComponent
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: status.color }}
      />
      <span
        className="text-[11px] italic"
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
  tabs = [],
  onCloseTab,
  onSwitchTab,
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
        <div className="hidden sm:flex items-center justify-end border-b border-white/[0.04] px-4 py-1">
          <span className="text-[10px] text-zinc-600">
            Context: {tokenCount.toLocaleString()} tokens
          </span>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {/* Fixed status pill + tab bar overlay - always visible at top during conversation */}
        {messages.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-6">
            <div className="flex justify-center py-2">
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
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 sm:gap-4">
              <div className="glass-panel depth-shadow flex h-14 w-14 items-center justify-center rounded-2xl sm:h-16 sm:w-16">
                <Bot className="h-7 w-7 text-[#ff9500] sm:h-8 sm:w-8" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-semibold text-white sm:text-lg">
                  Hii~ I&apos;m Senko!
                </h2>
                <p className="mt-1 max-w-sm text-xs text-zinc-500 sm:text-sm">
                  Talk to me about anything~ I can search stuff, vibe,
                  play games, or just hang out ^w^
                </p>
              </div>
              {/* Sub-status pill */}
              <StatusPill status={currentStatus} />
              <div className="mt-2 grid w-full max-w-md grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2">
                {[
                  "Tell me something interesting",
                  "Let's play a game!",
                  "I had the worst day ever...",
                  "Look up the latest anime news",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => onSendMessage(suggestion)}
                    className="glass-panel rounded-xl px-3 py-2.5 text-left text-xs text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-300 active:bg-white/[0.08]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl px-2 py-3 sm:px-0 sm:py-4">
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
            className="absolute bottom-2 left-1/2 -translate-x-1/2 h-7 gap-1 rounded-full bg-white/[0.08] px-3 text-[10px] text-zinc-400 hover:bg-white/[0.12] backdrop-blur-sm border border-white/[0.06]"
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
              className="h-7 gap-1.5 rounded-lg bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20 border border-red-500/25"
            >
              <Square className="h-3 w-3" />
              Stop generating
            </Button>
          )}
          {showContinue && onContinueGeneration && (
            <Button
              size="sm"
              onClick={onContinueGeneration}
              className="h-7 gap-1.5 rounded-lg bg-[#ff9500]/10 px-3 text-xs text-[#ff9500] hover:bg-[#ff9500]/20 border border-[#ff9500]/20"
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
      />
    </div>
  );
}
