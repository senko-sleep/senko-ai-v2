import { memo, useEffect, useRef, useState } from "react";
import { CodeJobCard } from "./code-job-card";
import { AlertTriangle, Bot, Check, CheckCircle2, Code2, Compass, Copy, Download, ExternalLink, Eye, GitBranch, Grid3X3, PauseCircle, PawPrint, Pencil, RotateCcw, Sparkles, Square } from "lucide-react";
import { FoxMark } from "./fox-mark";
import { activitySources, visibleTrail, websiteUrl } from "./activity";
import { AgentTrail } from "./activity-trail";
import { ImageGallery } from "../chat/image-gallery";
import { RichMessageContent } from "../ui-renderer/dynamic-ui-renderer";
import { ThinkingPanel } from "./thinking-panel";
import { ChatVideos } from "./chat-videos";
import { ComicCardView } from "./comic-card";
import { SearchResults } from "./search-results";
import type { Msg } from "./lib";
import { downloadTextFile, type FollowUpAction } from "./workspace-artifacts";

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

/** Horizontal preview strip + "View all images" gallery button for chat-mode image results. */
function ScrapedImageStrip({
  images,
  query,
}: {
  images: NonNullable<Msg["scrapedImages"]>;
  query?: string;
}) {
  const [showGallery, setShowGallery] = useState(false);
  const preview = images.slice(0, 4);

  return (
    <div className="mt-2 w-full">
      {/* Mini horizontal strip (up to 4 thumbnails) */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {preview.map((img, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setShowGallery(true)}
            className="shrink-0 rounded-lg overflow-hidden border border-[var(--sk-line)] hover:border-[var(--sk-accent-line)] transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt || ""}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-24 w-24 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </button>
        ))}
        {images.length > 4 && (
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="shrink-0 h-24 w-24 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-surface)] flex items-center justify-center text-[11px] text-[var(--sk-muted)] hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)] transition-colors"
          >
            +{images.length - 4} more
          </button>
        )}
      </div>

      {/* "View all images" button */}
      <button
        type="button"
        onClick={() => setShowGallery(true)}
        className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-accent-ink)] transition-colors"
      >
        <Grid3X3 size={12} aria-hidden />
        View all {images.length} images
      </button>

      {showGallery && (
        <ImageGallery
          images={images.map((img) => ({
            url: img.url,
            alt: img.alt,
            source: img.source,
            engine: img.engine,
          }))}
          query={query}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  );
}

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

/** Strips hidden [DOCUMENT CONTEXT] blocks from user message display while keeping them for the LLM. */
function splitUserDisplayContent(raw: string): { visibleText: string; uiPreviewBlock?: string } {
  const docCtxIdx = raw.indexOf("\n\n<!-- SENKO_DOC_CONTEXT");
  const base = docCtxIdx !== -1 ? raw.slice(0, docCtxIdx).trim() : raw;
  const uiMatch = /```(?:ui|senko-ui)\r?\n[\s\S]*?```/i.exec(base);
  if (uiMatch) {
    const visibleText = base.replace(uiMatch[0], "").trim();
    return { visibleText, uiPreviewBlock: uiMatch[0] };
  }
  return { visibleText: base };
}

