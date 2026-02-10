"use client";

import { useState, useRef } from "react";
import { Send, Paperclip, Mic, Brain, MoreHorizontal } from "lucide-react";
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
    <div className="border-t border-white/[0.06] bg-[rgba(0,0,0,0.95)] px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4 shrink-0">
      <div className="glass-panel depth-shadow mx-auto flex max-w-4xl items-end gap-2 rounded-2xl p-2 sm:gap-3 sm:p-3">
        {/* More options button with thinking toggle */}
        <div className="relative">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowMenu(!showMenu)}
                  className={cn(
                    "mb-0.5 h-10 w-10 shrink-0 rounded-xl p-0 transition-colors",
                    showMenu ? "bg-white/10 text-zinc-200" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                  )}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="glass-panel-solid text-xs">
                Options
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Dropdown menu */}
          {showMenu && (
            <div
              ref={menuRef}
              className="absolute bottom-full left-0 mb-2 w-48 rounded-xl glass-panel-solid border border-white/[0.08] shadow-xl overflow-hidden animate-scale-in z-50"
            >
              <button
                onClick={() => {
                  onAgentModeChange?.(isThinking ? "agent" : "thinking");
                  setShowMenu(false);
                }}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3.5 py-2.5 text-[13px] transition-colors text-left",
                  isThinking
                    ? "bg-purple-500/10 text-purple-400"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                )}
              >
                <Brain className="h-4 w-4" />
                <div>
                  <div className="font-medium">Thinking Mode</div>
                  <div className="text-[11px] opacity-60">{isThinking ? "On — deep reasoning" : "Off — normal speed"}</div>
                </div>
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-[13px] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors text-left border-t border-white/[0.06]"
              >
                <Paperclip className="h-4 w-4" />
                <div>
                  <div className="font-medium">Attach File</div>
                  <div className="text-[11px] opacity-60">Coming soon</div>
                </div>
              </button>
              <button
                className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-[13px] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors text-left border-t border-white/[0.06]"
              >
                <Mic className="h-4 w-4" />
                <div>
                  <div className="font-medium">Voice Input</div>
                  <div className="text-[11px] opacity-60">Coming soon</div>
                </div>
              </button>
            </div>
          )}
        </div>

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onClick={() => setShowMenu(false)}
          placeholder={isThinking ? "Ask something to reason about..." : "Message Senko AI..."}
          disabled={disabled}
          className="min-h-[44px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] text-zinc-200 placeholder:text-zinc-500 focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
        />

        <div className="flex items-end gap-1">
          {/* Thinking mode indicator */}
          {isThinking && (
            <div className="mb-1.5 flex items-center gap-1 rounded-lg bg-purple-500/10 border border-purple-500/20 px-2 py-1">
              <Brain className="h-3 w-3 text-purple-400" />
              <span className="text-[10px] text-purple-400 font-medium">Think</span>
            </div>
          )}

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!content.trim() || disabled}
                  className="mb-0.5 h-11 w-11 shrink-0 rounded-xl bg-[var(--senko-accent)] p-0 text-black hover:brightness-90 disabled:opacity-30 sm:h-10 sm:w-10 transition-all hover:shadow-[0_0_20px_var(--senko-accent-dim)]"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="glass-panel-solid text-xs">
                {sendWithEnter ? "Send (Enter)" : "Send"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-zinc-600 hidden sm:block">
        Senko can search the web, open apps, browse sites, and more~ but double-check important stuff!
      </p>
    </div>
  );
}
