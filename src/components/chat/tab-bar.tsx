"use client";

import { ExternalLink, X } from "lucide-react";
import type { SenkoTab } from "@/types/chat";

interface TabBarProps {
  tabs: SenkoTab[];
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
}

export function TabBar({ tabs, onCloseTab, onSwitchTab }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 border-b border-white/[0.04] px-3 py-1.5 overflow-x-auto scrollbar-none">
      {tabs.map((tab) => {
        let hostname = "";
        try { hostname = new URL(tab.url).hostname; } catch { /* skip */ }

        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] shrink-0 cursor-pointer transition-all duration-200 max-w-[200px] ${
              tab.active
                ? "bg-[var(--senko-accent)]/10 text-[var(--senko-accent)] border border-[var(--senko-accent)]/20"
                : "bg-white/[0.03] text-zinc-500 border border-white/[0.04] hover:bg-white/[0.06] hover:text-zinc-400"
            }`}
            onClick={() => onSwitchTab(tab.id)}
            title={tab.title || tab.url}
          >
            {/* Favicon */}
            {tab.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tab.favicon}
                alt=""
                className="h-3 w-3 rounded-sm shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : hostname ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=16`}
                alt=""
                className="h-3 w-3 rounded-sm shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : null}

            {/* Title */}
            <span className="truncate">
              {tab.title || hostname || "Tab"}
            </span>

            {/* Open in browser */}
            <a
              href={tab.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden group-hover:flex shrink-0 rounded p-0.5 hover:bg-white/10 transition-colors"
              onClick={(e) => e.stopPropagation()}
              title="Open in browser"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>

            {/* Close */}
            <button
              className="hidden group-hover:flex shrink-0 rounded p-0.5 hover:bg-white/10 transition-colors"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              title="Close tab"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
