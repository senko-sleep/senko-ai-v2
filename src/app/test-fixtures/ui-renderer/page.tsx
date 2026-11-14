"use client";
import { useEffect, useState } from "react";
import { RichMessageContent } from "@/components/ui-renderer/dynamic-ui-renderer";
import { MessageBubble } from "@/components/assistant/message-bubble";
import type { Msg } from "@/components/assistant/lib";

/** Public, non-sensitive acceptance artifacts rendered through the actual message renderer. */
export default function RendererAcceptancePage() {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState("Loading renderer acceptance artifact…");
  const [action, setAction] = useState("");
  const [message, setMessage] = useState<Msg | null>(null);
  useEffect(() => {
    const name = new URLSearchParams(location.search).get("case") || "eevee-controlled";
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw new Error("Invalid acceptance artifact name.");
      const response = await fetch(`/test-fixtures/ui-generation/${name}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Artifact unavailable: HTTP ${response.status}`);
      const data = await response.json(); setContent(data.content || ""); setMessage(data.message || null); setScope(data.scope || "Renderer acceptance artifact");
    }).catch((error) => { if (!controller.signal.aborted) setScope(String(error)); });
    return () => controller.abort();
  }, []);
  return <main className="sk min-h-dvh bg-[var(--sk-bg)] p-4 text-[var(--sk-text)] md:p-8"><div className="mx-auto max-w-6xl"><p data-testid="artifact-scope" className="mb-4 text-xs text-[var(--sk-muted)]">{scope}</p>{message ? <MessageBubble msg={message} onSendMessage={setAction} onRunPrompt={setAction} /> : <RichMessageContent messageId="renderer-acceptance" text={content} onSendMessage={setAction} onRunPrompt={setAction} />}<p role="status" data-testid="ui-action-result">{action}</p></div></main>;
}
