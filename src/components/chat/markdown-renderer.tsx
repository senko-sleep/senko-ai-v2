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
    <div className="group/code relative my-2 overflow-hidden rounded-lg border border-white/[0.06]">
      <div className="flex items-center justify-between bg-white/[0.03] px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto bg-[rgba(0,0,0,0.3)] p-3">
        <code className="text-[13px] leading-relaxed text-[#e0e0e0]">{code}</code>
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
                className="rounded bg-[#ff9500]/[0.10] px-1.5 py-0.5 text-[13px] text-[#ffb347] font-mono"
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
          return <p className="mb-2 last:mb-0 leading-relaxed text-white/95">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-2 ml-4 list-disc space-y-1 marker:text-[#00d4ff]/60">{children}</ul>;
        },
        ol({ children }) {
          return (
            <ol className="mb-2 ml-4 list-decimal space-y-1 marker:text-[#00d4ff]/60">{children}</ol>
          );
        },
        li({ children }) {
          return <li className="leading-relaxed text-white/90">{children}</li>;
        },
        h1({ children }) {
          return (
            <h1 className="mb-2 mt-4 text-lg font-bold text-[#00d4ff] first:mt-0">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="mb-2 mt-3 text-base font-semibold text-[#00d4ff] first:mt-0">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="mb-1.5 mt-2.5 text-sm font-semibold text-[#00ff88] first:mt-0">
              {children}
            </h3>
          );
        },
        strong({ children }) {
          return (
            <strong className="font-semibold text-white">{children}</strong>
          );
        },
        em({ children }) {
          return <em className="italic text-zinc-300">{children}</em>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-2 border-l-2 border-[#00d4ff]/50 pl-3 text-zinc-300 bg-[#00d4ff]/[0.04] rounded-r-lg py-1 pr-2">
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
              className="inline-flex items-center gap-0.5 text-[#00d4ff] underline decoration-[#00d4ff]/30 underline-offset-2 transition-colors hover:text-[#66e5ff] hover:decoration-[#00d4ff]/60"
            >
              {children}
              <ExternalLink className="inline h-3 w-3" />
            </a>
          );
        },
        img() {
          // Block all raw image output from AI - images are shown via the ImageCarousel UI only
          return null;
        },
        hr() {
          return <hr className="my-3 border-white/[0.08]" />;
        },
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="w-full text-sm">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className="border-b border-white/[0.06] bg-white/[0.03]">
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className="px-3 py-1.5 text-left text-xs font-medium text-zinc-400">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-3 py-1.5 text-white/90">{children}</td>
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
