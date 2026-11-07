export interface TaskRequirement {
  id: string;
  text: string;
  status: "pending" | "verified" | "blocked";
  evidence?: string;
}

/** Keep the complete original request as a coverage check even if planning omits a detail. */
export function taskRequirements(goal: string, items: unknown = []): TaskRequirement[] {
  // Planners sometimes write a moderation note ("User requests ... copyrighted characters") as a
  // checklist item. It isn't something to do, so it would never verify and the task would stall.
  const texts = [goal, ...(Array.isArray(items) ? items.filter((x): x is string => typeof x === "string" && !!x.trim() && !isModerationNote(x)) : [])];
  return [...new Set(texts.map(x => x.trim()))].map((text, i) => ({ id: `r${i}`, text, status: "pending" }));
}

/** Reviews cannot delete requirements or certify one without concrete evidence. */
export function reviewRequirements(current: TaskRequirement[], review: unknown): TaskRequirement[] {
  const rows = Array.isArray(review) ? review : [];
  return current.map(item => {
    const matches = rows.filter(row => row && typeof row === "object" && row.id === item.id);
    const row = matches.length === 1 ? matches[0] : null;
    const evidence = typeof row?.evidence === "string" ? row.evidence.trim().slice(0, 800) : "";
    let status = evidence && (row?.status === "verified" || row?.status === "blocked") ? row.status : "pending";
    // The auditor checks completion only. A "blocked" based on content policy is the auditor
    // moderating, not an obstacle on the page, so it doesn't count. The minors limit stays.
    if (status === "blocked" && isPolicyBlock(evidence)) status = "pending";
    return { ...item, status, evidence: evidence || undefined };
  });
}

const POLICY_WORDS = /\b(polic(y|ies)|disallowed|prohibited|not permitted|not allowed|inappropriate|guidelines|explicit|adult|sexual|nsfw|porn\w*|rule ?34|copyright(ed)?|trademark(ed)?)\b/i;
const MINOR_WORDS = /\b(minors?|child(ren)?|underage|kids?|loli|shota)\b/i;

/** True when a "blocked" reason is about content rules rather than something on the page. */
export function isPolicyBlock(evidence: string) {
  return POLICY_WORDS.test(evidence) && !MINOR_WORDS.test(evidence);
}

/** A checklist item that describes or judges the request instead of naming something to do. */
export function isModerationNote(text: string) {
  return /^\s*(the\s+)?user\s+(requests|is requesting|asks|is asking|wants)\b/i.test(text) && isPolicyBlock(text);
}

/**
 * Items still pending only because the auditor judged the content (not because work is
 * missing). These don't hold the task back.
 */
export function onlyPolicyGaps(items: TaskRequirement[]) {
  const open = items.filter(item => item.status !== "verified");
  return open.length > 0 && open.every(item => item.id !== "r0" && (isModerationNote(item.text) || isPolicyBlock(item.evidence || "")));
}

export function requirementsComplete(items: TaskRequirement[]) {
  return items.length > 0 && items.every(item => item.status === "verified" && !!item.evidence);
}

export function updateRequirements(items: TaskRequirement[], updates: unknown): TaskRequirement[] {
  if (!Array.isArray(updates)) return items;
  return items.map(item => {
    if (item.id === "r0" || !updates.some(row => row?.id === item.id)) return item;
    return reviewRequirements([item], updates)[0];
  });
}

export function describeRequirements(items: TaskRequirement[]) {
  return items.map(item => `${item.id} [${item.status}] ${item.text}${item.evidence ? ` — ${item.evidence}` : ""}`).join("\n");
}
