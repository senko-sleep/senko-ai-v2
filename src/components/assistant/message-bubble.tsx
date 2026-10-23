import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AlertTriangle, Bot, Check, CheckCircle2, Copy, ExternalLink, PauseCircle, PawPrint, Pencil, RotateCcw, Square } from "lucide-react";
import { FoxMark } from "./fox-mark";
import { activitySources } from "./activity";
import { AgentTrail } from "./activity-trail";
import type { Msg } from "./lib";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1.5" role="status" aria-label="Senko is thinking">
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
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition hover:bg-white/10 hover:text-white"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
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
        <span className="flex h-36 items-center justify-center text-xs text-[var(--sk-muted)]">Image unavailable</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt || "Image from the source page"} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
      {alt && <span className="mt-1 block text-[11px] text-[var(--sk-muted)]">{alt}</span>}
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
    <div className={`flex flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}>
      {ids.map((id) => (
        <a key={id} href={`/api/uploads/${id}`} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${id}`}
            alt="Attached image"
            loading="lazy"
            className="h-28 max-w-[200px] rounded-lg border border-[var(--sk-line)] object-cover transition hover:opacity-90"
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
  onEdit,
}: {
  msg: Msg;
  streaming?: boolean;
  onRetry?: (id: string) => void;
  onRunAgent?: (id: string) => void;
  onEdit?: (id: string, newContent: string) => void;
}) {
  const { copied, copy } = useCopy();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const t = editRef.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 28), 160)}px`;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const t = editRef.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 28), 160)}px`;
  }, [draft, editing]);

  if (msg.role === "user") {
    return (
      <div className="sk-in group flex flex-col items-end gap-1.5">
        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="end" /> : null}
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = draft.trim();
              if (!next && !msg.imageIds?.length) return;
              setEditing(false);
              onEdit?.(msg.id, next);
            }}
            className="sk-composer w-full max-w-[88%] rounded-2xl p-2 sm:max-w-[72%]"
          >
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const next = draft.trim();
                  if (!next && !msg.imageIds?.length) return;
                  setEditing(false);
                  onEdit?.(msg.id, next);
                }
              }}
              rows={1}
              aria-label="Edit message"
              className="sk-scroll block max-h-[160px] min-h-[26px] w-full resize-none bg-transparent px-1.5 py-0.5 text-[13.5px] leading-relaxed text-[var(--sk-text)] outline-none focus-visible:shadow-none"
            />
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <span className="mr-auto pl-1 text-[10.5px] text-[var(--sk-faint)]">
                Rewinds chat to here
              </span>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="sk-btn h-6.5 rounded-md px-2 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!draft.trim() && !msg.imageIds?.length}
                className="sk-btn sk-primary h-6.5 rounded-md px-2.5 text-[11.5px]"
              >
                Send
              </button>
            </div>
          </form>
        ) : (
          msg.content && (
            <div className="flex max-w-full items-center justify-end gap-1.5">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(msg.content);
                    setEditing(true);
                  }}
                  className="sk-btn h-6 w-6 shrink-0 rounded-md text-[var(--sk-faint)] opacity-100 transition-opacity hover:text-[var(--sk-text)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                  aria-label="Edit message"
                  title="Edit message"
                >
                  <Pencil size={11.5} />
                </button>
              )}
              <div
                className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-xs border px-3.5 py-2 text-[13.5px] leading-relaxed text-[var(--sk-text)] sm:max-w-[68%]"
                style={{ background: "var(--sk-user)", borderColor: "var(--sk-user-border)" }}
              >
                {msg.content}
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  const agent = msg.agent;
  const running = agent?.status === "running";
  const thinking = msg.pending && !msg.content && !agent;
  const finalUrl = agent?.url || msg.actions?.[0]?.url;
  const hasTrail = !!agent && Boolean(agent.trail?.length || activitySources(agent.trail, finalUrl).length);
  const showMeta = !msg.pending && Boolean(msg.content || agent);

  const metaContent = showMeta ? (
    <>
      {msg.content && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            copy(msg.content);
          }}
          className="sk-btn h-5 w-5 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
          aria-label={copied ? "Copied" : "Copy reply"}
          title="Copy"
        >
          {copied ? <Check size={11.5} /> : <Copy size={11.5} />}
        </button>
      )}
      {agent && agent.status !== "running" && (
        <span className="inline-flex items-center gap-1 px-0.5">
          {agent.status === "done" ? <CheckCircle2 size={10.5} /> : agent.status === "paused" ? <PauseCircle size={10.5} /> : <Square size={8.5} />}
          {agent.status === "done" ? "Agent finished" : agent.status === "paused" ? "Paused" : agent.status === "error" ? "Agent hit an error" : "Agent stopped"}
        </span>
      )}
      {msg.mood && (
        <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--sk-accent-ink)]" title="Senko's mood">
          <PawPrint size={10} className="shrink-0" aria-hidden />
          <span className="truncate">{msg.mood}</span>
        </span>
      )}
      {msg.provider && <span className="hidden truncate px-0.5 sm:inline">{msg.provider}</span>}
    </>
  ) : null;

  return (
    <div className="sk-in group flex gap-2.5 sm:gap-3">
      <div className="mt-0.5 shrink-0">
        <FoxMark size={18} className={msg.pending ? "sk-thinking" : ""} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {running && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--sk-muted)]" aria-live="polite">
            <span className="sk-pulse h-1.5 w-1.5 rounded-full bg-[var(--sk-accent)]" aria-hidden />
            Working in the browser
          </div>
        )}

        {thinking && <TypingDots />}

        {msg.content && !msg.error && (
          <div>
            <Markdown text={msg.content} />
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 rounded-full bg-[var(--sk-accent)] sk-pulse" aria-hidden />}
          </div>
        )}

        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="start" /> : null}

        {msg.error && (
          <div className="border-l-2 border-[var(--sk-danger)] pl-3 text-[12.5px]" role="alert">
            <div className="flex items-center gap-1.5 font-medium text-[var(--sk-danger)]">
              <AlertTriangle size={13.5} className="shrink-0" aria-hidden />
              <span>That didn&apos;t work</span>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-[var(--sk-muted)]">{msg.error}</div>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(msg.id)}
                className="sk-btn mt-2 h-6.5 border border-[var(--sk-line)] px-2 text-[11px]"
              >
                <RotateCcw size={11} aria-hidden /> Try again
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
              className="group/link inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--sk-line)] bg-white/[0.02] px-3 py-1 text-[12px] transition hover:border-[var(--sk-accent-line)] hover:bg-[var(--sk-accent-soft)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://www.google.com/s2/favicons?domain=${hostOf(a.url)}&sz=32`}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-xs"
              />
              <span className="truncate font-medium text-[var(--sk-text)]">{a.label}</span>
              <span className="hidden truncate text-[11px] text-[var(--sk-muted)] sm:inline">· {hostOf(a.url)}</span>
              <ExternalLink size={11} className="shrink-0 text-[var(--sk-accent-ink)]" aria-hidden />
            </a>
          ))}

        {msg.suggestAgent && onRunAgent && (
          <button
            type="button"
            onClick={() => onRunAgent(msg.id)}
            className="sk-btn h-7 rounded-full border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2.5 text-[11.5px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-[var(--sk-on-accent)]"
          >
            <Bot size={12.5} aria-hidden /> Do this in Agent mode
          </button>
        )}

        {hasTrail ? (
          <AgentTrail trail={agent.trail} finalUrl={finalUrl} running={running} meta={metaContent} />
        ) : (
          showMeta && (
            <div className="flex h-5 items-center gap-1.5 text-[11px] text-[var(--sk-faint)] opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {metaContent}
            </div>
          )
        )}
      </div>
    </div>
  );
});
