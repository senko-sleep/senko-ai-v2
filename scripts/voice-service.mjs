import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(root, ".env.local")); } catch { /* optional */ }

/** One gateway can serve a local model or distribute requests across model replicas. */
export function createVoiceService({ config, synthesize, fetchImpl = fetch }) {
  let active = 0;
  let cursor = 0;
  const workers = config.workers || [];
  const limit = Math.max(1, Math.min(64, Number(config.maxConcurrent) || 2));
  const timeoutMs = Math.max(100, Math.min(300_000, Number(config.timeoutMs) || 80_000));
  return http.createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (config.token && req.headers.authorization !== `Bearer ${config.token}`) return json(401, { error: "Unauthorized" });
    if (req.url === "/health" && req.method === "GET") return json(200, {
      status: synthesize || workers.length ? "configured" : "awaiting_model",
      voice: "senko-v1", localModelLoaded: !!synthesize, workers: workers.length, active, maxConcurrent: limit,
    });
    if (req.url !== "/synthesize" || req.method !== "POST") return json(404, { error: "Not found" });
    if (!synthesize && !workers.length) return json(503, { error: "Senko's voice service is connected. Add her trained model module or cloud workers to .data/voice/config.json to generate speech." });
    if (active >= limit) {
      res.setHeader("Retry-After", "2");
      return json(503, { error: "All voice slots are busy. Please retry shortly." });
    }
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 131_072) return json(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return json(400, { error: "Invalid JSON" }); }
      if (!input || typeof input.text !== "string" || !input.text.trim() || input.text.length > 15000) return json(400, { error: "text must contain 1–15000 characters" });
      if (input.voice !== "senko-v1") return json(400, { error: "Unknown voice identity" });
      let result;
      if (synthesize) {
        // Model adapters receive a cancellation signal and the original personality/mood.
        result = await Promise.race([
          synthesize(input, { signal: controller.signal }),
          new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Voice synthesis timed out or was cancelled")), { once: true })),
        ]);
      } else {
        const start = cursor++ % workers.length;
        for (let i = 0; i < workers.length; i++) {
          const worker = workers[(start + i) % workers.length];
          try {
            const upstream = await fetchImpl(worker.url, {
              method: "POST", signal: controller.signal,
              headers: { "Content-Type": "application/json", ...(worker.token ? { Authorization: `Bearer ${worker.token}` } : {}) },
              body: JSON.stringify(input),
            });
            if (!upstream.ok) { await upstream.body?.cancel(); throw new Error("Worker unavailable"); }
            if (!/^audio\//i.test(upstream.headers.get("content-type") || "")) { await upstream.body?.cancel(); throw new Error("Worker returned non-audio data"); }
            const reader = upstream.body.getReader();
            const parts = [];
            let size = 0;
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new Error("Audio too large"); }
              parts.push(value);
            }
            result = { audio: Buffer.concat(parts), mime: upstream.headers.get("content-type"), seconds: Number(upstream.headers.get("x-audio-duration")) };
            if (result.audio.length < 200) throw new Error("Empty audio");
            break;
          } catch { if (controller.signal.aborted) break; }
        }
      }
      if (!result || !result.audio || result.audio.length < 200 || result.audio.length > 12 * 1024 * 1024 || !/^audio\/[a-z0-9.+-]+(?:;[^\r\n]*)?$/i.test(result.mime)) throw new Error("No model worker returned valid audio");
      if (controller.signal.aborted) throw new Error("Voice synthesis timed out or was cancelled");
      const headers = { "Content-Type": result.mime, "Cache-Control": "no-store" };
      if (Number.isFinite(result.seconds) && result.seconds > 0) headers["X-Audio-Duration"] = String(result.seconds);
      res.writeHead(200, headers);
      res.end(result.audio);
    } catch (error) {
      if (!res.destroyed) json(503, { error: error instanceof Error ? error.message : "Voice synthesis failed" });
    } finally { clearTimeout(timer); active--; }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const storage = path.resolve(process.env.SENKO_VOICE_STORAGE || path.join(root, ".data/voice"));
  const config = JSON.parse(await readFile(path.join(storage, "config.json"), "utf8").catch(() => '{"workers":[]}'));
  const token = process.env.SENKO_VOICE_TOKEN || config.token;
  const host = process.env.SENKO_VOICE_HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !token) throw new Error("Set SENKO_VOICE_TOKEN before exposing the voice service outside localhost");
  let synthesize;
  if (config.modelModule) {
    const model = await import(pathToFileURL(path.resolve(storage, config.modelModule)).href);
    if (typeof model.synthesize !== "function") throw new Error("Model module must export synthesize(input, { signal })");
    synthesize = model.synthesize;
  }
  createVoiceService({ config: { ...config, token }, synthesize }).listen(Number(process.env.SENKO_VOICE_PORT) || 7861, host, () => {
    console.log(`[voice] Listening on ${host}:${process.env.SENKO_VOICE_PORT || 7861}; ${synthesize ? "local model loaded" : config.workers?.length ? "cloud workers configured" : "waiting for original model"}`);
  });
}
