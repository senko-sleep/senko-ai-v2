"use client";

import { useRef, useEffect } from "react";
import { Bot, Square, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { Message } from "@/types/chat";

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
}

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
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 sm:gap-4">
              <div className="glass-panel depth-shadow flex h-14 w-14 items-center justify-center rounded-2xl sm:h-16 sm:w-16">
                <Bot className="h-7 w-7 text-[#00d4ff] sm:h-8 sm:w-8" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-semibold text-white sm:text-lg">
                  Senko AI
                </h2>
                <p className="mt-1 max-w-sm text-xs text-zinc-500 sm:text-sm">
                  Agentic AI with browser integration, web search,
                  and real-time capabilities.
                </p>
              </div>
              <div className="mt-2 grid w-full max-w-md grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2">
                {[
                  "What can you help me with?",
                  "Search the web for latest news",
                  "What device am I using?",
                  "Show me where I am on a map",
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
              className="h-7 gap-1.5 rounded-lg bg-[#00d4ff]/10 px-3 text-xs text-[#00d4ff] hover:bg-[#00d4ff]/20 border border-[#00d4ff]/20"
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
