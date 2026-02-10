// Structured search logging system for the fallback cascade

export type SearchErrorCode =
  | "RENDER_TIMEOUT"
  | "RENDER_HTTP_ERROR"
  | "RENDER_EMPTY_RESULTS"
  | "RENDER_UNAVAILABLE"
  | "DDG_VQD_BLOCKED"
  | "DDG_BOT_DETECTION"
  | "DDG_TIMEOUT"
  | "DDG_EMPTY_RESULTS"
  | "DDG_HTTP_ERROR"
  | "SERPER_AUTH_FAILED"
  | "SERPER_RATE_LIMITED"
  | "SERPER_TIMEOUT"
  | "SERPER_EMPTY_RESULTS"
  | "SERPER_HTTP_ERROR"
  | "PUPPETEER_UNAVAILABLE"
  | "PUPPETEER_TIMEOUT"
  | "PUPPETEER_CRASH"
  | "PUPPETEER_EMPTY_RESULTS"
  | "PUPPETEER_CAPTCHA"
  | "GOOGLE_HTTP_ERROR"
  | "GOOGLE_TIMEOUT"
  | "GOOGLE_EMPTY_RESULTS"
  | "GOOGLE_CAPTCHA"
  | "ALL_FALLBACKS_EXHAUSTED"
  | "UNKNOWN_ERROR";

export type SearchEngineName =
  | "render-api"
  | "duckduckgo"
  | "google-scrape"
  | "serper"
  | "puppeteer";

export interface SearchAttempt {
  engine: SearchEngineName;
  status: number;
  success: boolean;
  responseTimeMs: number;
  error?: string;
  retryCount?: number;
}

export interface SearchError {
  code: SearchErrorCode;
  message: string;
  source: SearchEngineName;
  fallbackLevel: 1 | 2 | 3 | 4 | 5;
  timestamp: string;
}

export interface SearchLogEntry {
  success: boolean;
  query: string;
  totalTimeMs: number;
  resolvedBy?: SearchEngineName;
  error?: SearchError;
  attempts: SearchAttempt[];
}

export class SearchLogger {
  private attempts: SearchAttempt[] = [];
  private startTime: number;
  private query: string;

  constructor(query: string) {
    this.query = query;
    this.startTime = Date.now();
  }

  logAttempt(attempt: SearchAttempt): void {
    this.attempts.push(attempt);
    const status = attempt.success ? "✓" : "✗";
    const retryInfo = attempt.retryCount !== undefined ? ` (retry ${attempt.retryCount})` : "";
    console.log(
      `[search][${attempt.engine}] ${status} status=${attempt.status} time=${attempt.responseTimeMs}ms${retryInfo}${attempt.error ? ` err="${attempt.error}"` : ""}`
    );
  }

  buildSuccess(resolvedBy: SearchEngineName, resultCount: number): SearchLogEntry {
    const entry: SearchLogEntry = {
      success: true,
      query: this.query,
      totalTimeMs: Date.now() - this.startTime,
      resolvedBy,
      attempts: this.attempts,
    };
    console.log(
      `[search] ✓ resolved by ${resolvedBy} with ${resultCount} results in ${entry.totalTimeMs}ms after ${this.attempts.length} attempt(s)`
    );
    return entry;
  }

  buildFailure(
    code: SearchErrorCode,
    message: string,
    source: SearchEngineName,
    fallbackLevel: 1 | 2 | 3 | 4 | 5
  ): SearchLogEntry {
    const entry: SearchLogEntry = {
      success: false,
      query: this.query,
      totalTimeMs: Date.now() - this.startTime,
      error: {
        code,
        message,
        source,
        fallbackLevel,
        timestamp: new Date().toISOString(),
      },
      attempts: this.attempts,
    };
    console.error(
      `[search] ✗ all fallbacks exhausted for "${this.query}" after ${this.attempts.length} attempt(s) in ${entry.totalTimeMs}ms — last error: ${code} from ${source}`
    );
    return entry;
  }

  getAttempts(): SearchAttempt[] {
    return [...this.attempts];
  }
}
