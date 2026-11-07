"use client";

import { useState } from "react";
import { WorkspacePanel, type WorkspaceTab } from "@/components/assistant/workspace-panel";

/**
 * Full-screen Side-by-Side Workspace view (`/code/[chatId]`).
 * Renders the dedicated Workspace Coding Agent, Code Editor, and Terminal on the left 50%,
 * and the Live Playable Website + AI Visual Inspector & Assigned Problems HUD on the right 50%.
 */
export function CodeWorkspace({ chatId }: { chatId: string }) {
  const [tab, setTab] = useState<WorkspaceTab>("agent");
  const [expanded, setExpanded] = useState(false);

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
