// Primary search engine: calls the standalone search API on Render.com
// This API runs Puppeteer + multi-engine scraping outside of Vercel's restrictions

import { config } from "@/lib/config";
import type { SearchResult, EngineResponse } from "./types";

export async function searchRenderApi(query: string): Promise<EngineResponse> {
  const baseUrl = config.searchApiUrl;
  if (!baseUrl) {
    return {
      results: [],
      status: 0,
      error: "SEARCH_API_URL not configured — skipping Render API",
    };
  }

  try {
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
    console.log(`[render-api] Calling ${url}`);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(config.searchTimeout + 10000), // extra time for Puppeteer fallback
    });

    if (!res.ok) {
      return {
        results: [],
        status: res.status,
        error: `Render search API returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();

    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
      const results: SearchResult[] = data.results.slice(0, 25).map((r: { title?: string; url?: string; snippet?: string }) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.snippet || "",
      }));
      console.log(`[render-api] ✓ ${data.engine} returned ${results.length} results`);
      return { results, status: 200 };
    }

    return {
      results: [],
      status: 200,
      error: data.error || "Render search API returned no results",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("abort")) {
      return {
        results: [],
        status: 408,
        error: `Render search API timed out after ${config.searchTimeout + 10000}ms`,
      };
    }
    return {
      results: [],
      status: 0,
      error: `Render search API network error: ${msg}`,
    };
  }
}
