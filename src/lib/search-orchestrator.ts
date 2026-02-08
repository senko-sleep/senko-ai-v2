// Search Orchestrator — manages the 5-level fallback cascade with exponential backoff
// Each level gets up to 3 retries before escalating to the next fallback

import { config } from "@/lib/config";
import {
  SearchLogger,
  type SearchEngineName,
  type SearchErrorCode,
  type SearchLogEntry,
} from "@/lib/search-logger";
import {
  searchRenderApi,
  searchDuckDuckGo,
  searchSerper,
  searchPuppeteer,
  type SearchResult,
  type EngineResponse,
} from "@/lib/search-engines";

interface FallbackLevel {
  level: 1 | 2 | 3 | 4;
  name: SearchEngineName;
  fn: (query: string) => Promise<EngineResponse>;
  errorCodePrefix: string;
}

const FALLBACK_CASCADE: FallbackLevel[] = [
  { level: 1, name: "render-api", fn: searchRenderApi,   errorCodePrefix: "RENDER" },
  { level: 2, name: "duckduckgo", fn: searchDuckDuckGo,  errorCodePrefix: "DDG" },
  { level: 3, name: "serper",     fn: searchSerper,       errorCodePrefix: "SERPER" },
  { level: 4, name: "puppeteer",  fn: searchPuppeteer,    errorCodePrefix: "PUPPETEER" },
];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 * Formula: min(base * 2^attempt + jitter, max)
 */
function getBackoffDelay(attempt: number): number {
  const base = config.searchBackoffBase;
  const max = config.searchBackoffMax;
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.5; // up to 50% of base as jitter
  return Math.min(exponential + jitter, max);
}

/**
 * Classify an EngineResponse error into a typed SearchErrorCode.
 */
function classifyError(prefix: string, response: EngineResponse): SearchErrorCode {
  const err = (response.error || "").toLowerCase();
  const status = response.status;

  if (status === 401 || status === 403) {
    if (err.includes("auth") || err.includes("api_key") || err.includes("key")) {
      return `${prefix}_AUTH_FAILED` as SearchErrorCode;
    }
    if (err.includes("captcha") || err.includes("bot") || err.includes("vqd")) {
      return `${prefix}_${prefix === "DDG" ? "VQD_BLOCKED" : "CAPTCHA"}` as SearchErrorCode;
    }
    return `${prefix}_HTTP_ERROR` as SearchErrorCode;
  }

  if (status === 429 || err.includes("rate limit")) {
    return `${prefix}_RATE_LIMITED` as SearchErrorCode;
  }

  if (status === 408 || err.includes("timeout") || err.includes("abort")) {
    return `${prefix}_TIMEOUT` as SearchErrorCode;
  }

  if (status === 200 && response.results.length === 0) {
    return `${prefix}_EMPTY_RESULTS` as SearchErrorCode;
  }

  if (err.includes("vqd") || err.includes("bot detection")) {
    return `${prefix === "DDG" ? "DDG_BOT_DETECTION" : `${prefix}_HTTP_ERROR`}` as SearchErrorCode;
  }

  if (err.includes("unavailable") || err.includes("not configured")) {
    return `${prefix}_UNAVAILABLE` as SearchErrorCode;
  }

  if (status !== 200 && status !== 0) {
    return `${prefix}_HTTP_ERROR` as SearchErrorCode;
  }

  return "UNKNOWN_ERROR";
}

export interface OrchestratorResult {
  results: SearchResult[];
  log: SearchLogEntry;
}

/**
 * Execute the full search cascade.
 * For each fallback level, retries up to `searchMaxRetries` times with exponential backoff.
 * Moves to the next level when all retries are exhausted or a non-retryable error occurs.
 */
export async function executeSearch(query: string): Promise<OrchestratorResult> {
  const logger = new SearchLogger(query);
  const maxRetries = config.searchMaxRetries;

  let lastErrorCode: SearchErrorCode = "UNKNOWN_ERROR";
  let lastErrorMessage = "";
  let lastSource: SearchEngineName = "render-api";
  let lastLevel: 1 | 2 | 3 | 4 = 1;

  for (const fallback of FALLBACK_CASCADE) {
    let retryCount = 0;
    let shouldEscalate = false;

    while (retryCount < maxRetries && !shouldEscalate) {
      const attemptStart = Date.now();

      // Add backoff delay between retries (not before first attempt of each level)
      if (retryCount > 0) {
        const backoffMs = getBackoffDelay(retryCount - 1);
        console.log(`[search][${fallback.name}] backoff ${Math.round(backoffMs)}ms before retry ${retryCount + 1}/${maxRetries}`);
        await delay(backoffMs);
      }

      let response: EngineResponse;
      try {
        response = await fallback.fn(query);
      } catch (err) {
        // Catch any unexpected throws from engine implementations
        const msg = err instanceof Error ? err.message : String(err);
        response = { results: [], status: 0, error: `Unexpected error in ${fallback.name}: ${msg}` };
      }

      const responseTimeMs = Date.now() - attemptStart;

      // Log the attempt
      logger.logAttempt({
        engine: fallback.name,
        status: response.status,
        success: response.results.length > 0,
        responseTimeMs,
        error: response.error,
        retryCount,
      });

      // Success — return immediately
      if (response.results.length > 0) {
        const log = logger.buildSuccess(fallback.name, response.results.length);
        return { results: response.results, log };
      }

      // Classify the error
      const errorCode = classifyError(fallback.errorCodePrefix, response);
      lastErrorCode = errorCode;
      lastErrorMessage = response.error || `${fallback.name} returned no results`;
      lastSource = fallback.name;
      lastLevel = fallback.level;

      // Determine if this error is retryable or should immediately escalate
      const nonRetryablePatterns = [
        "not configured",
        "auth",
        "api_key",
        "unavailable",
      ];
      const isNonRetryable = nonRetryablePatterns.some(p =>
        (response.error || "").toLowerCase().includes(p)
      );

      if (isNonRetryable) {
        console.log(`[search][${fallback.name}] non-retryable error, escalating to next fallback`);
        shouldEscalate = true;
      } else {
        retryCount++;
      }
    }

    // Small delay between fallback levels to avoid thundering herd
    if (fallback.level < 4) {
      await delay(200);
    }
  }

  // All fallbacks exhausted
  const log = logger.buildFailure(
    lastErrorCode,
    lastErrorMessage,
    lastSource,
    lastLevel
  );

  return { results: [], log };
}
