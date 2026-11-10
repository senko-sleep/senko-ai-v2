"use client";

import dynamic from "next/dynamic";
import type { WorkspaceEditorSession, WorkspaceEditorStatus } from "./workspace-code-editor";
import { filterWorkspacePaths } from "./workspace-file-search";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  Globe,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  PanelLeft,
  Pencil,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  WrapText,
  X,
} from "lucide-react";
import { downloadTextFile, type CodeArtifact, type ResearchSource } from "./workspace-artifacts";
import {
  buildTree,
  bundlePage,
  deletePath,
  emptyProject,
  languageOf,
  loadProject,
  mergeArtifacts,
  normalizePath,
  previewEntry,
  previewStatusDoc,
  renamePath,
  repairKey,
  saveProject,
  type TreeNode,
  type WorkspaceProject,
} from "./workspace-files";
import { WorkspaceActivityLog } from "./workspace-activity-log";
import { applyStep, type ActivityEntry } from "@/lib/agent/activity-log";
import { WorkspaceExecutionEvidence, type WorkspaceCodingTask, type WorkspaceMediaEvidence } from "./workspace-execution-evidence";
import { EnhancedMarkdown } from "@/components/ui-renderer/dynamic-ui-renderer";

export type WorkspaceTab = "code" | "preview" | "terminal" | "agent" | "sources";

export interface WorkspacePanelProps {
  chatId: string | null;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  artifacts: CodeArtifact[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  sources: ResearchSource[];
  scrapedImages?: string[];
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onAskSenko: (prompt: string, mode?: "chat" | "agent") => void;
  defaultSplitPreview?: boolean;
}

interface ServerDiffRecord {
  path: string;
  status: "created" | "modified" | "deleted" | "moved";
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
}

interface ServerCommandRecord {
  id: string;
  command: string;
  category: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  blockedReason?: string;
}

interface ServerBrowserInspection {
  mediaPlayback?: WorkspaceMediaEvidence[];
  id: string;
  url: string;
  httpStatus: number | null;
  title: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; reason: string; status?: number }[];
  brokenImages: string[];
  layoutIssues: string[];
  elementsCount: number;
  interactions: { action: string; target: string; ok: boolean; detail: string }[];
  screenshotBase64?: string;
  passed: boolean;
}

interface ServerDiagnosticIssue {
  id: string;
  source: "bundle" | "test" | "runtime" | "browser" | "layout" | "interaction";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  file?: string;
  status: "assigned" | "debugging" | "editing" | "fixed";
  assignedAt: number;
  resolvedAt?: number;
}

interface ServerLedger {
  codingTask?: WorkspaceCodingTask;
  primaryGoal?: string;
  codeWritten: boolean;
  codeExecuted: boolean;
  testStatus: "passed" | "failed" | "not_run" | "blocked";
  files: Record<string, { path: string; code: string; sizeBytes: number; binary?: boolean }>;
  diffs: ServerDiffRecord[];
  commands: ServerCommandRecord[];
  browserInspections: ServerBrowserInspection[];
  repairAttempts: {
    id?: string;
    attempt: number;
    signature?: string;
    timestamp?: number;
    stage: string;
    probableCause: string;
    filesModified: string[];
    resolved: boolean;
  }[];
  issues?: ServerDiagnosticIssue[];
}

interface WorkspaceFileOp {
  action: "On disk" | "Created" | "Edited" | "Deleted";
  path: string;
  langBadge: string;
  linesRange?: string;
  added?: number;
  removed?: number;
}

interface WorkspaceAgentStep {
  id: number;
  stage: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  url?: string;
  fileOps?: WorkspaceFileOp[];
}

interface WorkspaceAgentRun {
  id: string;
  prompt: string;
  status: "running" | "done" | "error" | "stopped";
  summary?: string;
  filesModified: string[];
  steps: WorkspaceAgentStep[];
  createdAt: number;
}

function wrapPreview(path: string, code: string): string {
  const trimmed = code.trim();
  if (/\.svg$/i.test(path) || /^<svg[\s>]/i.test(trimmed)) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:94vw;max-height:92vh;height:auto}</style></head><body>${trimmed}</body></html>`;
  }
  if (/^<!doctype html>|^<html[\s>]/i.test(trimmed)) return trimmed;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;line-height:1.5}</style></head><body>${trimmed}</body></html>`;
}

const WorkspaceCodeEditor = dynamic(() => import("./workspace-code-editor").then((module) => module.WorkspaceCodeEditor), {
  ssr: false,
  loading: () => <div className="flex flex-1 items-center justify-center text-xs text-[var(--sk-muted)]">Loading editor?</div>,
});

