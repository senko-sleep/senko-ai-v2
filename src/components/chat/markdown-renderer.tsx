"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ExternalLink } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
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
  result = result.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '');
  result = result.replace(/<\s*think[^>]*>[\s\S]*$/gi, '');
  result = result.replace(/<\s*\/\s*think\s*>/gi, '');

  // Strip stray kaomoji/emoticon fragments that break markdown (e.g. "///< text")
  result = result.replace(/\/\/\/<\s*/g, '');
  result = result.replace(/;w;/g, '');

  // Convert unicode bullet points to markdown list items
  result = result.replace(/^\s*[\u2022\u2023\u25E6\u2043\u2219]\s*/gm, '- ');

  // 1. Fix orphaned numbered list items inline
  result = result.replace(/([^\n])(\s*\d+\. )/g, '$1\n\n$2');

  // 2. Fix orphaned bullet points inline
  result = result.replace(/([^\n*\-])(\s*[\-\*] )/g, '$1\n\n$2');

  // 3. Headers: insert \n\n before ## headers not at line start
  result = result.replace(/([^\n])(#{1,6} )/g, '$1\n\n$2');

  // 4. Headers running into text: detect camelCase boundary
  result = result.replace(/(#{1,6} .+?)([a-z])([A-Z])/g, '$1$2\n\n$3');

  // 5. Clean up multiple consecutive newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  // 6. Fix numbered lists that got split with extra blank lines
  result = result.replace(/(\d+\..+?)\n{2,}(\d+\.)/g, '$1\n$2');

  // 7. Fix blockquote markers that appear mid-line
  result = result.replace(/([^\n])\s*>\s+/g, '$1\n\n> ');

  return result;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const processed = preprocessMarkdown(content);
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
          return <ul className="mb-4 ml-5 list-disc space-y-1.5 marker:text-[var(--muted-foreground)]">{children}</ul>;
        },
        ol({ children }) {
          return (
            <ol className="mb-4 ml-5 list-decimal space-y-1.5 marker:text-[var(--muted-foreground)] marker:font-medium">{children}</ol>
          );
        },
        li({ children }) {
          return <li className="leading-[1.7] text-[var(--foreground)]/90 text-[15px] pl-1">{children}</li>;
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
          // Block all raw image output from AI - images are shown via the ImageCarousel UI only
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
