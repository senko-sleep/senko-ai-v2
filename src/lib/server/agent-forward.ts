// Wasmer's Next bundle does not run src/proxy.ts, so browser endpoints also
// forward here at the route level. The upstream keeps the real Playwright
// session, its SSE frames, cursor events, and user input on one agent host:
//   AGENT_HOST=sandbox   -> the Vercel Sandbox "agent computer" (needs VERCEL_TOKEN/TEAM/PROJECT off Vercel)
//   AGENT_BACKEND_URL    -> another deploy that runs Chromium (e.g. the Docker image)
const BROWSER_PATH = /^\/api\/(chats\/[^/]+\/agent(?:\/.*)?|sessions\/.*)$/;

async function upstreamBase(pathname: string): Promise<string | Response | null> {
  // /api/agent-host itself runs here: it boots the sandbox. Everything that drives the browser goes to it.
  if (process.env.AGENT_HOST === "sandbox") {
    if (!BROWSER_PATH.test(pathname)) return null;
    const { currentHost } = await import("./agent-host");
    const host = await currentHost().catch(() => null);
    if (!host) return Response.json({ error: "The agent computer is asleep. Starting it…", needsHost: true }, { status: 503, headers: { "Retry-After": "2" } });
    return host.url;
  }
  const backend = process.env.AGENT_BACKEND_URL?.trim().replace(/\/+$/, "");
  if (!backend) return null;
  if (!/^\/api\/agent-host$/.test(pathname) && !BROWSER_PATH.test(pathname)) return null;
  return backend;
}

export async function forwardAgentRequest(req: Request): Promise<Response | null> {
  const incoming = new URL(req.url);
  const base = await upstreamBase(incoming.pathname);
  if (!base) return null;
  if (typeof base !== "string") return base;
  const target = new URL(incoming.pathname + incoming.search, base);
  if (target.origin === incoming.origin) return null;
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    cache: "no-store",
    redirect: "manual",
    signal: req.signal,
  });
  const responseHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    // Hop-by-hop and upstream-specific headers would confuse this server's own response
    // (a copied "transfer-encoding: chunked" makes Wasmer send an empty body).
    if (/^(content-encoding|content-length|transfer-encoding|connection|keep-alive|server|date|x-vercel-.*|strict-transport-security)$/i.test(k)) continue;
    responseHeaders.append(k, v);
  }
  const type = upstream.headers.get("content-type") || "";
  if (!/event-stream/i.test(type) || !upstream.body) {
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  }
  // SSE (agent events, live-view frames): re-stream chunk by chunk so it stays live.
  const reader = upstream.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  responseHeaders.set("cache-control", "no-cache, no-store");
  responseHeaders.set("x-accel-buffering", "no");
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
