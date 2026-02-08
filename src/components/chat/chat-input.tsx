"use client";

import { useState, useRef } from "react";
import { Send, Paperclip, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  sendWithEnter?: boolean;
}

export function ChatInput({
  onSend,
  disabled = false,
  sendWithEnter = true,
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

  return (
    <div className="border-t border-white/[0.06] bg-[rgba(10,10,15,0.6)] px-4 py-3">
      <div className="glass-panel depth-shadow mx-auto flex max-w-4xl items-end gap-2 rounded-2xl p-2">
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

        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message Senko AI..."
          disabled={disabled}
          className="min-h-[36px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
        />

        <div className="flex items-end gap-1">
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

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!content.trim() || disabled}
                  className="mb-0.5 h-8 w-8 shrink-0 rounded-lg bg-[#a78bfa] p-0 text-white hover:bg-[#8b5cf6] disabled:opacity-30"
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

      <p className="mt-1.5 text-center text-[10px] text-zinc-600">
        Senko AI is an agentic assistant. Verify important information.
      </p>
    </div>
  );
}
