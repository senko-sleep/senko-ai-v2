import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AlertTriangle, Bot, Check, CheckCircle2, Copy, ExternalLink, PauseCircle, PawPrint, RotateCcw, Square } from "lucide-react";
import { FoxMark } from "./fox-mark";
import { AgentTrail } from "./activity-trail";
import type { Msg } from "./lib";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-2" role="status" aria-label="Senko is thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="sk-dot h-1.5 w-1.5 rounded-full bg-[var(--sk-accent)]" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {}
    );
  };
  return { copied, copy };
}

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopy();
  // rehype-highlight puts "language-xyz" on the inner <code>.
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } })?.props?.className || "";
  const lang = /language-([\w+-]+)/.exec(cls)?.[1] || "text";
  return (
    <div className="sk-code">
      <div className="sk-code-head">
        <span>{lang}</span>
        <button
          type="button"
          onClick={() => copy(ref.current?.innerText || "")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition hover:bg-white/10 hover:text-white"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function ReplyImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  return (
    <span className="sk-message-image">
      {failed ? (
        <span className="flex h-40 items-center justify-center text-xs text-[var(--sk-muted)]">Image unavailable</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt || "Image from the source page"} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
      {alt && <span className="mt-1 block text-xs text-[var(--sk-muted)]">{alt}</span>}
    </span>
  );
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="sk-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          img: ({ src, alt }) => <ReplyImage key={typeof src === "string" ? src : ""} src={typeof src === "string" ? src : undefined} alt={alt} />,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function Images({ ids, align }: { ids: string[]; align: "start" | "end" }) {
  return (
    <div className={`flex flex-wrap gap-2 ${align === "end" ? "justify-end" : ""}`}>
      {ids.map((id) => (
        <a key={id} href={`/api/uploads/${id}`} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${id}`}
            alt="Attached image"
            loading="lazy"
            className="h-32 max-w-[220px] rounded-xl border border-[var(--sk-line)] object-cover transition hover:opacity-90"
          />
        </a>
      ))}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  msg,
  streaming,
  onRetry,
  onRunAgent,
}: {
  msg: Msg;
  streaming?: boolean;
  onRetry?: (id: string) => void;
  onRunAgent?: (id: string) => void;
}) {
  const { copied, copy } = useCopy();

  if (msg.role === "user") {
    return (
      <div className="sk-in flex flex-col items-end gap-2">
        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="end" /> : null}
        {msg.content && (
          <div
            className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm border px-4 py-2.5 text-[14.5px] leading-relaxed text-[var(--sk-text)] sm:max-w-[72%]"
            style={{ background: "var(--sk-user)", borderColor: "var(--sk-user-border)" }}
          >
            {msg.content}
          </div>
        )}
      </div>
    );
  }

  const agent = msg.agent;
  const running = agent?.status === "running";
  const thinking = msg.pending && !msg.content && !agent;

  return (
    <div className="sk-in group flex gap-3.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--sk-line)] bg-[var(--sk-raised)]">
        <FoxMark size={18} className={msg.pending ? "sk-thinking" : ""} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
        {running && (
          <div className="flex items-center gap-2 text-xs text-[var(--sk-muted)]" aria-live="polite">
            <span className="sk-pulse h-1.5 w-1.5 rounded-full bg-[var(--sk-accent)]" aria-hidden />
            Working in the browser
          </div>
        )}

        {thinking && <TypingDots />}

        {msg.content && !msg.error && (
          <div>
            <Markdown text={msg.content} />
            {streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 rounded-full bg-[var(--sk-accent)] sk-pulse" aria-hidden />}
          </div>
        )}

        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="start" /> : null}

        {msg.error && (
          <div className="rounded-xl border border-[var(--sk-danger)]/30 bg-[var(--sk-danger-soft)] px-4 py-3 text-sm" role="alert">
            <div className="flex items-start gap-2 text-[var(--sk-danger)]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="font-medium">That didn&apos;t work</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[13px] text-[var(--sk-text)] opacity-80">{msg.error}</div>
              </div>
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(msg.id)}
                className="sk-btn mt-3 h-7.5 border border-[var(--sk-line)] px-2.5 text-xs"
              >
                <RotateCcw size={12} aria-hidden /> Try again
              </button>
            )}
          </div>
        )}

        {!agent &&
          msg.actions?.map((a, i) => (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/link flex max-w-md items-center gap-3 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-solid)] px-3.5 py-2.5 text-sm transition hover:border-[var(--sk-accent-line)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://www.google.com/s2/favicons?domain=${hostOf(a.url)}&sz=64`}
                alt=""
                className="h-6 w-6 rounded-md bg-white/90 p-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{a.label}</span>
                <span className="block truncate text-xs text-[var(--sk-muted)]">{hostOf(a.url)}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--sk-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--sk-accent-ink)] transition group-hover/link:bg-[var(--sk-accent)] group-hover/link:text-[var(--sk-on-accent)]">
                Open <ExternalLink size={11} aria-hidden />
              </span>
            </a>
          ))}

        {agent && <AgentTrail trail={agent.trail} finalUrl={agent.url || msg.actions?.[0]?.url} running={running} />}

        {msg.suggestAgent && onRunAgent && (
          <button
            type="button"
            onClick={() => onRunAgent(msg.id)}
            className="sk-btn h-8 rounded-lg border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-3 text-xs text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-[var(--sk-on-accent)]"
          >
            <Bot size={14} aria-hidden /> Do this in Agent mode
          </button>
        )}

        {!msg.pending && (msg.content || agent) && (
          <div className="flex h-6 items-center gap-1.5 text-[11.5px] text-[var(--sk-faint)] opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {msg.content && (
              <button
                type="button"
                onClick={() => copy(msg.content)}
                className="sk-btn h-6 w-6 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
                aria-label={copied ? "Copied" : "Copy reply"}
                title="Copy"
              >
                {copied ? <Check size={12.5} /> : <Copy size={12.5} />}
              </button>
            )}
            {agent && agent.status !== "running" && (
              <span className="inline-flex items-center gap-1 px-1">
                {agent.status === "done" ? <CheckCircle2 size={11.5} /> : agent.status === "paused" ? <PauseCircle size={11.5} /> : <Square size={9.5} />}
                {agent.status === "done" ? "Agent finished" : agent.status === "paused" ? "Paused" : agent.status === "error" ? "Agent hit an error" : "Agent stopped"}
              </span>
            )}
            {msg.mood && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-[var(--sk-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--sk-accent-ink)]" title="Senko's mood">
                <PawPrint size={10.5} className="shrink-0" aria-hidden />
                <span className="truncate">{msg.mood}</span>
              </span>
            )}
            {msg.provider && <span className="hidden truncate px-1 sm:inline">{msg.provider}</span>}
          </div>
        )}
      </div>
    </div>
  );
});
