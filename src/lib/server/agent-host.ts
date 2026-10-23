// Runs the browser agent on Vercel. Vercel functions can't run Chrome, so when
// AGENT_HOST=sandbox the agent server (this same app) runs inside a Vercel Sandbox
// microVM, started on demand from a prepared snapshot (scripts/agent-host-snapshot.mjs).
// Agent and live-view requests are forwarded to it by src/proxy.ts.
//
// Hobby plans cap a sandbox at 45 minutes, so a fresh one replaces it shortly before it
// expires. Browser sessions are saved in the database and restore on the new host.
import { q, q1 } from "./db";

export const SNAPSHOT_KEY = "agent_host.snapshot";
const CURRENT_KEY = "agent_host.current";
const LOCK_KEY = "agent_host.lock";

export interface AgentHost {
  name: string;
  url: string;
  snapshotId: string;
  expiresAt: number;
  region?: string;
}

export function sandboxMode(): boolean {
  return process.env.AGENT_HOST === "sandbox";
}

/** Vercel region the agent computer runs in. Sites see the browser as being there (state laws, geoblocks). */
export const HOST_REGION = () => (process.env.AGENT_HOST_REGION || "iad1").trim();
const LIFETIME_MS =() => Math.max(5, Number(process.env.AGENT_HOST_TIMEOUT_MIN || 45)) * 60_000;
/** Replace the host when it has less than this left, so tasks don't die mid-way. */
const RENEW_BEFORE_MS = 6 * 60_000;
const APP_DIR = "/vercel/sandbox/app";
const PORT = 3000;

async function kvGet<T>(key: string): Promise<T | null> {
  const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown) {
  await q(
    "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [key, JSON.stringify(value)]
  );
}

/** Lease-style lock in the database so only one function instance boots a host at a time. */
async function tryLock(owner: string): Promise<boolean> {
  const rows = await q<{ key: string }>(
    `INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_kv.updated_at < now() - interval '150 seconds'
     RETURNING key`,
    [LOCK_KEY, JSON.stringify(owner)]
  );
  return rows.length > 0;
}

async function unlock(owner: string) {
  await q("DELETE FROM app_kv WHERE key = $1 AND value = $2", [LOCK_KEY, JSON.stringify(owner)]);
}

// Function instances cache the host briefly so proxy.ts doesn't hit the database per request.
const g = globalThis as unknown as { __agentHost?: { host: AgentHost | null; at: number } };

/** The current host, if one is running (no health check, no boot). Used by the proxy. */
export async function currentHost(): Promise<AgentHost | null> {
  const c = g.__agentHost;
  if (c && Date.now() - c.at < 15_000) return c.host && c.host.expiresAt > Date.now() ? c.host : null;
  const host = await kvGet<AgentHost>(CURRENT_KEY).catch(() => null);
  g.__agentHost = { host, at: Date.now() };
  return host && host.expiresAt > Date.now() ? host : null;
}

async function healthy(url: string, ms = 3000): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

/** Env vars the agent server needs. Vercel-specific and routing vars stay behind. */
function hostEnv(): Record<string, string> {
  const out: Record<string, string> = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(PORT),
    PLAYWRIGHT_BROWSERS_PATH: "/vercel/sandbox/ms-playwright",
    // Lets /api/sessions/:id/live hand out direct live-view links to this machine.
    AGENT_COMPUTER: "1",
  };
  const keep = /^(DATABASE_URL|APP_ACCESS_KEY|APP_PASSWORD|SESSION_SECRET|LLM_[A-Z_]+|AGENT_(?!HOST|BACKEND)[A-Z_]+|LIVE_[A-Z_]+|SCREEN_[A-Z_]+|SEARCH_API_URL|WALLHAVEN_API_KEY|[A-Z]+_API_KEY|[A-Z]+_MODEL|[A-Z]+_VISION_MODEL|[A-Z]+_TOKEN_BUDGET|SENKO_LLM_URL|SENKO_LLM_KEY|BROWSER_PROXY_URL|OLLAMA_URL|OLLAMA_API_KEY)$/;
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || !keep.test(k)) continue;
    if (/_URL$/.test(k) && k !== "DATABASE_URL" && /localhost|127\.0\.0\.1/.test(v)) continue;
    out[k] = v;
  }
  // On Wasmer, DATABASE_URL may be Wasmer's own internal database; the sandbox needs the shared Neon one.
  if (process.env.WASMER_APP_ID) {
    const shared = process.env.SENKO_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
    if (shared) out.DATABASE_URL = shared;
  }
  return out;
}

