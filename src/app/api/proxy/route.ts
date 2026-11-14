import { NextRequest } from "next/server";
import { validateOrReject } from "@/lib/url-validator";
import { rewritePlaylist } from "@/lib/chat-video";
import { isAdHost, proxyClientScript, rewriteCss, rewriteHtml, stripHostileScripts, withProxyToken } from "@/lib/server/proxy-rewrite";
import { fetchUpstream } from "@/lib/server/upstream-fetch";
import { detectFakeVerification } from "@/lib/security/fake-verification";
import { PROXY_TOKEN_PARAM, signProxyToken, verifyProxyToken } from "@/lib/auth-token";

// Proxied pages are other people's code served from our address. The CSP sandbox gives them
// an opaque origin: no access to our cookies, storage, API session or parent page, no top-level
// redirects, no alert/confirm prompts. Search engines shouldn't index our address for them.
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-presentation allow-pointer-lock; frame-ancestors 'self'";
const HARDEN = {
  "Content-Security-Policy": SANDBOX,
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export const runtime = "nodejs";
export const maxDuration = 60;

const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];
const isPlaylist = (url: string, type: string) => /mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url);

function errorPage(url: string, why: string, status = 200): Response {
  const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui, sans-serif; background: #000; color: #ff9500; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; } h2 { font-size: 1rem; margin-bottom: 0.5rem; }
  p { color: #71717a; font-size: 0.8rem; } a { color: #ff9500; text-decoration: underline; }
</style></head><body><div class="box">
  <h2>Couldn't load this site inline</h2><p>${why.replace(/</g, "&lt;")}</p>
  <p style="margin-top:1rem"><a href="${safe}" target="_blank" rel="noopener">Open in browser instead →</a></p>
</div><script>try{if(parent!==window)parent.postMessage(${JSON.stringify({ senkoEmbedError: 1, url, reason: why }).replace(/</g, "\\u003c")},"*")}catch(e){}</script></body></html>`;
  return new Response(html, { status, headers: { ...HARDEN, "Content-Type": "text/html; charset=utf-8", "X-Senko-Proxy-Error": "1" } });
}

/** Most sites POST their API calls (GraphQL, JSON) with a Content-Type that needs a preflight. */
export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") || "content-type",
      "Access-Control-Max-Age": "600",
    },
  });
}

const MAX_POST_BYTES = 5 * 1024 * 1024;

/**
 * An embedded page's POSTs: its own API calls (/api/proxy?asset=1&url=...) and the forms the
 * client script sends here (the target is the form's hidden "url" field). Only with the signed
 * token, so this isn't an open POST relay.
 */
export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") || "";
  if (Number(req.headers.get("content-length") || 0) > MAX_POST_BYTES) return new Response("too large", { status: 413 });
  const target = new URL(req.url);
  let body: BodyInit;
  let contentType: string | undefined = type || undefined;
  if (!target.searchParams.get("url") && /application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)) {
    const fd = await req.formData();
    for (const k of ["url", PROXY_TOKEN_PARAM]) {
      const v = fd.get(k);
      if (typeof v === "string" && v) target.searchParams.set(k, v);
      fd.delete(k);
    }
    if (/urlencoded/i.test(type)) {
      body = new URLSearchParams([...fd.entries()].filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    } else {
      body = fd;
      contentType = undefined; // fetch writes the multipart boundary itself
    }
  } else {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_POST_BYTES) return new Response("too large", { status: 413 });
    body = buf;
  }
  return handle(new NextRequest(target, { headers: req.headers, signal: req.signal }), { body, contentType });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest, post?: { body: BodyInit; contentType?: string }): Promise<Response> {
  // "__sp": a reload / Back of an embedded page at its real path, rewritten here by src/proxy.ts
  // (the rewrite keeps the original query, so the real URL is in the marker, not in "url").
  const sp = req.nextUrl.searchParams.get("__sp");
  let url = req.nextUrl.searchParams.get("url") || (sp && /^https?:\/\//i.test(sp) ? sp : null);
  if (!url) return new Response("url required", { status: 400 });

  // SSRF protection: block private IPs, cloud metadata, non-http schemes
  const ssrfBlock = validateOrReject(url);
  if (ssrfBlock) return ssrfBlock;

  // Extra query params come from GET forms the page submitted through us:
  // /api/proxy?url=https://site.com/search&key=eevee -> https://site.com/search?key=eevee
  const extra = new URLSearchParams();
  req.nextUrl.searchParams.forEach((val, key) => {
    if (sp) return; // the marker already is the full real URL
    if (key !== "url" && key !== "asset" && key !== "ref" && key !== PROXY_TOKEN_PARAM) extra.append(key, val);
  });
  if (extra.toString()) url = url + (url.includes("?") ? "&" : "?") + extra.toString();

  if (isAdHost(url)) return new Response("", { status: 204 });

  const isAsset = req.nextUrl.searchParams.get("asset") === "1";
  // Pages only load for the app itself (an embed with a signed token, or our own pages), so a
  // link made elsewhere can't show someone's page (a phishing / fake-captcha page) on our address.
  const pt = req.nextUrl.searchParams.get(PROXY_TOKEN_PARAM);
  const tokenOk = await verifyProxyToken(pt);
  const fromApp = req.headers.get("sec-fetch-site") === "same-origin";
  if (!isAsset && !tokenOk && !fromApp) return errorPage(url, "This proxy link only works inside Senko.", 403);
  if (post && !tokenOk && !fromApp) return new Response("signed token required", { status: 403 });
  const token = tokenOk ? pt! : await signProxyToken();
  const ref = req.nextUrl.searchParams.get("ref") || undefined;
  let referer: string;
  try {
    referer = (ref ? new URL(ref).origin : new URL(url).origin) + "/";
  } catch {
    referer = "";
  }

  const headers: Record<string, string> = {
    Accept: isAsset ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (referer) headers.Referer = referer;
  const range = req.headers.get("range");
  if (range) headers.Range = range;
  if (post?.contentType) headers["Content-Type"] = post.contentType;
  if (post && referer) headers.Origin = referer.replace(/\/$/, "");

  try {
    const { res, finalUrl, challenged } = await fetchUpstream(url, {
      headers, signal: req.signal, timeoutMs: isAsset ? 45_000 : 15_000,
      ...(post ? { method: "POST" as const, body: post.body } : {}),
    });
    const redirectBlock = validateOrReject(finalUrl);
    if (redirectBlock) return redirectBlock;
    const contentType = res.headers.get("content-type") || "";
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges" };

    if (contentType.includes("text/css")) {
      const css = withProxyToken(rewriteCss(await res.text(), finalUrl, ref), token);
      return new Response(css, { status: res.status, headers: { ...cors, ...HARDEN, "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }

    // HLS: every variant and segment comes back through the video proxy (Referer kept).
    if (isPlaylist(finalUrl, contentType)) {
      const body = withProxyToken(rewritePlaylist(await res.text(), finalUrl, referer || undefined), token);
      return new Response(body, { status: 200, headers: { ...cors, ...HARDEN, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" } });
    }

    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
    // Images, fonts, scripts, video (streamed, with Range for seeking), XHR responses.
    if (isAsset || !isHtml) {
      const out = new Headers({ ...cors, ...HARDEN });
      for (const h of PASS_HEADERS) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
      if (!out.has("content-type")) out.set("Content-Type", "application/octet-stream");
      // Never render a page from an asset link: scripts reading it get text, browsers show text.
      if (/html|xml|svg/i.test(out.get("content-type") || "") && !/^image\/svg/i.test(contentType)) out.set("Content-Type", "text/plain; charset=utf-8");
      if (/^(?:video|audio)\//i.test(contentType) && !out.has("accept-ranges")) out.set("Accept-Ranges", "bytes");
      out.set("Cache-Control", res.status === 200 || res.status === 206 ? "public, max-age=3600" : "no-store");
      return new Response(res.body, { status: res.status, headers: out });
    }

    let html = await res.text();
    if (challenged) return errorPage(url, `${new URL(url).hostname} shows a bot check to servers. Open it in the live browser instead.`);
    const fake = detectFakeVerification({ html });
    if (fake) return errorPage(url, `Blocked: ${fake.reason} Don't follow any steps it shows.`);
    html = stripHostileScripts(html);
    html = withProxyToken(rewriteHtml(html, finalUrl), token);
    const script = withProxyToken(proxyClientScript(finalUrl), token);
    // Run before the page's own scripts.
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + script);
    else html = script + html;

    return new Response(html, {
      status: res.status,
      headers: { ...HARDEN, "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (isAsset) return new Response("", { status: 502 });
    return errorPage(url, err instanceof Error ? err.message : "Connection failed");
  }
}
