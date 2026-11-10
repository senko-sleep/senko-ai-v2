// Per-chat coding project: files in folders, kept in this browser's storage under the chat id.
// Code blocks from replies become files (or update them); the user can also add, rename and
// delete files and folders. Nothing here touches the server.

import type { CodeArtifact } from "./workspace-artifacts";

export interface WorkspaceFile {
  path: string; // "src/app.js", no leading slash
  code: string;
  binary?: boolean;
  /** Artifact this file was last filled from, so a newer reply updates it but user edits stick. */
  sourceId?: string;
  edited?: boolean;
}

export interface WorkspaceProject {
  files: WorkspaceFile[];
  folders: string[]; // empty folders the user created
}

const KEY = (chatId: string) => `senko.workspace.${chatId}`;
export const emptyProject = (): WorkspaceProject => ({ files: [], folders: [] });

export function loadProject(chatId: string | null): WorkspaceProject {
  if (!chatId) return emptyProject();
  try {
    const raw = localStorage.getItem(KEY(chatId));
    const p = raw ? (JSON.parse(raw) as WorkspaceProject) : null;
    if (p && Array.isArray(p.files)) return { files: p.files, folders: Array.isArray(p.folders) ? p.folders : [] };
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return emptyProject();
}

export function saveProject(chatId: string | null, project: WorkspaceProject) {
  if (!chatId) return;
  try {
    localStorage.setItem(KEY(chatId), JSON.stringify(project));
  } catch {
    /* quota or private mode: the project still works for this visit */
  }
}

const PROJECT_EVENT = "senko:project";

/**
 * The one way to change a chat's project, so the file panel, coding jobs and the Node runner
 * tab all see the same files. Other tabs hear about it through the "storage" event.
 */
export function updateProject(chatId: string, fn: (p: WorkspaceProject) => WorkspaceProject): WorkspaceProject {
  const before = loadProject(chatId);
  const after = fn(before);
  if (after !== before) {
    saveProject(chatId, after);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROJECT_EVENT, { detail: { chatId } }));
  }
  return after;
}

/** Calls back whenever this chat's project changes, in this tab or another one. */
export function onProjectChange(chatId: string, cb: () => void): () => void {
  const local = (e: Event) => (e as CustomEvent<{ chatId: string }>).detail?.chatId === chatId && cb();
  const other = (e: StorageEvent) => e.key === KEY(chatId) && cb();
  window.addEventListener(PROJECT_EVENT, local);
  window.addEventListener("storage", other);
  return () => {
    window.removeEventListener(PROJECT_EVENT, local);
    window.removeEventListener("storage", other);
  };
}

/** Clean a user- or model-supplied path: forward slashes, no "..", no leading slash. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

/** Where an artifact lives in the project: the path from its first-line comment, else its filename. */
export function artifactPath(art: CodeArtifact): string {
  const fromTitle = /^[\w./-]+\.[A-Za-z0-9]+$/.test(art.title) ? art.title : "";
  return normalizePath(fromTitle || art.filename);
}

/**
 * Brings reply code into the project. A later block for the same path replaces the file,
 * unless the user edited it by hand. Returns the same object when nothing changed.
 */
export function mergeArtifacts(project: WorkspaceProject, artifacts: CodeArtifact[]): WorkspaceProject {
  let files = project.files;
  let changed = false;
  for (const art of artifacts) {
    const path = artifactPath(art);
    if (!path || /^snippet-\d+/i.test(path) || /^(tsx|ts|jsx|js|sh|bash|json|txt)$/i.test(path)) continue;
    const i = files.findIndex((f) => f.path === path);
    if (i < 0) {
      files = [...files, { path, code: art.code, sourceId: art.id }];
      changed = true;
    } else if (files[i].sourceId !== art.id && !files[i].edited) {
      files = files.map((f, j) => (j === i ? { ...f, code: art.code, sourceId: art.id } : f));
      changed = true;
    }
  }
  return changed ? { ...project, files } : project;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "folder";
  children: TreeNode[];
}

