// Runs a voice production: direct and synthesize each section, keep what succeeded, then join.
// Directing runs ahead of synthesis so the (slower) speech engine never waits on a model when it
// can avoid it. Both go in story order so emotion and character voices carry forward.
import { q, q1, toBuffer } from "./db";
import { joinWavs } from "./voice-audio";
import { directSection, type SectionDirectOptions, type SectionDirectResult } from "./voice-director";
import { VoiceError, voiceLimits, withVoiceBudget } from "./voice-policy";
import { renderWithEngines, saveAudio, voiceEngines, type VoiceEngine, type VoiceMeta } from "./voice";
import { mergeCast, productionSnapshot, sectionPlan, type VoiceProduction, type VoiceSection } from "@/lib/voice/production";
import type { VoiceProgress } from "@/lib/voice/progress";

export interface ProductionOptions {
  ownerId: string;
  production: VoiceProduction;
  /** Only these sections. Default: every section without finished audio. */
  only?: number[];
  /** Keep the current direction (a user edit) instead of asking the director. */
  keepDirection?: boolean;
  request?: string;
  mood?: string;
  personality?: string;
  provider?: string;
  signal?: AbortSignal;
  engines?: VoiceEngine[];
  ask?: SectionDirectOptions["ask"];
  onProgress?: (progress: VoiceProgress) => void;
}

export interface ProductionResult {
  production: VoiceProduction;
  voice?: VoiceMeta;
  failure?: { code: string; message: string; retryAfter?: number };
}

const failureOf = (error: unknown) => error instanceof VoiceError
  ? { code: error.code, message: error.message, retryAfter: error.retryAfter }
  : { code: "synthesis_failed", message: "Speech generation failed." };

/** A safety bound for one section (real durations are measured from the audio). */
const sectionLimitSeconds = (s: VoiceSection) => Math.min(voiceLimits().maxSeconds, Math.max(20, Math.ceil(s.words * 0.8) + 12));

async function loadAudio(ownerId: string, id: string): Promise<Buffer> {
  const row = await q1<{ data: unknown }>("SELECT data FROM images WHERE id = $1 AND owner_id = $2", [id, ownerId]);
  if (!row) throw new VoiceError(404, "assembly_failed", "A section's audio is missing. Regenerate that section.");
  return toBuffer(row.data);
}

async function deleteAudio(ownerId: string, ids: (string | undefined)[], keep: VoiceProduction) {
  const inUse = new Set([keep.audioId, ...keep.sections.map(s => s.audioId)]);
  for (const id of new Set(ids)) {
    if (id && !inUse.has(id)) await q("DELETE FROM images WHERE id = $1 AND owner_id = $2", [id, ownerId]).catch(() => {});
  }
}

