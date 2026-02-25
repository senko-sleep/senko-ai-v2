"use client";

import { useState } from "react";
import { 
  FileText, Image, Table2, Link2, Video, Quote, 
  List, Code2, Heading1, ChevronRight, ExternalLink,
  Layers, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParsedBlock {
  id: string;
  type: "text" | "image" | "table" | "link" | "video" | "quote" | "list" | "code" | "heading";
  content: string;
  meta?: {
    url?: string;
    alt?: string;
    rows?: number;
    cols?: number;
    language?: string;
    level?: number;
  };
  confidence?: number;
}

interface ARContentViewProps {
  url: string;
  title?: string;
  blocks: ParsedBlock[];
  isLoading?: boolean;
  onBlockClick?: (block: ParsedBlock) => void;
}

const BLOCK_ICONS: Record<ParsedBlock["type"], typeof FileText> = {
  text: FileText,
  image: Image,
  table: Table2,
  link: Link2,
  video: Video,
  quote: Quote,
  list: List,
  code: Code2,
  heading: Heading1,
};

const BLOCK_COLORS: Record<ParsedBlock["type"], string> = {
  text: "#a1a1aa",
  image: "#f472b6",
  table: "#4ade80",
  link: "#38bdf8",
  video: "#f97316",
  quote: "#a78bfa",
  list: "#facc15",
  code: "#22d3ee",
  heading: "#fb7185",
};

export function ARContentView({
  url,
  title,
  blocks,
  isLoading,
  onBlockClick,
}: ARContentViewProps) {
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    const next = new Set(expandedBlocks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedBlocks(next);
  };

  // Group blocks by type for summary
  const blockCounts = blocks.reduce((acc, b) => {
    acc[b.type] = (acc[b.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--glass)]">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--accent)]">
          <Layers className="h-4 w-4 text-[var(--primary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)] truncate">
            {title || "Content Analysis"}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] truncate flex items-center gap-1">
            <span>{url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </div>
        </div>
        {isLoading && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-[var(--primary)]" />
            Parsing...
          </div>
        )}
      </div>

      {/* Block type summary */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--glass)]/50">
        {Object.entries(blockCounts).map(([type, count]) => {
          const Icon = BLOCK_ICONS[type as ParsedBlock["type"]] || FileText;
          const color = BLOCK_COLORS[type as ParsedBlock["type"]] || "#a1a1aa";
          return (
            <div
              key={type}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ 
                backgroundColor: `${color}15`,
                color: color,
                border: `1px solid ${color}30`
              }}
            >
              <Icon className="h-3 w-3" />
              <span className="capitalize">{type}</span>
              <span className="opacity-70">×{count}</span>
            </div>
          );
        })}
      </div>

      {/* AR-style blocks visualization */}
      <div className="relative p-4">
        {/* Decorative grid background */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(var(--foreground) 1px, transparent 1px),
              linear-gradient(90deg, var(--foreground) 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px"
          }}
        />

        {/* Connecting lines (decorative) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--primary)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Block cards */}
        <div className="relative space-y-2">
          {blocks.map((block, idx) => {
            const Icon = BLOCK_ICONS[block.type] || FileText;
            const color = BLOCK_COLORS[block.type] || "#a1a1aa";
            const isHovered = hoveredBlock === block.id;
            const isExpanded = expandedBlocks.has(block.id);

            return (
              <div
                key={block.id}
                className={cn(
                  "relative group rounded-xl border transition-all duration-200 cursor-pointer",
                  isHovered ? "shadow-lg" : "shadow-sm"
                )}
                style={{
                  backgroundColor: isHovered ? `${color}08` : "var(--glass)",
                  borderColor: isHovered ? `${color}40` : "var(--glass-border)",
                  transform: isHovered ? "translateX(4px)" : "none"
                }}
                onMouseEnter={() => setHoveredBlock(block.id)}
                onMouseLeave={() => setHoveredBlock(null)}
                onClick={() => onBlockClick?.(block)}
              >
                {/* Connection dot */}
                <div
                  className="absolute -left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: color }}
                />
                
                {/* Block header */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div
                    className="flex items-center justify-center h-7 w-7 rounded-lg shrink-0"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color }}
                      >
                        {block.type}
                      </span>
                      {block.confidence && (
                        <span className="text-[10px] text-[var(--muted-foreground)]">
                          {Math.round(block.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "text-sm text-[var(--foreground)] mt-0.5 transition-all",
                      isExpanded ? "" : "line-clamp-1"
                    )}>
                      {block.content}
                    </p>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(block.id);
                    }}
                    className={cn(
                      "shrink-0 h-6 w-6 rounded-md flex items-center justify-center transition-all",
                      "hover:bg-[var(--glass-hover)] text-[var(--muted-foreground)]"
                    )}
                  >
                    <ChevronRight 
                      className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")} 
                    />
                  </button>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="rounded-lg bg-[var(--muted)] p-3 text-sm text-[var(--foreground)]">
                      {block.content}
                      {block.meta?.url && (
                        <a
                          href={block.meta.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link2 className="h-3 w-3" />
                          {block.meta.url}
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ARContentSkeleton() {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--glass)]">
        <div className="h-8 w-8 rounded-lg skeleton-shimmer" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-32 rounded skeleton-shimmer" />
          <div className="h-3 w-48 rounded skeleton-shimmer" />
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-[var(--primary)]" />
          <span className="text-xs text-[var(--muted-foreground)]">Parsing...</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-3">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-lg skeleton-shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-16 rounded skeleton-shimmer" />
                <div className="h-4 w-full rounded skeleton-shimmer" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
