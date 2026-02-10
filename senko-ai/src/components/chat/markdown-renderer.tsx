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
    <div className="group/code relative my-3 overflow-hidden rounded-xl border border-white/[0.07]">
      <div className="flex items-center justify-between bg-white/[0.03] px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
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
      <pre className="scrollbar-thin overflow-x-auto bg-[rgba(0,0,0,0.3)] p-4">
        <code className="text-[14px] leading-relaxed text-[#e0e0e0]">{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isInline = !className && !String(children).includes("\n");
          if (isInline) {
            return (
              <code
                className="rounded-md bg-[var(--senko-accent)]/[0.10] px-2 py-0.5 text-[14px] text-[#ffb347] font-mono"
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
          return <p className="mb-3 last:mb-0 leading-[1.75] text-white/95 text-[15px]">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-3 ml-5 list-disc space-y-1.5 marker:text-[var(--senko-accent)]/60">{children}</ul>;
        },
        ol({ children }) {
          return (
            <ol className="mb-3 ml-5 list-decimal space-y-1.5 marker:text-[var(--senko-accent)]/60">{children}</ol>
          );
        },
        li({ children }) {
          return <li className="leading-[1.7] text-white/90 text-[15px]">{children}</li>;
        },
        h1({ children }) {
          return (
            <h1 className="mb-3 mt-5 text-xl font-bold text-[var(--senko-accent)] first:mt-0">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="mb-2.5 mt-4 text-lg font-bold text-[var(--senko-accent)] first:mt-0">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="mb-2 mt-3 text-base font-semibold text-[#ffb347] first:mt-0">
              {children}
            </h3>
          );
        },
        strong({ children }) {
          return (
            <strong className="font-bold text-white">{children}</strong>
          );
        },
        em({ children }) {
          return <em className="italic text-zinc-300">{children}</em>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-3 border-l-3 border-[var(--senko-accent)]/50 pl-4 text-zinc-300 bg-[var(--senko-accent)]/[0.04] rounded-r-xl py-2 pr-3">
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
              className="inline-flex items-center gap-1 text-[var(--senko-accent)] underline decoration-[var(--senko-accent)]/30 underline-offset-3 transition-colors hover:text-[#ffcc80] hover:decoration-[var(--senko-accent)]/60"
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
          return <hr className="my-4 border-white/[0.08]" />;
        },
        table({ children }) {
          return (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/[0.07]">
              <table className="w-full text-[14px]">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className="border-b border-white/[0.07] bg-white/[0.03]">
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className="px-4 py-2 text-left text-[13px] font-semibold text-zinc-400">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-4 py-2 text-white/90">{children}</td>
          );
        },
        tr({ children }) {
          return (
            <tr className="border-b border-white/[0.04] last:border-0">
              {children}
            </tr>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
