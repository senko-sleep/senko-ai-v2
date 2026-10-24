export interface TaskRequirement {
  id: string;
  text: string;
  status: "pending" | "verified" | "blocked";
  evidence?: string;
}

/** Keep the complete original request as a coverage check even if planning omits a detail. */
export function taskRequirements(goal: string, items: unknown = []): TaskRequirement[] {
  const texts = [goal, ...(Array.isArray(items) ? items.filter((x): x is string => typeof x === "string" && !!x.trim()) : [])];
  return [...new Set(texts.map(x => x.trim()))].map((text, i) => ({ id: `r${i}`, text, status: "pending" }));
}

/** Reviews cannot delete requirements or certify one without concrete evidence. */
export function reviewRequirements(current: TaskRequirement[], review: unknown): TaskRequirement[] {
  const rows = Array.isArray(review) ? review : [];
  return current.map(item => {
    const matches = rows.filter(row => row && typeof row === "object" && row.id === item.id);
    const row = matches.length === 1 ? matches[0] : null;
    const evidence = typeof row?.evidence === "string" ? row.evidence.trim().slice(0, 800) : "";
    const status = evidence && (row?.status === "verified" || row?.status === "blocked") ? row.status : "pending";
    return { ...item, status, evidence: evidence || undefined };
  });
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
