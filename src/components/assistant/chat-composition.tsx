"use client";

import type { CSSProperties } from "react";
import { RichMessageContent } from "../ui-renderer/dynamic-ui-renderer";
import { SmartImage } from "../ui-renderer/smart-image";
import type { ChatLayoutNode, ChatLayoutSegment } from "@/lib/chat-layout";
import type { Msg } from "./lib";
import "./chat-composition.css";

type Props = {
  segments: ChatLayoutSegment[];
  images?: Msg["scrapedImages"];
  messageId: string;
  streaming?: boolean;
  uiImages?: Record<string, string[]>;
  onSendMessage?: (text: string) => void;
  onRunPrompt?: (text: string) => void;
};

export function ChatComposition({ segments, images, ...rich }: Props) {
  function render(node: ChatLayoutNode, key: number) {
    const style = {
      "--chat-weight": node.weight ?? 1,
      "--chat-span": Math.round(node.span ?? 1),
      "--chat-columns": Math.round(node.columns ?? 2),
      gap: node.gap ?? 16,
      alignItems: node.align ?? "start",
    } as CSSProperties;
    return (
      <div key={key} className={`sk-chat-piece sk-chat-${node.type}`} style={style}>
        {node.type === "text" ? <RichMessageContent {...rich} text={node.text!} /> : null}
        {node.type === "image" ? (
          <figure className="m-0 min-w-0">
            <SmartImage
              imageUrl={node.image !== undefined ? images?.[node.image]?.url : undefined}
              imageQuery={node.imageQuery}
              sourceUrl={node.image !== undefined ? images?.[node.image]?.source : undefined}
              alt={node.alt || (node.image !== undefined ? images?.[node.image]?.alt : undefined) || node.imageQuery || "Image"}
              aspect={node.aspect}
              quietActions
            />
            {node.caption ? <figcaption className="mt-1.5 text-xs leading-relaxed text-[var(--sk-muted)]">{node.caption}</figcaption> : null}
          </figure>
        ) : null}
        {node.children?.map((child, i) => render(child, i))}
      </div>
    );
  }

  return (
    <div className="sk-chat-composition space-y-3">
      {segments.map((segment, i) => {
        if (segment.kind === "prose") return <RichMessageContent key={i} {...rich} text={segment.text} />;
        if (segment.kind === "layout") return render(segment.node, i);
        if (segment.kind === "pending") return <div key={i} role="status" aria-label="Composing response" className="h-16 animate-pulse rounded-xl bg-[var(--sk-surface)]" />;
        return <p key={i} role="status" className="text-sm text-[var(--sk-muted)]">This part of the response could not be displayed. Try regenerating the reply.</p>;
      })}
    </div>
  );
}
