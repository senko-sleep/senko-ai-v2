// Autonomous Workflow Engine (8-stage lifecycle with dependency DAG, conditional branches,
// safe parallel batching for read-only steps, checkpoints, and strict post-action verification).
//
// Core invariant: A node or task is NEVER marked "verified" merely because a tool call returned
// without throwing. Every PlanNode must satisfy its explicit VerificationCriterion checks against
// observed reality (URL, visible text, DOM elements, or non-empty artifact output).

import type { RiskLevel } from "./risk";

export type WorkflowStage =
  | "intent"
  | "context"
  | "planning"
  | "execution"
  | "observation"
  | "recovery"
  | "verification"
  | "delivery";

export type TaskIntentKind = "conversation" | "research" | "coding" | "automation" | "data";

export interface VerificationCriterion {
  id: string;
  kind: "url_matches" | "text_contains" | "element_present" | "artifact_non_empty" | "custom_evidence";
  expected: string;
  passed?: boolean;
  observed?: string;
}

export interface PlanNode {
  id: string;
  title: string;
  dependsOn: string[];
  /**
   * Optional branch condition:
   * - "if_verified:<nodeId>"
   * - "if_failed:<nodeId>"
   * - "url_contains:<substring>"
   * - "text_contains:<substring>"
   */
  condition?: string;
  /** True only for side-effect-free read/inspection steps that are safe to batch in parallel. */
  readOnly?: boolean;
  risk: RiskLevel;
  verification: VerificationCriterion[];
  status: "pending" | "running" | "verified" | "failed" | "skipped";
  attempts: number;
  evidence?: string;
}

export interface WorkflowCheckpoint {
  at: number;
  nodeId: string;
  stage: WorkflowStage;
  summary: string;
}

export interface TaskWorkflowGraph {
  taskId: string;
  goal: string;
  intentKind: TaskIntentKind;
  stage: WorkflowStage;
  nodes: PlanNode[];
  checkpoints: WorkflowCheckpoint[];
  /** Set when this workflow was initialized from a verified saved workflow (skill). */
  reusedSkillId?: string;
  updatedAt: number;
}

export interface VerificationObservation {
  url?: string;
  text?: string;
  elementTexts?: string[];
  artifactContent?: string;
  customEvidence?: Record<string, string>;
  /**
   * When true and no observable state is provided, verification must fail to prevent
   * pretending a step succeeded merely because a tool call completed.
   */
  toolSucceededOnly?: boolean;
}

const g = globalThis as unknown as { __workflowGraphs?: Map<string, TaskWorkflowGraph> };
const mem = (g.__workflowGraphs ??= new Map());

export function classifyTaskIntent(goal: string): TaskIntentKind {
  const q = goal.trim().toLowerCase();
  if (/\b(build|implement|refactor|code|component|html|css|typescript|react|python|function|fix bug|debug)\b/.test(q)) {
    return "coding";
  }
  if (/\b(chart|plot|csv|dataset|spreadsheet|table|statistics|regression|desmos|graph)\b/.test(q)) {
    return "data";
  }
  if (/\b(click|log ?in|fill|submit|navigate|open|watch|play|book|buy|checkout|download|drag|select)\b/.test(q)) {
    return "automation";
  }
  if (/\b(compare|research|sources|citations|papers|summarize|investigate|find out|benchmarks)\b/.test(q)) {
    return "research";
  }
  return "conversation";
}

export function createWorkflowGraph(
  taskId: string,
  goal: string,
  nodes: Omit<PlanNode, "status" | "attempts">[],
  reusedSkillId?: string,
  now = Date.now(),
): TaskWorkflowGraph {
  const graph: TaskWorkflowGraph = {
    taskId,
    goal,
    intentKind: classifyTaskIntent(goal),
    stage: nodes.length > 0 ? "planning" : "intent",
    nodes: nodes.map((n) => ({
      ...n,
      status: "pending",
      attempts: 0,
      verification: n.verification.map((v) => ({ ...v })),
    })),
    checkpoints: [
      {
        at: now,
        nodeId: "root",
        stage: "planning",
        summary: reusedSkillId
          ? `Initialized ${nodes.length}-step plan from saved workflow "${reusedSkillId}"`
          : `Created ${nodes.length}-step execution plan`,
      },
    ],
    reusedSkillId,
    updatedAt: now,
  };
  mem.set(taskId, graph);
  return graph;
}

