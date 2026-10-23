import { useState } from "react";
import { MessageSquare, PanelLeftClose, Settings2, SquarePen, Trash2 } from "lucide-react";
import { FoxMark } from "./fox-mark";
import type { ChatSummary } from "./lib";

function groupChats(chats: ChatSummary[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groups: { label: string; items: ChatSummary[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of chats) {
    const t = new Date(c.updatedAt).getTime();
    const i = t >= start.getTime() ? 0 : t >= start.getTime() - day ? 1 : t >= start.getTime() - 7 * day ? 2 : 3;
    groups[i].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

export function Sidebar({
  chats,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  onSettings,
  onClose,
}: {
  chats: ChatSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <nav aria-label="Chats" className="flex h-full w-full flex-col border-r border-[var(--sk-line)] bg-[var(--sk-panel)]">
      <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-[var(--sk-line)] px-3.5">
        <FoxMark size={24} title="Senko" />
        <span className="sk-display text-[17px] font-semibold tracking-tight text-[var(--sk-text)]">Senko</span>
        <button
          type="button"
          onClick={onClose}
          className="sk-btn ml-auto h-8 w-8 rounded-lg text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2.5">
        <button
          type="button"
          onClick={onNew}
          className="sk-btn h-9 w-full justify-start gap-2 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-solid)] px-3 text-[13px] font-medium text-[var(--sk-text)] shadow-2xs hover:border-[var(--sk-accent-line)] hover:bg-[var(--sk-raised)]"
        >
          <SquarePen size={14} className="text-[var(--sk-accent-ink)]" aria-hidden />
          New chat
          <kbd className="ml-auto hidden rounded border border-[var(--sk-line)] bg-[var(--sk-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sk-faint)] lg:inline">
            Ctrl ⇧ O
          </kbd>
        </button>
      </div>

      <div className="sk-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {loading && !chats.length ? (
          <div className="space-y-1.5 px-1 pt-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk-skel h-8 rounded-lg" />
            ))}
          </div>
        ) : !chats.length ? (
          <p className="px-2.5 pt-4 text-[12.5px] leading-relaxed text-[var(--sk-faint)]">
            Your conversations will show up here, on every device you link.
          </p>
        ) : (
          groupChats(chats).map((g) => (
            <div key={g.label} className="mt-4 first:mt-2">
              <h3 className="px-2.5 pb-1.5 text-[11px] font-medium text-[var(--sk-faint)]">{g.label}</h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === activeId;
                  const asking = confirming === c.id;
                  return (
                    <li key={c.id} className="group/item relative">
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={active ? "page" : undefined}
                        className={`flex h-8.5 w-full items-center gap-2 rounded-lg pl-2.5 pr-8 text-left text-[13px] transition-colors ${
                          active
                            ? "bg-[var(--sk-raised)] font-medium text-[var(--sk-text)] shadow-2xs"
                            : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                        }`}
                      >
                        <MessageSquare size={13.5} className={`shrink-0 ${active ? "text-[var(--sk-accent-ink)]" : "opacity-50"}`} aria-hidden />
                        <span className="truncate">{c.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (asking) {
                            setConfirming(null);
                            onDelete(c.id);
                          } else {
                            setConfirming(c.id);
                            setTimeout(() => setConfirming((v) => (v === c.id ? null : v)), 3000);
                          }
                        }}
                        onBlur={() => setConfirming((v) => (v === c.id ? null : v))}
                        className={`absolute right-1 top-1/2 flex h-6.5 -translate-y-1/2 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition ${
                          asking
                            ? "bg-[var(--sk-danger-soft)] text-[var(--sk-danger)] opacity-100"
                            : "text-[var(--sk-faint)] opacity-100 hover:text-[var(--sk-danger)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover/item:opacity-100"
                        }`}
                        aria-label={asking ? `Confirm delete “${c.title}”` : `Delete “${c.title}”`}
                        title={asking ? "Click again to delete" : "Delete"}
                      >
                        {asking ? "Delete?" : <Trash2 size={12.5} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[var(--sk-line)] p-2.5">
        <button
          type="button"
          onClick={onSettings}
          className="sk-btn h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[13px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
        >
          <Settings2 size={15} aria-hidden /> Settings
        </button>
      </div>
    </nav>
  );
}
