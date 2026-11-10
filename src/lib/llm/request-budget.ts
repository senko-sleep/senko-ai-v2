export class InferenceBudgetExceeded extends Error {
  constructor(limit: number) { super(`Task inference request budget exhausted (${limit} requests). Files are preserved; no further inference requests were sent.`); this.name = "InferenceBudgetExceeded"; }
}

export interface InferenceAttempt { provider: string; model: string; startedAt: number; responseHeadersMs?: number; status?: number }

/** Counts actual inference HTTP requests, including compatibility retries, across a task. */
export class InferenceRequestBudget {
  readonly attempts: InferenceAttempt[] = [];
  readonly limit: number;
  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Inference request limit must be an integer from 1 to 1000.");
    this.limit = limit;
  }
  get remaining() { return this.limit - this.attempts.length; }
  assertAvailable() { if (!this.remaining) throw new InferenceBudgetExceeded(this.limit); }
  take(provider: string, model: string): InferenceAttempt {
    this.assertAvailable();
    const attempt = { provider, model, startedAt: Date.now() };
    this.attempts.push(attempt);
    return attempt;
  }
}