export const MessageBubble = memo(function MessageBubble({
  msg,
  chatId,
  streaming,
  onRetry,
  onRunAgent,
  onRunPrompt,
  onSendMessage,
  onEdit,
  onBranch,
  followUps,
  onFollowUp,
}: {
  msg: Msg;
  chatId?: string | null;
  streaming?: boolean;
  onRetry?: (id: string) => void;
  onRunAgent?: (id: string) => void;
  onRunPrompt?: (text: string) => void;
  onSendMessage?: (text: string) => void;
  onEdit?: (id: string, newContent: string) => void;
  onBranch?: (id: string) => void;
  followUps?: FollowUpAction[];
  onFollowUp?: (action: FollowUpAction) => void;
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
    const { visibleText, uiPreviewBlock } = splitUserDisplayContent(msg.content);
    return (
      <div className="sk-in group flex flex-col items-end gap-1.5">
        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="end" /> : null}
        {uiPreviewBlock && (
          <div className="w-full max-w-[92%] sm:max-w-[78%]">
            <RichMessageContent messageId={msg.id} text={uiPreviewBlock} onSendMessage={onSendMessage} />
          </div>
        )}
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
          visibleText && (
            <div className="flex w-full items-center justify-end gap-1">
              {onBranch && (
                <button
                  type="button"
                  onClick={() => onBranch(msg.id)}
                  className="sk-btn h-6 w-6 shrink-0 rounded-md text-[var(--sk-faint)] opacity-100 transition-opacity hover:text-[var(--sk-text)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                  aria-label="Branch chat from here"
                  title="Branch chat from here"
                >
                  <GitBranch size={11.5} />
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(visibleText);
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
                {visibleText}
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
          title="Copy reply"
        >
          {copied ? <Check size={11.5} /> : <Copy size={11.5} />}
        </button>
      )}
      {onRetry && !running && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRetry(msg.id);
          }}
          className="sk-btn h-5 w-5 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
          aria-label="Regenerate reply"
          title="Regenerate reply"
        >
          <RotateCcw size={11} />
        </button>
      )}
      {onBranch && !running && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBranch(msg.id);
          }}
          className="sk-btn h-5 w-5 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
          aria-label="Branch conversation from here"
          title="Branch conversation from here"
        >
          <GitBranch size={11} />
        </button>
      )}
      {msg.content && !running && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadTextFile(`senko-reply-${msg.id.slice(0, 6)}.md`, msg.content, "text/markdown;charset=utf-8");
          }}
          className="sk-btn h-5 w-5 rounded-md text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
          aria-label="Export reply as Markdown"
          title="Export reply as Markdown (.md)"
        >
          <Download size={11} />
        </button>
      )}
      {agent && agent.status !== "running" && (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-0.5">
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
      {msg.provider && <span className="hidden min-w-0 max-w-[24ch] truncate px-0.5 sm:inline" title={msg.provider}>{msg.provider}</span>}
    </>
  ) : null;

  return (
    <div className="sk-in group flex gap-2.5 sm:gap-3">
      <div className="mt-0.5 shrink-0">
        <FoxMark size={18} className={msg.pending ? "sk-thinking" : ""} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {/* While the agent works: the same live dropdown as chat replies, with its browser steps. */}
        {running && (
          <ThinkingPanel
            steps={[
              { id: -1, label: "Working in the live browser", status: "done" as const, detail: agent.goal.length > 140 ? `${agent.goal.slice(0, 140)}…` : agent.goal },
              ...visibleTrail(agent.trail || []).map((entry, i, all) => {
                const item = typeof entry === "string" ? { label: entry } : entry;
                return { id: i, label: item.label, url: websiteUrl(item.url) || undefined, status: (i === all.length - 1 ? "running" : "done") as "running" | "done" };
              }),
            ]}
            pending
            answering={false}
            startedAt={msg.startedAt}
          />
        )}

        {!agent && (thinking || msg.miniAgentSteps?.length || msg.thoughts) && (
          <ThinkingPanel
            steps={msg.miniAgentSteps}
            thoughts={msg.thoughts}
            pending={!!msg.pending}
            answering={Boolean(msg.content)}
            startedAt={msg.startedAt}
            thinkingMs={msg.thinkingMs}
          />
        )}

        {msg.content && (
          <div>
            <RichMessageContent
              messageId={msg.id}
              text={msg.content}
              streaming={streaming}
              uiImages={msg.uiImages}
              onSendMessage={streaming ? undefined : onSendMessage}
              onRunPrompt={streaming ? undefined : onRunPrompt}
            />
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 rounded-full bg-[var(--sk-accent)] sk-pulse" aria-hidden />}
          </div>
        )}

        {msg.imageIds?.length ? <Images ids={msg.imageIds} align="start" /> : null}

        {msg.videos?.length ? <ChatVideos videos={msg.videos} /> : null}

        {msg.search?.results.length ? <SearchResults card={msg.search} /> : null}

        {msg.comic ? <ComicCardView card={msg.comic} onSendMessage={streaming ? undefined : onSendMessage} /> : null}

        {/* Scraped image strip + "View all images" button — shown for chat-mode image searches */}
        {msg.scrapedImages?.length ? (
          <ScrapedImageStrip images={msg.scrapedImages} query={msg.imageQuery} />
        ) : null}

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

        {msg.codeTask && chatId && !streaming && <CodeJobCard messageId={msg.id} chatId={chatId} goal={msg.codeTask} />}

        {msg.suggestAgent && onRunAgent && (
          <button
            type="button"
            onClick={() => onRunAgent(msg.id)}
            className="sk-btn h-7 rounded-full border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2.5 text-[11.5px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-[var(--sk-on-accent)]"
          >
            <Bot size={12.5} aria-hidden /> Do this in Agent mode
          </button>
        )}

        {hasTrail && !running ? (
          <AgentTrail trail={agent.trail} finalUrl={finalUrl} running={running} meta={metaContent} />
        ) : (
          showMeta && (
            <div className="flex h-5 items-center gap-1.5 text-[11px] text-[var(--sk-faint)] opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {metaContent}
            </div>
          )
        )}

        {/* Contextual follow-up actions */}
        {!streaming && !running && followUps && followUps.length > 0 && onFollowUp && (
          <div className="sk-fade flex flex-wrap items-center gap-1.5 pt-1">
            {followUps.map((f, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onFollowUp(f)}
                className="sk-follow-chip"
              >
                {f.action === "open-preview" ? (
                  <Eye size={11.5} className="text-[var(--sk-accent-ink)]" />
                ) : f.action === "open-code" ? (
                  <Code2 size={11.5} className="text-[var(--sk-accent-ink)]" />
                ) : f.action === "open-sources" ? (
                  <Compass size={11.5} className="text-[var(--sk-accent-ink)]" />
                ) : f.mode === "agent" ? (
                  <Bot size={11.5} className="text-[var(--sk-accent-ink)]" />
                ) : (
                  <Sparkles size={11.5} className="text-[var(--sk-accent-ink)]" />
                )}
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
