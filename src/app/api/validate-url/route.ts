import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Lightweight URL validator — HEAD request with short timeout
// Returns { valid: true, url: finalUrl } or { valid: false }
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return Response.json({ valid: false, error: "No URL provided" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    clearTimeout(timeout);

    // Valid if we get any response that isn't a DNS/connection error
    // Even 403/404 means the domain exists — the site is real
    const valid = res.status < 500;
    return Response.json({ valid, status: res.status, url: res.url || url });
  } catch (err: unknown) {
    // HEAD failed — try GET (some servers reject HEAD)
    try {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 4000);

      const res2 = await fetch(url, {
        method: "GET",
        signal: controller2.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Range": "bytes=0-0", // Minimize data transfer
        },
      });

      clearTimeout(timeout2);
      const valid = res2.status < 500;
      return Response.json({ valid, status: res2.status, url: res2.url || url });
    } catch {
      // Both HEAD and GET failed — domain doesn't exist or is unreachable
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ valid: false, error: message });
    }
  }
}
