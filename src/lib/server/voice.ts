// Voice messages: spoken replies stored with the actual voice identity on each message.
//
// Default: Senko's authored synthetic bank. Other engines require explicit selection.
//   senko       Versioned warm/bright/airy formant design; not a neural training claim.
//   custom      Senko's own voice model, served by you over HTTP (SENKO_VOICE_URL). It gets the
//               text, her mood, her personality and the voice profile (voice/senko/profile.json).
//               The contract it has to meet is in voice/senko/README.md.
//   windows     Installed English system speech; never labeled as Senko's trained voice.
//   elevenlabs  The ElevenLabs "Senko" preset (ELEVENLABS_API_KEY): a stand-in voice until the
//               custom model is up. Every message says which engine voiced it.
// Nothing is faked: with no engine configured, or every engine failing, the reply says so.
import { windowsSpeech } from "../../../scripts/windows-voice.mjs";
import { senkoSpeech } from "../../../scripts/senko-voice.mjs";
import voicebank from "../../../voice/senko/voicebank.json";
import { validateVoiceInput, withVoiceBudget, VoiceError, voiceLimits } from "./voice-policy";
import { verifyVoiceAudio } from "./voice-audio";
import { VOICE_PRESETS } from "@/lib/voice-synth";
import profile from "../../../voice/senko/profile.json";
import { HttpError } from "./identity";
import { newId, q } from "./db";

export type VoiceEngineId = "senko" | "custom" | "elevenlabs" | "windows";

export interface VoiceMeta {
  /** /api/uploads/<audioId> serves the audio. */
  audioId: string;
  mime: string;
  engine: VoiceEngineId;
  /** Shown on the player: "Senko" or "Senko (stand-in voice)". */
  voice: string;
  /** The mood Senko was in (her status tag), passed to the engine as the emotion. */
  emotion?: string;
  /** Length in seconds when the engine reports it. */
  seconds?: number;
  model?: string;
  modelKind?: "authored-formant-voicebank";
  modelFingerprint?: string;
}

export interface SynthRequest {
  text: string;
  ownerId: string;
  durationSeconds?: number;
  emotion?: string;
  /** Senko's personality prompt (the user's custom one when set), for the custom model. */
  personality?: string;
  signal?: AbortSignal;
}

export interface SynthResult {
  audio: Buffer;
  mime: string;
  engine: VoiceEngineId;
  voice: string;
  seconds?: number;
  model?: string;
  modelKind?: "authored-formant-voicebank";
  modelFingerprint?: string;
}

export interface VoiceEngine {
  id: VoiceEngineId;
  /** Configured on this server (env present). */
  available: () => boolean;
  synthesize: (r: SynthRequest) => Promise<SynthResult>;
}

export const VOICE_PROFILE = profile;
/** The longest text one voice message speaks (about two minutes). */
export const MAX_SPEECH_CHARS = 1500;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const AUDIO_MIME = /^audio\/(?:mpeg|mp3|wav|x-wav|wave|ogg|opus|webm|mp4|aac|flac|x-flac)$/i;

// ── Text that can be heard ──────────────────────────────────────────────────

const KAOMOJI = /(?:[=:;xX]?[(（][^()（）\n]{0,8}[)）]|[=^>][wWoO.,_-]?[=^<]|>\/\/\/<|;[wW];|(?<![\w])[;:=][wW3pPdD](?![\w])|\bXD\b|\b[xX]3\b)/g;

/** A markdown chat reply as plain sentences to speak: no code, cards, links, tags or emoji. */
export function speechText(markdown: string): string {
  const t = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ") // code and ui blocks can't be heard
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[\[[^\]\n]*\]\]/g, " ") // action tags
    .replace(/\[(?:MEMORY|STATUS):[^\]\n]*\]/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1") // links -> their words
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, " ")
    .replace(KAOMOJI, " ")
    .replace(/~+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,!?])/g, "$1")
    .replace(/\s*\n+\s*/g, "\n")
    .trim();
  return t;
}

// ── Engines ─────────────────────────────────────────────────────────────────

