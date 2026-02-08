"use client";

import { useState, useCallback } from "react";
import type { PermissionStatus } from "@/types/chat";

const PERMISSION_NAMES = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
] as const;

async function fetchPermissions(): Promise<PermissionStatus[]> {
  if (typeof window === "undefined" || !navigator.permissions) {
    return PERMISSION_NAMES.map((name) => ({ name, state: "prompt" as const }));
  }
  const results: PermissionStatus[] = [];
  for (const name of PERMISSION_NAMES) {
    try {
      const status = await navigator.permissions.query({
        name: name as PermissionName,
      });
      results.push({ name, state: status.state as PermissionStatus["state"] });
    } catch {
      results.push({ name, state: "prompt" });
    }
  }
  return results;
}

export function usePermissions() {
  const [permissions, setPermissions] = useState<PermissionStatus[]>(
    PERMISSION_NAMES.map((name) => ({ name, state: "prompt" as const }))
  );

  const queryPermissions = useCallback(async () => {
    const results = await fetchPermissions();
    setPermissions(results);
  }, []);

  const requestPermission = useCallback(
    async (permissionName: string) => {
      try {
        switch (permissionName) {
          case "notifications":
            await Notification.requestPermission();
            break;
          case "geolocation":
            navigator.geolocation.getCurrentPosition(() => {}, () => {});
            break;
          case "camera":
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: true });
              stream.getTracks().forEach((t) => t.stop());
            } catch { /* denied */ }
            break;
          case "microphone":
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              stream.getTracks().forEach((t) => t.stop());
            } catch { /* denied */ }
            break;
          case "clipboard-read":
            try { await navigator.clipboard.readText(); } catch { /* denied */ }
            break;
          default:
            break;
        }
      } catch { /* failed */ }
      setTimeout(() => queryPermissions(), 500);
    },
    [queryPermissions]
  );

  return { permissions, requestPermission, refreshPermissions: queryPermissions };
}