const narrowWorkspaceQuery = "(max-width: 1023px)";
const subscribeToWorkspaceWidth = (listener: () => void) => {
  const media = window.matchMedia(narrowWorkspaceQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

type Draft = { kind: "file" | "folder" | "rename"; target: string; value: string } | null;

const tabBtn = (on: boolean) =>
  `sk-btn h-7 px-2.5 text-[11.5px] rounded-md ${
    on
      ? "bg-[var(--sk-surface-3)] text-[var(--sk-text)] font-medium shadow-xs border border-[var(--sk-line-strong)]"
      : "text-[var(--sk-muted)] hover:text-[var(--sk-text)] border border-transparent"
  }`;
const iconBtn = "sk-btn h-6.5 w-6.5 text-[var(--sk-muted)] hover:text-[var(--sk-text)]";

export function WorkspacePanel({
  chatId,
  activeTab,
  onTabChange,
  artifacts,
  selectedArtifactId,
  sources,
  scrapedImages = [],
  expanded,
  onToggleExpand,
  onClose,
  onAskSenko,
  defaultSplitPreview = true,
}: WorkspacePanelProps) {
  const [project, setProject] = useState<WorkspaceProject>(emptyProject);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft>(null);
  const [copied, setCopied] = useState(false);
  const [viewport, setViewport] = useState<"fit" | "desktop" | "mobile">("fit");
  const [previewKey, setPreviewKey] = useState(0);
  const [splitPreview, setSplitPreview] = useState<boolean>(defaultSplitPreview);
  const [showDiff, setShowDiff] = useState(false);
  const [treeOpenManual, setTreeOpenManual] = useState<boolean | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");
  const [expandedShot, setExpandedShot] = useState<string | null>(null);
  const [showAiVision, setShowAiVision] = useState(false);
  const [previewPaneWidth, setPreviewPaneWidth] = useState(0);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Real Node.js backend workspace & terminal state
  const [ledger, setLedger] = useState<ServerLedger | null>(null);
  const [checkpoints, setCheckpoints] = useState<{ id: string; label: string; createdAt: number }[]>([]);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cmdInput, setCmdInput] = useState("");
  const [termBusy, setTermBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [egressInfo, setEgressInfo] = useState<string | null>(null);
  const [bundledHtml, setBundledHtml] = useState<string | null>(null);
  const [bundleErrors, setBundleErrors] = useState<string[]>([]);
  const [bundleFailed, setBundleFailed] = useState<string | null>(null);

  // Dedicated Workspace Coding Agent state (live edits, live fixes, live debugs)
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentRuns, setAgentRuns] = useState<WorkspaceAgentRun[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const agentAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      if (w > 0) setPreviewPaneWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab, splitPreview, project.files.length]);

  const draftRef = useRef<HTMLInputElement>(null);
  const editorSession = useRef<WorkspaceEditorSession>({ documents: new Map() });
  const [editorStatus, setEditorStatus] = useState<WorkspaceEditorStatus>({ line: 1, column: 1, diagnostics: 0 });
  const [quickOpen, setQuickOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const quickOpenInput = useRef<HTMLInputElement>(null);
  const quickOpenTrigger = useRef<HTMLButtonElement>(null);
  const activeFileTab = useRef<HTMLButtonElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(50);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [wrapLines, setWrapLines] = useState(false);
  useEffect(() => {
    const element = panesRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const matchingPaths = useMemo(() => filterWorkspacePaths(project.files.map((f) => f.path), fileQuery), [project.files, fileQuery]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setWrapLines((wrap) => !wrap);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p" && !event.altKey) {
        event.preventDefault();
        setQuickOpen((open) => !open);
        setFileQuery("");
        setQuickOpenIndex(0);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => { if (quickOpen) quickOpenInput.current?.focus(); }, [quickOpen]);
  const closeQuickOpen = () => { setQuickOpen(false); quickOpenTrigger.current?.focus(); };
  const chooseQuickOpen = (path: string) => {
    setSelected(path);
    setShowDiff(false);
    onTabChange("code");
    closeQuickOpen();
  };

  const refreshServerWorkspace = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}/workspace`);
      if (!res.ok) return;
      const data = (await res.json()) as { ledger?: ServerLedger; checkpoints?: { id: string; label: string; createdAt: number }[] };
      setCheckpoints(data.checkpoints || []);
      if (data.ledger) {
        setLedger(data.ledger);
        const srvFiles = Object.values(data.ledger.files || {});
        {
          setProject((prev) => {
            const srvSet = new Set(srvFiles.map((sf) => sf.path));
            const nextFiles = prev.files.filter((f) => srvSet.has(f.path) || f.edited);
            let changed = nextFiles.length !== prev.files.length;
            for (const sf of srvFiles) {
              const idx = nextFiles.findIndex((f) => f.path === sf.path);
              if (idx < 0) {
                nextFiles.push({ path: sf.path, code: sf.code, binary: sf.binary, edited: false });
                changed = true;
              } else if ((nextFiles[idx].binary !== sf.binary || nextFiles[idx].code !== sf.code) && !nextFiles[idx].edited) {
                nextFiles[idx] = { ...nextFiles[idx], code: sf.code, binary: sf.binary, edited: false };
                changed = true;
              }
            }
            // Keep the same object when nothing changed so effects keyed on project.files don't re-fire.
            return changed ? { ...prev, files: nextFiles } : prev;
          });
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => () => { agentAbortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!chatId) return;
    let busy = false;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      void refreshServerWorkspace(chatId).finally(() => { busy = false; });
    }, 3000);
    return () => clearInterval(timer);
  }, [chatId, refreshServerWorkspace]);

  useEffect(() => {
    const loaded = loadProject(chatId);
    setProject(loaded);
    setLoadedFor(chatId);
    setSelected((s) => (s && loaded.files.some((f) => f.path === s) ? s : loaded.files[loaded.files.length - 1]?.path ?? null));
    void refreshServerWorkspace(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Tracked via ref: depending on ledger here made refresh -> setLedger -> effect -> refresh loop forever.
  const hasServerFilesRef = useRef(false);
  hasServerFilesRef.current = Object.keys(ledger?.files || {}).length > 0;

  useEffect(() => {
    if (loadedFor !== chatId) return;
    // Only merge chat message code artifacts when the real server workspace has no files yet
    if (!hasServerFilesRef.current && artifacts.length > 0) {
      setProject((p) => {
        const merged = mergeArtifacts(p, artifacts);
        setSelected((s) => s ?? merged.files[merged.files.length - 1]?.path ?? null);
        return merged;
      });
    }
    void refreshServerWorkspace(chatId);
  }, [artifacts, chatId, loadedFor, refreshServerWorkspace]);

  useEffect(() => {
    if (loadedFor === chatId) saveProject(chatId, project);
  }, [project, chatId, loadedFor]);

  useEffect(() => {
    const art = artifacts.find((a) => a.id === selectedArtifactId);
    if (!art) return;
    const file = project.files.find((f) => f.sourceId === art.id);
    if (file) setSelected(file.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArtifactId]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (draft) draftRef.current?.focus();
  }, [draft]);

  const tree = useMemo(() => buildTree(project), [project]);
  const file = project.files.find((f) => f.path === selected) || project.files[0] || null;
  const entry = useMemo(() => previewEntry(project, file?.path ?? selected), [project, file, selected]);
  const needsEsbuildBundle = useMemo(
    () =>
      Boolean(
        entry &&
          (/\.(tsx|jsx|ts)$/i.test(entry.path) ||
            (/\.(html?)$/i.test(entry.path) && /\.(tsx|ts|jsx)\b/i.test(entry.code))),
      ),
    [entry],
  );

  // Cheap content signature so re-bundling only happens when file contents really change,
  // not every time a new (but identical) files array is created.
  const filesSig = useMemo(() => {
    let h = 0;
    for (const f of project.files) {
      const s = `${f.path}\u0000${f.edited ? 1 : 0}\u0000${f.code}\u0001`;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return `${project.files.length}:${h}`;
  }, [project.files]);
  const filesRef = useRef(project.files);
  filesRef.current = project.files;
  const entryPath = entry?.path ?? null;

  useEffect(() => {
    if (!chatId || !entryPath || !needsEsbuildBundle) {
      setBundledHtml(null);
      setBundleErrors([]);
      return;
    }
    let cancelled = false;
    const runBundle = async () => {
      try {
        for (const pf of filesRef.current) {
          if (!pf.edited) continue;
          await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "write_file", path: pf.path, content: pf.code }),
          }).catch(() => {});
        }
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "bundle_preview",
            path: /\.(tsx|jsx|ts)$/i.test(entryPath) ? entryPath : undefined,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setBundleFailed(`Preview bundle request failed (HTTP ${res.status}).`);
          return;
        }
        const data = (await res.json()) as { html?: string; errors?: string[] };
        if (cancelled) return;
        setBundledHtml(data.html || null);
        setBundleErrors(data.errors || []);
        setBundleFailed(data.html ? null : (data.errors || []).join("\n") || "Bundler returned no output.");
      } catch (e) {
        if (!cancelled) setBundleFailed(e instanceof Error ? e.message : String(e));
      }
    };
    const t = setTimeout(() => void runBundle(), 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [chatId, entryPath, needsEsbuildBundle, filesSig, previewKey]);

  const previewDoc = useMemo(() => {
    if (!entry || /\.md$/i.test(entry.path)) return "";
    if (needsEsbuildBundle) {
      // Never render raw TS/TSX source as if it were the app: show real bundle state instead.
      return bundledHtml || previewStatusDoc(bundleFailed ? "error" : "compiling", bundleFailed || bundleErrors.join("\n"));
    }
    return wrapPreview(entry.path, bundlePage(project, entry));
  }, [project, entry, needsEsbuildBundle, bundledHtml, bundleFailed, bundleErrors]);

  const currentFileDiff = useMemo(
    () => (file && ledger ? ledger.diffs.find((d) => d.path === file.path) || null : null),
    [file, ledger],
  );

  const narrowViewport = useSyncExternalStore(subscribeToWorkspaceWidth, () => window.matchMedia(narrowWorkspaceQuery).matches, () => false);
  const narrowWorkspace = narrowViewport || (workspaceWidth > 0 && workspaceWidth < 1024);
  const showFileTree = treeOpenManual ?? (!narrowWorkspace && (project.files.length > 1 || project.folders.length > 0));

  const codeLines = useMemo(() => (file ? file.code.split("\n") : [""]), [file]);
  useEffect(() => { activeFileTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [file?.path, activeTab, workspaceWidth, previewWidth]);
  useEffect(() => { if (quickOpen) document.getElementById(`workspace-file-result-${quickOpenIndex}`)?.scrollIntoView({ block: "nearest" }); }, [quickOpen, quickOpenIndex]);

  const filteredSources = useMemo(() => {
    const q = sourceFilter.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => s.title.toLowerCase().includes(q) || s.host.toLowerCase().includes(q) || s.url.toLowerCase().includes(q));
  }, [sources, sourceFilter]);

  const folderOf = (path: string | null) => {
    if (!path) return "";
    if (project.folders.includes(path) || project.files.every((f) => f.path !== path)) return path;
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  };

  const syncFileToServer = async (path: string, content: string) => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write_file", path, content }),
      });
      if (res.ok) {
        const j = (await res.json()) as { ledger?: ServerLedger };
        if (j.ledger) {
          setLedger(j.ledger);
          if (j.ledger.files[path]?.code === content) {
            setProject((prev) => ({ ...prev, files: prev.files.map((f) =>
              f.path === path && f.code === content ? { ...f, edited: false } : f) }));
          }
        }
      }
    } catch {
      /* ignore */
    }
  };

  const runCheckpointAction = async (checkpointId?: string) => {
    if (!chatId || checkpointBusy) return;
    setCheckpointBusy(true);
    setCheckpointError(null);
    try {
      // Include editor drafts in the snapshot/undo history before changing the disk tree.
      for (const pf of project.files.filter((f) => f.edited)) {
        const saved = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write_file", path: pf.path, content: pf.code }),
        });
        if (!saved.ok) throw new Error(`Could not save ${pf.path} before checkpoint (HTTP ${saved.status}).`);
      }
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkpointId ? { action: "restore_checkpoint", checkpointId } : { action: "checkpoint", goal: "Manual editor checkpoint" }),
      });
      const data = await res.json() as { error?: string; ledger?: ServerLedger };
      if (!res.ok) throw new Error(data.error || `Checkpoint operation failed (HTTP ${res.status}).`);
      if (checkpointId && data.ledger) {
        setProject((prev) => ({ ...prev, files: Object.values(data.ledger!.files).map((f) => ({ path: f.path, code: f.code, edited: false })) }));
        setPreviewKey((key) => key + 1);
      }
      await refreshServerWorkspace(chatId);
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Checkpoint operation failed.");
    } finally { setCheckpointBusy(false); }
  };

  const commitDraft = async () => {
    if (!draft) return;
    const name = normalizePath(draft.value);
    if (name) {
      if (draft.kind === "rename") {
        const parent = draft.target.includes("/") ? draft.target.slice(0, draft.target.lastIndexOf("/")) : "";
        const dest = normalizePath(parent ? `${parent}/${name}` : name);
        const renamed = renamePath(project, draft.target, dest);
        if (renamed === project) { setDraft(null); return; }
        if (chatId) {
          try {
            for (const pf of project.files.filter((f) => f.path === draft.target || f.path.startsWith(`${draft.target}/`))) {
              const nextPath = dest + pf.path.slice(draft.target.length);
              for (const operation of [
                { action: "write_file", path: pf.path, content: pf.code },
                { action: "move_file", fromPath: pf.path, toPath: nextPath },
              ]) {
                const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
                  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation),
                });
                if (!res.ok) throw new Error(`Rename failed (HTTP ${res.status}).`);
              }
            }
          } catch (error) {
            setBundleFailed(error instanceof Error ? error.message : "Rename failed.");
            return;
          }
        }
        setProject(renamed);
        if (selected === draft.target || selected?.startsWith(`${draft.target}/`)) setSelected(dest + (selected?.slice(draft.target.length) || ""));
      } else {
        const path = normalizePath(draft.target ? `${draft.target}/${name}` : name);
        const exists = project.files.some((f) => f.path === path) || project.folders.includes(path);
        if (!exists) {
          if (draft.kind === "file") {
            setProject((p) => ({ ...p, files: [...p.files, { path, code: "", edited: true }] }));
            setSelected(path);
            void syncFileToServer(path, "");
          } else {
            setProject((p) => ({ ...p, folders: [...p.folders, path] }));
          }
          if (draft.target) setOpenFolders((s) => new Set(s).add(draft.target));
        }
      }
    }
    setDraft(null);
  };

  const remove = (path: string) => {
    setProject((p) => deletePath(p, path));
    if (selected === path || selected?.startsWith(`${path}/`)) setSelected(null);
    if (chatId) {
      void fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_file", path }),
      }).catch(() => {});
    }
  };

  const editFile = (code: string) => {
    if (!file) return;
    setProject((p) => ({ ...p, files: p.files.map((f) => (f.path === file.path ? { ...f, code, edited: true } : f)) }));
  };

  const runServerCommand = async (command: string) => {
    if (!chatId || !command.trim() || termBusy) return;
    setTermBusy(true);
    try {
      // Sync only user-edited files before running command
      for (const pf of project.files) {
        if (!pf.edited) continue;
        await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write_file", path: pf.path, content: pf.code }),
        }).catch(() => {});
      }
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_command", command: command.trim() }),
      });
      if (res.ok) {
        const j = (await res.json()) as { ledger?: ServerLedger };
        if (j.ledger) setLedger(j.ledger);
      }
    } finally {
      setTermBusy(false);
    }
  };

  const stopWorkspaceAgent = useCallback(() => {
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    setAgentBusy(false);
    setAgentRuns((prev) =>
      prev.map((r, idx) => (idx === prev.length - 1 && r.status === "running" ? { ...r, status: "stopped" } : r)),
    );
  }, []);

  const runWorkspaceAgentTask = useCallback(
    async (instruction: string, opts: { applyLiveInstruction?: boolean; inspectBrowser?: boolean } = {}) => {
      const cleanGoal = instruction.trim();
      if (!chatId || !cleanGoal || agentBusy) return;

      const ctl = new AbortController();
      agentAbortRef.current = ctl;
      setAgentBusy(true);
      setSplitPreview(true);
      if (activeTab !== "agent") onTabChange("agent");

      const runId = `ws_agent_${Date.now()}`;
      setAgentRuns((prev) => [
        ...prev,
        {
          id: runId,
          prompt: cleanGoal,
          status: "running",
          filesModified: [],
          steps: [],
          createdAt: Date.now(),
        },
      ]);

      try {
        // Sync only user-edited editor files to server workspace before the agent runs
        for (const pf of project.files) {
          if (!pf.edited) continue;
          await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "write_file", path: pf.path, content: pf.code }),
            signal: ctl.signal,
          }).catch(() => {});
        }

        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: opts.applyLiveInstruction !== false ? "agent_chat" : "run_workflow",
            goal: cleanGoal,
            applyLiveInstruction: opts.applyLiveInstruction !== false,
            inspectBrowser: opts.inspectBrowser ?? Boolean(entry),
            stream: true,
          }),
          signal: ctl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Workspace Agent HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            try {
              const evt = JSON.parse(jsonStr) as {
                type: "step" | "done" | "error";
                step?: WorkspaceAgentStep;
                ledger?: ServerLedger;
                result?: {
                  sanitizedReply?: string;
                  verificationReportMarkdown?: string;
                  filesCreatedOrModified?: string[];
                  testPassed?: boolean;
                  verified?: boolean;
                };
                error?: string;
              };

              if (evt.ledger) {
                setLedger(evt.ledger);
                const srvFiles = Object.values(evt.ledger.files || {});
                {
                  setProject((prev) => {
                    const serverPaths = new Set(srvFiles.map((f) => f.path));
                    const nextFiles = prev.files.filter((f) => serverPaths.has(f.path) || f.edited);
                    let changed = nextFiles.length !== prev.files.length;
                    for (const sf of srvFiles) {
                      const idx = nextFiles.findIndex((f) => f.path === sf.path);
                      if (idx < 0) {
                        nextFiles.push({ path: sf.path, code: sf.code });
                        changed = true;
                      } else if (nextFiles[idx].code !== sf.code && !nextFiles[idx].edited) {
                        nextFiles[idx] = { ...nextFiles[idx], code: sf.code, edited: false };
                        changed = true;
                      }
                    }
                    return changed ? { ...prev, files: nextFiles } : prev;
                  });
                }
              }

              if (evt.type === "step" && evt.step) {
                const step = evt.step;
                setActivity((prev) => applyStep(prev, runId, step));
                if ((step.stage === "implement" || step.stage === "repair") && step.status === "done") {
                  setPreviewKey((k) => k + 1);
                }
                setAgentRuns((prev) =>
                  prev.map((r) => {
                    if (r.id !== runId) return r;
                    const exists = r.steps.some((s) => s.id === step.id);
                    const nextSteps = exists
                      ? r.steps.map((s) => (s.id === step.id ? step : s))
                      : [...r.steps, step];
                    return { ...r, steps: nextSteps };
                  }),
                );
              } else if (evt.type === "done") {
                const verified = evt.result?.verified === true;
                const summary = evt.result?.sanitizedReply || evt.result?.verificationReportMarkdown || (verified ? "Workspace verification passed." : "Workspace changes remain unverified. Inspect the test and browser results.");
                const filesModified = evt.result?.filesCreatedOrModified || [];
                setAgentRuns((prev) =>
                  prev.map((r) =>
                    r.id === runId
                      ? { ...r, status: verified ? "done" : "error", summary, filesModified }
                      : r,
                  ),
                );
                setPreviewKey((k) => k + 1);
                void refreshServerWorkspace(chatId);
              } else if (evt.type === "error") {
                setAgentRuns((prev) =>
                  prev.map((r) =>
                    r.id === runId
                      ? { ...r, status: "error", summary: evt.error || "Agent task encountered an error." }
                      : r,
                  ),
                );
              }
            } catch {
              /* ignore malformed event */
            }
          }
        }
      } catch (err) {
        if (!ctl.signal.aborted) {
          setAgentRuns((prev) =>
            prev.map((r) =>
              r.id === runId
                ? { ...r, status: "error", summary: err instanceof Error ? err.message : String(err) }
                : r,
            ),
          );
        }
      } finally {
        if (agentAbortRef.current === ctl) {
          agentAbortRef.current = null;
        }
        setAgentBusy(false);
      }
    },
    [activeTab, onTabChange, agentBusy, chatId, entry, project.files, refreshServerWorkspace],
  );

  const runAutonomousVerifyAndRepair = async () => {
    await runWorkspaceAgentTask(
      "Run automated tests, inspect the live app in Chromium, and repair any build, test, or runtime errors.",
      { applyLiveInstruction: false, inspectBrowser: Boolean(entry) },
    );
  };

  // Auto-start building the project if the user opened a new workspace that has a primaryGoal from chat but 0 files yet
  const autoBuiltChatRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !ledger || agentBusy) return;
    const srvCount = Object.keys(ledger.files || {}).length;
    if (srvCount === 0 && ledger.primaryGoal && autoBuiltChatRef.current !== chatId) {
      autoBuiltChatRef.current = chatId;
      void runWorkspaceAgentTask(ledger.primaryGoal, { applyLiveInstruction: true, inspectBrowser: true });
    }
  }, [chatId, ledger, agentBusy, runWorkspaceAgentTask]);

  const runBrowserInspection = async () => {
    if (!chatId || inspectBusy) return;
    setInspectBusy(true);
    try {
      for (const pf of project.files) {
        if (!pf.edited) continue;
        await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write_file", path: pf.path, content: pf.code }),
        }).catch(() => {});
      }
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect_browser" }),
      });
      if (res.ok) {
        const j = (await res.json()) as { ledger?: ServerLedger };
        if (j.ledger) setLedger(j.ledger);
      }
    } finally {
      setInspectBusy(false);
    }
  };

  const checkNetworkEgress = async () => {
    if (!chatId || termBusy) return;
    setTermBusy(true);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe_network" }),
      });
      if (res.ok) {
        const j = (await res.json()) as {
          diagnostics?: {
            online: boolean;
            publicEgressIp: string | null;
            staticEgressConfigured: boolean;
            staticEgressIp: string | null;
            latencyMs: number;
          };
        };
        if (j.diagnostics) {
          const d = j.diagnostics;
          setEgressInfo(
            `Network: ${d.online ? "Online" : "Offline"} · Public Egress IP: ${d.publicEgressIp || "n/a"} · Static Egress: ${
              d.staticEgressConfigured ? d.staticEgressIp : "Dynamic (set SENKO_STATIC_EGRESS_IP for static IP)"
            } (${d.latencyMs}ms)`,
          );
        }
      }
    } finally {
      setTermBusy(false);
    }
  };


  const popOutPreview = () => {
    if (!previewDoc) return;
    const blob = new Blob([previewDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const draftInput = (depth: number) =>
    draft && (
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: 8 + depth * 12 }}>
        {draft.kind === "folder" ? <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--sk-faint)]" /> : <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[var(--sk-faint)]" />}
        <input
          ref={draftRef}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setDraft(null);
          }}
          onBlur={commitDraft}
          placeholder={draft.kind === "folder" ? "folder name" : "file.html"}
          aria-label={draft.kind === "folder" ? "New folder name" : draft.kind === "file" ? "New file name" : "New name"}
          className="h-6 min-w-0 flex-1 rounded border border-[var(--sk-accent-line)] bg-[var(--sk-bg)] px-1.5 font-mono text-[11.5px] text-[var(--sk-text)] outline-none"
        />
      </div>
    );

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isOpen = openFolders.has(node.path);
      const isSel = (file?.path ?? selected) === node.path;
      if (draft?.kind === "rename" && draft.target === node.path) return <div key={node.path}>{draftInput(depth)}</div>;
      return (
        <div key={node.path}>
          <div
            className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[12px] ${
              isSel
                ? "bg-[var(--sk-surface-2)] font-medium text-[var(--sk-text)]"
                : "text-[var(--sk-muted)] hover:bg-white/[0.04] hover:text-[var(--sk-text)]"
            }`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => {
              setSelected(node.path);
              if (node.kind === "folder")
                setOpenFolders((s) => {
                  const next = new Set(s);
                  if (next.has(node.path)) next.delete(node.path);
                  else next.add(node.path);
                  return next;
                });
            }}
          >
            {node.kind === "folder" ? (
              <>
                <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--sk-accent-ink)]" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--sk-accent-ink)]" />}
              </>
            ) : (
              <FileCode2 className={`ml-[14px] h-3.5 w-3.5 shrink-0 ${isSel ? "text-[var(--sk-accent-ink)]" : "opacity-70"}`} />
            )}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <span className="hidden items-center group-hover:flex">
              <button
                type="button"
                className="sk-btn h-5 w-5 text-[var(--sk-faint)] hover:text-[var(--sk-text)]"
                aria-label={`Rename ${node.name}`}
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft({ kind: "rename", target: node.path, value: node.name });
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="sk-btn h-5 w-5 text-[var(--sk-faint)] hover:text-[var(--sk-danger,#e5484d)]"
                aria-label={`Delete ${node.name}`}
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(node.path);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          </div>
          {node.kind === "folder" && isOpen && (
            <>
              {renderNodes(node.children, depth + 1)}
              {draft && draft.kind !== "rename" && draft.target === node.path && draftInput(depth + 1)}
            </>
          )}
        </div>
      );
    });

  const startDraft = (kind: "file" | "folder") => {
    setTreeOpenManual(true);
    const target = folderOf(selected);
    if (target) setOpenFolders((s) => new Set(s).add(target));
    setDraft({ kind, target, value: "" });
  };

  const hasFiles = project.files.length > 0 || project.folders.length > 0;
  const latestInspection = ledger?.browserInspections?.[ledger.browserInspections.length - 1] || null;
  const assignedIssues = useMemo(() => {
    const list: ServerDiagnosticIssue[] = [...(ledger?.issues || [])];
    if (bundleErrors.length > 0 && !list.some((i) => i.source === "bundle" && i.status !== "fixed")) {
      list.unshift({
        id: "client_bundle_err",
        source: "bundle",
        severity: "critical",
        title: `Frontend Bundle Error (${entry?.path || "App.tsx"})`,
        detail: bundleErrors[0],
        file: entry?.path,
        status: agentBusy ? "debugging" : "assigned",
        assignedAt: Date.now(),
      });
    }
    return list;
  }, [ledger?.issues, bundleErrors, entry?.path, agentBusy]);

  const openIssuesCount = assignedIssues.filter((i) => i.status !== "fixed").length;
  const fitScale = useMemo(() => {
    if (narrowWorkspace || viewport !== "fit" || previewPaneWidth <= 0 || previewPaneWidth >= 960) return 1;
    return Math.max(0.45, Math.min(1, (previewPaneWidth - 4) / 960));
  }, [viewport, previewPaneWidth, narrowWorkspace]);

  const renderPreviewPane = () =>
    entry ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)]/60 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                agentBusy || inspectBusy
                  ? "animate-ping bg-[var(--sk-accent)]"
                  : openIssuesCount > 0
                    ? "bg-[var(--sk-warn)]"
                    : "bg-[var(--sk-ok)]"
              }`}
              aria-hidden
            />
            <span className="min-w-0 truncate font-mono text-[11.5px] text-[var(--sk-muted)]">{entry.path}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {chatId && (
              <button
                type="button"
                onClick={() =>
                  void runWorkspaceAgentTask(
                    "Inspect the actual rendered website in Chromium. Reproduce and repair defects, then retest the original requested behavior. Report any blocked acceptance checks; do not mark attempted repairs fixed.",
                    { applyLiveInstruction: true, inspectBrowser: true },
                  )
                }
                disabled={agentBusy || inspectBusy}
                className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 text-[11px] hover:border-[var(--sk-line-strong)]"
                title="Inspect website and attempt repairs"
              >
                <span>{agentBusy || inspectBusy ? "Working" : "Inspect and repair"}</span>
              </button>
            )}
            {latestInspection?.screenshotBase64 && (
              <button
                type="button"
                onClick={() => setShowAiVision((v) => !v)}
                className={`sk-btn h-6.5 rounded-md border px-2 text-[10.5px] font-medium ${
                  showAiVision
                    ? "border-[var(--sk-line-strong)] bg-[var(--sk-surface-2)] text-[var(--sk-text)]"
                    : "border-[var(--sk-line)] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                }`}
                title="Toggle AI Chromium Vision Frame vs Interactive Live Website"
              >
                <span className="hidden md:inline">{showAiVision ? "Live app" : "Screenshot"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewport("fit")}
              className={`sk-btn h-6.5 rounded-md px-1.5 text-[10.5px] font-mono ${
                viewport === "fit"
                  ? "bg-[var(--sk-surface-2)] text-[var(--sk-text)] font-semibold border border-[var(--sk-line-strong)]"
                  : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
              }`}
              title={narrowWorkspace ? "Responsive preview at 100% scale" : "Fit desktop canvas to preview pane"}
              aria-pressed={viewport === "fit"}
            >
              {narrowWorkspace ? "Responsive" : `Fit${fitScale < 0.99 ? ` ${Math.round(fitScale * 100)}%` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => setViewport("desktop")}
              className={`${iconBtn} ${viewport === "desktop" ? "bg-[var(--sk-surface-2)] text-[var(--sk-text)]" : ""}`}
              title="1:1 Desktop viewport (100%)"
              aria-label="Desktop width"
              aria-pressed={viewport === "desktop"}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewport("mobile")}
              className={`${iconBtn} ${viewport === "mobile" ? "bg-[var(--sk-surface-2)] text-[var(--sk-text)]" : ""}`}
              title="Mobile viewport (390px)"
              aria-label="Mobile width"
              aria-pressed={viewport === "mobile"}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setPreviewKey((k) => k + 1)} className={iconBtn} title="Reload preview" aria-label="Reload preview">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {previewDoc && (
              <button type="button" onClick={popOutPreview} className={iconBtn} title="Open preview in new tab" aria-label="Open preview in new tab">
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        </div>

        {/* Live AI Website Inspector & Assigned Problems HUD */}
        {(latestInspection || assignedIssues.length > 0 || agentBusy || inspectBusy) && (
          <div className="border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)]/90 px-3 py-1.5 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {agentBusy || inspectBusy ? (
                  <Loader2 className="h-3.5 w-3.5 sk-spin text-[var(--sk-accent-ink)]" />
                ) : openIssuesCount === 0 && latestInspection?.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--sk-ok)]" />
                ) : openIssuesCount > 0 ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--sk-warn)]" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--sk-accent-ink)]" />
                )}
                <span className="font-medium text-[var(--sk-text)]">
                  {agentBusy || inspectBusy
                    ? "AI Looking at Website · Assigning & Fixing Problems…"
                    : openIssuesCount > 0
                      ? `${openIssuesCount} Assigned Problem${openIssuesCount === 1 ? "" : "s"} in Queue`
                      : latestInspection?.passed
                        ? "Browser checks passed"
                        : latestInspection ? "Browser checks need attention" : "Awaiting browser inspection"}
                </span>
                {latestInspection && (
                  <span className="text-[var(--sk-muted)]">
                    · {latestInspection.consoleErrors.length} console err · {latestInspection.pageErrors.length} exceptions ·{" "}
                    {latestInspection.interactions.filter((i) => i.ok).length} interactions recorded
                  </span>
                )}
              </div>

              {openIssuesCount > 0 && !agentBusy && (
                <button
                  type="button"
                  onClick={() =>
                    void runWorkspaceAgentTask(
                      `Fix all assigned website problems (${assignedIssues
                        .filter((i) => i.status !== "fixed")
                        .map((i) => `${i.title}: ${i.detail}`)
                        .join("; ")}) and retest the original requested behavior. Report unresolved or blocked checks.`,
                      { applyLiveInstruction: true, inspectBrowser: true },
                    )
                  }
                  className="sk-btn h-5.5 shrink-0 rounded border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2 text-[10.5px] font-medium text-[var(--sk-accent-ink)]"
                >
                  <span>Auto-Fix All ({openIssuesCount})</span>
                </button>
              )}
            </div>

            {assignedIssues.length > 0 && (
              <div className="mt-1.5 flex max-h-24 flex-col gap-1 overflow-y-auto pr-1">
                {assignedIssues.slice(-4).map((iss) => (
                  <div
                    key={iss.id}
                    className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-black/30 px-2 py-1 font-mono text-[10.5px]"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.2 text-[9.5px] font-semibold uppercase ${
                          iss.status === "fixed"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : iss.status === "editing"
                              ? "bg-sky-500/20 text-sky-300 animate-pulse"
                              : iss.status === "debugging"
                                ? "bg-purple-500/20 text-purple-300 animate-pulse"
                                : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {iss.status}
                      </span>
                      <span className="shrink-0 font-semibold text-zinc-200">{iss.title}:</span>
                      <span className="truncate text-zinc-400">{iss.detail}</span>
                    </div>
                    {iss.file && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(iss.file!);
                          onTabChange("code");
                        }}
                        className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.2 text-[10px] text-[var(--sk-accent-ink)] hover:underline"
                      >
                        {iss.file}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {latestInspection && latestInspection.interactions.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {latestInspection.interactions.map((inter, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.2 font-mono text-[10px] ${
                      inter.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {inter.ok ? "✓" : "✗"} {inter.detail}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          ref={previewContainerRef}
          className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden bg-[var(--sk-bg)]"
        >
          {/\.md$/i.test(entry.path) ? (
            <div className="sk-scroll h-full w-full overflow-y-auto p-5 select-text">
              <EnhancedMarkdown text={entry.code} />
            </div>
          ) : showAiVision && latestInspection?.screenshotBase64 ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[#0c0a09] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-[var(--sk-accent-ink)]">
                <Eye className="h-3.5 w-3.5" />
                <span>AI Chromium Vision Capture ({latestInspection.url})</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${latestInspection.screenshotBase64}`}
                alt="AI Chromium Inspection Capture"
                className="max-h-[calc(100%-28px)] max-w-full rounded-lg border border-[var(--sk-accent-line)] object-contain shadow-2xl"
              />
            </div>
          ) : (
            <div
              className={`h-full transition-all ${
                viewport === "mobile"
                  ? "my-3 max-h-[calc(100%-24px)] w-[390px] max-w-full overflow-hidden rounded-2xl border border-[var(--sk-line-strong)] bg-[#0c0a09] shadow-2xl"
                  : "w-full overflow-hidden bg-[#0c0a09]"
              }`}
            >
              <div
                style={
                  viewport === "fit" && fitScale < 0.99
                    ? {
                        width: `${(100 / fitScale).toFixed(2)}%`,
                        height: `${(100 / fitScale).toFixed(2)}%`,
                        transform: `scale(${fitScale.toFixed(4)})`,
                        transformOrigin: "top left",
                      }
                    : { width: "100%", height: "100%" }
                }
              >
                <iframe
                  key={`${entry.path}-${previewKey}`}
                  title={`Preview of ${entry.path}`}
                  sandbox="allow-scripts allow-forms allow-modals"
                  srcDoc={previewDoc}
                  className="h-full w-full border-0 bg-white"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-[var(--sk-faint)]">
        Add a TypeScript/React (.tsx), HTML, or SVG file to preview it live side-by-side here.
      </div>
    );

  return (
    <aside aria-label="Workspace" className="relative flex h-full w-full flex-col bg-[var(--sk-panel)] text-[var(--sk-text)] select-none">
      {quickOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/55 px-3 pt-12" onMouseDown={(event) => { if (event.target === event.currentTarget) closeQuickOpen(); }}>
          <div role="dialog" aria-modal="true" aria-label="Open project file" className="w-full max-w-lg overflow-hidden rounded-lg border border-[var(--sk-line-strong)] bg-[var(--sk-surface-1)] shadow-2xl" onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); closeQuickOpen(); }
            else if (event.key === "ArrowDown") { event.preventDefault(); setQuickOpenIndex((index) => Math.max(0, Math.min(index + 1, matchingPaths.length - 1))); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setQuickOpenIndex((index) => Math.max(0, index - 1)); }
            else if (event.key === "Enter" && matchingPaths[quickOpenIndex]) { event.preventDefault(); chooseQuickOpen(matchingPaths[quickOpenIndex]); }
            else if (event.key === "Tab") { event.preventDefault(); quickOpenInput.current?.focus(); }
          }}>
            <div className="flex items-center gap-2 border-b border-[var(--sk-line)] px-3">
              <Search className="h-4 w-4 shrink-0 text-[var(--sk-muted)]" />
              <input ref={quickOpenInput} aria-label="Search project files" role="combobox" aria-expanded="true" aria-controls="workspace-file-results" aria-activedescendant={matchingPaths[quickOpenIndex] ? `workspace-file-result-${quickOpenIndex}` : undefined} value={fileQuery} onChange={(event) => { setFileQuery(event.target.value); setQuickOpenIndex(0); }} placeholder="Open file by name or path..." className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--sk-text)] outline-none" />
              <kbd className="text-[10px] text-[var(--sk-muted)]">Esc</kbd>
            </div>
            <div id="workspace-file-results" role="listbox" aria-label="Matching project files" className="sk-scroll max-h-72 overflow-auto p-1">
              {matchingPaths.length ? matchingPaths.map((path, index) => (
                <button id={`workspace-file-result-${index}`} key={path} type="button" role="option" aria-selected={index === quickOpenIndex} tabIndex={-1} onMouseEnter={() => setQuickOpenIndex(index)} onClick={() => chooseQuickOpen(path)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left font-mono text-xs ${index === quickOpenIndex ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]" : "text-[var(--sk-muted)]"}`}>
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{path}</span>
                </button>
              )) : <p className="p-4 text-xs text-[var(--sk-muted)]">No matching files.</p>}
            </div>
            <div className="border-t border-[var(--sk-line)] px-3 py-2 text-[10px] text-[var(--sk-muted)]">Up/Down navigate | Enter open | Ctrl/Cmd+P quick open</div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--sk-line)] px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg bg-[var(--sk-surface-1)] p-0.5 border border-[var(--sk-line)] scrollbar-none" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "code"}
            onClick={() => onTabChange("code")}
            className={tabBtn(activeTab === "code")}
          >
            <span>Files</span>
            {project.files.length > 0 && (
              <span className="sk-tabular text-[10.5px] text-[var(--sk-muted)]">
                {project.files.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preview"}
            onClick={() => {
              setSplitPreview(false);
              onTabChange("preview");
            }}
            className={tabBtn(activeTab === "preview")}
          >
            <span>Preview</span>
            {entry && <span className="h-1.5 w-1.5 rounded-full bg-[var(--sk-ok)]" aria-hidden />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "agent"}
            onClick={() => onTabChange("agent")}
            className={tabBtn(activeTab === "agent")}
          >
            <span>Agent</span>
            {agentBusy ? (
              <span className="text-[10.5px] text-[var(--sk-muted)]">running</span>
            ) : agentRuns.length > 0 ? (
              <span className="sk-tabular text-[10.5px] text-[var(--sk-muted)]">
                {agentRuns.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "terminal"}
            onClick={() => onTabChange("terminal")}
            className={tabBtn(activeTab === "terminal")}
          >
            <span>Terminal</span>
            {ledger && ledger.commands.length > 0 && (
              <span
                className={`sk-tabular text-[10.5px] ${
                  ledger.testStatus === "passed"
                    ? "text-[var(--sk-ok)]"
                    : ledger.testStatus === "failed"
                      ? "text-[var(--sk-danger)]"
                      : "text-[var(--sk-muted)]"
                }`}
              >
                {ledger.testStatus === "passed" ? "pass" : ledger.testStatus === "failed" ? "fail" : ledger.commands.length}
              </span>
            )}
          </button>
          {(sources.length > 0 || scrapedImages.length > 0) && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sources"}
              onClick={() => onTabChange("sources")}
              className={tabBtn(activeTab === "sources")}
            >
              <span>Sources</span>
              <span className="sk-tabular text-[10.5px] text-[var(--sk-muted)]">
                {sources.length + scrapedImages.length}
              </span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button ref={quickOpenTrigger} type="button" onClick={() => { setQuickOpen(true); setFileQuery(""); setQuickOpenIndex(0); }} className={`${iconBtn} h-7 w-7`} aria-label="Open project file" title="Open file (Ctrl/Cmd+P)"><Search className="h-3.5 w-3.5" /></button>
          {activeTab !== "preview" && activeTab !== "sources" && (
            <button
              type="button"
              onClick={() => setSplitPreview((v) => !v)}
              className={`sk-btn h-7 px-2 text-[11px] inline-flex ${
                splitPreview
                  ? "border border-[var(--sk-line-strong)] bg-[var(--sk-surface-2)] text-[var(--sk-text)]"
                  : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
              }`}
              title={splitPreview ? "Hide side-by-side live website" : "Show side-by-side live website"}
              aria-pressed={splitPreview}
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Side-by-Side</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleExpand}
            className={`${iconBtn} hidden h-7 w-7 md:inline-flex`}
            title={expanded ? "Restore split view" : "Expand workspace"}
            aria-label={expanded ? "Restore split view" : "Expand workspace"}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={onClose} className={`${iconBtn} h-7 w-7`} title="Close (Alt+W)" aria-label="Close workspace">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={panesRef} className={`relative flex min-h-0 flex-1 overflow-hidden ${narrowWorkspace ? "flex-col" : "flex-row"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {activeTab === "code" && (
          <div className="flex min-h-0 flex-1">
            {showFileTree && (
              <nav aria-label="Project files" className="sk-scroll flex w-40 shrink-0 flex-col overflow-y-auto border-r border-[var(--sk-line)] bg-[var(--sk-bg-2)]/50 p-1.5">
                <div className="mb-1 flex items-center justify-between px-1.5">
                  <span className="text-[10.5px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">Project</span>
                  <span className="flex items-center">
                    <button type="button" className={iconBtn} title="New file" aria-label="New file" onClick={() => startDraft("file")}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={iconBtn} title="New folder" aria-label="New folder" onClick={() => startDraft("folder")}>
                      <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                {renderNodes(tree, 0)}
                {draft && draft.kind !== "rename" && !draft.target && draftInput(0)}
                {!hasFiles && !draft && (
                  <p className="px-2 py-3 text-[11.5px] leading-relaxed text-[var(--sk-faint)]">
                    Empty. Ask Senko to build something, or add a file.
                  </p>
                )}
              </nav>
            )}

            {file ? (
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)]/60 px-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setTreeOpenManual((v) => !(v !== null ? v : showFileTree))}
                      className={`${iconBtn} shrink-0 ${showFileTree ? "text-[var(--sk-text)]" : ""}`}
                      title={showFileTree ? "Hide file tree" : "Show project files"}
                      aria-label={showFileTree ? "Hide file tree" : "Show project files"}
                    >
                      <PanelLeft className="h-3.5 w-3.5" />
                    </button>

                    {project.files.map((pf) => {
                      const active = pf.path === file.path;
                      const label = pf.path.split("/").pop() || pf.path;
                      return (
                        <button
                          key={pf.path}
                          ref={active ? activeFileTab : undefined}
                          type="button"
                          onClick={() => setSelected(pf.path)}
                          title={pf.path}
                          className={`inline-flex h-6.5 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[11.5px] transition ${
                            active
                              ? "border-[var(--sk-line-strong)] bg-[var(--sk-surface-2)] text-[var(--sk-text)] font-medium"
                              : "border-transparent text-[var(--sk-muted)] hover:bg-white/[0.04] hover:text-[var(--sk-text)]"
                          }`}
                        >
                          <FileCode2 className="h-3 w-3 shrink-0 text-[var(--sk-accent-ink)]" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}

                    {!showFileTree && (
                      <button
                        type="button"
                        onClick={() => startDraft("file")}
                        className={`${iconBtn} shrink-0`}
                        title="New file"
                        aria-label="New file"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <div className="relative" onKeyDown={(event) => { if (event.key === "Escape") setHistoryOpen(false); }}>
                      <button type="button" className={iconBtn} aria-label="Workspace checkpoints" aria-expanded={historyOpen} title="Workspace checkpoints" onClick={() => setHistoryOpen((open) => !open)}><History className="h-3.5 w-3.5" /></button>
                      {historyOpen && <div className="absolute right-0 top-8 z-40 w-72 rounded-lg border border-[var(--sk-line-strong)] bg-[var(--sk-surface-1)] p-2 shadow-xl">
                        <p className="px-2 py-1 text-[11px] font-medium text-[var(--sk-text)]">Source checkpoints</p>
                        <p className="px-2 pb-2 text-[10px] leading-relaxed text-[var(--sk-muted)]">Restore source files. Current files are saved as an undo checkpoint. Dependencies and databases are unchanged.</p>
                        <button type="button" disabled={checkpointBusy || agentBusy || !chatId} onClick={() => void runCheckpointAction()} className="sk-btn mb-1 h-7 w-full justify-center border border-[var(--sk-line)] text-[11px]">{checkpointBusy ? "Saving..." : "Create checkpoint"}</button>
                        <div className="sk-scroll max-h-52 overflow-auto">
                          {checkpoints.length ? [...checkpoints].sort((a, b) => b.createdAt - a.createdAt).map((checkpoint) => <button key={checkpoint.id} type="button" disabled={checkpointBusy || agentBusy} onClick={() => void runCheckpointAction(checkpoint.id)} className="flex w-full flex-col gap-0.5 rounded px-2 py-2 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-[var(--sk-accent-ink)]" title={`Restore ${checkpoint.label}`}><span className="w-full truncate text-[11px] text-[var(--sk-text)]">Restore: {checkpoint.label}</span><span className="text-[10px] text-[var(--sk-muted)]">{new Date(checkpoint.createdAt).toLocaleString()}</span></button>) : <p className="px-2 py-2 text-[11px] text-[var(--sk-muted)]">No saved checkpoints yet.</p>}
                        </div>
                        {checkpointError && <p role="alert" className="px-2 py-2 text-[11px] text-rose-400">{checkpointError}</p>}
                      </div>}
                    </div>
                    {currentFileDiff && (currentFileDiff.addedLines > 0 || currentFileDiff.removedLines > 0) && (
                      <button
                        type="button"
                        onClick={() => setShowDiff((v) => !v)}
                        className={`sk-btn h-6.5 rounded-md border px-2 font-mono text-[10.5px] ${
                          showDiff
                            ? "border-[var(--sk-line-strong)] bg-[var(--sk-surface-2)] text-[var(--sk-text)]"
                            : "border-[var(--sk-line)] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                        }`}
                        title="Toggle file diff view"
                      >
                        <span className="text-emerald-400">+{currentFileDiff.addedLines}</span>
                        <span className="text-rose-400">-{currentFileDiff.removedLines}</span>
                      </button>
                    )}
                    <span className="sk-tabular hidden px-1.5 text-[10.5px] text-[var(--sk-faint)] sm:inline">
                      {codeLines.length} lines
                    </span>
                    <button
                      type="button"
                      className={iconBtn}
                      title={copied ? "Copied" : "Copy file"}
                      aria-label="Copy file"
                      onClick={() => {
                        navigator.clipboard.writeText(file.code).catch(() => {});
                        setCopied(true);
                      }}
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-[var(--sk-ok)]" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      title="Download file"
                      aria-label="Download file"
                      onClick={() => downloadTextFile(file.path.split("/").pop() || file.path, file.code)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {file.binary ? <div role="status" className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--sk-muted)]">Binary asset: {file.path}. Reference this file from your page and inspect it in Preview. Text editing is unavailable for this asset.</div> : showDiff && currentFileDiff ? (
                  <div className="sk-scroll flex-1 overflow-auto bg-[var(--sk-code-bg)] p-3 font-mono text-[12px] leading-[1.6] select-text">
                    {currentFileDiff.unifiedDiff.split("\n").map((dLine, idx) => {
                      const cls = dLine.startsWith("+") && !dLine.startsWith("+++")
                        ? "bg-emerald-500/10 text-emerald-300"
                        : dLine.startsWith("-") && !dLine.startsWith("---")
                          ? "bg-rose-500/10 text-rose-300"
                          : "text-zinc-400";
                      return (
                        <div key={idx} className={`whitespace-pre px-2 ${cls}`}>
                          {dLine}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--sk-code-bg)]">
                    <WorkspaceCodeEditor
                      path={file.path}
                      code={file.code}
                      session={editorSession.current}
                      wrapLines={wrapLines}
                      onChange={editFile}
                      onSave={(code) => void syncFileToServer(file.path, code)}
                      onStatus={setEditorStatus}
                    />
                    <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-[var(--sk-line)] px-3 font-mono text-[10px] text-[var(--sk-muted)]" aria-label="Editor status">
                      <span className="min-w-0 truncate" title={file.path}>{file.path}{file.edited ? " - unsaved" : ""}</span>
                      <span className="flex min-w-0 shrink-0 items-center gap-3">
                        <button type="button" aria-label="Soft wrap" aria-pressed={wrapLines} title="Soft wrap (Alt+Z)" onClick={() => setWrapLines((wrap) => !wrap)} className={`flex h-5 items-center gap-1 rounded px-1 hover:bg-white/5 focus-visible:outline focus-visible:outline-[var(--sk-accent-ink)] ${wrapLines ? "text-[var(--sk-accent-ink)]" : ""}`}><WrapText className="h-3 w-3" /><span className="hidden sm:inline">Wrap</span></button>
                        <span title="Syntax parser diagnostics only; run typecheck for project types" className={editorStatus.diagnostics ? "text-rose-400" : ""}>{editorStatus.diagnostics} syntax issues</span>
                        <span>Ln {editorStatus.line}, Col {editorStatus.column}</span>
                        <span className="hidden uppercase sm:inline">{languageOf(file.path)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center text-xs text-[var(--sk-faint)]">
                {hasFiles ? "Pick a file to edit." : "Code Senko writes lands here as files."}
              </div>
            )}
          </div>
        )}

        {activeTab === "preview" && renderPreviewPane()}

        {activeTab === "agent" && (
          <div className="flex min-h-0 flex-1 flex-col bg-[var(--sk-code-bg)] select-text">
            {/* Workspace Agent Header & Quick Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)] px-3 py-2 text-[11.5px]">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-[var(--sk-accent-ink)]" />
                <div>
                  <span className="font-medium text-[var(--sk-text)]">Workspace Coding Agent</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={agentBusy || !chatId}
                  onClick={() =>
                    void runWorkspaceAgentTask(
                      "Inspect the actual rendered website in Chromium. Reproduce and repair defects, then retest the original requested behavior. Report blocked acceptance checks honestly.",
                      { applyLiveInstruction: true, inspectBrowser: true },
                    )
                  }
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2 text-[11px] font-medium text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"
                >
                  <span>Inspect and repair</span>
                </button>
                <button
                  type="button"
                  disabled={agentBusy || !chatId}
                  onClick={() =>
                    void runWorkspaceAgentTask(
                      "Write or update automated unit tests (test.ts / test.js) for the workspace code and run them until they pass.",
                      { applyLiveInstruction: true, inspectBrowser: false },
                    )
                  }
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 text-[11px] hover:border-[var(--sk-accent-line)]"
                >
                  <span>Add and run tests</span>
                </button>
                {agentBusy && (
                  <button
                    type="button"
                    onClick={stopWorkspaceAgent}
                    className="sk-btn h-6.5 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 text-[11px] text-rose-300 hover:bg-rose-500/25"
                  >
                    <span>Stop</span>
                  </button>
                )}
              </div>
            </div>

            {/* Remembered Workspace Main Goal Banner */}
            <div className="border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)]/40 px-3.5 py-2 text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="shrink-0 text-[10.5px] text-[var(--sk-muted)]">
                    Goal
                  </span>
                  {editingGoal ? (
                    <input
                      type="text"
                      value={goalDraft}
                      onChange={(e) => setGoalDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && chatId && goalDraft.trim()) {
                          setEditingGoal(false);
                          void fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "set_primary_goal", primaryGoal: goalDraft.trim() }),
                          }).then((r) => r.json()).then((j) => {
                            if (j?.ledger) setLedger(j.ledger);
                          });
                        } else if (e.key === "Escape") {
                          setEditingGoal(false);
                        }
                      }}
                      placeholder="Project goal"
                      className="h-6 min-w-0 flex-1 rounded border border-[var(--sk-accent-line)] bg-[var(--sk-bg)] px-2 text-[11.5px] text-[var(--sk-text)] outline-none"
                    />
                  ) : (
                    <span className="truncate text-[var(--sk-text)]" title={ledger?.primaryGoal || ""}>
                      {ledger?.primaryGoal || "No goal set"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (editingGoal && chatId && goalDraft.trim()) {
                      setEditingGoal(false);
                      void fetch(`/api/chats/${encodeURIComponent(chatId)}/workspace`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "set_primary_goal", primaryGoal: goalDraft.trim() }),
                      }).then((r) => r.json()).then((j) => {
                        if (j?.ledger) setLedger(j.ledger);
                      });
                    } else {
                      setGoalDraft(ledger?.primaryGoal || "");
                      setEditingGoal((v) => !v);
                    }
                  }}
                  className="shrink-0 rounded border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 py-0.5 text-[10.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                >
                  {editingGoal ? "Save" : "Edit"}
                </button>
              </div>
            </div>

            {/* Assigned Website Problems & Live Debug Queue */}
            {assignedIssues.length > 0 && (
              <div className="border-b border-[var(--sk-line)] bg-black/25 px-3.5 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-amber-300">
                    Problems ({assignedIssues.filter((i) => i.status !== "fixed").length} open ·{" "}
                    {assignedIssues.filter((i) => i.status === "fixed").length} fixed)
                  </span>
                </div>
                <div className="space-y-1">
                  {assignedIssues.map((iss) => (
                    <div
                      key={iss.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11px]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${
                            iss.status === "fixed"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : iss.status === "editing"
                                ? "bg-sky-500/20 text-sky-300 animate-pulse"
                                : iss.status === "debugging"
                                  ? "bg-purple-500/20 text-purple-300 animate-pulse"
                                  : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {iss.status}
                        </span>
                        <span className="shrink-0 font-semibold text-zinc-200">[{iss.source.toUpperCase()}] {iss.title}:</span>
                        <span className="truncate text-zinc-400">{iss.detail}</span>
                      </div>
                      {iss.file && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(iss.file!);
                            onTabChange("code");
                          }}
                          className="shrink-0 rounded border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--sk-accent-ink)]"
                        >
                          {iss.file}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Activity & Conversation Feed */}
            <div className="sk-scroll flex-1 space-y-3 overflow-y-auto p-3.5 text-[12px]">
              <WorkspaceExecutionEvidence task={ledger?.codingTask} media={latestInspection?.mediaPlayback} primaryGoal={ledger?.primaryGoal} />
              <details className="group border-b border-[var(--sk-line)] pb-3">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-[var(--sk-text)]">Activity log{activity.length > 0 ? ` (${activity.length})` : ""}</summary>
                <div className="mt-2"><WorkspaceActivityLog entries={activity} /></div>
              </details>
              {agentRuns.length > 0 ? (
                agentRuns.map((run) => (
                  <div key={run.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-zinc-100">{run.prompt}</div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                          run.status === "running"
                            ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                            : run.status === "done"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : run.status === "stopped"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>

                    {run.steps.length > 0 && (
                      <div className="space-y-2 rounded-lg border border-white/[0.05] bg-black/30 p-2.5 font-mono text-[11px]">
                        {run.steps.map((s) => (
                          <div key={s.id} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 truncate">
                                {s.status === "running" ? (
                                  <Loader2 className="h-3 w-3 shrink-0 sk-spin text-[var(--sk-accent-ink)]" />
                                ) : s.status === "done" ? (
                                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
                                )}
                                <span className="truncate text-zinc-200">{s.label}</span>
                              </span>
                              {s.detail && <span className="shrink-0 text-[10.5px] text-zinc-500">{s.detail}</span>}
                            </div>

                            {s.fileOps && s.fileOps.length > 0 && (
                              <div className="ml-4 space-y-1 border-l border-white/[0.07] pl-3 py-0.5">
                                {s.fileOps.map((op, opIdx) => {
                                  const baseName = op.path.split("/").pop() || op.path;
                                  const badgeColor =
                                    op.langBadge === "TSX" || op.langBadge === "JSX"
                                      ? "text-sky-400"
                                      : op.langBadge === "TS"
                                        ? "text-blue-400"
                                        : op.langBadge === "{}"
                                          ? "text-amber-400"
                                          : "text-emerald-400";
                                  return (
                                    <div key={`${op.path}_${opIdx}`} className="flex items-center gap-2 text-[11px]">
                                      <span className="w-16 shrink-0 text-zinc-500">{op.action}</span>
                                      <span className={`shrink-0 text-[10px] font-bold ${badgeColor}`}>{op.langBadge}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelected(op.path);
                                          onTabChange("code");
                                        }}
                                        title={op.path}
                                        className="truncate text-zinc-200 hover:text-[var(--sk-accent-ink)] hover:underline"
                                      >
                                        {baseName}
                                      </button>
                                      {op.linesRange && (
                                        <span className="shrink-0 text-zinc-500">{op.linesRange}</span>
                                      )}
                                      {typeof op.added === "number" && (
                                        <span className="shrink-0 text-emerald-400">+{op.added}</span>
                                      )}
                                      {typeof op.removed === "number" && (
                                        <span className="shrink-0 text-rose-400">-{op.removed}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {run.filesModified.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[10.5px] text-zinc-400">Live updated files:</span>
                        {run.filesModified.map((fp) => (
                          <button
                            key={fp}
                            type="button"
                            onClick={() => {
                              setSelected(fp);
                              onTabChange("code");
                            }}
                            className="rounded border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--sk-accent-ink)] hover:border-[var(--sk-accent-line)]"
                          >
                            {fp}
                          </button>
                        ))}
                      </div>
                    )}

                    {run.summary && (
                      <div className="prose-invert text-[11.5px] leading-relaxed text-zinc-300">
                        <EnhancedMarkdown text={run.summary} />
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-[11.5px] text-[var(--sk-muted)]">No agent runs yet.</p>
              )}
            </div>

            {/* Workspace Agent Live Prompt Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!agentPrompt.trim() || agentBusy || !chatId) return;
                const task = agentPrompt.trim();
                setAgentPrompt("");
                void runWorkspaceAgentTask(task, { applyLiveInstruction: true, inspectBrowser: Boolean(entry) });
              }}
              className="flex h-10 shrink-0 items-center gap-2 border-t border-[var(--sk-line)] bg-[var(--sk-surface-1)] px-3"
            >
              <input
                type="text"
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                disabled={agentBusy || !chatId}
                placeholder={
                  file
                    ? `Change ${file.path} or describe a task`
                    : "Describe a task"
                }
                aria-label="Workspace agent instruction"
                className="flex-1 bg-transparent text-[12px] text-[var(--sk-text)] placeholder:text-[var(--sk-faint)] outline-none"
              />
              {agentBusy ? (
                <button
                  type="button"
                  onClick={stopWorkspaceAgent}
                  className="sk-btn h-6.5 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 text-[11px] text-rose-300"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!agentPrompt.trim() || !chatId}
                  className="sk-btn sk-primary h-6.5 rounded-md px-2.5 text-[11px]"
                >
                  <span>Run</span>
                </button>
              )}
            </form>
          </div>
        )}

        {activeTab === "terminal" && (
          <div className="flex min-h-0 flex-1 flex-col bg-[var(--sk-code-bg)] select-text">
            {/* Verification Status Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-surface-1)] px-3 py-2 text-[11.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--sk-muted)]">
                  Written: {ledger?.codeWritten || project.files.length > 0 ? "yes" : "no"} · Executed: {ledger?.codeExecuted ? "yes" : "no"} · Tests: <span className={ledger?.testStatus === "passed" ? "text-[var(--sk-ok)]" : ledger?.testStatus === "failed" ? "text-[var(--sk-danger)]" : ""}>{(ledger?.testStatus || "not_run").replace("_", " ")}</span>
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={termBusy || !chatId}
                  onClick={() => void runServerCommand("npm test")}
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 text-[11px] hover:border-[var(--sk-accent-line)]"
                >
                  <Play className="h-3 w-3 text-[var(--sk-accent-ink)]" />
                  <span>Run tests</span>
                </button>
                <button
                  type="button"
                  disabled={termBusy || !chatId}
                  onClick={() => void runAutonomousVerifyAndRepair()}
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2 text-[11px] text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"
                >
                  {termBusy ? <Loader2 className="h-3 w-3 sk-spin" /> : <Sparkles className="h-3 w-3" />}
                  <span>Auto-Verify & Repair</span>
                </button>
                <button
                  type="button"
                  disabled={inspectBusy || agentBusy || !chatId}
                  onClick={() => void runBrowserInspection()}
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] px-2 text-[11px]"
                >
                  {inspectBusy ? <Loader2 className="h-3 w-3 sk-spin" /> : <Eye className="h-3 w-3" />}
                  <span>Inspect in Chromium</span>
                </button>
                <button
                  type="button"
                  disabled={termBusy || !chatId}
                  onClick={() => void checkNetworkEgress()}
                  className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] px-2 text-[11px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                >
                  <Globe className="h-3 w-3" />
                  <span>Egress IP</span>
                </button>
              </div>
            </div>

            {egressInfo && (
              <div className="border-b border-[var(--sk-line)] bg-white/[0.02] px-3 py-1.5 font-mono text-[11px] text-[var(--sk-muted)]">
                {egressInfo}
              </div>
            )}

            {/* Terminal Output Stream */}
            <div className="sk-scroll flex-1 space-y-3 overflow-y-auto p-3.5 font-mono text-[12px]">
              {ledger?.commands && ledger.commands.length > 0 ? (
                ledger.commands.map((cmd) => (
                  <div key={cmd.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] pb-1.5">
                      <span className="font-semibold text-zinc-200">$ {cmd.command}</span>
                      <span className="flex items-center gap-2 text-[10.5px]">
                        <span className="text-zinc-500">{cmd.durationMs}ms</span>
                        <span
                          className={`rounded px-1.5 py-0.2 font-medium ${
                            cmd.exitCode === 0
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          exit {cmd.exitCode ?? "blocked"}
                        </span>
                      </span>
                    </div>
                    {cmd.stdout && (
                      <pre className="mt-2 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-zinc-300">
                        {cmd.stdout}
                      </pre>
                    )}
                    {cmd.stderr && (
                      <pre className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-rose-300">
                        {cmd.stderr}
                      </pre>
                    )}
                  </div>
                ))
              ) : (
                <div className="py-8 text-center font-sans text-xs text-[var(--sk-faint)]">
                  No commands executed in this workspace yet. Run a Node.js command below or click &ldquo;Run Tests&rdquo;.
                </div>
              )}

              {ledger?.repairAttempts && ledger.repairAttempts.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                    Autonomous Debugging & Repair History
                  </div>
                  {ledger.repairAttempts.map((rep) => (
                    <div key={repairKey(rep)} className="text-[11.5px] text-zinc-300">
                      <span className="font-medium text-amber-200">Cycle #{rep.attempt} ({rep.stage}):</span> {rep.probableCause}{" "}
                      {rep.filesModified.length > 0 && <span className="text-zinc-400">[{rep.filesModified.join(", ")}]</span>}{" "}
                      <span className={rep.resolved ? "text-emerald-400" : "text-rose-400"}>
                        ({rep.resolved ? "Resolved" : "Unresolved"})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Interactive Command Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!cmdInput.trim() || termBusy) return;
                const toRun = cmdInput.trim();
                setCmdInput("");
                void runServerCommand(toRun);
              }}
              className="flex h-10 shrink-0 items-center gap-2 border-t border-[var(--sk-line)] bg-[var(--sk-surface-1)] px-3"
            >
              <span className="font-mono text-xs font-bold text-[var(--sk-accent-ink)]">$</span>
              <input
                type="text"
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                disabled={termBusy || !chatId}
                placeholder="Run node, npm, or test command in workspace…"
                aria-label="Workspace terminal command"
                className="flex-1 bg-transparent font-mono text-[12px] text-[var(--sk-text)] placeholder:text-[var(--sk-faint)] outline-none"
              />
              <button
                type="submit"
                disabled={termBusy || !cmdInput.trim() || !chatId}
                className="sk-btn sk-primary h-6.5 rounded-md px-2.5 text-[11px]"
              >
                {termBusy ? <Loader2 className="h-3 w-3 sk-spin" /> : "Run"}
              </button>
            </form>
          </div>
        )}

        {activeTab === "sources" && (
          <div className="sk-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5 select-text">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--sk-faint)]" />
              <input
                type="search"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                placeholder="Filter sources, domains, or visited pages…"
                className="h-8 w-full rounded-lg border border-[var(--sk-line)] bg-[var(--sk-surface-1)] pl-8 pr-3 text-xs text-[var(--sk-text)] placeholder:text-[var(--sk-faint)] outline-none focus:border-[var(--sk-accent-line)]"
              />
            </div>

            {filteredSources.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">
                  <span>Referenced & Visited Sources ({filteredSources.length})</span>
                </div>
                {filteredSources.map((src) => (
                  <div
                    key={src.url}
                    className="sk-surface-card flex flex-col gap-2 p-3 transition-colors hover:border-[var(--sk-line-strong)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-[var(--sk-muted)]">
                          <Globe className="h-3 w-3 shrink-0 text-[var(--sk-accent-ink)]" />
                          <span className="font-medium text-[var(--sk-accent-ink)]">{src.host}</span>
                          <span>·</span>
                          <span className="capitalize">{src.origin.replace("-", " ")}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-medium text-[var(--sk-text)]">{src.title}</p>
                        <p className="truncate text-[11px] text-[var(--sk-faint)]">{src.url}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onAskSenko(`Open ${src.url} and summarize the key facts on the page.`, "agent")}
                          className="sk-btn h-6 border border-[var(--sk-line)] px-2 text-[10.5px] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                          title="Inspect with Agent Browser"
                        >
                          <span>Inspect</span>
                        </button>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="sk-btn h-6 w-6 text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                          title="Open in new browser tab"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    {src.shotId && chatId && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setExpandedShot(expandedShot === src.shotId ? null : src.shotId!)}
                          className="text-[11px] text-[var(--sk-accent-ink)] hover:underline"
                        >
                          {expandedShot === src.shotId ? "Hide step screenshot" : "View agent step screenshot"}
                        </button>
                        {expandedShot === src.shotId && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/sessions/${encodeURIComponent(chatId)}/screenshots/${encodeURIComponent(src.shotId)}`}
                            alt={`Screenshot for ${src.title}`}
                            className="mt-2 max-h-52 w-full rounded-lg border border-[var(--sk-line)] object-cover"
                            loading="lazy"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--sk-line)] bg-[var(--sk-surface-1)] p-6 text-center text-xs text-[var(--sk-muted)]">
                No web sources or citations recorded in this conversation yet.
              </div>
            )}

            {scrapedImages.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--sk-faint)]">
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>Collected Visual Evidence ({scrapedImages.length})</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {scrapedImages.map((id) => (
                    <a
                      key={id}
                      href={`/api/images/${id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-lg border border-[var(--sk-line)] bg-[var(--sk-surface-1)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/images/${id}`}
                        alt="Collected visual asset"
                        className="h-28 w-full object-cover transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {splitPreview && activeTab !== "preview" && activeTab !== "sources" && (
          <>
            <div role="separator" aria-label="Resize editor and preview" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={70} aria-valuenow={previewWidth} tabIndex={0}
              className={`z-10 w-1 shrink-0 cursor-col-resize bg-[var(--sk-line)] hover:bg-[var(--sk-accent-ink)] focus:bg-[var(--sk-accent-ink)] focus:outline-none ${narrowWorkspace ? "hidden" : "block"}`}
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = panesRef.current?.getBoundingClientRect(); if (rect) setPreviewWidth(Math.max(25, Math.min(70, Math.round((rect.right - event.clientX) / rect.width * 100)))); }}
              onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setPreviewWidth((width) => Math.max(25, Math.min(70, width + (event.key === "ArrowLeft" ? 2 : -2)))); } }}
            />
            <div style={{ "--workspace-preview-width": `${previewWidth}%` } as React.CSSProperties} className={`flex min-h-0 shrink-0 flex-col border-[var(--sk-line)] ${narrowWorkspace ? "h-[45%] w-full border-t" : "h-auto w-[var(--workspace-preview-width)]"}`}>
              {renderPreviewPane()}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
