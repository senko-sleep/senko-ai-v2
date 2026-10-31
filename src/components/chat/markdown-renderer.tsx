"use client";

import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ExternalLink } from "lucide-react";
import { parseMessageSegments, type UIValue } from "@/lib/ui-schema";
import { CitationPill, DynamicUIRenderer, UIPendingSkeleton } from "@/components/ui-renderer/dynamic-ui-renderer";
import { DiagramView, MathView } from "@/components/ui-renderer/charts-and-diagrams";

interface MarkdownRendererProps {
  content: string;
  messageId?: string;
  isStreaming?: boolean;
  onSendMessage?: (content: string) => void;
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="flex items-center justify-between bg-[var(--muted)] px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto bg-[var(--card)] p-4">
        <code className="text-[14px] leading-relaxed text-[var(--foreground)]">{code}</code>
      </pre>
    </div>
  );
}

function preprocessMarkdown(text: string): string {
  let result = text;

  // Safety net: strip any <think> blocks that leaked through upstream stripping
  result = result.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, "");
  result = result.replace(/<\s*think[^>]*>[\s\S]*$/gi, "");
  result = result.replace(/<\s*\/\s*think\s*>/gi, "");

  // Convert [[cite: Label | url]] into special anchor syntax
  result = result.replace(/\[\[\s*cite\s*:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+?))?\s*\]\]/gi, (_, label: string, url?: string) => {
    const cleanLabel = label.trim();
    const cleanUrl = url?.trim() || `https://citation.local/${encodeURIComponent(cleanLabel)}`;
    return `[cite:${cleanLabel}](${cleanUrl})`;
  });

  // Protect code spans from preprocessing
  const codeSlots: string[] = [];
  const PLACEHOLDER = "\x00CODE";

  result = result.replace(/```[\s\S]*?```/g, (m) => {
    codeSlots.push(m);
    return `${PLACEHOLDER}${codeSlots.length - 1}\x00`;
  });

  result = result.replace(/`[^`\n]+`/g, (m) => {
    codeSlots.push(m);
    return `${PLACEHOLDER}${codeSlots.length - 1}\x00`;
  });

  result = result.replace(/\/\/\/<\s*/g, "");
  result = result.replace(/;w;/g, "");
  result = result.replace(/\t/g, "    ");
  result = result.replace(/^\s*[\u2022\u2023\u25E6\u2043\u2219]\s*/gm, "- ");
  result = result.replace(/^(\*\*[^*\n]+\*\*)\n(?!\n)/gm, "$1\n\n");
  result = result.replace(/([^\n])\n(#{1,6} )/g, "$1\n\n$2");
  result = result.replace(/([^\n])(#{1,6} )/g, "$1\n\n$2");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.replace(/^([^\n>]+)>[^\S\n]+/gm, "$1\n\n> ");

  result = result.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeSlots[parseInt(idx, 10)]);

  return result;
}

function SingleMarkdownSegment({ content }: { content: string }) {
  const processed = useMemo(() => preprocessMarkdown(content), [content]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isInline = !className && !String(children).includes("\n");
          if (isInline) {
            return (
              <code
                className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[14px] text-[var(--foreground)] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
        pre({ children }) {
          return <>{children}</>;
        },
        p({ children }) {
          return <p className="mb-4 last:mb-0 leading-[1.75] text-[var(--foreground)]/90 text-[15px]">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-4 ml-5 list-disc space-y-1 marker:text-[var(--muted-foreground)] [li_>&]:mt-1 [li_>&]:mb-0">{children}</ul>;
        },
        ol({ children }) {
          return (
            <ol className="mb-4 ml-5 list-decimal space-y-1 marker:text-[var(--muted-foreground)] marker:font-medium [li_>&]:mt-1 [li_>&]:mb-0">{children}</ol>
          );
        },
        li({ children }) {
          return <li className="leading-[1.7] text-[var(--foreground)]/90 text-[15px] pl-1 [&>ul]:mb-1 [&>ol]:mb-1 [&>ul]:mt-1 [&>ol]:mt-1">{children}</li>;
        },
        h1({ children }) {
          return (
            <h1 className="mb-4 mt-6 text-[20px] font-semibold text-[var(--foreground)] first:mt-0">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="mb-3 mt-5 text-[17px] font-semibold text-[var(--foreground)] first:mt-0">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="mb-2 mt-4 text-[15px] font-semibold text-[var(--foreground)]/90 first:mt-0">
              {children}
            </h3>
          );
        },
        strong({ children }) {
          return (
            <strong className="font-semibold text-[var(--foreground)]">{children}</strong>
          );
        },
        em({ children }) {
          return <em className="italic text-[var(--foreground)]/80">{children}</em>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-3 border-l-3 border-[var(--muted-foreground)] pl-4 text-[var(--muted-foreground)] bg-[var(--muted)] rounded-r-xl py-2 pr-3">
              {children}
            </blockquote>
          );
        },
        a({ href, children }) {
          const childText = String(children);
          if (childText.startsWith("cite:")) {
            const label = childText.slice(5).trim();
            const isPlaceholder = href?.startsWith("https://citation.local/");
            return <CitationPill citation={{ label, url: isPlaceholder ? undefined : href }} />;
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--senko-accent)] underline decoration-[var(--senko-accent)]/30 underline-offset-3 transition-colors hover:text-white hover:decoration-white/40"
            >
              {children}
              <ExternalLink className="inline h-3.5 w-3.5" />
            </a>
          );
        },
        img() {
          return null;
        },
        hr() {
          return <hr className="my-4 border-[var(--border)]" />;
        },
        table({ children }) {
          return (
            <div className="my-3 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-[14px]">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className="border-b border-[var(--border)] bg-[var(--muted)]">
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className="px-4 py-2 text-left text-[13px] font-semibold text-[var(--muted-foreground)]">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-4 py-2 text-[var(--foreground)]/90">{children}</td>
          );
        },
        tr({ children }) {
          return (
            <tr className="border-b border-[var(--border)]/50 last:border-0">
              {children}
            </tr>
          );
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

export function MarkdownRenderer({ content, messageId, isStreaming = false, onSendMessage }: MarkdownRendererProps) {
  const [uiState, setUiState] = useState<Record<string, UIValue>>({});
  const handleStateChange = useCallback((key: string, val: UIValue) => {
    if (key === "__reset__") setUiState({});
    else setUiState((prev) => ({ ...prev, [key]: val }));
  }, []);

  const segments = useMemo(() => parseMessageSegments(content, isStreaming), [content, isStreaming]);

  return (
    <div className="space-y-3">
      {segments.map((seg, idx) => {
        if (seg.kind === "markdown") {
          return <SingleMarkdownSegment key={idx} content={seg.text} />;
        }
        if (seg.kind === "ui") {
          return (
            <DynamicUIRenderer
              key={idx}
              node={seg.node}
              messageId={messageId}
              state={uiState}
              onStateChange={handleStateChange}
              onSendMessage={onSendMessage}
            />
          );
        }
        if (seg.kind === "ui_pending") {
          return <UIPendingSkeleton key={idx} previewTitle={seg.previewTitle} previewType={seg.previewType} />;
        }
        if (seg.kind === "mermaid") {
          return <DiagramView key={idx} mermaid={seg.code} />;
        }
        if (seg.kind === "math") {
          return <MathView key={idx} latex={seg.latex} block />;
        }
        return null;
      })}
    </div>
  );
}
