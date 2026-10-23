// The panel's view when the agent browses over HTTP (no Chromium on this server):
// the page as readable text with its links and forms, which you can click and fill in yourself.
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { PageSnap } from "@/lib/agent/http-session";

export type PageOp =
  | { op: "goto"; url: string }
  | { op: "click"; link: number }
  | { op: "submit"; form: number; values: Record<string, string> }
  | { op: "back" };

export function ReaderView({ page, busy, onOp }: { page: PageSnap | null; busy: boolean; onOp: (op: PageOp) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (form: number, name: string, v: string) => setValues((s) => ({ ...s, [`${form}:${name}`]: v }));
  const formValues = (form: number, names: string[]) => Object.fromEntries(names.filter((n) => `${form}:${n}` in values).map((n) => [n, values[`${form}:${n}`]]));

  return (
    <div className="absolute inset-0 z-[3] flex flex-col bg-[var(--sk-bg)] text-[var(--sk-text)]">
      <form
        className="flex shrink-0 items-center gap-1 border-b border-[var(--sk-line)] px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url?.trim()) onOp({ op: "goto", url: url.trim() });
          setUrl(null);
        }}
      >
        <button type="button" className="sk-btn h-6 w-6 shrink-0 rounded-md" aria-label="Back" onClick={() => onOp({ op: "back" })}>
          <ArrowLeft size={12} />
        </button>
        <input
          value={url ?? page?.url ?? ""}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setUrl(null)}
          placeholder="Type a web address"
          aria-label="Address"
          className="min-w-0 flex-1 rounded-md bg-[var(--sk-surface)] px-2 py-1 text-[11.5px] outline-none"
        />
        <button type="submit" className="sk-btn h-6 w-6 shrink-0 rounded-md" aria-label="Go">
          {busy ? <Loader2 size={12} className="sk-spin" /> : <ArrowRight size={12} />}
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px] leading-relaxed">
        {!page ? (
          <p className="pt-6 text-center text-[var(--sk-muted)]">Pages the agent opens show up here. You can also type an address above.</p>
        ) : (
          <>
            <h3 className="mb-1.5 text-[13px] font-semibold">{page.title || page.url}</h3>
            {page.needsJs && <p className="mb-2 rounded-md bg-[var(--sk-surface)] px-2 py-1 text-[11px] text-[var(--sk-muted)]">This page is mostly empty without JavaScript.</p>}
            <p className="whitespace-pre-wrap break-words text-[var(--sk-muted)]">{page.text.slice(0, 2500)}</p>

            {page.forms.map((f) => (
              <form
                key={f.n}
                className="mt-3 space-y-1.5 rounded-lg border border-[var(--sk-line)] p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onOp({ op: "submit", form: f.n, values: formValues(f.n, f.fields.map((x) => x.name)) });
                }}
              >
                {f.fields
                  .filter((x) => x.type !== "hidden")
                  .map((x) => (
                    <label key={x.name} className="block text-[11px]">
                      <span className="text-[var(--sk-muted)]">{x.label || x.name}</span>
                      {x.options?.length ? (
                        <select
                          value={values[`${f.n}:${x.name}`] ?? x.value}
                          onChange={(e) => set(f.n, x.name, e.target.value)}
                          className="mt-0.5 w-full rounded-md bg-[var(--sk-surface)] px-2 py-1 outline-none"
                        >
                          {x.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={x.type === "password" ? "password" : "text"}
                          value={values[`${f.n}:${x.name}`] ?? x.value}
                          onChange={(e) => set(f.n, x.name, e.target.value)}
                          className="mt-0.5 w-full rounded-md bg-[var(--sk-surface)] px-2 py-1 outline-none"
                        />
                      )}
                    </label>
                  ))}
                <button type="submit" className="sk-btn h-6.5 rounded-md bg-[var(--sk-accent)] px-3 text-[11px] font-medium text-white">
                  Submit
                </button>
              </form>
            ))}

            {page.links.length > 0 && (
              <ul className="mt-3 space-y-0.5">
                {page.links.slice(0, 40).map((l) => (
                  <li key={l.n}>
                    <button type="button" onClick={() => onOp({ op: "click", link: l.n })} className="max-w-full truncate text-left text-[11.5px] text-[var(--sk-accent-ink)] hover:underline" title={l.href}>
                      {l.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
