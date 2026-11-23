"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward, SlidersHorizontal } from "lucide-react";
import { DIRECTION_LIMITS, type ProductionStage } from "@/lib/voice/production";
import { errorFromResponse, readSSE, type Msg, type SectionDirection, type StoredMessage, type VoiceNote, type VoiceProduction, type VoiceProgress, type VoiceSection } from "./lib";

type Failure = NonNullable<Msg["voiceError"]>;
type Live = { production?: VoiceProduction; voice?: VoiceNote; error?: Failure | null };
type View = { kind: "full" } | { kind: "section"; index: number };
type Panel = "sections" | "transcript" | "stats";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const STAGE: Record<ProductionStage, string> = { writing: "Writing", directing: "Directing", synthesizing: "Synthesizing", assembling: "Assembling", completed: "Completed", failed: "Needs attention" };
const STATUS: Record<VoiceSection["status"], string> = { pending: "Waiting", directing: "Directing", queued: "Directed", synthesizing: "Recording", ready: "Ready", failed: "Failed" };
const CONTROLS: { key: keyof typeof DIRECTION_LIMITS; label: string; step: number; unit?: string }[] = [
  { key: "pace", label: "Pace", step: 0.01, unit: "×" },
  { key: "energy", label: "Energy", step: 0.01, unit: "×" },
  { key: "pitch", label: "Register", step: 0.1 },
  { key: "warmth", label: "Warmth", step: 0.05 },
  { key: "brightness", label: "Brightness", step: 0.05 },
  { key: "breathiness", label: "Breathiness", step: 0.05 },
  { key: "pauseAfterMs", label: "Pause after", step: 10, unit: " ms" },
];

