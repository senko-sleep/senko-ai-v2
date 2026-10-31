import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, Box, FileText, ImagePlus, Loader2, Square, X } from "lucide-react";
import type { ExtractedDocument } from "@/lib/document-extractor";
import type { Mode } from "./lib";

export interface Attachment {
  key: string;
  preview: string;
  id?: string;
  doc?: ExtractedDocument;
  fileName?: string;
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

  const uploading = attachments.some((a) => !a.id && !a.doc && !a.error);
  const ready = attachments.filter((a) => a.id || a.doc);
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
        const files = [...e.dataTransfer.files];
        if (files.length) onAddFiles(files);
      }}
      className={`sk-composer relative rounded-2xl px-2.5 py-1.5 ${
        dragging ? "border-[var(--sk-accent)]" : ""
      }`}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pb-1.5 pt-1" aria-label="Attached files">
          {attachments.map((a) => (
            <li key={a.key} className="sk-pop group relative">
              {a.doc || (a.fileName && !a.preview) ? (
                <div
                  className={`flex h-11 max-w-[200px] items-center gap-2 rounded-lg border bg-[var(--sk-raised)] px-2.5 ${
                    a.error ? "border-[var(--sk-danger)] opacity-50" : "border-[var(--sk-line)]"
                  }`}
                >
                  {a.doc?.is3DModel ? (
                    <Box size={15} className="shrink-0 text-[var(--sk-accent-ink)]" />
                  ) : (
                    <FileText size={15} className="shrink-0 text-[var(--sk-accent-ink)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-medium text-[var(--sk-text)]">
                      {a.doc?.fileName || a.fileName || "Document"}
                    </div>
                    <div className="text-[10px] text-[var(--sk-muted)]">
                      {a.doc ? `${a.doc.fileType} · ${a.doc.pageCount}p` : "Reading…"}
                    </div>
                  </div>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.preview}
                  alt="Attached image"
                  className={`h-11 w-11 rounded-lg border object-cover ${
                    a.error ? "border-[var(--sk-danger)] opacity-50" : "border-[var(--sk-line)]"
                  }`}
                />
              )}
              {!a.id && !a.doc && !a.error && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
                  <Loader2 size={13} className="sk-spin text-white" aria-label="Uploading" />
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.key)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--sk-line)] bg-[var(--sk-bg)] text-[var(--sk-muted)] transition hover:text-[var(--sk-text)]"
                aria-label="Remove attachment"
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
          accept="image/*,.pdf,.txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.js,.ts,.py,.obj,.stl"
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
          aria-label="Attach images, documents, or 3D models"
          title="Attach images, PDFs, documents, or 3D models (.obj)"
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
            const files = [...e.clipboardData.files];
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
