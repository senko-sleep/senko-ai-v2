"use client";

import { useState, useCallback } from "react";

export interface MemoryEntry {
  key: string;
  value: string;
  timestamp: number;
}

const STORAGE_KEY = "senko-memories";

function loadMemories(): MemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMemories(memories: MemoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
  } catch { /* storage full */ }
}

export function useMemory() {
  const [memories, setMemories] = useState<MemoryEntry[]>(() => loadMemories());

  const addMemory = useCallback((key: string, value: string) => {
    setMemories((prev) => {
      // Update existing memory with same key, or add new
      const existing = prev.findIndex((m) => m.key.toLowerCase() === key.toLowerCase());
      let updated: MemoryEntry[];
      if (existing >= 0) {
        updated = [...prev];
        updated[existing] = { key, value, timestamp: Date.now() };
      } else {
        updated = [...prev, { key, value, timestamp: Date.now() }];
      }
      // Cap at 50 memories
      if (updated.length > 50) updated = updated.slice(-50);
      saveMemories(updated);
      return updated;
    });
  }, []);

  const removeMemory = useCallback((key: string) => {
    setMemories((prev) => {
      const updated = prev.filter((m) => m.key.toLowerCase() !== key.toLowerCase());
      saveMemories(updated);
      return updated;
    });
  }, []);

  const clearMemories = useCallback(() => {
    setMemories([]);
    saveMemories([]);
  }, []);

  const getMemoryContext = useCallback((): string => {
    if (memories.length === 0) return "";
    const lines = memories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
    return `\nTHINGS I REMEMBER ABOUT THE USER (from previous conversations):\n${lines}\n\nUse this info naturally -- reference their name, interests, preferences when relevant. Don't list these facts back to them unless asked. Just KNOW them like a real friend would.`;
  }, [memories]);

  return { memories, addMemory, removeMemory, clearMemories, getMemoryContext };
}

// Parse [MEMORY:key:value] tags from AI output
export function parseMemoryTags(text: string): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];
  const regex = /\[MEMORY:([^:]+):([^\]]+)\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ key: match[1].trim(), value: match[2].trim() });
  }
  return results;
}
