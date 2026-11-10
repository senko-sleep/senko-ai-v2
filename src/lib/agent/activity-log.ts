/**
 * Activity log model. Entries are derived only from step events the server
 * actually streamed (CodingAgentStepEvent); nothing is synthesized.
 */

export type ActivityCategory = "agent" | "research" | "terminal" | "files" | "testing";

export interface ActivityStepInput {
  id: number;
  stage: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  url?: string;
  fileOps?: { action: string; path: string; added?: number; removed?: number }[];
}

export interface ActivityEntry {
  /** Stable key: run id + step id. */
  key: string;
  runId: string;
  category: ActivityCategory;
  stage: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  url?: string;
  fileOps?: { action: string; path: string; added?: number; removed?: number }[];
  /** Client receipt time of the first event for this step (ms). */
  startedAt: number;
  /** Client receipt time of the latest status change (ms). */
  updatedAt: number;
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|gsk|pk|rk|xox[abps]|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /((?:api[_-]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)(?!Bearer\b|\[redacted\])[^\s"'&,;]{6,}/gi,
  /(:\/\/[^/\s:@]+:)[^@\s/]+@/g,
];

/** Masks credential-shaped substrings before text is displayed or searched. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0], "[redacted]");
  out = out.replace(SECRET_PATTERNS[1], "[redacted]");
  out = out.replace(SECRET_PATTERNS[2], "Bearer [redacted]");
  out = out.replace(SECRET_PATTERNS[3], "$1[redacted]");
  out = out.replace(SECRET_PATTERNS[4], "$1[redacted]@");
  return out;
}

export function categorizeStage(stage: string, fileOps?: unknown[]): ActivityCategory {
  switch (stage) {
    case "install":
    case "execute":
      return "terminal";
    case "test":
    case "inspect":
    case "repair":
    case "verify":
      return "testing";
    case "research":
      return "research";
    case "implement":
      return fileOps && fileOps.length > 0 ? "files" : "agent";
    default:
      return fileOps && fileOps.length > 0 ? "files" : "agent";
  }
}

const MAX_ENTRIES = 500;
const MAX_TEXT = 2000;

function clip(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const safe = redactSecrets(value);
  return safe.length > MAX_TEXT ? `${safe.slice(0, MAX_TEXT)}\n[truncated ${safe.length - MAX_TEXT} chars]` : safe;
}

/**
 * Upserts a streamed step into the log, preserving chronological order by first
 * receipt. The result is bounded to the newest MAX_ENTRIES entries.
 */
export function applyStep(entries: ActivityEntry[], runId: string, step: ActivityStepInput, now: number = Date.now()): ActivityEntry[] {
  const key = `${runId}:${step.id}`;
  const existing = entries.findIndex((entry) => entry.key === key);
  const fileOps = step.fileOps?.map((op) => ({ ...op, path: redactSecrets(op.path) }));
  const base = {
    category: categorizeStage(step.stage, fileOps),
    stage: step.stage,
    label: clip(step.label) || "",
    status: step.status,
    detail: clip(step.detail),
    url: step.url ? redactSecrets(step.url) : undefined,
    fileOps,
  };
  if (existing >= 0) {
    const next = entries.slice();
    next[existing] = { ...entries[existing], ...base, updatedAt: now };
    return next;
  }
  const appended = [...entries, { key, runId, ...base, startedAt: now, updatedAt: now }];
  return appended.length > MAX_ENTRIES ? appended.slice(appended.length - MAX_ENTRIES) : appended;
}

export interface ActivityFilter {
  categories?: ReadonlySet<ActivityCategory>;
  query?: string;
  errorsOnly?: boolean;
}

export function filterActivity(entries: ActivityEntry[], filter: ActivityFilter): ActivityEntry[] {
  const query = filter.query?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.categories && filter.categories.size > 0 && !filter.categories.has(entry.category)) return false;
    if (filter.errorsOnly && entry.status !== "error") return false;
    if (!query) return true;
    const haystack = [entry.label, entry.detail, entry.url, entry.stage, ...(entry.fileOps?.map((op) => `${op.action} ${op.path}`) || [])]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function summarizeActivity(entries: ActivityEntry[]): Record<ActivityCategory, number> & { errors: number; running: number } {
  const counts = { agent: 0, research: 0, terminal: 0, files: 0, testing: 0, errors: 0, running: 0 };
  for (const entry of entries) {
    counts[entry.category]++;
    if (entry.status === "error") counts.errors++;
    if (entry.status === "running") counts.running++;
  }
  return counts;
}

export function formatActivityText(entries: ActivityEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.startedAt).toISOString().slice(11, 19);
      const head = `${time} [${entry.category}/${entry.stage}] ${entry.status.toUpperCase()} ${entry.label}`;
      const lines = [head];
      if (entry.detail) lines.push(`  ${entry.detail.replace(/\n/g, "\n  ")}`);
      if (entry.url) lines.push(`  ${entry.url}`);
      for (const op of entry.fileOps || []) lines.push(`  ${op.action} ${op.path}${op.added || op.removed ? ` (+${op.added || 0} -${op.removed || 0})` : ""}`);
      return lines.join("\n");
    })
    .join("\n");
}
