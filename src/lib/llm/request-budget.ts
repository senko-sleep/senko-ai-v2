export class InferenceBudgetExceeded extends Error {
  constructor(limit: number) {
    super(`Task inference request budget exhausted (${limit} requests). Files are preserved; no further inference requests were sent.`);
    this.name = "InferenceBudgetExceeded";
  }
}

export interface InferenceAttempt {
  provider: string;
  model: string;
  startedAt: number;
  responseHeadersMs?: number;
  status?: number;
}

/** Counts actual inference HTTP requests, including compatibility retries, across a task. */
export class InferenceRequestBudget {
  readonly attempts: InferenceAttempt[] = [];
  readonly limit: number;
  /** How many failed provider calls may be handed back; bounds retries during an outage. */
  private readonly failedAllowance: number;
  private refunded = 0;
  constructor(limit: number, opts: { failedAllowance?: number } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Inference request limit must be an integer from 1 to 1000.");
    }
    this.limit = limit;
    this.failedAllowance = Math.max(0, opts.failedAllowance ?? 0);
  }
  get used() { return this.attempts.length - this.refunded; }
  get remaining() { return this.limit - this.used; }

  /** A call that produced no answer (rate limit, server error, dropped connection) costs no budget. */
  settle(attempt: InferenceAttempt) {
    const status = attempt.status ?? 0;
    if ((status === 0 || status === 408 || status === 429 || status >= 500) && this.refunded < this.failedAllowance) this.refunded++;
  }
  get fractionRemaining() { return this.remaining / this.limit; }
  /** True when approaching exhaustion (<= 25% or <= 6 requests left). */
  get isLow() { return this.remaining <= Math.max(6, Math.floor(this.limit * 0.25)); }
  /** True when critically low (<= 3 requests left): deliver collected work or finish immediately. */
  get isCritical() { return this.remaining <= 3; }

  assertAvailable() {
    if (!this.remaining) throw new InferenceBudgetExceeded(this.limit);
  }

  take(provider: string, model: string): InferenceAttempt {
    this.assertAvailable();
    const attempt = { provider, model, startedAt: Date.now() };
    this.attempts.push(attempt);
    return attempt;
  }

  /** Concise prompt line so the agent adapts its strategy as budget shrinks. */
  statusSummary(): string {
    const base = `Inference budget: ${this.remaining}/${this.limit} requests remaining`;
    if (this.isCritical) {
      return `${base} (CRITICAL — immediately send any already-stashed valid results and call done, or report partial progress honestly; do not start new exploratory searches).`;
    }
    if (this.isLow) {
      return `${base} (LOW — prioritize direct media retrieval and delivery of remaining needed items; avoid exploratory clicks, redundant searches, or unnecessary screenshots).`;
    }
    return base;
  }
}
