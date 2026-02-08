"use client";

import { useSyncExternalStore } from "react";
import type { BrowserInfo } from "@/types/chat";

function buildSnapshot(): BrowserInfo {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookiesEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    colorDepth: window.screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceMemory: (navigator as unknown as Record<string, number>)
      .deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

let cachedSnapshot: BrowserInfo | null = null;

function getSnapshot(): BrowserInfo {
  if (!cachedSnapshot) {
    cachedSnapshot = buildSnapshot();
  }
  return cachedSnapshot;
}

function getServerSnapshot(): BrowserInfo | null {
  return null;
}

function subscribe(callback: () => void) {
  const update = () => {
    cachedSnapshot = buildSnapshot();
    callback();
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}

export function useBrowserInfo(): BrowserInfo | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
