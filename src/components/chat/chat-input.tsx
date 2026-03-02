"use client";

import { useState, useRef } from "react";
import { Send, Plus, Globe, Grid3X3, Brain, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AgentMode = "agent" | "thinking";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  sendWithEnter?: boolean;
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
}

export function ChatInput({
  onSend,
  disabled = false,
  sendWithEnter = true,
  agentMode = "agent",
  onAgentModeChange,
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (content.trim() && !disabled) {
      onSend(content.trim());
      setContent("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (sendWithEnter && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  const isThinking = agentMode === "thinking";

  return (
    <div className="px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 shrink-0">
      <div className="mx-auto max-w-3xl">
        {/* Input area */}
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onClick={() => setShowMenu(false)}
          placeholder={isThinking ? "Ask something to reason about..." : "Message Senko..."}
          disabled={disabled}
          className="min-h-[52px] max-h-[200px] w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-[15px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-1 focus-visible:ring-[var(--primary)]/50 focus-visible:border-[var(--primary)]/50 focus-visible:ring-offset-0 transition-all"
          rows={1}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between mt-3">
          {/* Left icons */}
          <div className="flex items-center gap-0.5">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg p-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Attach</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg p-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Globe className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Browse Web</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onAgentModeChange?.(isThinking ? "agent" : "thinking");
                    }}
                    className={cn(
                      "h-8 w-8 rounded-lg p-0 transition-colors",
                      isThinking
                        ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]"
                    )}
                  >
                    <Brain className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {isThinking ? "Thinking Mode On" : "Enable Thinking"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Right side: Mode toggle + Send */}
          <div className="flex items-center gap-2">
            {/* Mode indicator - subtle */}
            {isThinking && (
              <span className="text-[11px] text-purple-400 font-medium px-2 py-1 rounded-lg bg-purple-500/10">
                Thinking mode
              </span>
            )}

            {/* Send button */}
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!content.trim() || disabled}
              className={cn(
                "h-9 w-9 rounded-xl p-0 send-btn",
                content.trim() && !disabled
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              )}
            >
              {disabled ? (
                <Square className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        
        {/* Subtle footer text */}
        <p className="text-center text-[11px] text-[var(--muted-foreground)]/60 mt-3">
          Senko can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}
