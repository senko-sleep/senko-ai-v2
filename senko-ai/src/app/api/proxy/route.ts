import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Resolve a possibly-relative URL against a base */
function resolveUrl(raw: string, base: string): string {
  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

/** Build a proxied URL for a sub-resource */
function proxyAsset(absUrl: string): string {
  return `/api/proxy?asset=1&url=${encodeURIComponent(absUrl)}`;
}

/** Build a proxied URL for an HTML page (navigation) */
function proxyPage(absUrl: string): string {
  return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
}

/** Rewrite all attribute URLs in HTML to go through the proxy */
function rewriteHtml(html: string, pageUrl: string): string {
  const base = pageUrl.replace(/[?#].*$/, "");

  // Remove existing <base> tags
  html = html.replace(/<base[^>]*>/gi, "");

  // Rewrite src= attributes (scripts, images, iframes, video, audio, source)
  html = html.replace(
    /(<(?:img|script|iframe|video|audio|source|embed|input)\b[^>]*?\s)src\s*=\s*(["'])(.*?)\2/gi,
    (_m, pre, q, val) => {
      if (val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("javascript:")) return _m;
      const abs = resolveUrl(val, base);
      return `${pre}src=${q}${proxyAsset(abs)}${q}`;
    }
  );

  // Rewrite href= on <link> tags (CSS, icons, preload)
  html = html.replace(
    /(<link\b[^>]*?\s)href\s*=\s*(["'])(.*?)\2/gi,
    (_m, pre, q, val) => {
      if (val.startsWith("data:") || val.startsWith("blob:")) return _m;
      const abs = resolveUrl(val, base);
      return `${pre}href=${q}${proxyAsset(abs)}${q}`;
    }
  );

  // Rewrite href= on <a> tags → proxy page navigation
  html = html.replace(
    /(<a\b[^>]*?\s)href\s*=\s*(["'])(.*?)\2/gi,
    (_m, pre, q, val) => {
      if (val.startsWith("#") || val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("javascript:") || val.startsWith("mailto:") || val.startsWith("tel:")) return _m;
      const abs = resolveUrl(val, base);
      return `${pre}href=${q}${proxyPage(abs)}${q}`;
    }
  );

  // Rewrite action= on <form> tags
  html = html.replace(
    /(<form\b[^>]*?\s)action\s*=\s*(["'])(.*?)\2/gi,
    (_m, pre, q, val) => {
      if (val.startsWith("javascript:")) return _m;
      const abs = resolveUrl(val, base);
      return `${pre}action=${q}${proxyPage(abs)}${q}`;
    }
  );

  // Rewrite srcset= attributes
  html = html.replace(
    /srcset\s*=\s*(["'])(.*?)\1/gi,
    (_m, q, val) => {
      const rewritten = val.replace(/(\S+)(\s+\S+)?/g, (part: string, url: string, descriptor: string) => {
        if (url.startsWith("data:")) return part;
        const abs = resolveUrl(url, base);
        return proxyAsset(abs) + (descriptor || "");
      });
      return `srcset=${q}${rewritten}${q}`;
    }
  );

  // Rewrite poster= attributes
  html = html.replace(
    /poster\s*=\s*(["'])(.*?)\1/gi,
    (_m, q, val) => {
      const abs = resolveUrl(val, base);
      return `poster=${q}${proxyAsset(abs)}${q}`;
    }
  );

  // Rewrite inline style= attributes containing url(...)
  html = html.replace(
    /style\s*=\s*(["'])((?:(?!\1).)*url\s*\((?:(?!\1).)*\)(?:(?!\1).)*)\1/gi,
    (_m, q, val) => {
      const rewritten = val.replace(
        /url\(\s*(["']?)((?!data:|blob:|#).*?)\1\s*\)/gi,
        (__m: string, iq: string, ival: string) => {
          const abs = resolveUrl(ival, base);
          return `url(${iq}${proxyAsset(abs)}${iq})`;
        }
      );
      return `style=${q}${rewritten}${q}`;
    }
  );

  // Rewrite url() inside inline <style> blocks
  html = html.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, css, close) => {
      const rewritten = rewriteCss(css, base);
      return `${open}${rewritten}${close}`;
    }
  );

  return html;
}

/** Rewrite url() references inside CSS */
function rewriteCss(css: string, cssUrl: string): string {
  const base = cssUrl.replace(/[?#].*$/, "");

  // Rewrite url(...) references
  css = css.replace(
    /url\(\s*(["']?)((?!data:|blob:|#).*?)\1\s*\)/gi,
    (_m, q, val) => {
      const abs = resolveUrl(val, base);
      return `url(${q}${proxyAsset(abs)}${q})`;
    }
  );

  // Rewrite @import url(...) and @import "..."
  css = css.replace(
    /@import\s+(["'])(.*?)\1/gi,
    (_m, q, val) => {
      const abs = resolveUrl(val, base);
      return `@import ${q}${proxyAsset(abs)}${q}`;
    }
  );

  return css;
}

// Block known ad/tracker domains to prevent ERR_BLOCKED_BY_CLIENT noise
const AD_DOMAINS = new Set([
  "acquiredeceasedundress.com", "darnobedienceupscale.com", "ospaxgapf.com",
  "doubleclick.net", "googlesyndication.com", "adservice.google.com",
  "pagead2.googlesyndication.com", "trafficjunky.com", "exoclick.com",
  "juicyads.com", "popads.net", "popcash.net", "propellerads.com",
  "adglare.net", "adglare.org", "spankurbate.com", "rule34comic.party",
]);

function isAdDomain(testUrl: string): boolean {
  try {
    const hostname = new URL(testUrl).hostname;
    return AD_DOMAINS.has(hostname) || [...AD_DOMAINS].some(d => hostname.endsWith("." + d));
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new Response("url required", { status: 400 });
  }

  // Block ad/tracker requests
  if (isAdDomain(url)) {
    return new Response("", { status: 204 });
  }

  const isSubResource = req.nextUrl.searchParams.get("asset") === "1";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: isSubResource
          ? "*/*"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        Referer: new URL(url).origin + "/",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "";

    // ── CSS: rewrite url() references ──
    if (contentType.includes("text/css")) {
      let css = await res.text();
      css = rewriteCss(css, url);
      return new Response(css, {
        status: res.status,
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ── Non-HTML sub-resources (images, fonts, JS, etc.): passthrough ──
    if (isSubResource || (!contentType.includes("text/html") && !contentType.includes("application/xhtml"))) {
      const body = await res.arrayBuffer();
      const headers: Record<string, string> = {
        "Content-Type": contentType || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      };
      // Fonts need CORS headers to load cross-origin
      if (contentType.includes("font") || contentType.includes("woff") || url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
        headers["Access-Control-Allow-Origin"] = "*";
        headers["Content-Type"] = contentType || "font/woff2";
      }
      return new Response(body, { status: res.status, headers });
    }

    // ── HTML: full rewrite ──
    let html = await res.text();

    // Remove CSP meta tags
    html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");

    // Remove frame-busting JS patterns
    html = html.replace(/if\s*\(\s*(?:top|window\.top|parent|window\.parent)\s*!==?\s*(?:self|window\.self|window)\s*\)[^}]*}/gi, "");
    html = html.replace(/top\.location\s*=\s*(?:self\.location|location|window\.location)/gi, "void 0");
    html = html.replace(/window\.top\.location/gi, "window.location");
    html = html.replace(/parent\.location/gi, "window.location");

    // Strip ad/tracker script tags by domain
    html = html.replace(/<script[^>]*src=["'][^"']*(?:acquiredeceasedundress|darnobedienceupscale|ospaxgapf|trafficjunky|exoclick|juicyads|popads|popcash|propellerads|doubleclick|googlesyndication|adglare|adserver|syndication)[^"']*["'][^>]*><\/script>/gi, "");
    html = html.replace(/<script[^>]*src=["'][^"']*(?:\.bn\.js|popunder|clickunder|adserv)[^"']*["'][^>]*><\/script>/gi, "");
    // Strip inline ad scripts (AdGlare, popunders, ad networks)
    html = html.replace(/<script[^>]*>[\s\S]*?(?:AdGlare|adglare|setZone|popunder|clickunder|exoclick|juicyads|trafficjunky|spankurbate)[\s\S]*?<\/script>/gi, "");

    // Rewrite all URLs in the HTML
    html = rewriteHtml(html, url);

    // Inject navigation interceptor + frame-bust prevention
    // Pass the REAL page URL so fetch/XHR resolve relative URLs against the original site, not localhost
    const pageOrigin = new URL(url).origin;
    const proxyScript = `<script>
(function(){
  var PAGE_BASE = "${url}";
  var PAGE_ORIGIN = "${pageOrigin}";

  // Block ad/tracker domains
  var AD_HOSTS = ['acquiredeceasedundress.com','darnobedienceupscale.com','ospaxgapf.com','doubleclick.net','googlesyndication.com','trafficjunky.com','exoclick.com','juicyads.com','popads.net','popcash.net','propellerads.com','adservice.google.com','adglare.net','adglare.org','spankurbate.com','rule34comic.party'];
  function isAd(u) { try { var h = new URL(u).hostname; return AD_HOSTS.some(function(d){return h===d||h.endsWith('.'+d)}); } catch(e){return false;} }

  // Prevent frame-busting
  try { Object.defineProperty(window,'top',{get:function(){return window}}); } catch(e){}

  // Resolve a URL against the original page, not localhost
  function resolveAgainstPage(raw) {
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('/api/proxy')) return null;
    try {
      // Relative URLs like /foo or ./bar should resolve against the original site
      if (raw.startsWith('/')) return PAGE_ORIGIN + raw;
      if (raw.startsWith('http')) return raw;
      return new URL(raw, PAGE_BASE).href;
    } catch(e) { return null; }
  }

  // Intercept all link clicks to stay in proxy
  document.addEventListener('click', function(e) {
    var a = e.target;
    while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.href) return;
    if (a.href.startsWith('#') || a.href.startsWith('javascript:') || a.href.startsWith('mailto:') || a.href.startsWith('tel:')) return;
    if (a.href.includes('/api/proxy')) return;
    e.preventDefault();
    var resolved = resolveAgainstPage(a.getAttribute('href')) || a.href;
    var proxyUrl = '/api/proxy?url=' + encodeURIComponent(resolved);
    var target = a.getAttribute('target');
    if (target === '_blank') {
      window.open(proxyUrl, '_blank');
    } else {
      window.location.href = proxyUrl;
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    if (form.action.includes('/api/proxy')) return;
    e.preventDefault();
    var resolved = resolveAgainstPage(form.getAttribute('action')) || form.action;
    form.action = '/api/proxy?url=' + encodeURIComponent(resolved);
    form.submit();
  }, true);

  // Intercept fetch to proxy API calls — resolve against original site, block ads
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      var resolved = resolveAgainstPage(input);
      if (resolved) {
        if (isAd(resolved)) return Promise.resolve(new Response('', {status: 204}));
        input = '/api/proxy?asset=1&url=' + encodeURIComponent(resolved);
      }
    }
    return origFetch.call(this, input, init);
  };

  // Intercept XMLHttpRequest — resolve against original site, block ads
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') {
      var resolved = resolveAgainstPage(url);
      if (resolved) {
        if (isAd(resolved)) { url = 'about:blank'; return origOpen.apply(this, [method, url]); }
        url = '/api/proxy?asset=1&url=' + encodeURIComponent(resolved);
      }
    }
    return origOpen.apply(this, arguments);
  };

  // Helper to proxy a URL for assets
  function proxyAssetUrl(raw) {
    var resolved = resolveAgainstPage(raw);
    if (!resolved) return null;
    if (isAd(resolved)) return null;
    return '/api/proxy?asset=1&url=' + encodeURIComponent(resolved);
  }

  // Intercept dynamic element creation — rewrite src/href on images, scripts, links, etc.
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    var lname = name.toLowerCase();
    if ((lname === 'src' || lname === 'href') && typeof value === 'string' && value.length > 0) {
      if (!value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('javascript:') && !value.startsWith('/api/proxy')) {
        var tag = this.tagName;
        // For <a> tags, proxy as page navigation; for everything else, proxy as asset
        if (tag === 'A' && lname === 'href') {
          var resolved = resolveAgainstPage(value);
          if (resolved && !isAd(resolved)) value = '/api/proxy?url=' + encodeURIComponent(resolved);
        } else {
          var proxied = proxyAssetUrl(value);
          if (proxied) value = proxied;
        }
      }
    }
    return origSetAttribute.call(this, name, value);
  };

  // Observe DOM for dynamically added elements and rewrite their URLs
  function rewriteNode(node) {
    if (node.nodeType !== 1) return;
    var el = node;
    // Rewrite src
    if (el.src && typeof el.src === 'string' && !el.src.includes('/api/proxy') && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
      var p = proxyAssetUrl(el.getAttribute('src'));
      if (p) origSetAttribute.call(el, 'src', p);
    }
    // Rewrite href on <link> elements
    if (el.tagName === 'LINK' && el.href && !el.href.includes('/api/proxy')) {
      var p2 = proxyAssetUrl(el.getAttribute('href'));
      if (p2) origSetAttribute.call(el, 'href', p2);
    }
    // Rewrite inline style url() references
    if (el.style && el.style.cssText && el.style.cssText.includes('url(')) {
      el.style.cssText = el.style.cssText.replace(/url\(\s*["']?((?!data:|blob:|#|\/api\/proxy)[^"')]+)["']?\s*\)/gi, function(m, u) {
        var p3 = proxyAssetUrl(u);
        return p3 ? 'url(' + p3 + ')' : m;
      });
    }
    // Recurse into children
    var children = el.children;
    for (var i = 0; i < children.length; i++) rewriteNode(children[i]);
  }

  // MutationObserver to catch dynamically added content
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          rewriteNode(added[j]);
        }
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  // Intercept window.open to stay in proxy
  var origWindowOpen = window.open;
  window.open = function(url, target, features) {
    if (typeof url === 'string' && url.length > 0 && !url.startsWith('about:') && !url.startsWith('javascript:') && !url.startsWith('/api/proxy')) {
      var resolved = resolveAgainstPage(url);
      if (resolved) {
        if (isAd(resolved)) return null;
        url = '/api/proxy?url=' + encodeURIComponent(resolved);
      }
    }
    return origWindowOpen.call(this, url, target, features);
  };
})();
</script>`;

    // Inject before </head> or at the top
    if (html.includes("</head>")) {
      html = html.replace("</head>", proxyScript + "</head>");
    } else {
      html = proxyScript + html;
    }

    return new Response(html, {
      status: res.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const errorHtml = `<!DOCTYPE html>
<html><head><style>
  body { font-family: system-ui, sans-serif; background: #000; color: #ff9500; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; }
  h2 { font-size: 1rem; margin-bottom: 0.5rem; }
  p { color: #71717a; font-size: 0.8rem; }
  a { color: #ff9500; text-decoration: underline; }
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
