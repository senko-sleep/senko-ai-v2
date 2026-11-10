"use client";
import { useEffect, useState } from "react";
import { RichMessageContent } from "@/components/ui-renderer/dynamic-ui-renderer";

/** Public, non-sensitive acceptance artifacts rendered through the actual message renderer. */
export default function RendererAcceptancePage() {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState("Loading renderer acceptance artifact…");
  const [action, setAction] = useState("");
  useEffect(() => {
    const name = new URLSearchParams(location.search).get("case") || "eevee-controlled";
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) { setScope("Invalid acceptance artifact name."); return; }
    const controller = new AbortController();
    void fetch(`/test-fixtures/ui-generation/${name}.json`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Artifact unavailable: HTTP ${response.status}`);
      const data = await response.json(); setContent(data.content); setScope(data.scope || "Renderer acceptance artifact");
    }).catch((error) => { if (!controller.signal.aborted) setScope(String(error)); });
    return () => controller.abort();
  }, []);
  return <main className="sk min-h-dvh bg-[var(--sk-bg)] p-4 text-[var(--sk-text)] md:p-8"><div className="mx-auto max-w-6xl"><p data-testid="artifact-scope" className="mb-4 text-xs text-[var(--sk-muted)]">{scope}</p><RichMessageContent messageId="renderer-acceptance" text={content} onSendMessage={setAction} onRunPrompt={setAction} /><p role="status" data-testid="ui-action-result">{action}</p></div></main>;
}