export function evaluateBranchCondition(
  condition: string | undefined,
  context: { url?: string; text?: string; verifiedNodeIds?: Set<string>; failedNodeIds?: Set<string> },
): boolean {
  if (!condition || !condition.trim()) return true;
  const trimmed = condition.trim();
  if (trimmed.startsWith("if_verified:")) {
    const id = trimmed.slice("if_verified:".length).trim();
    return Boolean(context.verifiedNodeIds?.has(id));
  }
  if (trimmed.startsWith("if_failed:")) {
    const id = trimmed.slice("if_failed:".length).trim();
    return Boolean(context.failedNodeIds?.has(id));
  }
  if (trimmed.startsWith("url_contains:")) {
    const needle = trimmed.slice("url_contains:".length).trim().toLowerCase();
    return Boolean(context.url?.toLowerCase().includes(needle));
  }
  if (trimmed.startsWith("text_contains:")) {
    const needle = trimmed.slice("text_contains:".length).trim().toLowerCase();
    return Boolean(context.text?.toLowerCase().includes(needle));
  }
  return true;
}

/**
 * Return all pending nodes whose dependencies are resolved and whose branch condition holds.
 * Nodes whose branch condition evaluates to false after all dependencies settle are marked skipped.
 */
export function readyNodes(
  graph: TaskWorkflowGraph,
  context: { url?: string; text?: string } = {},
): PlanNode[] {
  const verifiedIds = new Set(graph.nodes.filter((n) => n.status === "verified").map((n) => n.id));
  const failedIds = new Set(graph.nodes.filter((n) => n.status === "failed").map((n) => n.id));
  const settledIds = new Set(
    graph.nodes.filter((n) => n.status === "verified" || n.status === "failed" || n.status === "skipped").map((n) => n.id),
  );

  const ready: PlanNode[] = [];
  for (const node of graph.nodes) {
    if (node.status !== "pending") continue;
    const isFailureRecoveryBranch = node.condition?.trim().startsWith("if_failed:");
    const depsReady = isFailureRecoveryBranch
      ? node.dependsOn.every((depId) => settledIds.has(depId))
      : node.dependsOn.every((depId) => verifiedIds.has(depId));
    if (!depsReady) continue;

    const condOk = evaluateBranchCondition(node.condition, {
      url: context.url,
      text: context.text,
      verifiedNodeIds: verifiedIds,
      failedNodeIds: failedIds,
    });
    if (!condOk) {
      node.status = "skipped";
      continue;
    }
    ready.push(node);
  }
  return ready;
}

/**
 * Group ready nodes into a safe execution batch:
 * - Multiple read-only, low-risk nodes can run in parallel.
 * - Any state-mutating or medium/high-risk node runs alone as a single-item batch.
 */
export function parallelizableBatch(
  graph: TaskWorkflowGraph,
  context: { url?: string; text?: string } = {},
): PlanNode[] {
  const ready = readyNodes(graph, context);
  if (ready.length === 0) return [];
  const readOnlyLowRisk = ready.filter((n) => n.readOnly === true && n.risk === "low");
  if (readOnlyLowRisk.length > 0) {
    return readOnlyLowRisk;
  }
  return [ready[0]];
}

/**
 * Strictly verify a PlanNode's criteria against real post-action observations.
 * Never passes if `toolSucceededOnly` is true without matching evidence, or if a node has no criteria
 * and no observed state.
 */
