// HTML/CSS rewriting for /api/proxy: every URL a proxied page loads comes back through the
// proxy, so a site that refuses to be framed can still be shown (with its images, players
// and fullscreen) inside a chat embed.

/** Resolve a possibly-relative URL against a base. */
export function resolveUrl(raw: string, base: string): string {
  try {
    return new URL(raw.trim(), base).href;
  } catch {
    return raw;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Proxied URL for a sub-resource (image, script, stylesheet, media, XHR). `ref` = the page's origin, sent as Referer. */
export function proxyAsset(absUrl: string, ref?: string): string {
  return `/api/proxy?asset=1${ref ? `&ref=${encodeURIComponent(ref)}` : ""}&url=${encodeURIComponent(absUrl)}`;
}

/** Proxied URL for a page (navigation, iframes). */
export function proxyPage(absUrl: string, ref?: string): string {
  return `/api/proxy?${ref ? `ref=${encodeURIComponent(ref)}&` : ""}url=${encodeURIComponent(absUrl)}`;
}

/**
 * Stamp the signed proxy token on every proxy URL in rewritten HTML / CSS / JS / playlists, so
 * a sandboxed page (which sends no login cookie) can still load through us. Forms posting to
 * "/api/proxy" get it as a hidden field.
 */
export function withProxyToken(text: string, token: string | undefined): string {
  if (!token) return text;
  const t = encodeURIComponent(token);
  return text
    .replace(/(\/api\/(?:video-)?proxy\?)(?!pt=)/g, `$1pt=${t}&`)
    .replace(/(<form\b[^>]*\saction="\/api\/proxy"[^>]*>)/gi, `$1<input type="hidden" name="pt" value="${t}"/>`);
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SKIP = /^(?:data:|blob:|javascript:|about:|#|mailto:|tel:)/i;

/** Rewrite url() and @import inside CSS. */
export function rewriteCss(css: string, cssUrl: string, ref = originOf(cssUrl)): string {
  const base = cssUrl.replace(/[?#].*$/, "");
  css = css.replace(/url\(\s*(["']?)((?!data:|blob:|#|\/api\/proxy).*?)\1\s*\)/gi, (_m, q, val) => `url(${q}${proxyAsset(resolveUrl(val, base), ref)}${q})`);
  css = css.replace(/@import\s+(["'])(.*?)\1/gi, (_m, q, val) => `@import ${q}${proxyAsset(resolveUrl(val, base), ref)}${q}`);
  return css;
}

function rewriteSrcset(val: string, base: string, ref: string): string {
  return val
    .split(",")
    .map((part) => {
      const [u, ...desc] = part.trim().split(/\s+/);
      if (!u || SKIP.test(u)) return part;
      return [proxyAsset(resolveUrl(u, base), ref), ...desc].join(" ");
    })
    .join(", ");
}

/** Rewrite every URL attribute in a page so it loads through the proxy. */
export function rewriteHtml(html: string, pageUrl: string): string {
  const base = pageUrl.replace(/#.*$/, "");
  const ref = originOf(pageUrl);
  const asset = (v: string) => (SKIP.test(v) || v.startsWith("/api/proxy") ? null : proxyAsset(resolveUrl(v, base), ref));

  html = html.replace(/<base\b[^>]*>/gi, "");
  // Rewritten CSS no longer matches its Subresource Integrity hash.
  html = html.replace(/(<(?:link|script)\b[^>]*?)\s+integrity\s*=\s*(["'])[^"']*\2/gi, "$1");
  html = html.replace(/<meta[^>]*http-equiv=["']?(?:Content-Security-Policy|X-Frame-Options)["']?[^>]*>/gi, "");

  // Frames are pages of their own (video players): proxy them as pages, allow fullscreen.
  html = html.replace(/(<i?frame\b[^>]*?\s)src\s*=\s*(["'])(.*?)\2/gi, (m, pre: string, q: string, val: string) => {
    if (SKIP.test(val) || val.startsWith("/api/proxy")) return m;
    return `${pre}src=${q}${proxyPage(resolveUrl(val, base), ref)}${q}`;
  });
  html = html.replace(/<iframe\b(?![^>]*\ballowfullscreen\b)/gi, '<iframe allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"');

  html = html.replace(/(<(?:img|script|video|audio|source|track|embed|input)\b[^>]*?\s)src\s*=\s*(["'])(.*?)\2/gi, (m, pre: string, q: string, val: string) => {
    const p = asset(val);
    return p ? `${pre}src=${q}${p}${q}` : m;
  });
  // Lazy loaders copy these into src later.
  html = html.replace(/(\sdata-(?:src|original|lazy-src|lazy|bg|poster))\s*=\s*(["'])(.*?)\2/gi, (m, attr: string, q: string, val: string) => {
    const urlish = /^(?:https?:)?\/\//i.test(val) || /^\.{0,2}\/[^\s]/.test(val) || /\.(?:jpe?g|png|gif|webp|avif|svg|mp4|webm|m3u8)(?:[?#]|$)/i.test(val);
    const p = urlish ? asset(val) : null;
    return p ? `${attr}=${q}${p}${q}` : m;
  });
  html = html.replace(/(\s(?:data-)?srcset)\s*=\s*(["'])(.*?)\2/gi, (_m, attr: string, q: string, val: string) => `${attr}=${q}${rewriteSrcset(val, base, ref)}${q}`);
  html = html.replace(/(\sposter)\s*=\s*(["'])(.*?)\2/gi, (m, attr: string, q: string, val: string) => {
    const p = asset(val);
    return p ? `${attr}=${q}${p}${q}` : m;
  });
  html = html.replace(/(<link\b[^>]*?\s)href\s*=\s*(["'])(.*?)\2/gi, (m, pre: string, q: string, val: string) => {
    const p = asset(val);
    return p ? `${pre}href=${q}${p}${q}` : m;
  });
  html = html.replace(/(<a\b[^>]*?\s)href\s*=\s*(["'])(.*?)\2/gi, (m, pre: string, q: string, val: string) => {
    if (SKIP.test(val) || val.startsWith("/api/proxy")) return m;
    return `${pre}href=${q}${proxyPage(resolveUrl(val, base))}${q}`;
  });
  // <meta http-equiv="refresh" content="0;url=...">
  html = html.replace(/(<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']\s*\d+\s*;\s*url=)([^"']+)(["'])/gi, (_m, pre: string, val: string, q: string) => `${pre}${proxyPage(resolveUrl(val, base))}${q}`);

  // Forms: submit to the proxy with the real target in a hidden field.
  html = html.replace(/(<form\b)([^>]*?)(\saction\s*=\s*(["'])(.*?)\4)([^>]*>)/gi, (m, open: string, before: string, _a: string, _q: string, action: string, after: string) => {
    if (action.startsWith("javascript:")) return m;
    const abs = action ? resolveUrl(action, base) : pageUrl;
    return `${open}${before} action="/api/proxy"${after}<input type="hidden" name="url" value="${htmlEscape(abs)}"/>`;
  });
  html = html.replace(/(<form\b)((?:(?!\saction\s*=)[^>])*>)/gi, (_m, open: string, rest: string) => `${open} action="/api/proxy"${rest}<input type="hidden" name="url" value="${htmlEscape(pageUrl)}"/>`);

  html = html.replace(/style\s*=\s*(["'])((?:(?!\1).)*url\s*\((?:(?!\1).)*\)(?:(?!\1).)*)\1/gi, (_m, q: string, val: string) => {
    const rewritten = val.replace(/url\(\s*(&quot;|["']?)((?!data:|blob:|#|\/api\/proxy).*?)\1\s*\)/gi, (_x: string, iq: string, iv: string) => `url(${iq}${proxyAsset(resolveUrl(iv, base), ref)}${iq})`);
    return `style=${q}${rewritten}${q}`;
  });
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) => `${open}${rewriteCss(css, base, ref)}${close}`);
  return html;
}

/** Strip ad/tracker scripts and frame-busting code. */
export function stripHostileScripts(html: string): string {
  html = html.replace(/if\s*\(\s*(?:top|window\.top|parent|window\.parent)\s*!==?\s*(?:self|window\.self|window)\s*\)[^}]*}/gi, "");
  html = html.replace(/top\.location\s*=\s*(?:self\.location|location|window\.location)/gi, "void 0");
  html = html.replace(/window\.top\.location/gi, "window.location");
  html = html.replace(/parent\.location/gi, "window.location");
  html = html.replace(/<script[^>]*src=["'][^"']*(?:acquiredeceasedundress|darnobedienceupscale|ospaxgapf|trafficjunky|exoclick|juicyads|popads|popcash|propellerads|doubleclick|googlesyndication|adglare|adserver|syndication)[^"']*["'][^>]*><\/script>/gi, "");
  html = html.replace(/<script[^>]*src=["'][^"']*(?:\.bn\.js|popunder|clickunder|adserv)[^"']*["'][^>]*><\/script>/gi, "");
  html = html.replace(/<script[^>]*>[\s\S]*?(?:AdGlare|adglare|setZone|popunder|clickunder|exoclick|juicyads|trafficjunky|spankurbate)[\s\S]*?<\/script>/gi, "");
  return html;
}

export const AD_HOSTS = [
  "acquiredeceasedundress.com", "darnobedienceupscale.com", "ospaxgapf.com",
  "doubleclick.net", "googlesyndication.com", "adservice.google.com",
  "pagead2.googlesyndication.com", "trafficjunky.com", "exoclick.com",
  "juicyads.com", "popads.net", "popcash.net", "propellerads.com",
  "adglare.net", "adglare.org", "spankurbate.com", "rule34comic.party",
];

export function isAdHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return AD_HOSTS.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

const js = (s: string) => JSON.stringify(s).replace(/<\//g, "<\\/");

/**
 * Runs first in every proxied page: keeps fetch/XHR, dynamic elements, lazy images, history
 * and popups inside the proxy, and tells the chat embed which page it's on.
 */
export function proxyClientScript(pageUrl: string): string {
  return `<script>
(function(){
  var PAGE_BASE = ${js(pageUrl)};
  var PAGE_ORIGIN = ${js(originOf(pageUrl))};
  // Sandboxed (opaque origin): location.origin is "null", so build it from the URL.
  var SELF = location.protocol + '//' + location.host;
  window.addEventListener('message', function(e){ if (e.source === window.parent && e.data && e.data.senkoEmbedCmd === 'back') history.back(); });
  var AD_HOSTS = ${JSON.stringify(AD_HOSTS)};
  function isAd(u){ try { var h = new URL(u).hostname; return AD_HOSTS.some(function(d){ return h===d || h.endsWith('.'+d); }); } catch(e){ return false; } }
  function resolveAgainstPage(raw){
    if (raw == null) return null;
    raw = String(raw).trim();
    if (!raw || /^(data:|blob:|javascript:|about:|mailto:|tel:|#)/i.test(raw)) return null;
    if (raw.indexOf('/api/proxy') === 0 || raw.indexOf(SELF + '/api/proxy') === 0) return null;
    if (raw.indexOf(SELF + '/') === 0) raw = raw.slice(SELF.length); // a relative URL the browser already resolved against us
    try {
      if (raw.indexOf('//') === 0) return location.protocol + raw;
      if (raw.charAt(0) === '/') return PAGE_ORIGIN + raw;
      if (/^https?:/i.test(raw)) return raw;
      return new URL(raw, PAGE_BASE).href;
    } catch(e){ return null; }
  }
  function assetUrl(raw){ var r = resolveAgainstPage(raw); if (!r || isAd(r)) return null; return '/api/proxy?asset=1&ref=' + encodeURIComponent(PAGE_ORIGIN) + '&url=' + encodeURIComponent(r); }
  function pageUrl(raw){ var r = resolveAgainstPage(raw); if (!r || isAd(r)) return null; return '/api/proxy?url=' + encodeURIComponent(r); }
  function announce(){ try { if (window.parent !== window) window.parent.postMessage({ senkoEmbed: 1, url: PAGE_BASE, title: document.title }, '*'); } catch(e){} }
  window.addEventListener('load', announce);

  document.addEventListener('click', function(e){
    var a = e.target; while (a && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.getAttribute('href')) return;
    var href = a.getAttribute('href');
    if (/^(#|javascript:|mailto:|tel:)/i.test(href) || href.indexOf('/api/proxy') === 0) return;
    var p = pageUrl(href); if (!p) return;
    e.preventDefault();
    if (a.getAttribute('target') === '_blank') window.open(p, '_blank'); else location.href = p;
  }, true);

  document.addEventListener('submit', function(e){
    var form = e.target; if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || '';
    if (action === '/api/proxy' || action.indexOf('/api/proxy?') === 0) return;
    e.preventDefault();
    var resolved = (action && resolveAgainstPage(action)) || PAGE_BASE;
    if ((form.method || 'get').toLowerCase() === 'get') {
      var ps = new URLSearchParams(); new FormData(form).forEach(function(v,k){ if (typeof v === 'string') ps.append(k, v); });
      ps.set('url', resolved); location.href = '/api/proxy?' + ps.toString();
    } else {
      var h = document.createElement('input'); h.type = 'hidden'; h.name = 'url'; h.value = resolved;
      form.appendChild(h); form.setAttribute('action', '/api/proxy'); form.submit();
    }
  }, true);

  var origFetch = window.fetch;
  window.fetch = function(input, init){
    try {
      var raw = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url));
      var r = resolveAgainstPage(raw);
      if (r) {
        if (isAd(r)) return Promise.resolve(new Response('', { status: 204 }));
        var p = '/api/proxy?asset=1&ref=' + encodeURIComponent(PAGE_ORIGIN) + '&url=' + encodeURIComponent(r);
        // The proxy answers with "Access-Control-Allow-Origin: *", which only works without credentials.
        input = (typeof Request !== 'undefined' && input instanceof Request) ? new Request(new Request(p, input), { credentials: 'omit' }) : p;
        init = Object.assign({}, init || {}, { credentials: 'omit' });
      }
    } catch(e){}
    return origFetch.call(this, input, init);
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    var args = Array.prototype.slice.call(arguments);
    var raw = url instanceof URL ? url.href : url;
    var r = resolveAgainstPage(raw);
    if (r) args[1] = isAd(r) ? 'about:blank' : '/api/proxy?asset=1&ref=' + encodeURIComponent(PAGE_ORIGIN) + '&url=' + encodeURIComponent(r);
    this.__senkoProxied = !!r;
    return origOpen.apply(this, args);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(){ if (this.__senkoProxied) { try { this.withCredentials = false; } catch(e){} } return origSend.apply(this, arguments); };

  function isFrame(el){ return el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME'); }
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value){
    var n = String(name).toLowerCase();
    if ((n === 'src' || n === 'href' || n === 'poster' || n === 'data-src') && typeof value === 'string' && value) {
      var p = (this.tagName === 'A' && n === 'href') || (isFrame(this) && n === 'src') ? pageUrl(value) : assetUrl(value);
      if (p) value = p;
    }
    return origSetAttribute.call(this, name, value);
  };
  // Players and lazy loaders usually set the property, not the attribute.
  function hook(Ctor, prop, mapper){
    if (!Ctor) return;
    var d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(Ctor.prototype, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function(v){ var m = typeof v === 'string' ? mapper(v) : null; d.set.call(this, m || v); } });
  }
  hook(window.HTMLImageElement, 'src', assetUrl);
  hook(window.HTMLScriptElement, 'src', assetUrl);
  hook(window.HTMLMediaElement, 'src', assetUrl);
  hook(window.HTMLSourceElement, 'src', assetUrl);
  hook(window.HTMLTrackElement, 'src', assetUrl);
  hook(window.HTMLVideoElement, 'poster', assetUrl);
  hook(window.HTMLLinkElement, 'href', assetUrl);
  hook(window.HTMLIFrameElement, 'src', pageUrl);

  function rewriteNode(el){
    if (!el || el.nodeType !== 1) return;
    var src = el.getAttribute && el.getAttribute('src');
    if (src && src.indexOf('/api/proxy') !== 0) { var p = isFrame(el) ? pageUrl(src) : assetUrl(src); if (p) origSetAttribute.call(el, 'src', p); }
    if (isFrame(el) && !el.hasAttribute('allowfullscreen')) { origSetAttribute.call(el, 'allowfullscreen', ''); origSetAttribute.call(el, 'allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture'); }
    if (el.tagName === 'LINK') { var h = el.getAttribute('href'); if (h && h.indexOf('/api/proxy') !== 0) { var p2 = assetUrl(h); if (p2) origSetAttribute.call(el, 'href', p2); } }
    if (el.style && el.style.cssText && el.style.cssText.indexOf('url(') >= 0) {
      el.style.cssText = el.style.cssText.replace(/url\\(\\s*["']?((?!data:|blob:|#|\\/api\\/proxy)[^"')]+)["']?\\s*\\)/gi, function(m, u){ var p3 = assetUrl(u); return p3 ? 'url(' + p3 + ')' : m; });
    }
    for (var i = 0; i < el.children.length; i++) rewriteNode(el.children[i]);
  }
  if (typeof MutationObserver !== 'undefined') {
    var obs = new MutationObserver(function(ms){ for (var i = 0; i < ms.length; i++) { var a = ms[i].addedNodes; for (var j = 0; j < a.length; j++) rewriteNode(a[j]); } });
    var start = function(){ obs.observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // pushState('/video/123') would point the frame at our own server; keep it in the proxy.
  ['pushState', 'replaceState'].forEach(function(k){
    var orig = history[k];
    history[k] = function(state, title, url){
      if (url != null) { var r = resolveAgainstPage(url); if (r) { PAGE_BASE = r; url = '/api/proxy?url=' + encodeURIComponent(r); } }
      var out = orig.call(this, state, title, url); announce(); return out;
    };
  });

  var origWindowOpen = window.open;
  window.open = function(url, target, features){
    if (typeof url === 'string' && url) { var r = resolveAgainstPage(url); if (r) { if (isAd(r)) return null; url = '/api/proxy?url=' + encodeURIComponent(r); } }
    return origWindowOpen.call(this, url, target, features);
  };
})();
</script>`;
}
