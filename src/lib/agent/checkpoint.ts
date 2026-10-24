// Agent task checkpoints: after every step the task's progress (plan, step history, sources)
// is saved, so a task that pauses (AI quota used up, you took control, the server restarted)
// continues from its last step instead of starting over. Stored in app_kv so it survives a
// restart of the agent computer; an in-memory copy keeps it working without a database.
import type { SourcePage } from "./context";
import type { TaskRequirement } from "./requirements";

export interface Checkpoint {
  v: 1;
  goal: string;
  plan: string[];
  history: string[];
  actionsTaken: number;
  sources: [string, SourcePage][];
  requirements?: TaskRequirement[];
  /** Why the task stopped last (shown when it resumes). */
  reason?: string;
  updatedAt: number;
}

const TTL = 24 * 60 * 60_000;
const g = globalThis as unknown as { __agentCheckpoints?: Map<string, Checkpoint> };
const mem = (g.__agentCheckpoints ??= new Map());
const keyOf = (chatId: string) => `agent.ckpt:${chatId}`;
const writes = new Map<string, Promise<void>>();
const leases = new Map<string, symbol>();

export function checkpointLease(chatId: string) {
  const lease = Symbol(chatId);
  leases.set(chatId, lease);
  return lease;
}

function enqueue(chatId: string, work: () => Promise<void>) {
  const next = (writes.get(chatId) || Promise.resolve()).catch(() => {}).then(work);
  writes.set(chatId, next);
  void next.finally(() => { if (writes.get(chatId) === next) writes.delete(chatId); });
  return next;
}

export async function saveCheckpoint(chatId: string, ck: Omit<Checkpoint, "v" | "updatedAt">, lease?: symbol): Promise<void> {
  if (lease && leases.get(chatId) !== lease) return;
  const full: Checkpoint = { ...ck, v: 1, updatedAt: Date.now(), sources: ck.sources.slice(-12) };
  mem.set(chatId, full);
  return enqueue(chatId, async () => { try {
    if (lease && leases.get(chatId) !== lease) return;
    const { q } = await import("@/lib/server/db");
    await q(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [keyOf(chatId), JSON.stringify(full)]
    );
  } catch {
    /* no database: the in-memory copy still works until a restart */
  } });
}

export async function loadCheckpoint(chatId: string): Promise<Checkpoint | null> {
  await writes.get(chatId)?.catch(() => {});
  let ck = mem.get(chatId) ?? null;
  if (!ck) {
    try {
      const { q1 } = await import("@/lib/server/db");
      const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [keyOf(chatId)]);
      ck = row ? (JSON.parse(row.value) as Checkpoint) : null;
    } catch {
      ck = null;
    }
  }
  if (!ck || ck.v !== 1 || Date.now() - ck.updatedAt > TTL || !ck.goal) return null;
  return ck;
}

export async function clearCheckpoint(chatId: string, lease?: symbol): Promise<void> {
  if (lease && leases.get(chatId) !== lease) return;
  mem.delete(chatId);
  return enqueue(chatId, async () => { try {
    if (lease && leases.get(chatId) !== lease) return;
    const { q } = await import("@/lib/server/db");
    await q("DELETE FROM app_kv WHERE key = $1", [keyOf(chatId)]);
  } catch {
    /* ignore */
  } });
}
