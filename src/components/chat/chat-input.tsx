"use client";

import { useState, useRef } from "react";
import { Send, Paperclip, Mic, Brain, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentMode } from "@/types/chat";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  sendWithEnter?: boolean;
  agentMode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
}

const MODE_CONFIG: Record<AgentMode, { icon: React.ElementType; label: string; description: string }> = {
  standard: { icon: Sparkles, label: "Standard", description: "Normal conversation" },
  thinking: { icon: Brain, label: "Thinking", description: "Shows AI reasoning process" },
  research: { icon: Search, label: "Research", description: "Deep search + multi-source" },
};

export function ChatInput({
  onSend,
  disabled = false,
  sendWithEnter = true,
  agentMode = "standard",
  onModeChange,
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const currentMode = MODE_CONFIG[agentMode];

  return (
    <div className="border-t border-white/[0.06] bg-[rgba(0,0,0,0.95)] px-2 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3 shrink-0">
      {/* Agent mode selector */}
      {onModeChange && (
        <div className="flex items-center gap-1.5 mb-2 mx-auto max-w-4xl px-1">
          {(Object.entries(MODE_CONFIG) as [AgentMode, typeof currentMode][]).map(([mode, config]) => {
            const Icon = config.icon;
            return (
              <button
                key={mode}
                onClick={() => onModeChange(mode)}
                className={`mode-pill ${agentMode === mode ? "active" : ""}`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{config.label}</span>
              </button>
            );
          })}
          <span className="text-[10px] text-zinc-600 ml-auto hidden sm:block">
            {currentMode.description}
          </span>
        </div>
      )}

      <div className="glass-panel depth-shadow mx-auto flex max-w-4xl items-end gap-1.5 rounded-2xl p-1.5 sm:gap-2 sm:p-2">
        {/* Attach button - hidden on mobile */}
        <div className="hidden sm:block">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mb-0.5 h-8 w-8 shrink-0 rounded-lg p-0 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="glass-panel-solid text-xs">
                Attach file
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message Senko AI..."
          disabled={disabled}
          className="min-h-[36px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
          rows={1}
        />

        <div className="flex items-end gap-1">
          {/* Mic button - hidden on mobile */}
          <div className="hidden sm:block">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mb-0.5 h-8 w-8 shrink-0 rounded-lg p-0 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="glass-panel-solid text-xs">
                  Voice input
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!content.trim() || disabled}
                  className="mb-0.5 h-9 w-9 shrink-0 rounded-xl bg-[var(--senko-accent)] p-0 text-black hover:bg-[#e08600] disabled:opacity-30 sm:h-8 sm:w-8 sm:rounded-lg transition-all"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="glass-panel-solid text-xs">
                {sendWithEnter ? "Send (Enter)" : "Send"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <p className="mt-1.5 text-center text-[10px] text-zinc-600 hidden sm:block">
        Senko can search the web, open apps, and more~ but double-check important stuff!
      </p>
    </div>
  );
}
