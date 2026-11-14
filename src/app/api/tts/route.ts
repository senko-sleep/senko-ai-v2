import { HttpError, route } from "@/lib/server/identity";
import { personalityFor } from "@/lib/server/persona";
import { speechText, synthesizeVoice } from "@/lib/server/voice";
import { voiceLimits, VoiceError } from "@/lib/server/voice-policy";

export const runtime = "nodejs";
export const GET = route(async () => Response.json({ limits: voiceLimits() }));
export const POST = route(async (req, who) => {
  const reader = req.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new HttpError(413, "Voice request is too large."); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  let body;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, "Invalid voice request JSON."); }
  if (!body || typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text is required");
  if (body.emotion !== undefined && (typeof body.emotion !== "string" || !["neutral", "soft", "excited", "sleepy", "sassy"].includes(body.emotion))) throw new HttpError(400, "Choose a supported voice mood: neutral, soft, excited, sleepy or sassy.");
  if (body.text.length > voiceLimits().maxChars) throw new VoiceError(413, "text_limit", `Voice text must be at most ${voiceLimits().maxChars} characters.`);
  try {
    const result = await synthesizeVoice({ text: speechText(body.text), ownerId: who.ownerId, durationSeconds: body.durationSeconds, emotion: body.emotion, personality: await personalityFor(who.ownerId), signal: req.signal });
    return new Response(new Uint8Array(result.audio), {
      headers: { "Content-Type": result.mime, "Cache-Control": "no-store", "X-Voice-Engine": result.engine, "X-Voice-Name": result.voice, "X-Audio-Duration": String(result.seconds), ...(result.model ? { "X-Voice-Model": result.model, "X-Voice-Model-Kind": result.modelKind || "", "X-Voice-Fingerprint": result.modelFingerprint || "" } : {}) },
    });
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    throw new HttpError(503, error instanceof Error ? error.message : "Voice synthesis unavailable");
  }
});
