// Remember solved human checks. When you pause the agent and solve a site's captcha, the site
// gives the browser a clearance cookie (Cloudflare's cf_clearance, DataDome, PerimeterX, Google's
// GOOGLE_ABUSE_EXEMPTION, ...). Those are kept per account, merged across every chat, saved in
// the database, and put into every browser session, so a site you've cleared once stays cleared
// (until the site itself expires the cookie). Only verification / anti-abuse cookies are kept,
// never login cookies.
import type { Cookie } from "playwright";
import { q, q1 } from "@/lib/server/db";

/** Google's anti-abuse / consent cookies (not the login ones). */
const GOOGLE_TRUST = new Set(["NID", "AEC", "SOCS", "CONSENT", "GOOGLE_ABUSE_EXEMPTION", "__Secure-ENID", "1P_JAR"]);
/** Clearance cookies set after a human check is passed, by name. */
const CLEARANCE = new Set([
  "cf_clearance", "__cf_bm", "_cfuvid", // Cloudflare
  "datadome", // DataDome
  "_px3", "_pxvid", "_pxde", "_pxhd", // PerimeterX / HUMAN
  "__ddg1_", "__ddg2_", "__ddgid_", "__ddgmark_", "__ddg5_", // DDoS-Guard
  "_abck", "ak_bmsc", "bm_sz", "bm_sv", // Akamai Bot Manager
  "reese84", // Imperva
  "aws-waf-token", // AWS WAF captcha
  "hcaptcha_session", "sucuri_cloudproxy_uuid",
]);
/** Clearance cookies whose names carry a per-site suffix. */
const CLEARANCE_PREFIX = /^(?:visid_incap_|incap_ses_|nlbi_|sucuri_cloudproxy_uuid_|__ddg)/;
const MAX_COOKIES = 400;

function isGoogleDomain(host: string): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(host) || /(^|\.)youtube\.com$/i.test(host);
}

/** Is this a verification / anti-abuse cookie worth remembering (and not a login)? */
export function isClearanceCookie(c: Pick<Cookie, "name" | "domain">): boolean {
  const host = (c.domain || "").replace(/^\./, "");
  if (!host) return false;
  if (GOOGLE_TRUST.has(c.name)) return isGoogleDomain(host);
  return CLEARANCE.has(c.name) || CLEARANCE_PREFIX.test(c.name);
}

const keyOf = (c: Cookie) => `${c.name}|${c.domain}|${c.path}`;
const live = (c: Cookie, now: number) => c.expires === -1 || c.expires > now;

/** Clearance cookies from a storage state / cookie list, unexpired. */
export function clearanceCookies(cookies: Cookie[] | undefined | null, now = Date.now() / 1000): Cookie[] {
  return (cookies || []).filter((c) => live(c, now) && isClearanceCookie(c));
}

/** Add `fresh` to `jar`: the newer value wins per cookie, expired ones drop out. */
export function mergeJar(jar: Cookie[], fresh: Cookie[], now = Date.now() / 1000): Cookie[] {
  const out = new Map<string, Cookie>();
  for (const c of jar) if (live(c, now)) out.set(keyOf(c), c);
  for (const c of fresh) if (live(c, now) && isClearanceCookie(c)) out.set(keyOf(c), c);
  // Keep the longest-lived if a huge number pile up.
  return [...out.values()].sort((a, b) => (b.expires === -1 ? Infinity : b.expires) - (a.expires === -1 ? Infinity : a.expires)).slice(0, MAX_COOKIES);
}

const g = globalThis as unknown as { __clearanceJar?: Map<string, Cookie[]>; __clearanceSaving?: Map<string, Promise<void>> };
const cache = (g.__clearanceJar ??= new Map());
const saving = (g.__clearanceSaving ??= new Map());
const dbKey = (ownerId: string) => `browser.clearance:${ownerId}`;

/** The account's remembered clearance cookies (cached; loaded from the database once). */
export async function loadClearance(ownerId: string): Promise<Cookie[]> {
  const hit = cache.get(ownerId);
  if (hit) return clearanceCookies(hit);
  const row = await q1<{ value: string }>("SELECT value FROM app_kv WHERE key = $1", [dbKey(ownerId)]).catch(() => null);
  let jar: Cookie[] = [];
  try {
    jar = row?.value ? (JSON.parse(row.value) as Cookie[]) : [];
  } catch {
    jar = [];
  }
  jar = clearanceCookies(jar);
  cache.set(ownerId, jar);
  return jar;
}

/** Remember any clearance cookies in `cookies` (merged into what the account already has). */
export async function rememberClearance(ownerId: string, cookies: Cookie[] | undefined | null): Promise<number> {
  const fresh = clearanceCookies(cookies);
  if (!fresh.length) return 0;
  const before = await loadClearance(ownerId);
  const merged = mergeJar(before, fresh);
  const old = new Map(before.map((c) => [keyOf(c), c]));
  const changed = merged.length !== before.length || merged.some((c) => {
    const b = old.get(keyOf(c));
    return !b || b.value !== c.value || b.expires !== c.expires;
  });
  cache.set(ownerId, merged);
  if (!changed) return 0;
  // One write at a time per account; the newest jar is what gets written.
  const prev = saving.get(ownerId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() =>
    q(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [dbKey(ownerId), JSON.stringify(cache.get(ownerId) || merged)],
    ).then(() => {}),
  );
  saving.set(ownerId, next);
  await next.catch(() => {});
  return fresh.length;
}

/** Tests only. */
export function resetClearanceCache() {
  cache.clear();
  saving.clear();
}
