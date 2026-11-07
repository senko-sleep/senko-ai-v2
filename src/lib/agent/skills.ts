// Verified Skill / Workflow Library.
//
// Captures parameterized, verified multi-step workflow templates ONLY after all verification
// criteria have passed (`stage === "delivery"`). Reusing a workflow is transparently disclosed
// as "Reused saved workflow" (never misrepresented as autonomous model learning), and workflows
// that fail verification on replay are automatically demoted so stale patterns never poison runs.

import type { PlanNode, TaskIntentKind, TaskWorkflowGraph, VerificationCriterion } from "./workflow-engine";
import type { RiskLevel } from "./risk";

export interface SkillStepTemplate {
  id: string;
  title: string;
  dependsOn: string[];
  condition?: string;
  readOnly?: boolean;
  risk: RiskLevel;
  verification: VerificationCriterion[];
}

export interface VerifiedSkill {
  id: string;
  ownerId: string;
  title: string;
  goalPattern: string;
  intentKind: TaskIntentKind;
  domain?: string;
  steps: SkillStepTemplate[];
  successCount: number;
  failureCount: number;
  /** Automatically set to false when replay verification fails repeatedly. */
  active: boolean;
  disclosureLabel: string;
  createdAt: number;
  lastUsedAt: number;
}

const g = globalThis as unknown as { __verifiedSkills?: Map<string, VerifiedSkill[]> };
const store: Map<string, VerifiedSkill[]> = (g.__verifiedSkills ??= new Map<string, VerifiedSkill[]>());

function normalizeKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(the|and|for|with|from|that|this|into|open|please)$/.test(w));
}

/**
 * Save a completed workflow graph into the user's Verified Skill Library.
 * Refuses to save if the workflow graph did not pass all verification criteria.
 */
export function saveVerifiedSkill(
  ownerId: string,
  graph: TaskWorkflowGraph,
  opts: { title?: string; domain?: string; now?: number } = {},
): VerifiedSkill | null {
  const verifiedNodes = graph.nodes.filter((n) => n.status === "verified");
  const hasUnverified = graph.nodes.some((n) => n.status !== "verified" && n.status !== "skipped");
  if (graph.stage !== "delivery" || hasUnverified || verifiedNodes.length === 0) {
    return null;
  }

  const now = opts.now ?? Date.now();
  const list = store.get(ownerId) ?? [];
  const title = (opts.title || graph.goal).trim().slice(0, 100);
  const id = `skill_${ Buffer.from(title.toLowerCase()).toString("hex").slice(0, 16)}_${verifiedNodes.length}`;

  const steps: SkillStepTemplate[] = graph.nodes
    .filter((n) => n.status === "verified")
    .map((n) => ({
      id: n.id,
      title: n.title,
      dependsOn: n.dependsOn.filter((dep) => verifiedNodes.some((v) => v.id === dep)),
      condition: n.condition,
      readOnly: n.readOnly,
      risk: n.risk,
      verification: n.verification.map(({ id: cid, kind, expected }) => ({ id: cid, kind, expected })),
    }));

  const existingIdx = list.findIndex((s) => s.id === id || s.goalPattern.toLowerCase() === graph.goal.trim().toLowerCase());
  const skill: VerifiedSkill =
    existingIdx >= 0
      ? {
          ...list[existingIdx],
          steps,
          successCount: list[existingIdx].successCount + 1,
          active: true,
          lastUsedAt: now,
        }
      : {
          id,
          ownerId,
          title,
          goalPattern: graph.goal.trim(),
          intentKind: graph.intentKind,
          domain: opts.domain,
          steps,
          successCount: 1,
          failureCount: 0,
          active: true,
          disclosureLabel: `Reused saved workflow: ${title}`,
          createdAt: now,
          lastUsedAt: now,
        };

  if (existingIdx >= 0) list[existingIdx] = skill;
  else list.unshift(skill);
  store.set(ownerId, list.slice(0, 100));
  void persistSkills(ownerId, store.get(ownerId)!);
  return skill;
}

