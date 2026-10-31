/**
 * GET /api/youtube?q=QUERY&sort=relevance|views|date&period=any|week|month&limit=10
 *
 * Returns verified YouTube search results using searchYouTube() from youtube.ts.
 * Never returns invented video IDs, titles, or stats — all results are verified
 * via the oEmbed API before being returned.
 *
 * Rate-limited: 1 request per 2 seconds per IP address.
 */
import { NextRequest } from "next/server";
import { identify, errorResponse } from "@/lib/server/identity";
import { searchYouTube, verifyYouTubeVideo, type YouTubeSort, type YouTubePeriod } from "@/lib/server/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple in-memory rate limiter: 1 req / 2 s per IP.
const rateLimiter = new Map<string, number>();
const RATE_WINDOW_MS = 2000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const last = rateLimiter.get(ip) ?? 0;
  if (now - last < RATE_WINDOW_MS) return false;
  rateLimiter.set(ip, now);
  // Prune stale entries periodically.
  if (rateLimiter.size > 500) {
    for (const [k, v] of rateLimiter) {
      if (now - v > 60_000) rateLimiter.delete(k);
    }
  }
  return true;
}

export async function GET(req: NextRequest) {
  try {
    await identify(req);
  } catch (e) {
    return errorResponse(e);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRate(ip)) {
    return Response.json({ ok: false, error: "Too many requests. Please wait a moment." }, { status: 429 });
  }

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ ok: false, error: "Missing required query parameter: q" }, { status: 400 });
  }

  const sortParam = searchParams.get("sort") ?? "relevance";
  const sort: YouTubeSort = sortParam === "views" || sortParam === "date" ? sortParam : "relevance";

  const periodParam = searchParams.get("period") ?? "any";
  const validPeriods: YouTubePeriod[] = ["any", "hour", "today", "week", "month", "year"];
  const period: YouTubePeriod = validPeriods.includes(periodParam as YouTubePeriod)
    ? (periodParam as YouTubePeriod)
    : "any";

  const limitParam = parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? 10 : limitParam, 15));

  const signal = req.signal;

  const outcome = await searchYouTube(
    { query: q, sort, period, limit },
    { signal, verify: verifyYouTubeVideo }
  ).catch((e) => ({
    ok: false as const,
    results: [],
    source: "",
    dropped: 0,
    error: e instanceof Error ? e.message : "YouTube search failed.",
  }));

  return Response.json(outcome);
}
