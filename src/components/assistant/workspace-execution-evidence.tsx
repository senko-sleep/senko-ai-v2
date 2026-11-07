"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Radio, RefreshCw } from "lucide-react";

export interface WorkspaceCodingTask {
  goal: string;
  status: "running" | "verified" | "incomplete" | "stopped";
  activity?: string;
  step: number;
  checks: string[];
  playbackRequired: boolean;
  mediaPlaybackVerified: boolean;
  sourcesCount: number;
}

export interface WorkspaceMediaEvidence {
  kind: "native" | "youtube";
  url: string;
  currentTime: number;
  advancedSeconds: number;
  paused: boolean;
  muted: boolean;
  readyState: number;
  error?: string;
  verified: boolean;
}

export interface WorkspaceProviderStatus {
  id: string;
  label: string;
  available: boolean;
  model?: string;
  detail?: string;
  health?: { state: "untested" | "healthy" | "transient_failure" | "configuration_error" | "unavailable"; checkedAt: number; status: number; reason: string; retryable: boolean; failures: number; retryAt?: number };
}

export function providerHealthLabel(provider: WorkspaceProviderStatus): string {
  const state = provider.health?.state;
  if (state === "healthy") return "Inference checked";
  if (state === "configuration_error") return "Configuration error";
  if (state === "unavailable") return "Model unavailable";
  if (state === "transient_failure") return provider.health?.retryable ? "Temporary failure" : "Inference failed";
  return provider.model ? "Inference not checked" : "Not configured";
}

export function playbackEvidenceSummary(media: WorkspaceMediaEvidence[]): { verified: boolean; detail: string } {
  const playing = media.find((entry) => entry.verified && !entry.paused && !entry.muted && entry.readyState >= 2 && !entry.error && entry.advancedSeconds >= 0.2);
  if (playing) return { verified: true, detail: `Unmuted ${playing.kind === "youtube" ? "YouTube" : "media"} playback advanced ${playing.advancedSeconds.toFixed(2)}s during browser observation.` };
  const error = media.find((entry) => entry.error)?.error;
  const best = media.reduce<WorkspaceMediaEvidence | undefined>((previous, current) => !previous || current.advancedSeconds > previous.advancedSeconds ? current : previous, undefined);
  return { verified: false, detail: error || (best ? `${best.paused ? "Paused" : "Not paused"} · ${best.muted ? "muted" : "unmuted"} · ${best.advancedSeconds.toFixed(2)}s observed advancement. Audible playback is unverified.` : "No advancing, unmuted media has been observed. An iframe or a play-button click does not prove playback.") };
}

function ProviderDiagnostics() {
  const [providers, setProviders] = useState<WorkspaceProviderStatus[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const load = async () => {
    if (loading || checking) return;
    setLoading(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/providers", { signal: abort.signal, cache: "no-store" });
      const data = await response.json() as { providers?: WorkspaceProviderStatus[]; error?: string };
      if (!response.ok || !Array.isArray(data.providers)) throw new Error(data.error || "Provider diagnostics could not be loaded.");
      setProviders(data.providers);
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  };

  const check = async (provider: WorkspaceProviderStatus) => {
    if (!provider.model || checking || loading) return;
    setChecking(provider.id); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: provider.id, model: provider.model }), signal: abort.signal });
      const data = await response.json() as { provider?: WorkspaceProviderStatus; error?: string };
      if (!response.ok || !data.provider) throw new Error(data.error || "Inference check did not return a result.");
      const result = data.provider;
      setProviders((previous) => previous?.map((entry) => entry.id === provider.id ? result : entry) || [result]);
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!abort.signal.aborted) setChecking(null); }
  };

  return <details className="group border-t border-[var(--sk-line)] pt-2" onToggle={(event) => { if (event.currentTarget.open && !providers && !loading) void load(); }}>
    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--sk-muted)] focus-visible:outline focus-visible:outline-[var(--sk-accent)]"><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />Provider diagnostics</summary>
    <div className="mt-2 space-y-2">
      <div className="flex items-start justify-between gap-3 text-[10.5px] text-[var(--sk-muted)]"><p>Discovery is not an inference check. Check sends one real, small request.</p><button type="button" disabled={loading || !!checking} onClick={() => void load()} aria-label="Refresh provider diagnostics" className="sk-btn h-5 w-5 shrink-0 disabled:opacity-40"><RefreshCw className={`h-3 w-3 ${loading ? "sk-spin" : ""}`} /></button></div>
      {loading && <p role="status" className="text-[11px] text-[var(--sk-muted)]">Loading configured providers…</p>}
      {error && <p role="alert" className="break-words text-[11px] text-amber-300">{error}</p>}
      {providers && <ul className="divide-y divide-[var(--sk-line)]">{providers.map((provider) => <li key={provider.id} className="flex min-w-0 items-start justify-between gap-2 py-2">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"><span className="font-medium text-[var(--sk-text)]">{provider.label}</span><span className={provider.health?.state === "healthy" ? "text-emerald-300" : "text-[var(--sk-muted)]"}>{providerHealthLabel(provider)}</span>{provider.health?.checkedAt ? <time className="text-[10px] text-[var(--sk-faint)]" dateTime={new Date(provider.health.checkedAt).toISOString()}>checked {new Date(provider.health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : null}</div>
          {provider.model && <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--sk-muted)]">{provider.model}</p>}
          {(provider.health?.reason || provider.detail) && <p className="mt-0.5 break-words text-[10.5px] leading-relaxed text-[var(--sk-muted)]">{provider.health?.status ? `HTTP ${provider.health.status} · ` : ""}{provider.health?.reason || provider.detail}</p>}
        </div><button type="button" disabled={!provider.model || loading || !!checking} onClick={() => void check(provider)} aria-label={`Check ${provider.label} inference`} className="sk-btn h-6 shrink-0 rounded border border-[var(--sk-line)] px-2 text-[10.5px] text-[var(--sk-text)] disabled:opacity-40">{checking === provider.id ? "Checking…" : "Check"}</button>
      </li>)}</ul>}
    </div>
  </details>;
}

