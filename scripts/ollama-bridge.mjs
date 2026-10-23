// Ollama bridge: lets the hosted app use the Ollama on THIS computer, free and uncapped.
//
//   node scripts/ollama-bridge.mjs            (reads OLLAMA_BRIDGE_KEY from env or .env.local)
//
// It listens on http://localhost:11435, rejects any request without
// "Authorization: Bearer <OLLAMA_BRIDGE_KEY>", and forwards the rest to Ollama at
// http://127.0.0.1:11434. Expose port 11435 with a free tunnel, e.g.
//   tailscale funnel 11435                        (stable https URL)
//   cloudflared tunnel --url http://localhost:11435   (URL changes each run)
// then set on Render: OLLAMA_URL=<tunnel URL>  OLLAMA_API_KEY=<same key>.
// When this computer is off, the app quietly falls back to the cloud models.
import http from "node:http";
import { readFileSync } from "node:fs";

function fromEnvFile(name) {
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const KEY = process.env.OLLAMA_BRIDGE_KEY || fromEnvFile("OLLAMA_BRIDGE_KEY");
const PORT = Number(process.env.OLLAMA_BRIDGE_PORT || 11435);
const TARGET = (process.env.OLLAMA_LOCAL_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

if (!KEY || KEY.length < 16) {
  console.error("Set OLLAMA_BRIDGE_KEY (16+ random characters) in .env.local or the environment first.");
  process.exit(1);
}

function authorized(req) {
  const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (given.length !== KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ KEY.charCodeAt(i);
  return diff === 0;
}

const ALLOWED = /^\/api\/(chat|generate|tags|show|version|ps)$/;

http
  .createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (!authorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"unauthorized"}');
      return;
    }
    // Only the read/chat endpoints: nobody can pull, delete or copy models through the bridge.
    if (!ALLOWED.test(path)) {
      res.writeHead(403, { "Content-Type": "application/json" }).end('{"error":"endpoint not allowed through the bridge"}');
      return;
    }
    const headers = { ...req.headers, host: new URL(TARGET).host };
    delete headers.authorization;
    delete headers.origin;
    const upstream = http.request(`${TARGET}${req.url}`, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Ollama isn't running on this computer (${e.message})` }));
    });
    req.pipe(upstream);
    res.on("close", () => upstream.destroy());
  })
  .listen(PORT, () => {
    console.log(`Ollama bridge on http://localhost:${PORT} -> ${TARGET} (key required)`);
  });