function mimeOf(contentType: string | null, fallback: string): string {
  const m = (contentType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_MIME.test(m) ? (m === "audio/mp3" ? "audio/mpeg" : m) : fallback;
}

async function readAudio(res: Response, fallbackMime: string): Promise<{ audio: Buffer; mime: string }> {
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (type && !AUDIO_MIME.test(type) && !/octet-stream/i.test(type)) throw new Error(`the engine answered ${type}, not audio`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new VoiceError(502, "malformed_audio", "The speech engine returned no audio.");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new VoiceError(502, "malformed_audio", "The speech engine returned too much audio."); }
    chunks.push(value);
  }
  const audio = Buffer.concat(chunks);
  if (audio.length < 44) throw new VoiceError(502, "malformed_audio", "The speech engine returned empty audio.");
  return { audio, mime: mimeOf(type, fallbackMime) };
}

async function errorText(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { error?: unknown; detail?: unknown };
    const d = j.error ?? (typeof j.detail === "object" && j.detail ? (j.detail as { message?: string }).message : j.detail);
    if (d) return `HTTP ${res.status}: ${String(d).slice(0, 200)}`;
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`;
}

/** Senko's own model. Contract: voice/senko/README.md. */
export const customEngine: VoiceEngine = {
  id: "custom",
  available: () => !!process.env.SENKO_VOICE_URL?.trim(),
  async synthesize({ text, emotion, personality, signal, durationSeconds }) {
    const url = process.env.SENKO_VOICE_URL!.trim();
    const token = process.env.SENKO_VOICE_TOKEN || process.env.SENKO_VOICE_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "audio/mpeg, audio/wav, audio/ogg" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const timeout = AbortSignal.timeout(Math.min(voiceLimits().timeoutMs, Number(process.env.SENKO_VOICE_ENGINE_TIMEOUT_MS) || 15_000));
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({
        text,
        voice: profile.id,
        mood: emotion || "neutral",
        personality: personality || undefined,
        profile,
        format: "mp3",
        speed: 1,
        durationSeconds: durationSeconds ?? voiceLimits().defaultSeconds,
      }),
    });
    if (!res.ok) {
      console.warn("[voice] Custom engine rejected synthesis", await errorText(res));
      throw new VoiceError(res.status === 429 ? 429 : 503, "model_unavailable", "The custom voice model is unavailable.", res.status === 429 ? 60 : undefined);
    }
    const { audio, mime } = await readAudio(res, "audio/mpeg");
    const secs = Number(res.headers.get("x-audio-duration"));
    return { audio, mime, engine: "custom", voice: profile.name, seconds: Number.isFinite(secs) && secs > 0 ? secs : undefined };
  },
};

/** How a mood leans the stand-in voice: more expressive when excited or dramatic, steadier when calm. */
export function elevenSettings(emotion?: string) {
  const p = VOICE_PRESETS.senko;
  const m = (emotion || "").toLowerCase();
  const lively = /hyp|excit|happy|playful|giddy|sass|dramatic|chaotic|silly|proud|smug/.test(m);
  const calm = /sleep|eepy|tired|calm|soft|sad|cozy|chill|gentle|serious/.test(m);
  return {
    stability: lively ? Math.max(0.2, p.stability - 0.1) : calm ? Math.min(0.7, p.stability + 0.2) : p.stability,
    similarity_boost: p.similarityBoost,
    style: lively ? Math.min(0.5, p.style + 0.2) : calm ? 0 : p.style,
    use_speaker_boost: true,
  };
}

/** The ElevenLabs "Senko" preset: a stand-in until the custom model is served. */
export const elevenLabsEngine: VoiceEngine = {
  id: "elevenlabs",
  available: () => !!process.env.ELEVENLABS_API_KEY?.trim(),
  async synthesize({ text, emotion, signal }) {
    const timeout = AbortSignal.timeout(45_000);
    const voiceId = process.env.SENKO_VOICE_ID || VOICE_PRESETS.senko.voiceId;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!.trim(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: elevenSettings(emotion) }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${await errorText(res)}`);
    const { audio, mime } = await readAudio(res, "audio/mpeg");
    return { audio, mime, engine: "elevenlabs", voice: `${profile.name} (stand-in voice)` };
  },
};

