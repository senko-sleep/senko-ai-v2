import { describe, expect, it } from "vitest";
import { classifyProviderFailure, modelUnavailable, providerHealth, recordProviderFailure, recordProviderSuccess, resetProviderHealth } from "@/lib/llm/provider-health";

describe("provider recovery classification", () => {
  it("never treats retired models or invalid credentials as transient outages", () => {
    for (const status of [404, 410]) expect(classifyProviderFailure(status)).toEqual({ state: "unavailable", retryable: false });
    for (const status of [401, 402, 403]) expect(classifyProviderFailure(status)).toEqual({ state: "configuration_error", retryable: false });
    for (const status of [0, 408, 429, 500, 503]) expect(classifyProviderFailure(status).retryable).toBe(true);
  });
  it("records permanent rejection, bounded exponential recovery, and a real recovery result", () => {
    resetProviderHealth("fixture", "model");
    const a = recordProviderFailure("fixture", "model", 503, "Unavailable");
    const b = recordProviderFailure("fixture", "model", 503, "Unavailable");
    expect(b.retryAt! - b.checkedAt).toBeGreaterThan(a.retryAt! - a.checkedAt);
    for (let i = 0; i < 20; i++) recordProviderFailure("fixture", "model", 503, "Unavailable");
    const capped = providerHealth("fixture", "model")!;
    expect(capped.retryAt! - capped.checkedAt).toBeLessThanOrEqual(30_000);
    recordProviderFailure("fixture", "model", 410, "Retired");
    expect(modelUnavailable("fixture", "model")).toBe(true);
    recordProviderSuccess("fixture", "model");
    expect(providerHealth("fixture", "model")?.state).toBe("healthy");
  });
});
