// Network rules for the agent's browser. There is NO list of forbidden websites:
// the agent goes wherever you send it. These rules only:
//  1. block ad/tracker domains (faster pages, fewer pop-ups), and
//  2. block private/internal network addresses, so a page can't make the server's
//     browser poke at the server's own network (e.g. cloud metadata endpoints).

const AD_DOMAINS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com", "pagead2.googlesyndication.com",
  "google-analytics.com", "googletagmanager.com", "googletagservices.com", "adnxs.com", "adsrvr.org", "advertising.com",
  "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com",
  "amazon-adsystem.com", "moatads.com", "scorecardresearch.com", "quantserve.com", "zedo.com", "media.net", "adform.net",
  "smartadserver.com", "yieldmo.com", "sharethrough.com", "teads.tv", "33across.com", "sovrn.com", "lijit.com", "bidswitch.net",
  "popads.net", "popcash.net", "propellerads.com", "propellerclick.com", "exoclick.com", "exosrv.com", "juicyads.com",
  "trafficjunky.net", "adsterra.com", "hilltopads.net", "clickadu.com", "onclickads.net", "onclkds.com", "mgid.com",
  "revcontent.com", "adcash.com", "admaven.com", "ad-maven.com", "a-ads.com", "coinzilla.com", "bidvertiser.com",
  "hotjar.com", "mouseflow.com", "fullstory.com", "clarity.ms", "segment.io", "mixpanel.com", "amplitude.com",
  "facebook.net", "connect.facebook.net", "ads-twitter.com", "ads.linkedin.com", "bat.bing.com", "adsafeprotected.com",
  "doubleverify.com", "imasdk.googleapis.com",
];
// Note: imasdk.googleapis.com serves video *ads*; blocking it skips many pre-rolls.

const AD_SET = new Set(AD_DOMAINS);

export function isAdHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  while (h.includes(".")) {
    if (AD_SET.has(h)) return true;
    h = h.slice(h.indexOf(".") + 1);
  }
  return false;
}

/** The app's own address is allowed even when it's localhost (used by the test fixtures). */
function ownOrigins(): string[] {
  const port = process.env.PORT || "3000";
  return [process.env.APP_URL || "", `http://localhost:${port}`, `http://127.0.0.1:${port}`]
    .filter(Boolean)
    .map((u) => u.replace(/\/$/, ""));
}

export function isPrivateUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ws:" && u.protocol !== "wss:") return false;
  if (ownOrigins().includes(u.origin)) return false;
  if (process.env.ALLOW_PRIVATE_URLS === "1") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // carrier-grade NAT
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}