/**
 * Find active verified workflows matching the user's goal and optional domain.
 */
export function findMatchingSkills(
  ownerId: string,
  goal: string,
  domain?: string,
  limit = 3,
): VerifiedSkill[] {
  const list = (store.get(ownerId) ?? []).filter((s) => s.active);
  if (list.length === 0) return [];
  const goalWords = new Set(normalizeKeywords(goal));
  if (goalWords.size === 0) return [];

  const scored = list
    .map((skill) => {
      const patternWords = normalizeKeywords(skill.goalPattern);
      if (patternWords.length === 0) return { skill, score: 0 };
      const overlap = patternWords.filter((w) => goalWords.has(w)).length;
      const ratio = overlap / Math.max(patternWords.length, goalWords.size);
      const domainBoost = domain && skill.domain && skill.domain.toLowerCase() === domain.toLowerCase() ? 0.25 : 0;
      const reliabilityBoost = Math.min(0.15, (skill.successCount - skill.failureCount) * 0.03);
      return { skill, score: ratio + domainBoost + reliabilityBoost };
    })
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((item) => item.skill);
}

/**
 * Instantiate a fresh `PlanNode` list from a `VerifiedSkill` so a new task can execute and
 * re-verify every step from scratch.
 */
export function instantiateSkillNodes(skill: VerifiedSkill): Omit<PlanNode, "status" | "attempts">[] {
  return skill.steps.map((s) => ({
    id: s.id,
    title: s.title,
    dependsOn: [...s.dependsOn],
    condition: s.condition,
    readOnly: s.readOnly,
    risk: s.risk,
    verification: s.verification.map((v) => ({ ...v })),
  }));
}

/**
 * Record whether a replayed skill passed or failed verification.
 * Automatically demotes (`active = false`) any skill whose failure count reaches 2 and exceeds successes.
 */
export function recordSkillReplayOutcome(
  ownerId: string,
  skillId: string,
  verified: boolean,
  now = Date.now(),
): VerifiedSkill | null {
  const list = store.get(ownerId) ?? [];
  const skill = list.find((s) => s.id === skillId);
  if (!skill) return null;
  if (verified) {
    skill.successCount += 1;
  } else {
    skill.failureCount += 1;
    if (skill.failureCount >= 2 && skill.failureCount >= skill.successCount) {
      skill.active = false;
    }
  }
  skill.lastUsedAt = now;
  void persistSkills(ownerId, list);
  return skill;
}

export function listSkills(ownerId: string): VerifiedSkill[] {
  return [...(store.get(ownerId) ?? [])];
}

export async function loadSkills(ownerId: string): Promise<VerifiedSkill[]> {
  const cached = store.get(ownerId);
  if (cached && cached.length > 0) return [...cached];
  try {
    const { q1 } = await import("@/lib/server/db");
    const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [`agent.skills:${ownerId}`]);
    if (row) {
      const parsed = JSON.parse(row.value) as VerifiedSkill[];
      if (Array.isArray(parsed)) {
        store.set(ownerId, parsed);
        return [...parsed];
      }
    }
  } catch {
    /* ignore */
  }
  return [...(store.get(ownerId) ?? [])];
}

export function deleteSkill(ownerId: string, skillId: string): boolean {
  const list = store.get(ownerId) ?? [];
  const next = list.filter((s) => s.id !== skillId);
  if (next.length === list.length) return false;
  store.set(ownerId, next);
  void persistSkills(ownerId, next);
  return true;
}

export function resetSkills(): void {
  store.clear();
}

async function persistSkills(ownerId: string, list: VerifiedSkill[]): Promise<void> {
  try {
    const { q } = await import("@/lib/server/db");
    await q(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [`agent.skills:${ownerId}`, JSON.stringify(list)],
    );
  } catch {
    /* in-memory store still works */
  }
}
