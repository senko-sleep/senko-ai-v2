"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import type { WebEmbed as WebEmbedType } from "@/types/chat";

interface WebEmbedProps {
  embed: WebEmbedType;
}

export function WebEmbed({ embed }: WebEmbedProps) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-white/[0.03] px-2 py-1 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${new URL(embed.url).hostname}&sz=16`}
            alt=""
            className="h-3 w-3 rounded-sm flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[10px] text-zinc-500 truncate">
            {embed.title || embed.url}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
            title={expanded ? "Minimize" : "Expand"}
          >
            {expanded ? <Minimize2 className="h-2.5 w-2.5" /> : <Maximize2 className="h-2.5 w-2.5" />}
          </button>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Open in browser"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>

      {/* iframe */}
      <div
        className="relative w-full bg-white transition-all"
        style={{ height: expanded ? "600px" : "350px" }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <div className="flex items-center gap-2 text-zinc-500 text-xs">
              <div className="h-3 w-3 border-2 border-zinc-600 border-t-[#a78bfa] rounded-full animate-spin" />
              loading site...
            </div>
          </div>
        )}
        <iframe
          src={embed.url}
          title={embed.title || embed.url}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