export async function runProduction(o: ProductionOptions): Promise<ProductionResult> {
  const p = o.production;
  const started = Date.now();
  const engines = o.engines ?? voiceEngines();
  const count = p.sections.length;
  const targets = p.sections.filter(s => (o.only ? o.only.includes(s.index) : s.status !== "ready" || !s.audioId));
  const report = (phase: VoiceProgress["phase"], message?: string) => {
    const ready = p.sections.filter(s => s.status === "ready").length;
    const seconds = p.sections.reduce((sum, s) => sum + (s.seconds || 0), 0);
    o.onProgress?.({ phase, completed: ready, total: count, seconds, message, production: productionSnapshot(p) });
  };
  for (const s of targets) { s.error = undefined; s.status = "pending"; s.linesDone = undefined; s.linesTotal = undefined; }
  p.error = undefined;
  p.stage = o.keepDirection ? "synthesizing" : "directing";
  report(o.keepDirection ? "synthesizing" : "preparing");

  const words = p.sections.reduce((sum, s) => sum + s.words, 0);
  // Measured CPU speed is about realtime; give long stories room, up to the policy's hard cap.
  const longJobMs = Math.ceil(words * 0.4 * 2.2 * 1000) + 120_000;
  let stale: (string | undefined)[] = [];

  try {
    await withVoiceBudget(o.ownerId, o.signal, async signal => {
      // Each section's synthesis waits for that section's direction, never for later ones.
      const directed = new Map<number, { done: Promise<void>; finish: () => void }>();
      for (const s of targets) {
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; });
        directed.set(s.index, { done, finish });
      }
      const directStart = Date.now();
      let directorDown = false;
      const directAll = (async () => {
        for (const s of targets) {
          try {
            if (o.keepDirection) continue;
            signal.throwIfAborted();
            s.status = "directing";
            report("preparing");
            const previous = p.sections[s.index - 1]?.direction;
            // Once no model is available, the rest of the story uses the neutral profile right
            // away: it shouldn't spend rate limit or hold up the recording.
            const result: SectionDirectResult = directorDown
              ? { parsed: null, attempts: 0, ms: 0, note: "No director model was available" }
              : await directSection(s.text, s.direction, {
                previous: previous?.emotion ? previous : undefined, cast: p.cast, position: { index: s.index, count },
                request: o.request, mood: o.mood, provider: o.provider, signal, ask: o.ask,
              });
            if (/timed out|No director/.test(result.note || "")) directorDown = true;
            s.directorAttempts += result.attempts;
            s.directorMs = result.ms;
            s.directorModel = result.model;
            s.directorNote = result.note;
            if (result.parsed) {
              s.direction = { ...result.parsed.direction, pauseAfterMs: s.index === count - 1 ? 0 : result.parsed.direction.pauseAfterMs };
              s.cues = result.parsed.cues;
              s.directionSource = "director";
              p.cast = mergeCast(p.cast, result.parsed.cast);
            } else if (s.directionSource !== "edited") {
              s.directionSource = "neutral"; // The narration is still performed, plainly.
            }
            s.status = "queued";
            report("preparing");
          } finally {
            directed.get(s.index)!.finish();
          }
        }
        p.directingMs = (p.directingMs || 0) + (Date.now() - directStart);
      })().finally(() => { for (const entry of directed.values()) entry.finish(); });
      directAll.catch(() => {});

      const synthStart = Date.now();
      let usable = engines;
      if (p.engine) {
        usable = engines.filter(e => e.id === p.engine); // One voice for the whole recording.
        if (!usable.length) throw new VoiceError(503, "engine_unavailable", `The ${p.engine} voice engine that recorded this story isn't available now.`);
      }
      for (const s of targets) {
        signal.throwIfAborted();
        await directed.get(s.index)!.done;
        signal.throwIfAborted();
        p.stage = "synthesizing";
        s.status = "synthesizing";
        report("synthesizing");
        const limit = sectionLimitSeconds(s);
        const sectionStart = Date.now();
        for (let attempt = 0; attempt < 2; attempt++) {
          s.synthesisAttempts++;
          try {
            const got = await renderWithEngines({
              text: s.text, plan: sectionPlan(s, p.cast), ownerId: o.ownerId, durationSeconds: limit, emotion: s.direction.emotion || o.mood, personality: o.personality, signal,
              onProgress: e => {
                if (e.phase !== "synthesizing" || !e.total) return;
                s.linesDone = e.completed;
                s.linesTotal = e.total;
                report("synthesizing");
              },
            }, limit, usable, signal);
            const audioId = await saveAudio(o.ownerId, got.mime, got.audio);
            stale.push(s.audioId);
            Object.assign(s, { audioId, seconds: got.seconds, synthesisMs: Date.now() - sectionStart, status: "ready", error: undefined });
            p.engine = got.engine;
            p.voice = got.voice;
            p.engineModel = got.model;
            usable = usable.filter(e => e.id === got.engine);
            break;
          } catch (error) {
            if (signal.aborted) throw error;
            const permanent = error instanceof VoiceError && [413, 422, 429].includes(error.status);
            if (!permanent && attempt === 0) { console.warn(`[voice] Section ${s.index + 1} synthesis failed; retrying once`); continue; }
            s.error = failureOf(error).message;
            s.synthesisMs = Date.now() - sectionStart;
            // A failed regeneration keeps the take that already worked.
            s.status = s.audioId ? "ready" : "failed";
            if (error instanceof VoiceError && error.status === 429) throw error;
            break;
          }
        }
        report("synthesizing");
      }
      p.synthesisMs = (p.synthesisMs || 0) + (Date.now() - synthStart);
      await directAll.catch(() => {});

      const failed = p.sections.filter(s => s.status !== "ready" || !s.audioId);
      if (failed.length) {
        throw new VoiceError(502, "sections_failed", `${failed.length} of ${count} sections couldn't be recorded (section ${failed.map(s => s.index + 1).join(", ")}). The others are saved, so you can retry just those.`);
      }
      p.stage = "assembling";
      report("assembling");
      const assembleStart = Date.now();
      const audio = await Promise.all(p.sections.map(s => loadAudio(o.ownerId, s.audioId!)));
      const joined = joinWavs(audio.map((a, i) => ({ audio: a, pauseAfterMs: p.sections[i].direction.pauseAfterMs })));
      p.sections.forEach((s, i) => { s.startSeconds = joined.starts[i]; });
      stale.push(p.audioId);
      p.audioId = count === 1 ? p.sections[0].audioId : await saveAudio(o.ownerId, "audio/wav", joined.audio);
      p.seconds = joined.seconds;
      p.assemblingMs = Date.now() - assembleStart;
    }, longJobMs);

    await deleteAudio(o.ownerId, stale, p);
    stale = [];
    p.stage = "completed";
    p.totalMs = (p.writer?.ms || 0) + (p.totalMs && o.only ? p.totalMs : 0) + (Date.now() - started);
    report("ready");
    const directed = p.sections.some(s => s.directionSource !== "neutral");
    return {
      production: p,
      voice: {
        audioId: p.audioId!, mime: "audio/wav", engine: p.engine as VoiceMeta["engine"], voice: p.voice || "Senko",
        seconds: p.seconds, segments: count, model: p.engineModel, emotion: o.mood || undefined, performance: directed ? "director" : "neutral",
      },
    };
  } catch (error) {
    await deleteAudio(o.ownerId, stale, p);
    const failure = failureOf(error);
    for (const s of p.sections) {
      if (s.status === "directing" || s.status === "queued" || s.status === "synthesizing" || s.status === "pending") s.status = s.audioId ? "ready" : "failed";
    }
    p.stage = "failed";
    p.error = failure.message;
    report("error", failure.message);
    return { production: p, failure };
  }
}
