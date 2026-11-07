import type { AgentStep } from "./lib";

export interface CodeArtifact {
  id: string;
  messageId: string;
  language: string;
  filename: string;
  title: string;
  code: string;
  lineCount: number;
  previewable: boolean;
}

export interface ResearchSource {
  url: string;
  host: string;
  title: string;
  origin: "citation" | "agent-step" | "browser-tab";
  shotId?: string;
}

export interface FollowUpAction {
  label: string;
  prompt: string;
  mode?: "chat" | "agent";
  action?: "open-code" | "open-preview" | "open-sources";
}

const EXT_MAP: Record<string, string> = {
  html: "html",
  htm: "html",
  svg: "svg",
  xml: "xml",
  css: "css",
  scss: "scss",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  python: "py",
  py: "py",
  json: "json",
  sql: "sql",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  powershell: "ps1",
  markdown: "md",
  md: "md",
  yaml: "yml",
  yml: "yml",
  rust: "rs",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
};

const PREVIEWABLE_LANGS = new Set(["html", "htm", "svg", "markdown", "md", "tsx", "jsx"]);

export function isPreviewableCode(language: string, code: string): boolean {
  const lang = language.toLowerCase().trim();
  if (PREVIEWABLE_LANGS.has(lang)) return true;
  if ((lang === "ts" || lang === "typescript" || lang === "js" || lang === "javascript") && /\bfrom\s+['"]react['"]|\bcreateRoot\s*\(/.test(code)) {
    return true;
  }
  if ((lang === "xml" || lang === "") && /^\s*<svg[\s>]/i.test(code)) return true;
  if (lang === "" && /^\s*<!doctype html>|^\s*<html[\s>]/i.test(code)) return true;
  return false;
}

function inferFilename(language: string, code: string, index: number): { filename: string; title: string } {
  const lang = (language || "txt").toLowerCase().trim();
  const ext = EXT_MAP[lang] || "txt";

  // Check if first line has a filename comment like // src/app.tsx or <!-- index.html --> or # main.py
  const firstLine = (code.split("\n")[0] || "").trim();
  const fileMatch = firstLine.match(
    /^(?:\/\/|#|\/\*+|<!--)\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\s*(?:\*+\/|-->)?$/,
  );
  if (fileMatch?.[1]) {
    const clean = fileMatch[1].split("/").pop() || fileMatch[1];
    return { filename: clean, title: fileMatch[1] };
  }

  // Try to infer from function / component / class name
  const fnMatch =
    code.match(/(?:export\s+default\s+function|export\s+function|function|class|def|interface)\s+([A-Za-z0-9_]+)/) ||
    code.match(/<title>([^<]{1,40})<\/title>/i);
  if (fnMatch?.[1]) {
    const rawName = fnMatch[1].trim();
    const slug = rawName
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    if (slug) {
      return { filename: `${slug}.${ext}`, title: rawName };
    }
  }

  const base =
    ext === "html"
      ? "index"
      : ext === "svg"
        ? "graphic"
        : ext === "css"
          ? "styles"
          : ext === "py"
            ? "script"
            : ext === "sql"
              ? "query"
              : `snippet-${index + 1}`;
  const filename = index === 0 && base !== `snippet-${index + 1}` ? `${base}.${ext}` : `${base}-${index + 1}.${ext}`;
  return { filename, title: `${lang.toUpperCase() || "TEXT"} · ${filename}` };
}

/**
 * Extracts all substantial fenced code blocks from assistant messages into inspectable
 * workspace artifacts. Ignores Senko's internal `ui` / `senko-ui` widget JSON blocks.
 */
export function extractCodeArtifacts(
  messages: ReadonlyArray<{ id: string; role: "user" | "assistant"; content: string }>,
): CodeArtifact[] {
  const artifacts: CodeArtifact[] = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;

  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    let match: RegExpExecArray | null;
    fenceRegex.lastIndex = 0;
    let localIndex = 0;
    while ((match = fenceRegex.exec(m.content)) !== null) {
      const rawLang = (match[1] || "").trim().toLowerCase();
      if (rawLang === "ui" || rawLang === "senko-ui" || rawLang === "widget") continue;
      const code = (match[2] || "").replace(/\n$/, "");
      if (code.trim().length < 16) continue;
      const lineCount = code.split("\n").length;
      const { filename, title } = inferFilename(rawLang || "text", code, artifacts.length);
      artifacts.push({
        id: `${m.id}-code-${localIndex++}`,
        messageId: m.id,
        language: rawLang || "text",
        filename,
        title,
        code,
        lineCount,
        previewable: isPreviewableCode(rawLang, code),
      });
    }
  }
  return artifacts;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Collects deduplicated research sources from markdown links in assistant replies,
 * agent steps, and open browser tabs.
 */
export function extractResearchSources(
  messages: ReadonlyArray<{ id: string; role: "user" | "assistant"; content: string; steps?: AgentStep[] }>,
  liveSteps: ReadonlyArray<AgentStep> = [],
  tabs: ReadonlyArray<{ title: string; url: string }> = [],
): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];

  const add = (url: string, title: string, origin: ResearchSource["origin"], shotId?: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const cleanUrl = url.replace(/[),.;]+$/, "");
    const host = safeHost(cleanUrl);
    if (!host || host === "localhost" || host === "127.0.0.1") return;
    if (seen.has(cleanUrl)) {
      if (shotId) {
        const existing = out.find((s) => s.url === cleanUrl);
        if (existing && !existing.shotId) existing.shotId = shotId;
      }
      return;
    }
    seen.add(cleanUrl);
    out.push({
      url: cleanUrl,
      host,
      title: (title || host).trim().slice(0, 120),
      origin,
      shotId,
    });
  };

  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = mdLinkRe.exec(m.content || "")) !== null) {
      add(match[2], match[1], "citation");
    }
    const bareUrlRe = /(?<!\()(https?:\/\/[^\s<>"')\]]+)/g;
    while ((match = bareUrlRe.exec(m.content || "")) !== null) {
      add(match[1], safeHost(match[1]), "citation");
    }
    if (m.steps) {
      for (const s of m.steps) {
        if (s.url) add(s.url, s.label || safeHost(s.url), "agent-step", s.shotId);
      }
    }
  }

  for (const s of liveSteps) {
    if (s.url) add(s.url, s.label || safeHost(s.url), "agent-step", s.shotId);
  }

  for (const t of tabs) {
    if (t.url && t.url !== "about:blank") add(t.url, t.title || safeHost(t.url), "browser-tab");
  }

  return out;
}

/**
 * Generates context-sensitive follow-up actions tailored to the nature of the assistant's reply.
 */
export function deriveFollowUpActions(
  content: string,
  mode: "chat" | "agent",
  messageArtifacts: ReadonlyArray<CodeArtifact>,
  sourceCount: number,
): FollowUpAction[] {
  const actions: FollowUpAction[] = [];
  const text = (content || "").trim();
  if (text.length < 30) return actions;

  const hasPreviewable = messageArtifacts.some((a) => a.previewable);
  if (hasPreviewable) {
    actions.push({
      label: "Live Preview in Workspace",
      prompt: "",
      action: "open-preview",
    });
  } else if (messageArtifacts.length > 0) {
    actions.push({
      label: `Open in Code Workspace (${messageArtifacts.length})`,
      prompt: "",
      action: "open-code",
    });
  }

  if (sourceCount > 0) {
    actions.push({
      label: `Inspect Sources (${sourceCount})`,
      prompt: "",
      action: "open-sources",
    });
  }

  if (messageArtifacts.length > 0) return actions.slice(0, 2);

  if (mode === "agent") return actions.slice(0, 2);

  if (/\|.*\|.*\|/.test(text) || /comparison|versus|\bvs\.?\b|trade-?offs/i.test(text)) {
    actions.push({
      label: "Recommend the best option",
      prompt: "Based on this comparison, give me a concrete recommendation for different use cases.",
      mode: "chat",
    });
    actions.push({
      label: "Verify live in Agent mode",
      prompt: "Use the browser agent to check the latest live pricing, benchmarks, or release notes for these options.",
      mode: "agent",
    });
  } else if (/step\s*1|1\.|tutorial|guide|how to/i.test(text)) {
    actions.push({
      label: "Generate a starter template",
      prompt: "Create a complete, ready-to-run starter implementation based on these steps.",
      mode: "chat",
    });
    actions.push({
      label: "Common pitfalls & troubleshooting",
      prompt: "What are the most common failure modes or pitfalls with this approach, and how do I avoid them?",
      mode: "chat",
    });
  } else {
    actions.push({
      label: "Go deeper with examples",
      prompt: "Go deeper into the most important part of this with concrete, practical examples.",
      mode: "chat",
    });
    actions.push({
      label: "Research live on the web",
      prompt: "Browse the web in Agent mode to gather the latest primary sources and data on this topic.",
      mode: "agent",
    });
  }

  return actions.slice(0, 4);
}

export function formatChatAsMarkdown(
  title: string,
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string; created_at?: string }>,
): string {
  const header = `# ${title || "Senko AI Workspace Export"}\n\n_Exported ${new Date().toISOString()}_\n\n---\n\n`;
  const body = messages
    .map((m) => `### ${m.role === "user" ? "User" : "Senko AI"}\n\n${m.content.trim()}\n`)
    .join("\n---\n\n");
  return header + body;
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
