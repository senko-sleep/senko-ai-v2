import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new Response("url required", { status: 400 });
  }

  // If this is a sub-resource request (CSS, JS, image, etc.), just proxy it directly
  const isSubResource = req.nextUrl.searchParams.get("asset") === "1";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: isSubResource
          ? "*/*"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "text/html";

    // For sub-resources or non-HTML, just pass through
    if (isSubResource || (!contentType.includes("text/html") && !contentType.includes("application/xhtml"))) {
      const body = await res.arrayBuffer();
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "public, max-age=3600");
      return new Response(body, { status: res.status, headers });
    }

    // HTML content -- rewrite for embedding
    let html = await res.text();

    try {
      const base = new URL(url);
      const origin = base.origin;
      const basePath = url.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");

      // Remove any existing <base> tags to avoid conflicts
      html = html.replace(/<base[^>]*>/gi, "");

      // Inject <base> tag for relative URL resolution
      if (html.includes("<head")) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${basePath}">`);
      } else if (html.includes("<html")) {
        html = html.replace(/<html([^>]*)>/i, `<html$1><head><base href="${basePath}"></head>`);
      } else {
        html = `<head><base href="${basePath}"></head>` + html;
      }

      // Remove CSP meta tags that block inline scripts/styles
      html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");

      // Remove any frame-busting scripts
      html = html.replace(/if\s*\(\s*(?:top|window\.top|parent|window\.parent)\s*!==?\s*(?:self|window\.self|window)\s*\)[^}]*}/gi, "");
      html = html.replace(/top\.location\s*=\s*self\.location/gi, "");
      html = html.replace(/window\.top\.location/gi, "window.location");

      // Inject a small script to catch and suppress frame-busting attempts
      const antiFrameBust = `<script>
        // Prevent frame-busting
        try {
          Object.defineProperty(window, 'top', { get: function() { return window; } });
        } catch(e) {}
        // Fix relative fetch/XHR calls by ensuring they go to the right origin
        window.__PROXY_ORIGIN__ = "${origin}";
      </script>`;

      if (html.includes("</head>")) {
        html = html.replace("</head>", antiFrameBust + "</head>");
      } else {
        html = antiFrameBust + html;
      }
    } catch {
      // skip rewriting if URL parsing fails
    }

    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Access-Control-Allow-Origin", "*");
    // Explicitly strip all frame-blocking headers
    // Do NOT set X-Frame-Options, Content-Security-Policy, or Cross-Origin-Embedder-Policy

    return new Response(html, {
      status: res.status,
      headers,
    });
  } catch (err) {
    // Return a styled error page instead of raw text
    const errorHtml = `<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui, sans-serif; background: #000000; color: #00d4ff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; }
  h2 { font-size: 1rem; margin-bottom: 0.5rem; }
  p { color: #71717a; font-size: 0.8rem; }
  a { color: #00d4ff; text-decoration: underline; }
</style></head><body>
  <div class="box">
    <h2>Couldn't load this site inline</h2>
    <p>${err instanceof Error ? err.message : "Connection failed"}</p>
    <p style="margin-top:1rem"><a href="${url}" target="_blank" rel="noopener">Open in browser instead →</a></p>
  </div>
</body></html>`;
    return new Response(errorHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
