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
    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
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
      className={`relative rounded-2xl border bg-[var(--sk-solid)] p-1.5 shadow-sm transition-colors duration-150 focus-within:border-[var(--sk-accent-line)] ${
        dragging ? "border-[var(--sk-accent)]" : "border-[var(--sk-line)]"
      }`}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-2 pb-1 pt-1.5" aria-label="Attached images">
          {attachments.map((a) => (
            <li key={a.key} className="sk-pop group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.preview}
                alt="Attached image"
                className={`h-14 w-14 rounded-lg border object-cover ${a.error ? "border-[var(--sk-danger)] opacity-50" : "border-[var(--sk-line)]"}`}
              />
              {!a.id && !a.error && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                  <Loader2 size={15} className="sk-spin text-white" aria-label="Uploading" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.key)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--sk-line)] bg-[var(--sk-solid)] text-[var(--sk-muted)] shadow transition hover:text-[var(--sk-text)]"
                aria-label="Remove image"
                title={a.error || "Remove"}
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

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
        className="sk-scroll block max-h-[200px] min-h-[40px] w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[14.5px] leading-relaxed text-[var(--sk-text)] outline-none placeholder:text-[var(--sk-faint)] focus-visible:shadow-none"
      />

      <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5 pt-0.5">
        <div className="flex items-center gap-1">
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
            className="sk-btn h-8 w-8 rounded-lg text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
            aria-label="Attach images"
            title="Attach images (or paste / drop them)"
          >
            <ImagePlus size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {footer}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="sk-btn h-8 w-8 rounded-lg bg-[var(--sk-text)] text-[var(--sk-bg)] hover:bg-[var(--sk-text)] hover:opacity-90"
              aria-label="Stop"
              title="Stop"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="sk-btn sk-primary h-8 w-8 rounded-lg"
              aria-label="Send"
              title="Send (Enter)"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
