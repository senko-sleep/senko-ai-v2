#!/usr/bin/env node
// Builds the "agent computer" snapshot used on Vercel (AGENT_HOST=sandbox).
//
// It boots a Vercel Sandbox, copies in the committed code (git HEAD), installs Chromium
// and its system libraries, builds the app, checks that it starts, then saves a snapshot.
// The snapshot id is stored in the database, so the next agent task uses it right away.
//
// Run it once, and again after changing server/agent code:
//   node scripts/agent-host-snapshot.mjs
// Needs DATABASE_URL in .env.local and a linked Vercel project (`npx vercel link`).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
process.chdir(root);
config({ path: ".env.local", quiet: true });

if (!process.env.VERCEL_OIDC_TOKEN && !process.env.VERCEL_TOKEN) {
  const tmp = path.join(os.tmpdir(), `senko-vercel-env-${Date.now()}`);
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vercel", "env", "pull", tmp, "--environment=development", "--yes"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  config({ path: tmp, quiet: true, override: false });
  fs.rmSync(tmp, { force: true });
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env.local");

const { Sandbox, Snapshot } = await import("@vercel/sandbox");
const pg = (await import("pg")).default;
const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
const credentials = VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
  ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
  : {};

const APP = "/vercel/sandbox/app";
const BROWSERS = "/vercel/sandbox/ms-playwright";
const CHROMIUM_DEPS =
  "nss nspr libxkbcommon atk at-spi2-atk at-spi2-core libXcomposite libXdamage libXrandr libXfixes libXcursor libXi libXtst libXScrnSaver libXext mesa-libgbm libdrm mesa-libGL mesa-libEGL cups-libs alsa-lib pango cairo gtk3 dbus-libs liberation-fonts google-noto-sans-cjk-fonts google-noto-emoji-color-fonts";

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"]).toString().trim();
if (dirty) console.warn("Note: uncommitted changes are NOT included (the snapshot uses git HEAD).");
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
const tarball = execFileSync("git", ["archive", "--format=tar.gz", "HEAD"], { maxBuffer: 512 * 1024 * 1024 });
log(`code: ${sha} (${(tarball.length / 1024 / 1024).toFixed(1)} MB)`);

let sb;
for (const vcpus of [4, 2]) {
  try {
    sb = await Sandbox.create({ ...credentials, region: (process.env.AGENT_HOST_REGION || "iad1").trim(), runtime: "node24", resources: { vcpus }, timeout: 40 * 60_000 });
    log(`sandbox up (${vcpus} vCPU)`);
    break;
  } catch (e) {
    if (vcpus === 2) throw e;
  }
}

async function run(label, script, { sudo = false, env = {} } = {}) {
  log(label, "…");
  const r = await sb.runCommand({ cmd: "sh", args: ["-c", script], sudo, env });
  const out = ((await r.stdout()) + (await r.stderr())).trim();
  if (r.exitCode !== 0) {
    console.error(out.slice(-3000));
    throw new Error(`${label} failed (exit ${r.exitCode})`);
  }
  return out;
}

try {
  await sb.writeFiles([{ path: "/vercel/sandbox/app.tgz", content: tarball }]);
  await run("unpack", `mkdir -p ${APP} && tar xzf /vercel/sandbox/app.tgz -C ${APP} && rm /vercel/sandbox/app.tgz`);
  await run("system libraries for Chromium", `dnf install -y --skip-broken ${CHROMIUM_DEPS} >/tmp/dnf.log 2>&1; ldconfig; echo ok`, { sudo: true });
  await run("npm ci", `cd ${APP} && npm ci --include=dev --no-audit --no-fund --loglevel=error`);
  await run("Chromium", `cd ${APP} && npx playwright install chromium chromium-headless-shell`, { env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS } });
  await run("next build", `cd ${APP} && npx next build`, {
    env: { NODE_OPTIONS: "--max-old-space-size=6144", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
  });
  await run("prune dev dependencies", `cd ${APP} && npm prune --omit=dev --no-audit --no-fund --loglevel=error`);
  const check = await run(
    "smoke test (start server + launch Chromium)",
    `cd ${APP}; PORT=3000 node node_modules/next/dist/bin/next start -p 3000 >/tmp/next.log 2>&1 & echo $! > /tmp/next.pid; ` +
      `for i in $(seq 1 60); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 1; done; curl -s localhost:3000/api/health; echo; ` +
      `node -e 'require("playwright").chromium.launch({args:["--no-sandbox"]}).then(async b=>{console.log("chromium",b.version());await b.close()}).catch(e=>{console.error(e.message);process.exit(1)})'; ` +
      `kill $(cat /tmp/next.pid) 2>/dev/null; true`,
    { env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS, NODE_ENV: "production" } }
  );
  log(check.replace(/\s+/g, " "));
  if (!/"status":"ok"/.test(check) || !/chromium \d/.test(check)) throw new Error("smoke test failed");

  // Snapshot storage is capped (Hobby: a handful of ~1.6 GB snapshots). Keep only the one
  // the agent uses right now; this build becomes the other.
  try {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127.0.0.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false } });
    await db.connect();
    const row = (await db.query("SELECT value FROM app_kv WHERE key = 'agent_host.snapshot'").catch(() => ({ rows: [] }))).rows[0];
    await db.end();
    const live = row ? JSON.parse(row.value).snapshotId : null;
    let freed = 0;
    for (const old of await (await Snapshot.list(credentials)).toArray()) {
      if (old.status !== "created" || old.id === live) continue;
      await (await Snapshot.get({ ...credentials, snapshotId: old.id })).delete().catch(() => {});
      freed += old.sizeBytes;
    }
    if (freed) log(`deleted old snapshots (${(freed / 1e9).toFixed(1)} GB)`);
  } catch (e) {
    log(`couldn't prune old snapshots: ${e instanceof Error ? e.message : e}`);
  }

  log("saving snapshot …");
  const snap = await sb.snapshot({ expiration: 0 });
  log(`snapshot ${snap.snapshotId}`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false }, max: 1 });
  await pool.query("CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  await pool.query(
    "INSERT INTO app_kv (key, value, updated_at) VALUES ('agent_host.snapshot', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [JSON.stringify({ snapshotId: snap.snapshotId, sha, at: new Date().toISOString() })]
  );
  await pool.end();
  log(`done: agent computer snapshot for ${sha} is live`);
} catch (e) {
  await sb.stop().catch(() => {});
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
