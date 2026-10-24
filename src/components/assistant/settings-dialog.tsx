import { useEffect, useRef, useState } from "react";
import { Brain, Cpu, Monitor, Moon, Sparkles, Sun, Trash2, X } from "lucide-react";
import { forgetMemory, getMemories } from "./api";
import type { ProviderInfo } from "./lib";

export type Theme = "system" | "light" | "dark";

function Row({ icon, title, desc, children, htmlFor }: { icon: React.ReactNode; title: string; desc: string; children?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[var(--sk-accent-ink)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-[var(--sk-text)]">
          {title}
        </label>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--sk-muted)]">{desc}</p>
      </div>
      {children && <div className="shrink-0 pt-0.5">{children}</div>}
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  personalized,
  onPersonalized,
  theme,
  onTheme,
  provider,
  providers,
  onProvider,
}: {
  open: boolean;
  onClose: () => void;
  personalized: boolean;
  onPersonalized: (v: boolean) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  provider: string;
  providers: ProviderInfo[];
  onProvider: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [memories, setMemories] = useState<{ key: string; value: string }[] | null>(null);
  const [memError, setMemError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, select, input")?.focus();
    getMemories()
      .then((m) => {
        setMemories(m);
        setMemError(null);
      })
      .catch((e) => setMemError(e instanceof Error ? e.message : String(e)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("button, select, input, [tabindex='0']")].filter((el) => !el.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const usable = providers.filter((p) => p.available);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="sk-fade absolute inset-0 bg-black/70 backdrop-blur-xs" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-settings-title"
        className="sk-glass-strong sk-pop relative flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
      >
        <div className="flex items-center px-4 pb-1 pt-3.5">
          <h2 id="sk-settings-title" className="sk-display text-[16px] font-semibold">
            Settings
          </h2>
          <button type="button" onClick={onClose} className="sk-btn ml-auto h-7 w-7 text-[var(--sk-muted)]" aria-label="Close settings">
            <X size={15} />
          </button>
        </div>

        <div className="sk-scroll overflow-y-auto px-4 pb-4">
          <div className="divide-y divide-[var(--sk-line)]">
            <Row
              icon={<Sparkles size={14} />}
              title="Personalized suggestions"
              desc={
                personalized
                  ? "On: starters are based on your interests and recent chats."
                  : "Off: your interests and chats aren't used. You'll see general ideas."
              }
              htmlFor="sk-personalized"
            >
              <button
                id="sk-personalized"
                type="button"
                role="switch"
                aria-checked={personalized}
                onClick={() => onPersonalized(!personalized)}
                className="sk-switch"
              >
                <span className="sr-only">{personalized ? "On" : "Off"}</span>
              </button>
            </Row>

            <div>
              <Row icon={<Moon size={14} />} title="Appearance" desc="Warm ember dark, daylight, or follow your device." />
              <div role="radiogroup" aria-label="Theme" className="-mt-1 grid grid-cols-3 gap-1.5 pb-3 pl-8.5">
                {(
                  [
                    ["dark", "Dark", <Moon key="d" size={12.5} />],
                    ["light", "Light", <Sun key="s" size={12.5} />],
                    ["system", "Auto", <Monitor key="m" size={12.5} />],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={theme === id}
                    onClick={() => onTheme(id)}
                    className={`sk-btn h-7.5 border text-[12px] ${
                      theme === id
                        ? "border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                        : "border-[var(--sk-line)] text-[var(--sk-muted)]"
                    }`}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Row icon={<Cpu size={14} />} title="AI model" desc="Auto picks the best available model and falls back if busy." htmlFor="sk-model" />
              <div className="-mt-1 pb-3 pl-8.5">
                <div className="rounded-lg border border-[var(--sk-line)] px-2.5 py-1.5">
                  <select id="sk-model" value={provider} onChange={(e) => onProvider(e.target.value)} className="sk-select w-full text-[12px] text-[var(--sk-text)]">
                    <option value="auto">Auto{usable[0] ? ` · ${usable[0].label}` : ""}</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.label}
                        {p.model ? ` · ${p.model}` : ""}
                        {!p.available ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="py-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[var(--sk-accent-ink)]">
                  <Brain size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">What Senko remembers</div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--sk-muted)]">Facts picked up from your chats. Remove anything you like.</p>
                </div>
                {!!memories?.length && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Forget everything Senko remembers about you?")) return;
                      forgetMemory().then(() => setMemories([]));
                    }}
                    className="sk-btn h-7 px-2 text-[11px] text-[var(--sk-danger)]"
                  >
                    Forget all
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-1 pl-8.5">
                {memError && <li className="text-[12px] text-[var(--sk-faint)]">{memError}</li>}
                {memories === null && !memError && <li className="sk-skel h-7 rounded-md" aria-hidden />}
                {memories?.length === 0 && <li className="text-[12px] text-[var(--sk-faint)]">Nothing yet.</li>}
                {memories?.map((m) => (
                  <li key={m.key} className="flex items-center gap-2 border-b border-[var(--sk-line)] py-1.5 text-[12px]">
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--sk-faint)]">{m.key.replace(/_/g, " ")}: </span>
                      <span className="break-words">{m.value}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => forgetMemory(m.key).then(() => setMemories((ms) => ms?.filter((x) => x.key !== m.key) || []))}
                      className="sk-btn h-6 w-6 shrink-0 text-[var(--sk-faint)] hover:text-[var(--sk-danger)]"
                      aria-label={`Forget ${m.key.replace(/_/g, " ")}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
