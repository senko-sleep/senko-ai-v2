import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new Response("url required", { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    const contentType = res.headers.get("content-type") || "text/html";
    let body: string | ArrayBuffer;

    if (contentType.includes("text/html") || contentType.includes("text/css") || contentType.includes("javascript")) {
      let html = await res.text();

      // Rewrite relative URLs to absolute
      try {
        const base = new URL(url);
        const origin = base.origin;

        // Inject a <base> tag so relative URLs resolve correctly
        if (html.includes("<head")) {
          html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
        } else if (html.includes("<html")) {
          html = html.replace(/<html([^>]*)>/i, `<html$1><head><base href="${origin}/"></head>`);
        }
      } catch {
        // skip base injection
      }

      body = html;
    } else {
      body = await res.arrayBuffer();
    }

    // Build response with frame-blocking headers stripped
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Access-Control-Allow-Origin", "*");
    // Explicitly do NOT copy X-Frame-Options or CSP headers

    return new Response(body, {
      status: res.status,
      headers,
    });
  } catch (err) {
    return new Response(
      `Proxy error: ${err instanceof Error ? err.message : "Failed to fetch"}`,
      { status: 502 }
    );
  }
}