async function sdk() {
  return import("@vercel/sandbox");
}

/**
 * On Vercel the SDK signs in by itself (OIDC). Anywhere else (e.g. Prisma Compute),
 * set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.
 */
function creds(): { token: string; teamId: string; projectId: string } | Record<string, never> {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

async function boot(snapshotId: string, onStatus?: (text: string) => void): Promise<AgentHost> {
  const { Sandbox } = await sdk();
  const name = `senko-agent-${Date.now().toString(36)}`;
  onStatus?.("Starting the agent computer…");
  const sb = await Sandbox.create({
    ...creds(),
    name,
    region: HOST_REGION() as never,
    source: { type: "snapshot", snapshotId },
    resources: { vcpus: Math.max(1, Number(process.env.AGENT_HOST_VCPUS || 2)) },
    timeout: LIFETIME_MS(),
    ports: [PORT],
    env: hostEnv(),
  });
  const url = sb.domain(PORT).replace(/\/$/, "");
  await sb.runCommand({
    cmd: "sh",
    args: ["-c", `cd ${APP_DIR} && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT} > /tmp/next.log 2>&1`],
    detached: true,
  });
  onStatus?.("Starting the browser…");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await healthy(url, 2000))) await new Promise((r) => setTimeout(r, 700));
  if (!(await healthy(url))) {
    const log = await sb.readFileToBuffer({ path: "/tmp/next.log" }).catch(() => null);
    await sb.stop().catch(() => {});
    throw new Error(`The agent computer didn't start.${log ? `\n${log.toString("utf8").slice(-800)}` : ""}`);
  }
  return { name, url, snapshotId, region: HOST_REGION(), expiresAt: Date.now() + LIFETIME_MS() - 30_000 };
}

async function stopHost(name: string) {
  try {
    const { Sandbox } = await sdk();
    const sb = await Sandbox.get({ ...creds(), name });
    await sb.stop();
  } catch {
    /* already gone */
  }
}

/**
 * Make sure an agent host is running and has time left; boots one if needed.
 * Safe to call from many requests at once (one boots, the rest wait for it).
 */
export async function ensureHost(onStatus?: (text: string) => void): Promise<AgentHost> {
  const snap = await kvGet<{ snapshotId: string }>(SNAPSHOT_KEY);
  if (!snap?.snapshotId) {
    throw new Error("The agent computer isn't set up yet. Run `node scripts/agent-host-snapshot.mjs` once (see SETUP.md).");
  }
  const deadline = Date.now() + 150_000;
  const owner = Math.random().toString(36).slice(2);
  while (Date.now() < deadline) {
    const cur = await kvGet<AgentHost>(CURRENT_KEY);
    const fresh = cur && cur.snapshotId === snap.snapshotId && (cur.region || "iad1") === HOST_REGION() && cur.expiresAt - Date.now() > RENEW_BEFORE_MS;
    if (cur && fresh && (await healthy(cur.url))) {
      g.__agentHost = { host: cur, at: Date.now() };
      return cur;
    }
    if (await tryLock(owner)) {
      try {
        // Someone may have finished booting while we waited for the lock.
        const again = await kvGet<AgentHost>(CURRENT_KEY);
        if (again && again.snapshotId === snap.snapshotId && (again.region || "iad1") === HOST_REGION() && again.expiresAt - Date.now() > RENEW_BEFORE_MS && (await healthy(again.url))) {
          return again;
        }
        const host = await boot(snap.snapshotId, onStatus);
        await kvSet(CURRENT_KEY, host);
        g.__agentHost = { host, at: Date.now() };
        // The old host keeps serving tasks already running on it until it expires;
        // stop it early only if it was broken.
        if (again && !(await healthy(again.url, 1500))) void stopHost(again.name);
        return host;
      } finally {
        await unlock(owner).catch(() => {});
      }
    }
    onStatus?.("Starting the agent computer…");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The agent computer took too long to start. Try again.");
}