export function WorkspaceExecutionEvidence({ task, media = [], primaryGoal }: { task?: WorkspaceCodingTask; media?: WorkspaceMediaEvidence[]; primaryGoal?: string }) {
  const playback = playbackEvidenceSummary(media);
  const playbackVerified = Boolean(task?.mediaPlaybackVerified && playback.verified);
  const verified = task?.status === "verified" && (!task.playbackRequired || playbackVerified);
  const state = verified ? "Runtime verified" : task?.status === "running" ? "Executing" : task?.status === "stopped" ? "Stopped" : task ? "Verification incomplete" : "Awaiting execution";
  return <section aria-label="Task acceptance and execution evidence" className="space-y-2.5 border-b border-[var(--sk-line)] pb-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><h3 className="text-[11px] font-medium tracking-wide text-[var(--sk-text)]">Execution evidence</h3><span role="status" className={`flex items-center gap-1.5 text-[10.5px] ${verified ? "text-emerald-300" : task?.status === "incomplete" ? "text-amber-300" : "text-[var(--sk-muted)]"}`}>{verified ? <CheckCircle2 className="h-3 w-3" /> : task?.status === "incomplete" ? <AlertTriangle className="h-3 w-3" /> : <Radio className="h-3 w-3" />}{state}</span></div>
    {task ? <>
      {task.goal !== primaryGoal && <p className="break-words text-[12px] leading-relaxed text-[var(--sk-text)]">{task.goal}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[var(--sk-muted)]"><span>Step {task.step}</span><span>{task.sourcesCount} retrieved source{task.sourcesCount === 1 ? "" : "s"}</span></div>
      {task.status === "running" && task.activity && <p className="break-words font-mono text-[11px] text-[var(--sk-accent-ink)]">{task.activity}</p>}
      {task.checks.length > 0 && <details className="group"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--sk-muted)]"><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />Required checks ({task.checks.length})</summary><ul className="mt-1.5 space-y-1 border-l border-[var(--sk-line)] pl-3 text-[11px] text-[var(--sk-muted)]">{[...new Set(task.checks)].map((check) => <li key={check}>{check}</li>)}</ul></details>}
      {task.playbackRequired && <div className="border-l-2 border-[var(--sk-line-strong)] pl-2.5"><p className={`text-[11px] font-medium ${playbackVerified ? "text-emerald-300" : "text-amber-300"}`}>{playbackVerified ? "Playback observed" : "Playback remains unverified"}</p><p className="mt-1 break-words text-[10.5px] leading-relaxed text-[var(--sk-muted)]">{playback.verified && !task.mediaPlaybackVerified ? "An earlier browser observation detected playback, but the current source revision has not been verified." : playback.detail}</p></div>}
    </> : <p className="text-[11px] leading-relaxed text-[var(--sk-muted)]">A task’s recorded checks will appear here when the coding agent runs. Saved files alone do not verify the requested behavior.</p>}
    <ProviderDiagnostics />
  </section>;
}