export const windowsEngine: VoiceEngine = {
  id: "windows",
  available: () => process.platform === "win32" && process.env.SENKO_VOICE_WINDOWS !== "0",
  async synthesize({ text, signal }) {
    try { return { ...await windowsSpeech(text, signal), engine: "windows" }; }
    catch (error) {
      console.warn("[voice] System speech failed", error instanceof Error ? error.message : "unknown");
      throw new VoiceError(503, "engine_unavailable", "The local speech engine could not generate audio.");
    }
  },
};

/** An authored acoustic voicebank; no Zira audio, cloned speaker or neural training claim. */
export const senkoEngine: VoiceEngine = {
  id: "senko",
  available: () => true,
  async synthesize({ text, emotion, durationSeconds, signal }) {
    try {
      const result = await senkoSpeech({ text, emotion, bank: voicebank, maxSeconds: durationSeconds ?? voiceLimits().defaultSeconds, signal });
      return { audio: result.audio, mime: result.mime, seconds: result.seconds, engine: "senko", voice: result.voice, model: result.model, modelKind: "authored-formant-voicebank", modelFingerprint: result.fingerprint };
    } catch (error) {
      console.warn("[voice] Senko synthesis failed", error instanceof Error ? error.message : "unknown");
      if (error instanceof Error && /duration limit/.test(error.message)) throw new VoiceError(422, "duration_limit", "Senko's speech exceeds the selected duration. Ask for a shorter message.");
      throw new VoiceError(503, "synthesis_failed", "Senko's voice could not generate this message.");
    }
  },
};

export function voiceEngines(all: VoiceEngine[] = [senkoEngine, customEngine, windowsEngine, elevenLabsEngine]): VoiceEngine[] {
  const pick = (process.env.SENKO_VOICE_ENGINE || "senko").trim().toLowerCase();
  const fallback = process.env.SENKO_VOICE_FALLBACK || "windows";
  const ids = pick === "auto" ? ["senko", "custom", fallback, "elevenlabs"] : pick === "custom" ? ["custom", fallback] : [pick];
  return ids.flatMap(id => all.filter(e => e.id === id && e.available())).filter((e, i, list) => list.indexOf(e) === i);
}

/** All entry points share input checks, persistent quotas, leases, and decoded audio validation. */
export async function synthesizeVoice(r: SynthRequest, engines = voiceEngines()): Promise<SynthResult> {
  const seconds = validateVoiceInput(r.text, r.durationSeconds);
  if (!r.ownerId) throw new VoiceError(401, "unauthorized", "A signed-in device is required for voice generation.");
  return withVoiceBudget(r.ownerId, r.signal, async signal => {
    if (!engines.length) throw new VoiceError(503, "engine_unavailable", "No compatible speech engine is available on this server.");
    let last: unknown;
    for (const engine of engines) {
      signal.throwIfAborted();
      try {
        const result = await engine.synthesize({ ...r, signal });
        const verified = await verifyVoiceAudio(result.audio, seconds, signal);
        return { ...result, ...verified };
      } catch (error) {
        last = error;
        if (signal.aborted || error instanceof VoiceError && [422, 429].includes(error.status)) throw error;
        console.warn(`[voice] ${engine.id} generation failed`, error instanceof Error ? error.message : "unknown");
      }
    }
    if (last instanceof VoiceError) throw last;
    throw new VoiceError(502, "synthesis_failed", "Speech generation failed. Please try again later.");
  });
}

/** Store audio in the uploads table; /api/uploads/<id> serves it (with Range for seeking). */
export async function saveAudio(ownerId: string, mime: string, data: Buffer): Promise<string> {
  if (!AUDIO_MIME.test(mime)) throw new HttpError(415, `Unsupported audio type ${mime}.`);
  if (data.length > MAX_AUDIO_BYTES) throw new HttpError(413, "Audio is larger than 12 MB.");
  const id = newId("a_");
  await q("INSERT INTO images (id, owner_id, mime, data) VALUES ($1, $2, $3, $4)", [id, ownerId, mime, data]);
  return id;
}
