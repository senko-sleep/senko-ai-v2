"use client";

import { useState } from "react";
import { ChevronRight, Brain, Sparkles, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingSectionProps {
  content: string;
  isStreaming?: boolean;
  onSkip?: () => void;
}

export function ThinkingSection({ content, isStreaming, onSkip }: ThinkingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse the thinking content into structured steps if possible
  const steps = parseThinkingSteps(content);
  const hasStructuredSteps = steps.length > 0;

  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] overflow-hidden animate-fade-in">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 transition-colors text-left",
          "hover:bg-[var(--glass-hover)]"
        )}
      >
        <div className="relative">
          <Brain className={cn(
            "h-5 w-5 text-[var(--muted-foreground)]",
            isStreaming && "animate-pulse"
          )} />
          {isStreaming && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--primary)] animate-ping" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {isStreaming ? "Thinking..." : "Thought Process"}
            </span>
            <ChevronRight 
              className={cn(
                "h-4 w-4 text-[var(--muted-foreground)] transition-transform",
                isExpanded && "rotate-90"
              )} 
            />
          </div>
          {!isExpanded && content && (
            <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">
              {content.slice(0, 100)}...
            </p>
          )}
        </div>

        {isStreaming && onSkip && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--glass-hover)] hover:text-[var(--foreground)] transition-colors"
          >
            Skip
          </button>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[var(--border)] px-4 py-3 animate-fade-in">
          {hasStructuredSteps ? (
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <ThinkingStep
                  key={idx}
                  number={idx + 1}
                  title={step.title}
                  content={step.content}
                  items={step.items}
                />
              ))}
            </div>
          ) : (
            <div className="prose prose-sm prose-invert max-w-none">
              <div className="text-sm text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">
                {content}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-[var(--primary)] animate-pulse" />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ThinkingStepProps {
  number: number;
  title: string;
  content?: string;
  items?: Array<{ label: string; value: string }>;
}

function ThinkingStep({ number, title, content, items }: ThinkingStepProps) {
  return (
    <div className="relative pl-6">
      {/* Step number */}
      <div className="absolute left-0 top-0 flex items-center justify-center h-5 w-5 rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--primary)]">
        {number}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-[var(--foreground)]">{title}</h4>
        
        {content && (
          <p className="mt-1 text-sm text-[var(--muted-foreground)] leading-relaxed">
            {content}
          </p>
        )}

        {items && items.length > 0 && (
          <ul className="mt-2 space-y-1">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-[var(--primary)] mt-1">•</span>
                <span>
                  <strong className="text-[var(--foreground)]">{item.label}:</strong>{" "}
                  <span className="text-[var(--muted-foreground)]">{item.value}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ParsedStep {
  title: string;
  content?: string;
  items?: Array<{ label: string; value: string }>;
}

function parseThinkingSteps(content: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  
  // Try to parse numbered steps like "1. Title:" or "Step 1:"
  const stepPattern = /(?:^|\n)(?:(\d+)\.|Step (\d+):?)\s*([^\n:]+):?\n?([\s\S]*?)(?=(?:\n(?:\d+\.|Step \d+))|$)/gi;
  
  let match;
  while ((match = stepPattern.exec(content)) !== null) {
    const title = match[3].trim();
    const body = match[4]?.trim() || "";
    
    // Parse bullet points in body
    const items: Array<{ label: string; value: string }> = [];
    const bulletPattern = /[•\-\*]\s*\*?\*?([^:\n]+)\*?\*?:?\s*(.+)/g;
    let bulletMatch;
    while ((bulletMatch = bulletPattern.exec(body)) !== null) {
      items.push({
        label: bulletMatch[1].replace(/\*\*/g, "").trim(),
        value: bulletMatch[2].trim(),
      });
    }

    // Get remaining content that's not bullet points
    const remainingContent = body
      .replace(bulletPattern, "")
      .replace(/\n{2,}/g, "\n")
      .trim();

    steps.push({
      title,
      content: remainingContent || undefined,
      items: items.length > 0 ? items : undefined,
    });
  }

  return steps;
}

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-[var(--glass)] border border-[var(--glass-border)] px-4 py-3">
      <div className="relative">
        <Brain className="h-5 w-5 text-[var(--muted-foreground)] animate-pulse" />
        <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-[var(--primary)] animate-pulse" />
      </div>
      <span className="text-sm text-[var(--muted-foreground)]">
        Thinking
        <span className="thinking-dots">
          <span className="thinking-dot" style={{ animationDelay: "0ms" }}>.</span>
          <span className="thinking-dot" style={{ animationDelay: "200ms" }}>.</span>
          <span className="thinking-dot" style={{ animationDelay: "400ms" }}>.</span>
        </span>
      </span>
    </div>
  );
}
