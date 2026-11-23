export type ProviderHealthState = "untested" | "healthy" | "transient_failure" | "configuration_error" | "unavailable";
export interface ProviderHealth {
  state: ProviderHealthState;
  checkedAt: number;
  status: number;
  reason: string;
  retryable: boolean;
  failures: number;
  retryAt?: number;
}

const health = new Map<string, ProviderHealth>();
const key = (provider: string, model: string) => `${provider}|${model}`;

const RETIRED = /\b(?:deprecated|decommissioned|retired|end[- ]of[- ]life|no longer (?:available|supported|exists?))\b/i;
const NOT_ON_PLAN = /\b(?:not available (?:on|in|for) (?:the |your )?(?:current |free )?(?:plan|tier)|(?:requires?|upgrade(?: to)?) (?:a |an |your )?(?:paid|pro|higher|enterprise)\b|insufficient (?:credits?|balance|funds)|out of credits?)/i;

/** The status code, refined by what the provider said: retired models and plan limits never heal on retry. */
export function classifyProviderFailure(status: number, message = ""): { state: ProviderHealthState; retryable: boolean } {
  if (status !== 429 && status < 500 && RETIRED.test(message)) return { state: "unavailable", retryable: false };
  if (status !== 429 && status < 500 && NOT_ON_PLAN.test(message)) return { state: "configuration_error", retryable: false };
  if (status === 404 || status === 410) return { state: "unavailable", retryable: false };
  if (status === 401 || status === 402 || status === 403) return { state: "configuration_error", retryable: false };
  return { state: "transient_failure", retryable: status === 0 || status === 408 || status === 429 || status >= 500 };
}

export function providerHealth(provider: string, model: string): ProviderHealth | undefined { return health.get(key(provider, model)); }
export function modelUnavailable(provider: string, model: string): boolean { return providerHealth(provider, model)?.state === "unavailable"; }
export function recordProviderSuccess(provider: string, model: string): void {
  health.set(key(provider, model), { state: "healthy", checkedAt: Date.now(), status: 200, reason: "Real inference completed.", retryable: false, failures: 0 });
}
export function recordProviderFailure(provider: string, model: string, status: number, reason: string, retryMs?: number | null): ProviderHealth {
  const previous = health.get(key(provider, model));
  const classification = classifyProviderFailure(status, reason);
  const failures = (previous?.failures || 0) + 1;
  const backoff = Math.max(retryMs || 0, Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)));
  const entry: ProviderHealth = { ...classification, checkedAt: Date.now(), status, reason: reason.slice(0, 350), failures,
    ...(classification.retryable ? { retryAt: Date.now() + backoff } : {}) };
  health.set(key(provider, model), entry);
  return entry;
}
/** Explicit probe may recheck after an operator changes configuration. */
export function resetProviderHealth(provider: string, model: string): void { health.delete(key(provider, model)); }
export function knownProviderHealth(provider: string): { model: string; health: ProviderHealth }[] {
  return [...health.entries()].filter(([id]) => id.startsWith(`${provider}|`)).map(([id, health]) => ({ model: id.slice(provider.length + 1), health }));
}
