import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, ImagePlus, Loader2, Square, X } from "lucide-react";
import type { Mode } from "./lib";

export interface Attachment {
  key: string;
  preview: string;
  id?: string;
  error?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  mode,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  inputRef,
  footer,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  mode: Mode;
  attachments: Attachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (key: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  footer?: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Grow with the text, up to a comfortable height.
  useEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "0px";
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 28), 160)}px`;
  }, [value, inputRef]);

  const uploading = attachments.some((a) => !a.id && !a.error);
  const ready = attachments.filter((a) => a.id);
  const canSend = !busy && !uploading && (value.trim().length > 0 || ready.length > 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (files.length) onAddFiles(files);
      }}
      className={`sk-composer relative rounded-2xl px-2.5 py-1.5 ${
        dragging ? "border-[var(--sk-accent)]" : ""
      }`}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pb-1.5 pt-1" aria-label="Attached images">
          {attachments.map((a) => (
            <li key={a.key} className="sk-pop group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.preview}
                alt="Attached image"
                className={`h-11 w-11 rounded-lg border object-cover ${a.error ? "border-[var(--sk-danger)] opacity-50" : "border-[var(--sk-line)]"}`}
              />
              {!a.id && !a.error && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                  <Loader2 size={13} className="sk-spin text-white" aria-label="Uploading" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.key)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--sk-line)] bg-[var(--sk-bg)] text-[var(--sk-muted)] transition hover:text-[var(--sk-text)]"
                aria-label="Remove image"
                title={a.error || "Remove"}
              >
                <X size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files || [])];
            if (files.length) onAddFiles(files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="sk-btn h-7 w-7 shrink-0 rounded-lg text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
          aria-label="Attach images"
          title="Attach images (or paste / drop them)"
        >
          <ImagePlus size={15} />
        </button>

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              onAddFiles(files);
            }
          }}
          rows={1}
          placeholder={mode === "agent" ? "Describe a browser task for Senko…" : "Message Senko…"}
          aria-label="Message"
          className="sk-scroll block max-h-[160px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-snug text-[var(--sk-text)] outline-none placeholder:text-[var(--sk-faint)] focus-visible:shadow-none"
        />

        <div className="flex shrink-0 items-center gap-1.5">
          {footer}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="sk-btn h-7 w-7 rounded-lg bg-[var(--sk-text)] text-[var(--sk-bg)] hover:bg-[var(--sk-text)] hover:opacity-90"
              aria-label="Stop"
              title="Stop"
            >
              <Square size={10} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="sk-btn sk-primary h-7 w-7 rounded-lg"
              aria-label="Send"
              title="Send (Enter)"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
