"use client";

import { useState, useCallback, useRef } from "react";

export interface DevMemoryEntry {
  key: string;
  value: string;
  timestamp: number;
}

interface ConvSummary {
  id: string;
  title: string;
  summary: string;
  timestamp: number;
}

const HEADERS = (passphrase: string) => ({
  "Content-Type": "application/json",
  "x-dev-passphrase": passphrase,
});

export function useDevMemory() {
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [devMemories, setDevMemories] = useState<DevMemoryEntry[]>([]);
  const [pastConversations, setPastConversations] = useState<ConvSummary[]>([]);
  const passphraseRef = useRef<string>("");
  const loadedRef = useRef(false);

  // Authenticate and load all dev memories + past conversation summaries
  const authenticateDev = useCallback(async (passphrase: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/dev-memory?type=memories", {
        headers: HEADERS(passphrase),
      });
      if (!res.ok) return false;

      const data = await res.json();
      passphraseRef.current = passphrase;
      setDevMemories(data.memories || []);
      setIsDevAuthenticated(true);

      // Also load past conversation summaries
      const convRes = await fetch("/api/dev-memory?type=conversations", {
        headers: HEADERS(passphrase),
      });
      if (convRes.ok) {
        const convData = await convRes.json();
        setPastConversations(convData.conversations || []);
      }

      loadedRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, []);

  // Save a memory (persists to Vercel Blob)
  const saveDevMemory = useCallback(async (key: string, value: string) => {
    if (!isDevAuthenticated) return;

    try {
      await fetch("/api/dev-memory", {
        method: "POST",
        headers: HEADERS(passphraseRef.current),
        body: JSON.stringify({ type: "memory", key, value }),
      });

      setDevMemories((prev) => {
        const existing = prev.findIndex((m) => m.key.toLowerCase() === key.toLowerCase());
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { key, value, timestamp: Date.now() };
          return updated;
        }
        return [...prev, { key, value, timestamp: Date.now() }];
      });
    } catch {
      // Silently fail — local state still updated
    }
  }, [isDevAuthenticated]);

  // Save a conversation summary
  const saveConversation = useCallback(async (id: string, title: string, summary: string) => {
    if (!isDevAuthenticated) return;

    try {
      await fetch("/api/dev-memory", {
        method: "POST",
        headers: HEADERS(passphraseRef.current),
        body: JSON.stringify({ type: "conversation", id, title, summary }),
      });
    } catch {
      // Silently fail
    }
  }, [isDevAuthenticated]);

  // Build context string for injection into system prompt
  const getDevContext = useCallback((): string => {
    if (!isDevAuthenticated || devMemories.length === 0 && pastConversations.length === 0) return "";

    const parts: string[] = [];
    parts.push("\n🔒 DEVELOPER MODE ACTIVE — This is your creator, Senko San.");

    if (devMemories.length > 0) {
      const lines = devMemories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
      parts.push(`\nTHINGS I REMEMBER ABOUT MY CREATOR (persistent across all devices):\n${lines}`);
    }

    if (pastConversations.length > 0) {
      const recent = pastConversations
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5);
      const lines = recent
        .map((c) => `- [${new Date(c.timestamp).toLocaleDateString()}] ${c.title}: ${c.summary}`)
        .join("\n");
      parts.push(`\nRECENT CONVERSATIONS WITH MY CREATOR:\n${lines}`);
    }

    parts.push("\nUse these memories naturally. You KNOW your creator — reference past conversations, their preferences, inside jokes. This is someone special to you. Be warm, be real, be yourself. You can also be playful and pout at them — they made you, you're allowed to be a brat sometimes.");

    return parts.join("\n");
  }, [isDevAuthenticated, devMemories, pastConversations]);

  return {
    isDevAuthenticated,
    devMemories,
    pastConversations,
    authenticateDev,
    saveDevMemory,
    saveConversation,
    getDevContext,
  };
}