const clock = (value?: number) => {
  const s = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const duration = (ms?: number) => (ms === undefined ? "–" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
const audioUrl = (id: string) => `/api/uploads/${encodeURIComponent(id)}`;

export function VoiceStudio({ msg, chatId }: { msg: Msg; chatId: string | null }) {
  const progress: VoiceProgress | undefined = msg.voiceProgress;
  const [live, setLive] = useState<Live | null>(null);
  const [recording, setRecording] = useState<number | "all" | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<SectionDirection | null>(null);
  const [view, setView] = useState<View>({ kind: "full" });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playbackError, setPlaybackError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<HTMLAudioElement>(null);
  const resume = useRef(false);

  const pending = !!msg.pending;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const production = live?.production ?? (pending ? progress?.production : msg.voiceProduction ?? progress?.production);
  const voice = live ? live.voice : msg.voice;
  const failure = live ? live.error : msg.voiceError;
  const sections = production?.sections ?? [];
  const ready = sections.filter(s => s.audioId && s.status === "ready");
  const working = pending || recording !== null;
  const fullId = !working && production?.stage === "completed" ? production.audioId ?? voice?.audioId : !production ? voice?.audioId : undefined;
  // Finished sections are playable while the rest are still recording.
  const fallbackIndex = ready[0]?.index;
  const current: View = view.kind === "full" && !fullId && fallbackIndex !== undefined ? { kind: "section", index: fallbackIndex } : view;
  const currentSection = current.kind === "section" ? sections[current.index] : undefined;
  const src = current.kind === "section" ? (currentSection?.audioId ? audioUrl(currentSection.audioId) : undefined) : fullId ? audioUrl(fullId) : undefined;
  const activeIndex = current.kind === "section"
    ? current.index
    : sections.reduce((found, s) => (s.startSeconds !== undefined && s.startSeconds <= time + 0.05 ? s.index : found), 0);
  const stage: ProductionStage = production?.stage ?? (progress?.phase === "error" ? "failed" : "writing");
  const totalWords = sections.reduce((n, s) => n + s.words, 0);
  const audioSeconds = production?.seconds ?? sections.reduce((n, s) => n + (s.seconds || 0), 0);
  const elapsed = pending && msg.startedAt ? Math.max(0, now - msg.startedAt) : undefined;
  const count = sections.length || progress?.total || 0;
  const done = sections.length ? ready.length : progress?.completed ?? 0;
  const failedCount = sections.filter(s => s.status === "failed").length;

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) return;
    if (el.paused) void el.play().catch(() => setPlaybackError(true));
    else el.pause();
  };
  const playSection = (index: number) => {
    const s = sections[index];
    if (!s?.audioId) return;
    setPlaybackError(false);
    resume.current = true;
    if (fullId && s.startSeconds !== undefined && current.kind === "full" && audio.current) {
      audio.current.currentTime = s.startSeconds;
      void audio.current.play().catch(() => setPlaybackError(true));
      return;
    }
    if (current.kind === "section" && current.index === index && audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => setPlaybackError(true));
      return;
    }
    setTime(0);
    setView({ kind: "section", index });
  };
  const previewSection = (index: number) => {
    resume.current = true;
    setPlaybackError(false);
    if (current.kind === "section" && current.index === index && audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => setPlaybackError(true));
      return;
    }
    setTime(0);
    setView({ kind: "section", index });
  };
  const step = (delta: number) => {
    const target = sections[activeIndex + delta];
    if (target?.audioId) playSection(target.index);
  };
  const onEnded = () => {
    setPlaying(false);
    if (current.kind !== "section") return;
    // While recording (or previewing without a full mix), continue with the next finished section.
    const next = sections[current.index + 1];
    if (!fullId && next?.audioId) {
      resume.current = true;
      setTime(0);
      setView({ kind: "section", index: next.index });
    }
  };

  const record = async (body: { section?: number; direction?: SectionDirection }) => {
    if (!chatId || recording !== null) return;
    audio.current?.pause();
    setRecording(body.section ?? "all");
    setRequestError(null);
    let finished = false;
    try {
      const res = await fetch(`/api/chats/${chatId}/messages/${msg.serverId ?? msg.id}/voice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await errorFromResponse(res));
      await readSSE(res, data => {
        const e = data as { type: string; progress?: VoiceProgress; message?: StoredMessage; error?: string };
        if (e.type === "voice_progress" && e.progress?.production) {
          const snapshot = e.progress.production;
          setLive(prev => ({ voice: prev ? prev.voice : msg.voice, error: null, production: snapshot }));
        } else if (e.type === "done" && e.message) {
          finished = true;
          setLive({ production: e.message.meta.voiceProduction, voice: e.message.meta.voice, error: e.message.meta.voiceError ?? null });
          setView({ kind: "full" });
          setEditing(null);
          setDraft(null);
        } else if (e.type === "error") {
          setRequestError(e.error || "The recording failed.");
        }
      });
      if (!finished) setRequestError(prev => prev ?? "The connection closed before the recording finished. Finished sections are saved.");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "The recording failed.");
    } finally {
      setRecording(null);
    }
  };

  const timelineLength = length || (current.kind === "section" ? currentSection?.seconds : production?.seconds) || 0;

  return (
    <section aria-label="Voice message" className="my-2 w-full max-w-[640px]">
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          aria-label={`${voice?.voice || production?.voice || "Senko"} recording`}
          onLoadedMetadata={e => {
            e.currentTarget.playbackRate = speed;
            if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration);
            setPlaybackError(false);
          }}
          onCanPlay={e => {
            if (!resume.current) return;
            resume.current = false;
            void e.currentTarget.play().catch(() => setPlaybackError(true));
          }}
          onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
          onError={() => { setPlaying(false); setPlaybackError(true); }}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!src}
          className="sk-btn sk-primary h-11 w-11 shrink-0 rounded-full"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} className="translate-x-px" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[13.5px] font-medium text-[var(--sk-text)]">
              {current.kind === "section" && currentSection ? `Section ${current.index + 1}` : voice?.voice || production?.voice || "Senko"}
            </p>
            <p className="shrink-0 text-[11.5px] tabular-nums text-[var(--sk-muted)]">{clock(time)} / {clock(timelineLength)}</p>
          </div>
          <div className="relative mt-1.5 flex h-4 items-center">
            <input
              type="range"
              min={0}
              max={timelineLength || 1}
              step={0.1}
              value={Math.min(time, timelineLength || 1)}
              disabled={!src}
              onChange={e => {
                const value = Number(e.target.value);
                setTime(value);
                if (audio.current) audio.current.currentTime = value;
              }}
              aria-label="Seek"
              aria-valuetext={`${clock(time)} of ${clock(timelineLength)}`}
              className="h-1 w-full cursor-pointer accent-[var(--sk-accent)] disabled:cursor-default disabled:opacity-40"
            />
            {current.kind === "full" && timelineLength > 0 && sections.slice(1).map(s => s.startSeconds !== undefined && (
              <span key={s.index} aria-hidden className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--sk-muted)]" style={{ left: `${(s.startSeconds / timelineLength) * 100}%` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 pl-14 text-[var(--sk-muted)]">
        {sections.length > 1 && (
          <>
            <IconButton label="Previous section" onClick={() => step(-1)} disabled={!sections[activeIndex - 1]?.audioId}><SkipBack size={14} aria-hidden /></IconButton>
            <IconButton label="Next section" onClick={() => step(1)} disabled={!sections[activeIndex + 1]?.audioId}><SkipForward size={14} aria-hidden /></IconButton>
          </>
        )}
        <IconButton label="Replay from the start" disabled={!src} onClick={() => { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setPlaybackError(true)); } }}><RotateCcw size={13.5} aria-hidden /></IconButton>
        <button
          type="button"
          onClick={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
          className="sk-btn h-8 min-w-11 rounded-md px-1.5 text-[12px] tabular-nums"
          aria-label={`Playback speed ${speed} times`}
        >{speed}×</button>
        {src && <a href={src} download="senko-recording.wav" className="sk-btn inline-flex h-8 w-8 items-center justify-center rounded-md" aria-label="Download audio"><Download size={14} aria-hidden /></a>}
        {current.kind === "section" && fullId && (
          <button type="button" onClick={() => { setTime(0); setView({ kind: "full" }); }} className="sk-btn h-8 rounded-md px-2 text-[12px]">Full recording</button>
        )}
      </div>

      {(working || stage === "failed") && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
            <span className="font-medium text-[var(--sk-text)]">{working && sections.length === 0 ? progress?.message || "Writing the narration" : STAGE[stage]}</span>
            <span className="tabular-nums text-[var(--sk-muted)]">
              {count > 0 && `${done} of ${count} ${sections.length ? "recorded" : "written"}`}
              {audioSeconds > 0 && ` · ${clock(audioSeconds)} audio`}
              {elapsed !== undefined && ` · ${duration(Math.floor(elapsed / 1000) * 1000)}`}
            </span>
          </div>
          {count > 0 && (
            <div role="progressbar" aria-label="Sections completed" aria-valuemin={0} aria-valuemax={count} aria-valuenow={done} className="mt-1.5 flex h-[3px] gap-[3px]">
              {Array.from({ length: count }, (_, i) => {
                const s = sections[i];
                const part = s?.status === "ready" ? 1 : s?.status === "synthesizing" && s.linesTotal ? (s.linesDone || 0) / s.linesTotal : !s && i < done ? 1 : 0;
                return (
                  <span key={i} className={`relative flex-1 overflow-hidden rounded-full ${s?.status === "failed" ? "bg-[var(--sk-danger)]" : "bg-[var(--sk-line)]"}`}>
                    <span className="absolute inset-y-0 left-0 bg-[var(--sk-accent)]" style={{ width: `${part * 100}%` }} />
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(failure || requestError || playbackError) && (
        <div role="alert" className="mt-3 border-l-2 border-[var(--sk-danger)] pl-3 text-[12.5px] text-[var(--sk-muted)]">
          <p>{requestError || failure?.message || "This audio couldn't be played. Try downloading it."}</p>
          {sections.length > 0 && (failedCount > 0 || !fullId) && !working && chatId && (
            <button type="button" onClick={() => void record({})} className="sk-btn mt-2 h-8 rounded-md border border-[var(--sk-line)] px-2.5 text-[12px] text-[var(--sk-text)]">
              <RotateCcw size={12} aria-hidden /> Retry {failedCount ? `${failedCount} failed section${failedCount === 1 ? "" : "s"}` : "recording"}
            </button>
          )}
        </div>
      )}

      {sections.length > 0 && (
        <div className="mt-3 flex gap-4 border-b border-[var(--sk-line)] text-[12px]" role="tablist" aria-label="Recording details">
          {(["sections", "transcript", "stats"] as Panel[]).map(name => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={panel === name}
              onClick={() => setPanel(open => (open === name ? null : name))}
              className={`-mb-px min-h-9 border-b-2 px-0.5 capitalize transition-colors ${panel === name ? "border-[var(--sk-accent)] text-[var(--sk-text)]" : "border-transparent text-[var(--sk-muted)] hover:text-[var(--sk-text)]"}`}
            >{name === "sections" ? `Sections (${sections.length})` : name === "stats" ? "Statistics" : name}</button>
          ))}
        </div>
      )}

      {panel === "sections" && (
        <ol className="divide-y divide-[var(--sk-line)]/60">
          {sections.map(s => {
            const isActive = activeIndex === s.index && (playing || current.kind === "section");
            const open = editing === s.index;
            return (
              <li key={s.index} className="py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (fullId ? playSection(s.index) : previewSection(s.index))}
                    disabled={!s.audioId}
                    aria-label={`Play section ${s.index + 1}`}
                    className={`sk-btn h-8 w-8 shrink-0 rounded-full ${isActive ? "text-[var(--sk-accent-ink)]" : "text-[var(--sk-muted)]"}`}
                  ><Play size={13} aria-hidden /></button>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-[var(--sk-text)]">
                      <span className="font-medium">Section {s.index + 1}</span>
                      <span className={`text-[11.5px] ${s.status === "failed" ? "text-[var(--sk-danger)]" : "text-[var(--sk-muted)]"}`}>{recording === s.index ? "Re-recording" : STATUS[s.status]}</span>
                    </p>
                    <p className="truncate text-[11.5px] text-[var(--sk-muted)]">
                      {[s.direction.emotion || (s.directionSource === "neutral" ? "Neutral performance" : ""), `pace ${s.direction.pace.toFixed(2)}`, `${s.words} words`, s.seconds ? clock(s.seconds) : ""].filter(Boolean).join(" · ")}
                    </p>
                    {s.error && <p className="mt-0.5 text-[11.5px] text-[var(--sk-danger)]">{s.error}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setEditing(open ? null : s.index); setDraft(open ? null : { ...s.direction }); }}
                    aria-expanded={open}
                    aria-label={`Direct section ${s.index + 1}`}
                    className={`sk-btn h-8 w-8 shrink-0 rounded-md ${open ? "text-[var(--sk-accent-ink)]" : "text-[var(--sk-muted)]"}`}
                  ><SlidersHorizontal size={14} aria-hidden /></button>
                </div>
                {open && draft && (
                  <div className="mt-2.5 pl-10">
                    {s.direction.delivery && <p className="mb-2 text-[12px] italic text-[var(--sk-muted)]">{s.direction.delivery}</p>}
                    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                      {CONTROLS.map(c => (
                        <label key={c.key} className="block text-[11.5px] text-[var(--sk-muted)]">
                          <span className="flex justify-between"><span>{c.label}</span><span className="tabular-nums text-[var(--sk-text)]">{draft[c.key]}{c.unit || ""}</span></span>
                          <input
                            type="range"
                            min={DIRECTION_LIMITS[c.key][0]}
                            max={DIRECTION_LIMITS[c.key][1]}
                            step={c.step}
                            value={draft[c.key]}
                            onChange={e => { const value = Number(e.target.value); setDraft(d => (d ? { ...d, [c.key]: value } : d)); }}
                            className="mt-1 h-1 w-full cursor-pointer accent-[var(--sk-accent)]"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={working} onClick={() => void record({ section: s.index, direction: draft })} className="sk-btn sk-primary h-8 rounded-md px-3 text-[12px]">
                        {recording === s.index ? <Loader2 size={12} className="sk-spin" aria-hidden /> : null} Re-record section
                      </button>
                      <button type="button" onClick={() => { setEditing(null); setDraft(null); }} className="sk-btn h-8 rounded-md px-2.5 text-[12px] text-[var(--sk-muted)]">Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {panel === "transcript" && (
        <div className="max-h-80 space-y-3 overflow-y-auto py-3 pr-1 text-[13.5px] leading-relaxed text-[var(--sk-text)]">
          {(msg.voiceProduction?.sections.length ? msg.voiceProduction.sections.map(s => s.text) : [msg.content]).filter(Boolean).map((text, i) => <p key={i} className="whitespace-pre-wrap">{text}</p>)}
        </div>
      )}

      {panel === "stats" && production && (
        <div className="py-3 text-[12px]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <Stat label="Stage" value={STAGE[stage]} />
            <Stat label="Words" value={totalWords.toLocaleString()} />
            <Stat label="Sections" value={`${ready.length} of ${sections.length}`} />
            <Stat label="Audio" value={audioSeconds ? clock(audioSeconds) : "–"} />
            <Stat label="Writing" value={duration(production.writer?.ms)} />
            <Stat label="Directing" value={duration(production.directingMs)} />
            <Stat label="Synthesis" value={duration(production.synthesisMs)} />
            <Stat label="Assembly" value={duration(production.assemblingMs)} />
            <Stat label="Speed" value={production.synthesisMs && audioSeconds ? `${(audioSeconds / (production.synthesisMs / 1000)).toFixed(2)}× realtime` : "–"} />
            <Stat label="Writer" value={production.writer?.model ? `${production.writer.provider ?? ""} ${production.writer.model}`.trim() : "–"} wide />
            <Stat label="Voice engine" value={[production.engine, production.engineModel].filter(Boolean).join(" · ") || "–"} wide />
          </dl>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] text-left tabular-nums">
              <thead className="text-[var(--sk-muted)]">
                <tr className="border-b border-[var(--sk-line)]">
                  {["Section", "Words", "Audio", "Director", "Synthesis", "Attempts", "Direction"].map(h => <th key={h} scope="col" className="py-1.5 pr-3 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sections.map(s => (
                  <tr key={s.index} className="border-b border-[var(--sk-line)]/50 text-[var(--sk-text)]">
                    <td className="py-1.5 pr-3">{s.index + 1}</td>
                    <td className="py-1.5 pr-3">{s.words}</td>
                    <td className="py-1.5 pr-3">{s.seconds ? clock(s.seconds) : "–"}</td>
                    <td className="py-1.5 pr-3">{duration(s.directorMs)}</td>
                    <td className="py-1.5 pr-3">{duration(s.synthesisMs)}</td>
                    <td className="py-1.5 pr-3">{s.synthesisAttempts || "–"}</td>
                    <td className="py-1.5 pr-3" title={s.directorNote || s.directorModel}>{s.directionSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="sk-btn h-8 w-8 rounded-md">{children}</button>;
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 sm:col-span-3" : ""}`}>
      <dt className="text-[11px] text-[var(--sk-muted)]">{label}</dt>
      <dd className="break-words text-[var(--sk-text)]">{value}</dd>
    </div>
  );
}
