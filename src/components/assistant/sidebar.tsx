import { useState } from "react";
import { PanelLeftClose, Pencil, Settings2, SquarePen, Trash2 } from "lucide-react";
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
  onRename,
  onSettings,
  onClose,
}: {
  chats: ChatSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const commit = () => {
    if (!editing) return;
    const title = editing.value.trim();
    const was = chats.find((c) => c.id === editing.id)?.title;
    if (title && title !== was) onRename(editing.id, title);
    setEditing(null);
  };

  return (
    <nav aria-label="Chats" className="sk-sidebar flex h-full w-full flex-col border-r border-[var(--sk-line)]">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <FoxMark size={25} title="Senko" />
        <span className="sk-display text-[14.5px] font-semibold tracking-tight text-[var(--sk-text)]">Senko</span>
        <button
          type="button"
          onClick={onClose}
          className="sk-btn ml-auto h-7 w-7 rounded-md text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="px-2 pb-1.5">
        <button
          type="button"
          onClick={onNew}
          className="sk-btn h-8 w-full justify-start gap-2 rounded-lg px-2.5 text-[12.5px] font-medium text-[var(--sk-text)] hover:bg-[var(--sk-hover)]"
        >
          <SquarePen size={13} className="text-[var(--sk-accent-ink)]" aria-hidden />
          New chat
          <kbd className="ml-auto hidden font-mono text-[9.5px] text-[var(--sk-faint)] lg:inline">
            Ctrl ⇧ O
          </kbd>
        </button>
      </div>

      <div className="sk-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && !chats.length ? (
          <div className="space-y-1 px-1 pt-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk-skel h-7 rounded-md" />
            ))}
          </div>
        ) : !chats.length ? (
          <p className="px-2.5 pt-3 text-[11.5px] leading-relaxed text-[var(--sk-faint)]">
            Your conversations will appear here across linked devices.
          </p>
        ) : (
          groupChats(chats).map((g) => (
            <div key={g.label} className="mt-3 first:mt-1.5">
              <h3 className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">{g.label}</h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === activeId;
                  const asking = confirming === c.id;
                  return (
                    <li key={c.id} className="group/item relative">
                      {editing?.id === c.id ? (
                        <input
                          autoFocus
                          value={editing.value}
                          maxLength={120}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setEditing({ id: c.id, value: e.target.value })}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          aria-label="Chat name"
                          className="h-7.5 w-full rounded-md border border-[var(--sk-accent-line)] bg-[var(--sk-raised)] px-2.5 text-[12.5px] text-[var(--sk-text)] outline-none"
                        />
                      ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex h-7.5 w-full items-center rounded-md pl-3 pr-12 text-left text-[12.5px] transition-colors ${
                          active
                            ? "bg-[var(--sk-hover)] font-medium text-[var(--sk-text)] before:absolute before:bottom-1.5 before:left-0.5 before:top-1.5 before:w-[2px] before:rounded-full before:bg-[var(--sk-accent)]"
                            : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
                        }`}
                      >
                        <span className="truncate">{c.title}</span>
                      </button>
                      )}
                      {editing?.id !== c.id && (
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, value: c.title })}
                        className="absolute right-7 top-1/2 flex h-6 -translate-y-1/2 items-center justify-center rounded px-1.5 text-[var(--sk-faint)] transition hover:text-[var(--sk-text)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover/item:opacity-100"
                        aria-label={`Rename “${c.title}”`}
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      )}
                      {editing?.id !== c.id && (
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
                        className={`absolute right-1 top-1/2 flex h-6 -translate-y-1/2 items-center justify-center rounded px-1.5 text-[10.5px] font-medium transition ${
                          asking
                            ? "bg-[var(--sk-danger-soft)] text-[var(--sk-danger)] opacity-100"
                            : "text-[var(--sk-faint)] opacity-100 hover:text-[var(--sk-danger)] sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover/item:opacity-100"
                        }`}
                        aria-label={asking ? `Confirm delete “${c.title}”` : `Delete “${c.title}”`}
                        title={asking ? "Click again to delete" : "Delete"}
                      >
                        {asking ? "Delete?" : <Trash2 size={11.5} />}
                      </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={onSettings}
          className="sk-btn h-8 w-full justify-start gap-2 rounded-lg px-2.5 text-[12.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
        >
          <Settings2 size={13.5} aria-hidden /> Settings
        </button>
      </div>
    </nav>
  );
}
