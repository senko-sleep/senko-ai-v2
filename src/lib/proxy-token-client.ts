// Browser side of the signed embed-proxy token (see signProxyToken in auth-token.ts).
import { useEffect, useState } from "react";

let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

/** A valid proxy token, refreshed an hour before it expires. Null if the server won't give one. */
export function getProxyToken(): Promise<string | null> {
  if (cached && cached.expiresAt - Date.now() > 3_600_000) return Promise.resolve(cached.token);
  pending ??= fetch("/api/proxy/token", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ token: string; expiresAt: number }>) : null))
    .then((j) => {
      cached = j?.token ? j : null;
      return cached?.token ?? null;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** `/api/proxy?pt=…&url=…` for a page shown in an embed frame. */
export function proxiedPageUrl(url: string, token: string | null): string {
  return `/api/proxy?${token ? `pt=${encodeURIComponent(token)}&` : ""}url=${encodeURIComponent(url)}`;
}

/** The token once loaded (undefined while loading, null if unavailable). */
export function useProxyToken(enabled = true): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void getProxyToken().then((t) => live && setToken(t));
    return () => {
      live = false;
    };
  }, [enabled]);
  return token;
}
