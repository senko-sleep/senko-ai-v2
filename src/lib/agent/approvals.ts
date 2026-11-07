// Approval state for consequential agent actions.
//
// Flow: the runner assesses an action, finds it high-risk, calls requestApproval() and pauses.
// The user approves or denies through POST /api/chats/:id/agent/approve. An approval is bound to
// the exact action key, is single-use, and expires; the resumed run consumes it once.
//
// State lives in this process's memory (like paused goals). If the server restarts mid-approval the
// approval is simply lost and the agent asks again, which fails safe.
import type { RiskCategory } from "./risk";

export interface ApprovalRequest {
  key: string;
  summary: string;
  category: RiskCategory;
  reasons: string[];
  url: string;
  requestedAt: number;
}

export interface AuditEntry {
  at: number;
  key: string;
  summary: string;
  category: RiskCategory;
  decision: "requested" | "approved" | "denied" | "executed" | "expired";
}

const TTL_MS = 10 * 60_000;
const AUDIT_MAX = 200;

const g = globalThis as unknown as {
  __approvalPending?: Map<string, ApprovalRequest>;
  __approvalGranted?: Map<string, { key: string; expires: number }>;
  __approvalAudit?: Map<string, AuditEntry[]>;
};
const pending = (g.__approvalPending ??= new Map());
const granted = (g.__approvalGranted ??= new Map());
const audit = (g.__approvalAudit ??= new Map());

function record(chatId: string, entry: Omit<AuditEntry, "at">, now = Date.now()) {
  const list = audit.get(chatId) ?? [];
  list.push({ at: now, ...entry });
  if (list.length > AUDIT_MAX) list.splice(0, list.length - AUDIT_MAX);
  audit.set(chatId, list);
  void persistAudit(chatId, list);
}

async function persistAudit(chatId: string, list: AuditEntry[]) {
  try {
    const { q } = await import("@/lib/server/db");
    await q(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [`agent.audit:${chatId}`, JSON.stringify(list)]
    );
  } catch {
    /* in-memory audit log still works without database */
  }
}

export function requestApproval(chatId: string, req: Omit<ApprovalRequest, "requestedAt">, now = Date.now()): ApprovalRequest {
  const full = { ...req, requestedAt: now };
  pending.set(chatId, full);
  // A new request supersedes any older grant for a different action.
  const prior = granted.get(chatId);
  if (prior && prior.key !== req.key) granted.delete(chatId);
  record(chatId, { key: req.key, summary: req.summary, category: req.category, decision: "requested" }, now);
  return full;
}

export function getPendingApproval(chatId: string): ApprovalRequest | undefined {
  return pending.get(chatId);
}

/** Approve the pending request. Fails unless `key` is exactly the one being asked about. */
export function grantApproval(chatId: string, key: string, now = Date.now()): boolean {
  const req = pending.get(chatId);
  if (!req || req.key !== key) return false;
  pending.delete(chatId);
  granted.set(chatId, { key, expires: now + TTL_MS });
  record(chatId, { key, summary: req.summary, category: req.category, decision: "approved" }, now);
  return true;
}

export function denyApproval(chatId: string, key: string, now = Date.now()): boolean {
  const req = pending.get(chatId);
  if (!req || req.key !== key) return false;
  pending.delete(chatId);
  granted.delete(chatId);
  record(chatId, { key, summary: req.summary, category: req.category, decision: "denied" }, now);
  return true;
}

/** True once, if this exact action was approved and the approval hasn't expired. */
export function consumeApproval(chatId: string, key: string, summary = "", category: RiskCategory = "none", now = Date.now()): boolean {
  const g1 = granted.get(chatId);
  if (!g1 || g1.key !== key) return false;
  granted.delete(chatId);
  if (g1.expires < now) {
    record(chatId, { key, summary, category, decision: "expired" }, now);
    return false;
  }
  record(chatId, { key, summary, category, decision: "executed" }, now);
  return true;
}

export function auditLog(chatId: string): AuditEntry[] {
  return [...(audit.get(chatId) ?? [])];
}

export async function loadAuditLog(chatId: string): Promise<AuditEntry[]> {
  const cached = audit.get(chatId);
  if (cached && cached.length > 0) return [...cached];
  try {
    const { q1 } = await import("@/lib/server/db");
    const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [`agent.audit:${chatId}`]);
    if (row) {
      const parsed = JSON.parse(row.value) as AuditEntry[];
      if (Array.isArray(parsed)) {
        audit.set(chatId, parsed);
        return [...parsed];
      }
    }
  } catch {
    /* ignore */
  }
  return [...(audit.get(chatId) ?? [])];
}

export function resetApprovals() {
  pending.clear();
  granted.clear();
  audit.clear();
}
