// Fallback Level 2: Serper API (Google Search API wrapper)

import { config } from "@/lib/config";
import type { SearchResult, EngineResponse } from "./types";

/**
 * Serper.dev Google Search API.
 * Requires SERPER_API_KEY in environment.
 * Returns structured JSON results — most reliable when available.
 */
export async function searchSerper(query: string): Promise<EngineResponse> {
  const apiKey = config.serperApiKey;
  if (!apiKey) {
    return {
      results: [],
      status: 401,
      error: "SERPER_API_KEY not configured — skipping Serper fallback",
    };
  }

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: config.searchMaxResults,
      }),
      signal: AbortSignal.timeout(config.searchTimeout),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        results: [],
        status: res.status,
        error: `Serper API authentication failed (HTTP ${res.status}) — check SERPER_API_KEY`,
      };
    }

    if (res.status === 429) {
      return {
        results: [],
        status: 429,
        error: "Serper API rate limit exceeded — too many requests",
      };
    }

    if (!res.ok) {
      return {
        results: [],
        status: res.status,
        error: `Serper API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const results: SearchResult[] = [];

    if (data.organic && Array.isArray(data.organic)) {
      for (const item of data.organic.slice(0, 10)) {
        if (item.link || item.url) {
          results.push({
            title: item.title || "",
            url: item.link || item.url || "",
            snippet: item.snippet || item.description || "",
          });
        }
      }
    }

    if (results.length === 0) {
      return {
        results: [],
        status: 200,
        error: "Serper API returned 200 but no organic results in response body",
      };
    }

    return { results, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort")) {
      return {
        results: [],
        status: 408,
        error: `Serper API request timed out after ${config.searchTimeout}ms`,
      };
    }
    return {
      results: [],
      status: 0,
      error: `Serper API network error: ${msg}`,
    };
  }
}