/** Folders first, then files, both alphabetical. */
export function buildTree(project: WorkspaceProject): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };
  const folder = (path: string): TreeNode => {
    let node = root;
    let acc = "";
    for (const part of path.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${part}` : part;
      let next = node.children.find((c) => c.kind === "folder" && c.name === part);
      if (!next) {
        next = { name: part, path: acc, kind: "folder", children: [] };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const f of project.folders) folder(f);
  for (const file of project.files) {
    const parts = file.path.split("/");
    const name = parts.pop() || file.path;
    folder(parts.join("/")).children.push({ name, path: file.path, kind: "file", children: [] });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

export function renamePath(project: WorkspaceProject, from: string, to: string): WorkspaceProject {
  const dest = normalizePath(to);
  if (!dest || dest === from) return project;
  const move = (p: string) => (p === from ? dest : p.startsWith(`${from}/`) ? dest + p.slice(from.length) : p);
  if (dest.startsWith(`${from}/`)) return project;
  const movedPaths = project.files.map((f) => move(f.path));
  if (new Set(movedPaths).size !== movedPaths.length) return project;
  // A destination cannot be both a file and a parent folder.
  if (movedPaths.some((p) => movedPaths.some((other) => other.startsWith(`${p}/`)))) return project;
  return {
    files: project.files.map((f) => ({ ...f, path: move(f.path) })),
    folders: project.folders.map(move),
  };
}

export function deletePath(project: WorkspaceProject, path: string): WorkspaceProject {
  const keep = (p: string) => p !== path && !p.startsWith(`${path}/`);
  return { files: project.files.filter((f) => keep(f.path)), folders: project.folders.filter(keep) };
}

export function languageOf(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return ext === "htm" ? "html" : ext === "md" ? "markdown" : ext || "text";
}

/** Pick the page to preview: root React/TSX entry first (so selecting a child component in src/components/ still previews the whole app), else index.html, else selected previewable file. */
export function previewEntry(project: WorkspaceProject, selected: string | null): WorkspaceFile | null {
  const html = project.files.filter((f) => /\.html?$/i.test(f.path));
  const tsxOrReact = project.files.filter(
    (f) =>
      /\.(tsx|jsx)$/i.test(f.path) &&
      !/\.(test|spec)\./i.test(f.path),
  );
  const rootReactCandidates = [
    "src/main.tsx",
    "src/index.tsx",
    "src/App.tsx",
    "src/app.tsx",
    "main.tsx",
    "index.tsx",
    "App.tsx",
    "app.tsx",
    "src/main.jsx",
    "src/index.jsx",
    "src/App.jsx",
    "App.jsx",
  ];
  for (const candidate of rootReactCandidates) {
    const found = tsxOrReact.find((f) => f.path.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  const sel = project.files.find((f) => f.path === selected);
  if (sel && /\.(svg|md)$/i.test(sel.path)) return sel;
  if (tsxOrReact.length > 0) return tsxOrReact[0];
  if (sel && /\.html?$/i.test(sel.path)) return sel;
  const dir = selected?.includes("/") ? selected.slice(0, selected.lastIndexOf("/")) : "";
  return (
    html.find((f) => f.path === (dir ? `${dir}/index.html` : "index.html")) ||
    html.find((f) => /(^|\/)index\.html?$/i.test(f.path)) ||
    html[0] ||
    sel ||
    null
  );
}

function resolveFrom(base: string, ref: string): string {
  if (/^(https?:|data:|\/\/)/i.test(ref)) return "";
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const parts = (ref.startsWith("/") ? ref : `${dir}/${ref}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p.split(/[?#]/)[0]);
  }
  return out.join("/");
}

/**
 * Turns a project page into one document the sandboxed preview can run: local stylesheets and
 * scripts it links to are inlined from the project's files.
 */
export function bundlePage(project: WorkspaceProject, entry: WorkspaceFile): string {
  const find = (ref: string) => {
    const p = resolveFrom(entry.path, ref);
    return p ? project.files.find((f) => f.path === p) : undefined;
  };
  return entry.code
    .replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (tag, href) => {
      const f = find(href);
      return f ? `<style data-file="${f.path}">\n${f.code}\n</style>` : tag;
    })
    .replace(/<script\b([^>]*)src=["']([^"']+\.m?js)["']([^>]*)><\/script>/gi, (tag, a, src, b) => {
      const f = find(src);
      const attrs = `${a}${b}`.replace(/\s+/g, " ").trim();
      return f ? `<script${attrs ? ` ${attrs}` : ""} data-file="${f.path}">\n${f.code.replace(/<\/script/gi, "<\\/script")}\n</script>` : tag;
    });
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** Placeholder document for the preview iframe while the esbuild bundle is building or after it failed. */
export function previewStatusDoc(state: "compiling" | "error", detail = ""): string {
  const title = state === "compiling" ? "Compiling with esbuild…" : "Preview build failed";
  const color = state === "compiling" ? "#a1a1aa" : "#fb7185";
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0c0a09;color:#e4e4e7;font:13px ui-monospace,monospace;padding:20px}h1{font-size:14px;color:${color};margin:0 0 12px}pre{white-space:pre-wrap;color:#fda4af}</style></head><body><h1>${title}</h1>${detail ? `<pre>${escHtml(detail)}</pre>` : ""}</body></html>`;
}

/** React key for a repair record. Older saved ledgers have no id, so fall back to data fields. */
export function repairKey(rep: { id?: string; attempt: number; timestamp?: number; stage: string; signature?: string }): string {
  return rep.id || `${rep.timestamp ?? 0}:${rep.stage}:${rep.attempt}:${rep.signature ?? ""}`;
}
