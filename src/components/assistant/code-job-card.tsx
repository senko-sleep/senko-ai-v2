"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Code2, Download, ExternalLink, Loader2, Play, Square } from "lucide-react";
import { downloadProjectZip, getJob, isJobRunningHere, onJobsChange, startJob, stopJob } from "./code-job-client";

/**
 * Shows a coding job under the reply that started it. It starts on its own the first time it's
 * shown, runs alongside everything else, and ends with a summary and the project as a .zip.
 */
export function CodeJobCard({ messageId, chatId, goal }: { messageId: string; chatId: string; goal: string }) {
  const job = useSyncExternalStore(
    onJobsChange,
    () => localStorageSnapshot(messageId),
    () => null,
  );
  const state = job ? (JSON.parse(job) as ReturnType<typeof getJob>) : null;
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    if (!getJob(messageId)) startJob(messageId, chatId, goal);
  }, [messageId, chatId, goal]);

  const running = state?.status === "running" && isJobRunningHere(messageId);
  const interrupted = state?.status === "running" && !isJobRunningHere(messageId);
  const done = state?.status === "done";
  const files = state?.filesChanged.length || 0;
  const workspaceUrl = `/code/${encodeURIComponent(chatId)}`;

  return (
    <div className="mt-2 max-w-lg rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface-1)] px-3 py-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        {running ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-[var(--sk-accent-ink)]" aria-hidden />
        ) : done ? (
          <Check size={14} className="shrink-0 text-[var(--sk-ok)]" aria-hidden />
        ) : (
          <Code2 size={14} className="shrink-0 text-[var(--sk-muted)]" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--sk-text)]" title={goal}>
          {done ? "Project verified" : running ? state?.activity || "Working" : interrupted ? "Paused (page was reloaded)" : state?.status === "failed" ? "Build failed" : state?.status === "unverified" ? "Saved · verification incomplete" : state?.status === "stopped" ? "Stopped" : "Starting"}
        </span>
        {files > 0 && (
          <span className="sk-tabular shrink-0 text-[11px] text-[var(--sk-faint)]">
            {files} file{files > 1 ? "s" : ""}
            {running && state?.step ? ` · step ${state.step}` : ""}
          </span>
        )}
      </div>

      {(done || state?.status === "unverified") && state?.summary && <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-[var(--sk-muted)]">{state.summary}</p>}
      {state?.status === "failed" && state.error && <p className="mt-1.5 text-[var(--sk-muted)]">{state.error}</p>}
      {running && !state?.usedNode && state?.step === 1 && (
        <p className="mt-1.5 text-[11.5px] text-[var(--sk-faint)]">
          Open the workspace to let it run Node and npm. Without it, it builds files only.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {done && files > 0 && (
          <button
            type="button"
            disabled={zipping}
            onClick={async () => {
              setZipping(true);
              await downloadProjectZip(chatId, goal.split(/\s+/).slice(0, 4).join("-")).finally(() => setZipping(false));
            }}
            className="sk-btn h-7 rounded-full border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2.5 text-[11.5px] text-[var(--sk-accent-ink)]"
          >
            {zipping ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download .zip
          </button>
        )}
        <a href={workspaceUrl} target="senko-workspace" className="sk-btn h-7 rounded-full border border-[var(--sk-line)] px-2.5 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]">
          <ExternalLink size={12} /> Open workspace
        </a>
        {state?.previewUrl && (
          <a href={state.previewUrl} target="_blank" rel="noreferrer" className="sk-btn h-7 rounded-full border border-[var(--sk-line)] px-2.5 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]">
            <Play size={12} /> Live app
          </a>
        )}
        {running && (
          <button type="button" onClick={() => stopJob(messageId)} className="sk-btn h-7 rounded-full px-2.5 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]">
            <Square size={11} /> Stop
          </button>
        )}
        {(interrupted || state?.status === "failed" || state?.status === "stopped" || state?.status === "unverified") && (
          <button type="button" onClick={() => startJob(messageId, chatId, goal)} className="sk-btn h-7 rounded-full px-2.5 text-[11.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]">
            <Play size={11} /> Resume
          </button>
        )}
      </div>
    </div>
  );
}

function localStorageSnapshot(id: string): string | null {
  try {
    return localStorage.getItem(`senko.codejob.${id}`);
  } catch {
    return null;
  }
}
