"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { connect, getChat } from "@/components/assistant/api";
import { WorkspacePanel, type WorkspaceTab } from "@/components/assistant/workspace-panel";

/**
 * Full-screen Side-by-Side Workspace view (`/code/[chatId]`).
 * Renders the dedicated Workspace Coding Agent, Code Editor, and Terminal on the left 50%,
 * and the Live Playable Website + AI Visual Inspector & Assigned Problems HUD on the right 50%.
 */
export function CodeWorkspace({ chatId }: { chatId: string }) {
  const [tab, setTab] = useState<WorkspaceTab>("agent");
  const [expanded, setExpanded] = useState(false);
  const [access, setAccess] = useState<"loading" | "ready" | "error">("loading");
  const [accessError, setAccessError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (await connect() === "needs-key") throw new Error("Sign in from the chat page to open this workspace.");
        await getChat(chatId);
        if (!cancelled) setAccess("ready");
      } catch (error) {
        if (!cancelled) { setAccessError(error instanceof Error ? error.message : "Workspace could not be opened."); setAccess("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  if (access !== "ready") return <main className="sk flex min-h-dvh items-center justify-center bg-[var(--sk-bg)] p-6 text-[var(--sk-text)]"><div className="max-w-md space-y-4"><p role={access === "error" ? "alert" : "status"}>{access === "error" ? accessError : "Opening workspace…"}</p>{access === "error" && <Link href="/" className="underline underline-offset-4">Return to chat</Link>}</div></main>;

  return (
    <main className="sk flex h-dvh w-full flex-row overflow-hidden bg-[var(--sk-bg)] text-[var(--sk-text)]">
      <WorkspacePanel
        key={chatId}
        chatId={chatId}
        activeTab={tab}
        onTabChange={setTab}
        artifacts={[]}
        selectedArtifactId={null}
        onSelectArtifact={() => {}}
        sources={[]}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onClose={() => window.close()}
        onAskSenko={() => {}}
        defaultSplitPreview={true}
      />
    </main>
  );
}
