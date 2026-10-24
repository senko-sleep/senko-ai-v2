// Database access. Uses real Postgres when DATABASE_URL is set (Neon, Render
// Postgres, Supabase), otherwise an embedded Postgres (PGlite) stored in .data/
// so local dev and tests need no setup. Same SQL either way.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type Row = Record<string, unknown>;

interface Driver {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  owner_id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_owner_idx ON chats (owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  image_ids JSONB NOT NULL DEFAULT '[]',
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages (chat_id, seq);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS browser_sessions (
  chat_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed',
  storage JSONB,
  tabs JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS screenshots (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  chat_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screenshots_chat_idx ON screenshots (chat_id, seq);
CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memories (
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key)
);
CREATE TABLE IF NOT EXISTS nav_memory (
  owner_id TEXT NOT NULL,
  host TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, host, kind, key)
);
`;

async function createPg(url: string): Promise<Driver> {
  const { Pool } = await import("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
    max: 5,
    // Serverless Postgres and scale-to-zero hosts close idle connections; drop ours first.
    idleTimeoutMillis: 10_000,
  });
  // An idle connection closed by the server must not crash the process.
  pool.on("error", (err) => console.warn("[db] idle connection closed:", err.message));
  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return r.rows as Row[];
    },
  };
}

async function createPglite(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  // DATA_DIR=":memory:" keeps everything in RAM (used by unit tests).
  let db;
  if (process.env.DATA_DIR === ":memory:") {
    db = await PGlite.create();
  } else {
    try {
      const defaultDataDir = process.env.VERCEL ? path.join(os.tmpdir(), ".data") : ".data";
      const dir = path.resolve(process.env.DATA_DIR || defaultDataDir, "pglite");
      // PGlite only creates the last folder, so make the parents on a fresh checkout.
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      db = await PGlite.create(dir);
    } catch (err) {
      console.warn("[db] Failed to use file-backed PGlite, falling back to in-memory:", err);
      db = await PGlite.create();
    }
  }
  return {
    async query(sql, params) {
      // PGlite runs one statement per query() when params are given; use exec for multi-statement DDL.
      if (!params?.length && sql.includes(";")) {
        const res = await db.exec(sql);
        return (res[res.length - 1]?.rows as Row[]) || [];
      }
      const r = await db.query(sql, params as unknown[]);
      return r.rows as Row[];
    },
  };
}

const g = globalThis as unknown as { __db?: Promise<Driver> };

async function init(): Promise<Driver> {
  // Wasmer's managed database injects its own DATABASE_URL, which can point at
  // an internal host even when this app uses the shared Neon database. Prefer
  // the explicitly configured Neon URL on Wasmer so all hosts see the same data.
  const url = (process.env.WASMER_APP_ID
    ? process.env.SENKO_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
    : process.env.DATABASE_URL)?.trim();
  if (!url && process.env.NODE_ENV === "production" && process.env.DATA_DIR !== ":memory:") {
    console.warn(
      "[db] DATABASE_URL is not set: using the embedded database. It needs a lot of RAM (small hosts like Render free crash) " +
        "and on most hosts its files are wiped on every deploy. Set DATABASE_URL to a Postgres/Neon URL."
    );
  }
  // The embedded database needs far more memory than a Wasmer sandbox has: booting it kills the
  // whole workload (every request then returns a 500). Fail this one call with a clear error instead.
  if (!url && process.env.WASMER_APP_ID) {
    throw new Error("No database configured on Wasmer: set SENKO_DATABASE_URL (or DATABASE_URL) as an app secret.");
  }
  const driver = url ? await createPg(url) : await createPglite();
  if (url) {
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await driver.query(stmt);
  } else {
    await driver.query(SCHEMA);
  }
  console.log(`[db] ready (${url ? "postgres" : "embedded PGlite"})`);
  return driver;
}

function driver(): Promise<Driver> {
  if (!g.__db) {
    g.__db = init().catch((e) => {
      g.__db = undefined;
      throw e;
    });
  }
  return g.__db;
}

export async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const d = await driver();
  return (await d.query(sql, params)) as T[];
}

export async function q1<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

/** BYTEA comes back as Buffer (pg) or Uint8Array (PGlite). */
export function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (typeof v === "string" && v.startsWith("\\x")) return Buffer.from(v.slice(2), "hex");
  return Buffer.alloc(0);
}

/** JSONB comes back parsed from both drivers, but be defensive. */
export function json<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export function newId(prefix = ""): string {
  const rand = crypto.getRandomValues(new Uint8Array(12));
  return prefix + Buffer.from(rand).toString("base64url");
}
