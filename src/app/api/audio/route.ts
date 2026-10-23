import { audioAvailable, audioStream } from "@/lib/agent/audio";
import { HttpError, route } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET -> live MP3 of the agent browser's sound (Docker image only).
export const GET = route(async (req) => {
  if (!audioAvailable()) throw new HttpError(404, "Live audio is only available on the server (Docker image with PulseAudio).");
  return new Response(audioStream(req.signal), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no" },
  });
});