export function verifyNodeCriteria(
  node: PlanNode,
  obs: VerificationObservation,
): { verified: boolean; results: VerificationCriterion[]; summary: string } {
  if (obs.toolSucceededOnly && !obs.url && !obs.text && !obs.elementTexts?.length && !obs.artifactContent && !obs.customEvidence) {
    return {
      verified: false,
      results: node.verification.map((c) => ({
        ...c,
        passed: false,
        observed: "Tool call completed, but no post-action page or artifact evidence was observed.",
      })),
      summary: "Verification rejected: tool call completion alone does not prove task outcome.",
    };
  }

  if (node.verification.length === 0) {
    const hasAnyEvidence = Boolean(obs.url || obs.text?.trim() || obs.elementTexts?.length || obs.artifactContent?.trim());
    return {
      verified: hasAnyEvidence,
      results: [],
      summary: hasAnyEvidence ? "Verified from post-action observation." : "No observable evidence captured.",
    };
  }

  const results: VerificationCriterion[] = node.verification.map((crit) => {
    const expectedLower = crit.expected.toLowerCase();
    switch (crit.kind) {
      case "url_matches": {
        const actual = obs.url || "";
        const passed = actual.toLowerCase().includes(expectedLower);
        return { ...crit, passed, observed: actual || "(no URL)" };
      }
      case "text_contains": {
        const actual = obs.text || "";
        const passed = actual.toLowerCase().includes(expectedLower);
        return {
          ...crit,
          passed,
          observed: passed ? `Found "${crit.expected}" in visible text` : `Missing "${crit.expected}" in visible text`,
        };
      }
      case "element_present": {
        const list = obs.elementTexts || [];
        const match = list.find((t) => t.toLowerCase().includes(expectedLower));
        return {
          ...crit,
          passed: Boolean(match),
          observed: match ? `Element "${match}" present` : `Element matching "${crit.expected}" not found`,
        };
      }
      case "artifact_non_empty": {
        const content = (obs.artifactContent || "").trim();
        const passed = content.length > 0 && (!crit.expected || content.toLowerCase().includes(expectedLower));
        return {
          ...crit,
          passed,
          observed: passed ? `Artifact verified (${content.length} chars)` : "Artifact missing or missing expected content",
        };
      }
      case "custom_evidence": {
        const val = obs.customEvidence?.[crit.id] || obs.text || "";
        const passed = val.toLowerCase().includes(expectedLower);
        return {
          ...crit,
          passed,
          observed: val ? val.slice(0, 120) : "No custom evidence recorded",
        };
      }
    }
  });

  const verified = results.every((r) => r.passed === true);
  const summary = verified
    ? results.map((r) => r.observed).join("; ")
    : `Failed criteria: ${results.filter((r) => !r.passed).map((r) => r.observed).join("; ")}`;

  return { verified, results, summary };
}

/**
 * Record the execution and verification outcome for a PlanNode, advancing the workflow stage
 * and appending a resumable checkpoint.
 */
export function advanceWorkflowNode(
  graph: TaskWorkflowGraph,
  nodeId: string,
  obs: VerificationObservation,
  now = Date.now(),
): { graph: TaskWorkflowGraph; verified: boolean; summary: string } {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { graph, verified: false, summary: `Unknown plan node "${nodeId}"` };
  }

  node.attempts += 1;
  graph.stage = "verification";
  const check = verifyNodeCriteria(node, obs);
  node.verification = check.results;
  node.evidence = check.summary;

  if (check.verified) {
    node.status = "verified";
  } else {
    node.status = "failed";
  }

  // Re-evaluate any conditional recovery/branch nodes that depend on this node
  readyNodes(graph, { url: obs.url, text: obs.text });

  const allDone = graph.nodes.every((n) => n.status === "verified" || n.status === "skipped");
  graph.stage = allDone ? "delivery" : check.verified ? "execution" : "recovery";
  graph.updatedAt = now;
  graph.checkpoints.push({
    at: now,
    nodeId: node.id,
    stage: graph.stage,
    summary: `${node.title}: ${check.verified ? "verified" : "failed"} (${check.summary})`,
  });

  mem.set(graph.taskId, graph);
  return { graph, verified: check.verified, summary: check.summary };
}

export async function saveWorkflowGraph(chatId: string, graph: TaskWorkflowGraph): Promise<void> {
  mem.set(chatId, graph);
  try {
    const { q } = await import("@/lib/server/db");
    await q(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [`task.graph:${chatId}`, JSON.stringify(graph)],
    );
  } catch {
    /* in-memory fallback works without DB */
  }
}

export async function loadWorkflowGraph(chatId: string): Promise<TaskWorkflowGraph | null> {
  const cached = mem.get(chatId);
  if (cached) return cached;
  try {
    const { q1 } = await import("@/lib/server/db");
    const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [`task.graph:${chatId}`]);
    if (row) {
      const parsed = JSON.parse(row.value) as TaskWorkflowGraph;
      mem.set(chatId, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function resetWorkflowGraphs(): void {
  mem.clear();
}
