// Real Node.js Execution Environment, Workspace File Manager, Local Server Runner,
// Playwright Visual Website Inspector, and Authenticity Verification Ledger.
//
// Core invariant: Every claimed file write, command execution, test result, or browser
// inspection is backed by a real OS process or Playwright browser observation recorded
// in the chat's VerificationLedger.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { getBrowser } from "./browser";
import { applyExactEdit } from "@/lib/code-job";
import { inspectMediaPlayback, type MediaPlaybackCheck } from "./media-verification";

/** Stop the entire command tree; killing cmd.exe alone leaves its Node server alive. */
async function stopProcessTree(proc: ChildProcess): Promise<void> {
  if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
  } else {
    try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch { /* Already exited. */ } }
  }
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); proc.removeListener("close", done); resolve(); };
    const timer = setTimeout(done, 2000);
    proc.once("close", done);
  });
}

function getEsbuild(): typeof import("esbuild") {
  const req = createRequire(import.meta.url);
  return req("esbuild") as typeof import("esbuild");
}

const OFFLINE_UTILITY_CSS = `
*, ::before, ::after { box-sizing: border-box; }
html.dark, html.dark body { background-color: #020617; color: #f8fafc; }
body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
ul, ol { list-style: none; margin: 0; padding: 0; }
h1, h2, h3, h4, p { margin: 0; }
img { display: block; max-width: 100%; }
button { cursor: pointer; border: none; background: transparent; color: inherit; font: inherit; }
input { font: inherit; color: inherit; }
.min-h-screen { min-height: 100vh; }
.h-full { height: 100%; }
.w-full { width: 100%; }
.w-2\\.5 { width: 0.625rem; } .h-2\\.5 { height: 0.625rem; }
.w-3 { width: 0.75rem; } .h-3 { height: 0.75rem; }
.w-3\\.5 { width: 0.875rem; } .h-3\\.5 { height: 0.875rem; }
.w-4 { width: 1rem; } .h-4 { height: 1rem; }
.w-5 { width: 1.25rem; } .h-5 { height: 1.25rem; }
.w-6 { width: 1.5rem; } .h-6 { height: 1.5rem; }
.w-8 { width: 2rem; } .h-8 { height: 2rem; }
.w-10 { width: 2.5rem; } .h-10 { height: 2.5rem; }
.w-11 { width: 2.75rem; } .h-11 { height: 2.75rem; }
.w-12 { width: 3rem; } .h-12 { height: 3rem; }
.w-13 { width: 3.25rem; } .h-16 { height: 4rem; }
.h-1\\.5 { height: 0.375rem; }
.max-w-md { max-width: 28rem; }
.max-w-lg { max-width: 32rem; }
.max-w-xl { max-width: 36rem; }
.max-w-2xl { max-width: 42rem; }
.max-w-4xl { max-width: 56rem; }
.max-w-5xl { max-width: 64rem; }
.max-w-\\[220px\\] { max-width: 220px; }
.max-h-80 { max-height: 20rem; }
.max-h-\\[380px\\] { max-height: 380px; }
.max-h-\\[300px\\] { max-height: 300px; }
.mx-auto { margin-left: auto; margin-right: auto; }
.mr-3 { margin-right: 0.75rem; }
.mt-0\\.5 { margin-top: 0.125rem; } .mb-1 { margin-bottom: 0.25rem; } .mb-3 { margin-bottom: 0.75rem; }
.mt-2 { margin-top: 0.5rem; } .mt-4 { margin-top: 1rem; } .mb-2 { margin-bottom: 0.5rem; } .mb-4 { margin-bottom: 1rem; }
.pr-1 { padding-right: 0.25rem; } .pb-1 { padding-bottom: 0.25rem; } .pt-1 { padding-top: 0.25rem; }
.pl-9 { padding-left: 2.25rem; } .pr-3 { padding-right: 0.75rem; }
.p-2 { padding: 0.5rem; } .p-2\\.5 { padding: 0.625rem; } .p-3 { padding: 0.75rem; } .p-3\\.5 { padding: 0.875rem; }
.p-4 { padding: 1rem; } .p-6 { padding: 1.5rem; } .p-8 { padding: 2rem; }
.px-1\\.5 { padding-left: 0.375rem; padding-right: 0.375rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-3\\.5 { padding-left: 0.875rem; padding-right: 0.875rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.flex { display: flex; } .inline-flex { display: inline-flex; } .inline-block { display: inline-block; }
.grid { display: grid; } .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.flex-col { flex-direction: column; } .flex-1 { flex: 1 1 0%; } .shrink-0 { flex-shrink: 0; } .min-w-0 { min-width: 0; }
.items-center { align-items: center; } .items-start { align-items: flex-start; } .items-end { align-items: flex-end; }
.justify-between { justify-content: space-between; } .justify-center { justify-content: center; }
.gap-1 { gap: 0.25rem; } .gap-1\\.5 { gap: 0.375rem; } .gap-2 { gap: 0.5rem; } .gap-3 { gap: 0.75rem; } .gap-4 { gap: 1rem; } .gap-5 { gap: 1.25rem; } .gap-6 { gap: 1.5rem; }
.space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; }
.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
.space-y-5 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.25rem; }
.space-x-4 > :not([hidden]) ~ :not([hidden]) { margin-left: 1rem; }
.relative { position: relative; } .absolute { position: absolute; } .inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
.left-3 { left: 0.75rem; } .right-3 { right: 0.75rem; } .bottom-3 { bottom: 0.75rem; } .top-1\\/2 { top: 50%; } .-translate-y-1\\/2 { transform: translateY(-50%); }
.overflow-hidden { overflow: hidden; } .overflow-y-auto { overflow-y: auto; } .overflow-x-auto { overflow-x: auto; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.object-cover { object-fit: cover; } .aspect-\\[4\\/4\\.5\\] { aspect-ratio: 4 / 4.5; }
.rounded { border-radius: 0.25rem; } .rounded-lg { border-radius: 0.5rem; } .rounded-xl { border-radius: 0.75rem; } .rounded-2xl { border-radius: 1rem; } .rounded-full { border-radius: 9999px; }
.border { border: 1px solid rgba(255,255,255,0.12); }
.border-slate-800, .border-slate-800\\/80, .border-slate-800\\/90 { border-color: rgba(30,41,59,0.85); }
.border-slate-700, .border-slate-700\\/80 { border-color: rgba(51,65,85,0.85); }
.border-pink-500\\/60, .border-pink-500\\/50, .border-pink-500\\/30 { border-color: rgba(236,72,153,0.5); }
.border-amber-500\\/30 { border-color: rgba(245,158,11,0.3); }
.border-emerald-500\\/20 { border-color: rgba(16,185,129,0.25); }
.bg-gray-900 { background-color: #111827; } .bg-gray-800 { background-color: #1f2937; } .bg-gray-700 { background-color: #374151; }
.bg-zinc-950 { background-color: #09090b; } .bg-zinc-900 { background-color: #18181b; } .bg-zinc-800 { background-color: #27272a; }
.bg-slate-950, .bg-slate-950\\/90 { background-color: #020617; }
.bg-slate-900, .bg-slate-900\\/70, .bg-slate-900\\/75, .bg-slate-900\\/80, .bg-slate-900\\/90 { background-color: rgba(15,23,42,0.85); }
.bg-slate-800, .bg-slate-800\\/60, .bg-slate-800\\/80 { background-color: rgba(30,41,59,0.85); }
.bg-indigo-950\\/80 { background-color: rgba(30,27,75,0.82); }
.bg-pink-500\\/15 { background-color: rgba(236,72,153,0.15); } .bg-pink-500\\/80 { background-color: rgba(236,72,153,0.85); }
.bg-amber-500\\/15 { background-color: rgba(245,158,11,0.15); } .bg-emerald-500\\/10 { background-color: rgba(16,185,129,0.12); }
.bg-black\\/45 { background-color: rgba(0,0,0,0.45); }
.bg-gradient-to-br { background-image: linear-gradient(to bottom right, #020617, #1e1b4b, #0f172a); }
.bg-gradient-to-r { background-image: linear-gradient(to right, #ec4899, #4f46e5); }
.bg-gradient-to-t { background-image: linear-gradient(to top, rgba(2,6,23,0.95), rgba(2,6,23,0.3), transparent); }
.from-pink-500.to-indigo-600, .from-pink-500.to-indigo-500 { background-image: linear-gradient(135deg, #ec4899, #4f46e5); }
.text-white { color: #ffffff; } .text-slate-100 { color: #f1f5f9; } .text-slate-200 { color: #e2e8f0; } .text-slate-300 { color: #cbd5e1; } .text-slate-400, .text-gray-400 { color: #94a3b8; }
.text-pink-300 { color: #f9a8d4; } .text-pink-400 { color: #f472b6; } .text-indigo-300 { color: #a5b4fc; }
.text-emerald-400, .text-emerald-400\\/90 { color: #34d399; } .text-amber-300 { color: #fcd34d; } .text-amber-400 { color: #fbbf24; } .text-rose-400 { color: #fb7185; }
.text-\\[10px\\] { font-size: 10px; } .text-\\[11px\\] { font-size: 11px; } .text-xs { font-size: 0.75rem; } .text-sm { font-size: 0.875rem; }
.text-lg { font-size: 1.125rem; } .text-xl { font-size: 1.25rem; } .text-2xl { font-size: 1.5rem; } .text-3xl { font-size: 1.875rem; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.font-medium { font-weight: 500; } .font-semibold { font-weight: 600; } .font-bold { font-weight: 700; }
.uppercase { text-transform: uppercase; } .tracking-wider { letter-spacing: 0.05em; } .tracking-tight { letter-spacing: -0.025em; }
.text-left { text-align: left; } .text-center { text-align: center; }
.shadow-lg, .shadow-xl { box-shadow: 0 10px 25px -5px rgba(0,0,0,0.45); }
.cursor-pointer { cursor: pointer; } .accent-pink-500 { accent-color: #ec4899; }
@media (min-width: 768px) {
  .md\\:p-6 { padding: 1.5rem; }
  .md\\:flex-row { flex-direction: row; }
  .md\\:items-center { align-items: center; }
  .md\\:w-64 { width: 16rem; }
}
@media (min-width: 1024px) {
  .lg\\:grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .lg\\:col-span-5 { grid-column: span 5 / span 5; }
  .lg\\:col-span-7 { grid-column: span 7 / span 7; }
}
`;
import { detectPageBotChallenge } from "./google-gate";
import { observeAccessibilitySnapshot, observeDom } from "./interaction";
import type { RiskLevel } from "./risk";

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

export interface FileDiffRecord {
  path: string;
  status: "created" | "modified" | "deleted" | "moved";
  previousPath?: string;
  before: string;
  after: string;
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
  sizeBytes: number;
  updatedAt: number;
}

export type CommandCategory =
  | "node"
  | "package_manager"
  | "test"
  | "build"
  | "lint"
  | "typecheck"
  | "server"
  | "other";

export interface CommandExecutionRecord {
  id: string;
  command: string;
  cwd: string;
  category: CommandCategory;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  timedOut: boolean;
  crashed: boolean;
  blockedReason?: string;
}

export interface TestRunSummary {
  commandId: string;
  command: string;
  runner: "node-test" | "vitest" | "jest" | "npm-test" | "node-script" | "custom";
  status: "passed" | "failed" | "blocked";
  exitCode: number | null;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  timestamp: number;
}

export interface BrowserInteractionCheck {
  action: "click" | "type" | "viewport";
  target: string;
  value?: string;
  ok: boolean;
  detail: string;
}

export interface BrowserInspectionRecord {
  mediaPlayback?: MediaPlaybackCheck[];
  id: string;
  url: string;
  httpStatus: number | null;
  title: string;
  consoleMessages: { type: string; text: string }[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; reason: string; status?: number }[];
  brokenImages: string[];
  layoutIssues: string[];
  elementsCount: number;
  a11ySummary: string;
  visibleTextExcerpt: string;
  interactions: BrowserInteractionCheck[];
  challengeDetected?: { provider: string; host: string; summary: string } | null;
  screenshotBase64?: string;
  passed: boolean;
  timestamp: number;
}

export interface RepairAttemptRecord {
  /** Unique across all workflow runs (attempt numbers restart at 1 each run). */
  id: string;
  attempt: number;
  signature: string;
  stage: "execute" | "test" | "browser";
  errorOutput: string;
  probableCause: string;
  filesModified: string[];
  verificationCommand: string;
  resolved: boolean;
  timestamp: number;
}

export interface WorkspaceDiagnosticIssue {
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

export interface ManagedServerInfo {
  id: string;
  command: string;
  port: number;
  url: string;
  status: "starting" | "running" | "crashed" | "stopped";
  pid?: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: number;
}

export interface NetworkDiagnostics {
  online: boolean;
  dnsResolved: boolean;
  resolvedAddresses: string[];
  httpReachable: boolean;
  httpStatus: number | null;
  latencyMs: number;
  publicEgressIp: string | null;
  staticEgressConfigured: boolean;
  staticEgressIp: string | null;
  error?: string;
}

export type VerificationTestStatus = "passed" | "failed" | "not_run" | "blocked";

export interface VerificationLedger {
  codingTask?: { goal: string; status: "running" | "verified" | "incomplete" | "stopped"; activity?: string; step: number; checks: string[]; playbackRequired: boolean; mediaPlaybackVerified: boolean; sourcesCount: number };
  chatId: string;
  workspaceDir: string;
  codeWritten: boolean;
  codeExecuted: boolean;
  testStatus: VerificationTestStatus;
  files: Record<string, { path: string; code: string; sizeBytes: number; updatedAt: number; binary?: boolean }>;
  diffs: FileDiffRecord[];
  commands: CommandExecutionRecord[];
  testRuns: TestRunSummary[];
  servers: ManagedServerInfo[];
  browserInspections: BrowserInspectionRecord[];
  repairAttempts: RepairAttemptRecord[];
  issues?: WorkspaceDiagnosticIssue[];
  primaryGoal?: string;
  updatedAt: number;
}

// Sensitive environment variable names and patterns that must never leak to child processes or logs.
const SENSITIVE_ENV_KEY =
  /^(DATABASE_URL|POSTGRES_.*|NEON_.*|SUPABASE_.*|.*_API_KEY|.*_SECRET|.*_TOKEN|.*_PASSWORD|SENKO_ACCESS_KEY|BROWSERBASE_.*|AWS_.*|STRIPE_.*|GITHUB_TOKEN|VERCEL_.*)$/i;

const SECRET_VALUE_PATTERNS = [
  /\b(gsk_[A-Za-z0-9]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
  /\b(postgres(?:ql)?:\/\/[^\s"']+)\b/gi,
  /\b(ghp_[A-Za-z0-9]{25,})\b/g,
];

export function redactSecrets(input: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!input) return "";
  let out = input;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, "[REDACTED_SECRET]");
  }
  for (const [k, v] of Object.entries(env)) {
    if (v && v.length >= 12 && SENSITIVE_ENV_KEY.test(k) && out.includes(v)) {
      out = out.split(v).join(`[REDACTED:${k}]`);
    }
  }
  return out;
}

export function buildSanitizedChildEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    CI: "true",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    npm_config_yes: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SENSITIVE_ENV_KEY.test(k)) continue;
    safe[k] = v;
  }
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (!SENSITIVE_ENV_KEY.test(k)) safe[k] = v;
    }
  }
  return safe;
}

export interface CommandRiskAssessment {
  risk: RiskLevel;
  blocked: boolean;
  requiresApproval: boolean;
  reason?: string;
}

/**
 * Evaluates a shell/Node command for destructive, credential-exfiltrating, or external-publishing behavior.
 */
export function assessCommandRisk(command: string): CommandRiskAssessment {
  const cmd = command.trim();
  if (!cmd) {
    return { risk: "low", blocked: true, requiresApproval: false, reason: "Empty command." };
  }
  // Hard-blocked destructive host commands
  if (
    /\b(rm\s+-[rf]{1,2}\s+(\/|~|\.\.|c:\\)|mkfs|shutdown|reboot|format\s+[a-z]:|del\s+\/[fqs]+\s+c:\\|reg\s+delete)/i.test(
      cmd,
    )
  ) {
    return {
      risk: "high",
      blocked: true,
      requiresApproval: false,
      reason: "Command attempts a destructive system operation outside the workspace.",
    };
  }
  // Hard-blocked credential/env exfiltration
  if (/\b(printenv|env\b.*curl|cat\s+.*\.env|type\s+.*\.env|Get-ChildItem\s+Env:)/i.test(cmd)) {
    return {
      risk: "high",
      blocked: true,
      requiresApproval: false,
      reason: "Command attempts to read protected host environment variables or .env files.",
    };
  }
  // High-risk irreversible / external publishing commands require explicit user approval
  if (/\b(npm\s+publish|npx\s+vercel(\s+--prod)?|firebase\s+deploy|git\s+push(\s+--force)?|gh\s+release|docker\s+push)\b/i.test(cmd)) {
    return {
      risk: "high",
      blocked: false,
      requiresApproval: true,
      reason: `External publishing or deployment command requires authorization: "${cmd.slice(0, 80)}"`,
    };
  }
  return { risk: "low", blocked: false, requiresApproval: false };
}

/** Turns an esbuild build failure into readable compiler output (file:line:col + hint). */
export function formatEsbuildError(err: unknown, entry: string): string {
  type Msg = { text?: string; location?: { file?: string; line?: number; column?: number; lineText?: string } | null };
  const errors = (err as { errors?: Msg[] })?.errors;
  const lines: string[] = [`TypeScript compile failed for ${entry} (esbuild):`];
  if (Array.isArray(errors) && errors.length) {
    for (const m of errors.slice(0, 10)) {
      const loc = m.location;
      lines.push(loc?.file ? `${loc.file}:${loc.line}:${loc.column}: error: ${m.text}` : `error: ${m.text}`);
      if (loc?.lineText) lines.push(`    ${loc.lineText.trim()}`);
      const missing = m.text?.match(/Could not resolve "(\.{1,2}\/[^"]+)"/);
      if (missing) {
        lines.push(`    hint: the local module ${missing[1]} does not exist yet — create it (a .ts file is fine for a .js import).`);
      }
    }
  } else {
    lines.push(err instanceof Error ? err.message : String(err));
  }
  return lines.join("\n") + "\n";
}

export function classifyCommand(command: string): CommandCategory {
  const c = command.trim().toLowerCase();
  if (/\b(vitest|jest|mocha|ava|playwright\s+test|pytest)\b/.test(c) || /\bnode\s+(?:--experimental-strip-types\s+)?--test\b/.test(c) || /\bnpm\s+(run\s+)?test\b/.test(c) || /\bnode\s+(?:--experimental-strip-types\s+)?[\w./-]*test[\w./-]*\.(m?js|cjs|ts|tsx)\b/.test(c)) {
    return "test";
  }
  if (/\b(npm\s+(install|i|ci|add|remove|uninstall|init)|pnpm\s+(add|install)|yarn\s+(add|install))\b/.test(c)) {
    return "package_manager";
  }
  if (/\b(tsc|vue-tsc)\b/.test(c) || /\bnpm\s+run\s+typecheck\b/.test(c)) {
    return "typecheck";
  }
  if (/\b(eslint|biome|prettier)\b/.test(c) || /\bnpm\s+run\s+lint\b/.test(c)) {
    return "lint";
  }
  if (/\b(npm\s+run\s+build|next\s+build|vite\s+build|esbuild)\b/.test(c)) {
    return "build";
  }
  if (/\b(node|tsx|ts-node|jiti)\b/.test(c)) {
    return "node";
  }
  return "other";
}

export function sanitizeWorkspaceId(chatId: string): string {
  const clean = (chatId || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return clean || "default";
}

export function getWorkspaceRootDir(baseDir?: string): string {
  return baseDir || process.env.SENKO_WORKSPACES_DIR || path.join(process.cwd(), ".data", "workspaces");
}

export function getChatWorkspaceDir(chatId: string, baseDir?: string): string {
  const root = path.resolve(getWorkspaceRootDir(baseDir));
  const id = sanitizeWorkspaceId(chatId);
  return path.join(root, id);
}

/**
 * Resolves a relative file path strictly within `workspaceDir`.
 * Rejects `..` traversal, absolute paths pointing outside `workspaceDir`, and `.env` access.
 */
export function resolveSafeWorkspacePath(workspaceDir: string, relativePath: string): { absPath: string; relPath: string } {
  const root = path.resolve(workspaceDir);
  const raw = (relativePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw === "." || raw === "..") {
    throw new WorkspaceSecurityError(`Invalid workspace file path: "${relativePath}"`);
  }
  const segments = raw.split("/");
  if (segments.some((s) => s === ".." || s === ".git" || s === ".senko" || /^\.env(\..+)?$/i.test(s))) {
    throw new WorkspaceSecurityError(`Access to path "${relativePath}" is restricted by workspace security policy.`);
  }
  const absPath = path.resolve(root, raw);
  const rel = path.relative(root, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorkspaceSecurityError(`Path traversal outside workspace blocked: "${relativePath}"`);
  }
  {
    // Check the nearest existing ancestor too: new files can otherwise escape via a symlinked directory.
    let existingPath = absPath;
    while (!fs.existsSync(existingPath) && existingPath !== root && path.dirname(existingPath) !== existingPath) existingPath = path.dirname(existingPath);
    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
    const realTarget = fs.existsSync(existingPath) ? fs.realpathSync(existingPath) : existingPath;
    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new WorkspaceSecurityError(`Symlink escape outside workspace blocked: "${relativePath}"`);
    }
  }
  return { absPath, relPath: rel.replace(/\\/g, "/") };
}

/**
 * Computes a concise unified diff and line addition/deletion counts between two strings.
 */
export function computeUnifiedDiff(filePath: string, before: string, after: string): {
  addedLines: number;
  removedLines: number;
  unifiedDiff: string;
} {
  if (before === after) {
    return { addedLines: 0, removedLines: 0, unifiedDiff: "" };
  }
  const oldLines = before ? before.split("\n") : [];
  const newLines = after ? after.split("\n") : [];

  let addedLines = 0;
  let removedLines = 0;
  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (diffLines.length < 160) diffLines.push(` ${o ?? ""}`);
    } else {
      if (o !== undefined) {
        removedLines++;
        if (diffLines.length < 160) diffLines.push(`-${o}`);
      }
      if (n !== undefined) {
        addedLines++;
        if (diffLines.length < 160) diffLines.push(`+${n}`);
      }
    }
  }

  return {
    addedLines,
    removedLines,
    unifiedDiff: diffLines.join("\n"),
  };
}

interface ActiveServerHandle {
  info: ManagedServerInfo;
  proc?: ChildProcess;
  httpServer?: http.Server;
  stop: () => Promise<void>;
}

const g = globalThis as unknown as {
  __senkoLedgers?: Map<string, VerificationLedger>;
  __senkoServers?: Map<string, Map<string, ActiveServerHandle>>;
};
const ledgers = (g.__senkoLedgers ??= new Map());
const activeServers = (g.__senkoServers ??= new Map());

export function getVerificationLedger(chatId: string, baseDir?: string): VerificationLedger {
  const key = sanitizeWorkspaceId(chatId);
  let ledger = ledgers.get(key);
  const workspaceDir = getChatWorkspaceDir(chatId, baseDir);
  if (!ledger || ledger.workspaceDir !== workspaceDir) {
    ledger = {
      chatId,
      workspaceDir,
      codeWritten: false,
      codeExecuted: false,
      testStatus: "not_run",
      files: {},
      diffs: [],
      commands: [],
      testRuns: [],
      servers: [],
      browserInspections: [],
      repairAttempts: [],
      issues: [],
      updatedAt: Date.now(),
    };
    ledgers.set(key, ledger);
  }
  if (!ledger.issues) ledger.issues = [];
  return ledger;
}

export function resetVerificationLedger(chatId: string, baseDir?: string): VerificationLedger {
  const key = sanitizeWorkspaceId(chatId);
  ledgers.delete(key);
  return getVerificationLedger(chatId, baseDir);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPortReady(port: number, host = "127.0.0.1", timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ port, host });
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
      sock.setTimeout(600, () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function parseTestCounts(output: string, exitCode: number | null): { passedCount: number; failedCount: number } {
  let passedCount = 0;
  let failedCount = 0;

  // Node --test format: "ℹ pass 4", "ℹ fail 1" or "# pass 4", "# fail 0"
  const nodePass = output.match(/(?:ℹ|#)\s*pass\s+(\d+)/i);
  const nodeFail = output.match(/(?:ℹ|#)\s*fail\s+(\d+)/i);
  if (nodePass || nodeFail) {
    passedCount = Number(nodePass?.[1] || 0);
    failedCount = Number(nodeFail?.[1] || 0);
    return { passedCount, failedCount };
  }

  // Vitest / Jest format: "Tests  3 passed (3)" or "Tests: 1 failed, 2 passed"
  const vitestPass = output.match(/(\d+)\s+passed/i);
  const vitestFail = output.match(/(\d+)\s+failed/i);
  if (vitestPass || vitestFail) {
    passedCount = Number(vitestPass?.[1] || 0);
    failedCount = Number(vitestFail?.[1] || 0);
    return { passedCount, failedCount };
  }

  // Fallback for custom assertion scripts (e.g. `node test.js`)
  if (exitCode === 0) {
    const okMatches = output.match(/\b(pass(?:ed)?|ok|✓|✔)\b/gi);
    passedCount = Math.max(1, okMatches?.length || 1);
    failedCount = 0;
  } else {
    failedCount = 1;
  }
  return { passedCount, failedCount };
}

/**
 * Real Node.js Coding Workspace Runtime scoped to a specific chat.
 */
export class CodingWorkspaceRuntime {
  readonly chatId: string;
  readonly workspaceDir: string;
  readonly ledger: VerificationLedger;

  constructor(chatId: string, baseDir?: string) {
    this.chatId = chatId;
    this.workspaceDir = getChatWorkspaceDir(chatId, baseDir);
    this.ledger = getVerificationLedger(chatId, baseDir);
  }

  async ensureWorkspace(): Promise<string> {
    await fsp.mkdir(this.workspaceDir, { recursive: true });
    return this.workspaceDir;
  }

  async writeFile(relativePath: string, content: string): Promise<FileDiffRecord> {
    await this.ensureWorkspace();
    const { absPath, relPath } = resolveSafeWorkspacePath(this.workspaceDir, relativePath);
    await fsp.mkdir(path.dirname(absPath), { recursive: true });

    let before = "";
    let existed = false;
    try {
      before = await fsp.readFile(absPath, "utf8");
      existed = true;
    } catch {
      existed = false;
    }

    let cleanContent = redactSecrets(content);
    if (/\.json$/i.test(relPath)) {
      // Strip any leading // or /* */ path comments that an LLM may have placed at the top of a JSON block
      cleanContent = cleanContent
        .replace(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n)+/, "")
        .trim();
    }
    await fsp.writeFile(absPath, cleanContent, "utf8");
    const sizeBytes = Buffer.byteLength(cleanContent, "utf8");
    const { addedLines, removedLines, unifiedDiff } = computeUnifiedDiff(relPath, before, cleanContent);
    if (before !== cleanContent) this.ledger.testStatus = "not_run";
    const now = Date.now();

    const record: FileDiffRecord = {
      path: relPath,
      status: existed ? "modified" : "created",
      before,
      after: cleanContent,
      addedLines,
      removedLines,
      unifiedDiff,
      sizeBytes,
      updatedAt: now,
    };

    this.ledger.codeWritten = true;
    this.ledger.files[relPath] = { path: relPath, code: cleanContent, sizeBytes, updatedAt: now };
    this.ledger.diffs = [...this.ledger.diffs.filter((d) => d.path !== relPath), record];
    this.ledger.updatedAt = now;
    return record;
  }

  async editFile(relativePath: string, target: string, replacement: string): Promise<FileDiffRecord> {
    const current = await this.readFile(relativePath);
    const updated = applyExactEdit(current, target, replacement);
    return this.writeFile(relativePath, updated);
  }

  async readFile(relativePath: string): Promise<string> {
    const { absPath, relPath } = resolveSafeWorkspacePath(this.workspaceDir, relativePath);
    const stat = await fsp.stat(absPath);
    if (stat.size > 2 * 1024 * 1024) {
      throw new Error(`File "${relPath}" exceeds 2 MB read limit.`);
    }
    const content = await fsp.readFile(absPath, "utf8");
    this.ledger.files[relPath] = { path: relPath, code: content, sizeBytes: stat.size, updatedAt: Date.now() };
    return content;
  }

  async moveFile(fromRelativePath: string, toRelativePath: string): Promise<FileDiffRecord> {
    await this.ensureWorkspace();
    const from = resolveSafeWorkspacePath(this.workspaceDir, fromRelativePath);
    const to = resolveSafeWorkspacePath(this.workspaceDir, toRelativePath);
    const content = await fsp.readFile(from.absPath, "utf8");
    await fsp.mkdir(path.dirname(to.absPath), { recursive: true });
    await fsp.rename(from.absPath, to.absPath);
    this.ledger.testStatus = "not_run";

    const now = Date.now();
    delete this.ledger.files[from.relPath];
    this.ledger.files[to.relPath] = {
      path: to.relPath,
      code: content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      updatedAt: now,
    };
    const record: FileDiffRecord = {
      path: to.relPath,
      previousPath: from.relPath,
      status: "moved",
      before: content,
      after: content,
      addedLines: 0,
      removedLines: 0,
      unifiedDiff: `rename from ${from.relPath}\nrename to ${to.relPath}`,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      updatedAt: now,
    };
    this.ledger.diffs.push(record);
    this.ledger.updatedAt = now;
    return record;
  }

  async deleteFile(relativePath: string): Promise<void> {
    const { absPath, relPath } = resolveSafeWorkspacePath(this.workspaceDir, relativePath);
    let before = "";
    try {
      const stat = await fsp.stat(absPath);
      if (!stat.isDirectory()) before = await fsp.readFile(absPath, "utf8");
    } catch {
      /* ignore */
    }
    await fsp.rm(absPath, { recursive: true, force: true });
    this.ledger.testStatus = "not_run";
    delete this.ledger.files[relPath];
    for (const k of Object.keys(this.ledger.files)) {
      if (k.startsWith(`${relPath}/`)) delete this.ledger.files[k];
    }
    const { addedLines, removedLines, unifiedDiff } = computeUnifiedDiff(relPath, before, "");
    this.ledger.diffs.push({
      path: relPath,
      status: "deleted",
      before,
      after: "",
      addedLines,
      removedLines,
      unifiedDiff,
      sizeBytes: 0,
      updatedAt: Date.now(),
    });
    this.ledger.updatedAt = Date.now();
  }

  async listFiles(): Promise<{ path: string; code: string; sizeBytes: number; binary?: boolean }[]> {
    await this.ensureWorkspace();
    const results: { path: string; code: string; sizeBytes: number; binary?: boolean }[] = [];

    const walk = async (dir: string) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".senko" || entry.name === ".senko-build" || entry.name.startsWith(".env")) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.workspaceDir, full).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const stat = await fsp.stat(full).catch(() => null);
          if (!stat) continue;
          const knownBinary = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|pdf|woff2?|ttf|otf|mp[34]|m4a|wav|ogg|webm|zip|gz|wasm)$/i.test(rel);
          if (stat.size > (knownBinary ? 20 * 1024 * 1024 : 512 * 1024)) continue;
          const bytes = knownBinary ? null : await fsp.readFile(full).catch(() => Buffer.alloc(0));
          const binary = knownBinary || bytes!.includes(0);
          const code = binary ? "" : bytes!.toString("utf8");
          results.push({ path: rel, code, sizeBytes: stat.size, ...(binary ? { binary: true } : {}) });
          this.ledger.files[rel] = { path: rel, code, sizeBytes: stat.size, updatedAt: stat.mtimeMs, ...(binary ? { binary: true } : {}) };
        }
      }
    };

    await walk(this.workspaceDir);
    const livePaths = new Set(results.map((f) => f.path));
    for (const tracked of Object.keys(this.ledger.files)) if (!livePaths.has(tracked)) delete this.ledger.files[tracked];
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }

  /** Reload real tool evidence when the worker and polling API use different processes. */
  async refreshPersistedEvidence(): Promise<void> {
    const newestSource = Math.max(0, ...Object.values(this.ledger.files).map((file) => file.updatedAt));
    try {
      const absPath = await this.internalEvidencePath("task.json");
      const saved = JSON.parse(await fsp.readFile(absPath, "utf8")) as import("./coding-loop").CodingTaskJournal;
      if (typeof saved.goal !== "string" || !["running", "verified", "incomplete", "stopped"].includes(saved.status) || !Number.isFinite(saved.updatedAt) || !Number.isFinite(saved.step)) return;
      const stale = newestSource > saved.updatedAt;
      const interrupted = saved.status === "running" && Date.now() - saved.updatedAt > 120_000;
      this.ledger.codingTask = {
        goal: saved.goal, status: interrupted ? "stopped" : stale && saved.status === "verified" ? "incomplete" : saved.status,
        activity: interrupted ? "Execution heartbeat expired; resume to reverify." : saved.activity,
        step: saved.step, checks: Array.isArray(saved.requirements?.checks) ? saved.requirements.checks.filter((item) => typeof item === "string") : [],
        playbackRequired: saved.requirements?.playback === true,
        mediaPlaybackVerified: !stale && Array.isArray(saved.evidence) && saved.evidence.filter((item) => item.revision === saved.revision && item.command === "inspect").at(-1)?.mediaPlaybackPassed === true,
        sourcesCount: Array.isArray(saved.sources) ? saved.sources.length : 0,
      };
    } catch { /* No persisted task yet; live ledger remains authoritative. */ }
    try {
      const absPath = await this.internalEvidencePath("browser-evidence.json");
      const records = JSON.parse(await fsp.readFile(absPath, "utf8")) as BrowserInspectionRecord[];
      if (Array.isArray(records)) for (const record of records) {
        if (typeof record.id !== "string" || !Number.isFinite(record.timestamp) || !Array.isArray(record.layoutIssues)) continue;
        const hydrated = record.timestamp < newestSource ? { ...record, passed: false, mediaPlayback: record.mediaPlayback?.map((media) => ({ ...media, verified: false })), layoutIssues: [...record.layoutIssues, "Source files changed after this inspection; reverify."] } : record;
        const existing = this.ledger.browserInspections.findIndex((item) => item.id === record.id);
        if (existing < 0) this.ledger.browserInspections.push(hydrated);
        else this.ledger.browserInspections[existing] = hydrated;
      }
      this.ledger.browserInspections.sort((a, b) => a.timestamp - b.timestamp);
    } catch { /* No browser evidence has been produced. */ }
  }

  private async internalEvidencePath(name: "task.json" | "browser-evidence.json"): Promise<string> {
    const directory = path.join(this.workspaceDir, ".senko");
    const target = path.join(directory, name);
    for (const candidate of [directory, target]) {
      const stat = await fsp.lstat(candidate).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (stat?.isSymbolicLink()) throw new WorkspaceSecurityError("Internal evidence cannot use symbolic links.");
    }
    return target;
  }

  private async persistBrowserEvidence(): Promise<void> {
    const absPath = await this.internalEvidencePath("browser-evidence.json");
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, JSON.stringify(this.ledger.browserInspections.slice(-5)), "utf8");
  }

  /**
   * Assigns a diagnostic problem/bug into the workspace ledger so the UI and agent can track
   * it from "assigned" -> "debugging" -> "editing" -> "fixed".
   */
  assignIssue(
    issue: Omit<WorkspaceDiagnosticIssue, "id" | "assignedAt" | "status"> & {
      status?: WorkspaceDiagnosticIssue["status"];
    },
  ): WorkspaceDiagnosticIssue {
    if (!this.ledger.issues) this.ledger.issues = [];
    const existing = this.ledger.issues.find(
      (i) => i.source === issue.source && i.title === issue.title && i.status !== "fixed",
    );
    if (existing) {
      existing.detail = issue.detail;
      if (issue.file) existing.file = issue.file;
      if (issue.status) existing.status = issue.status;
      this.ledger.updatedAt = Date.now();
      return existing;
    }
    const created: WorkspaceDiagnosticIssue = {
      id: `iss_${Date.now()}_${this.ledger.issues.length + 1}`,
      source: issue.source,
      severity: issue.severity,
      title: issue.title,
      detail: issue.detail,
      file: issue.file,
      status: issue.status || "assigned",
      assignedAt: Date.now(),
    };
    this.ledger.issues.push(created);
    this.ledger.updatedAt = Date.now();
    return created;
  }

  updateIssueStatus(
    sourceOrId: string,
    status: WorkspaceDiagnosticIssue["status"],
    detail?: string,
    file?: string,
  ): void {
    if (!this.ledger.issues) return;
    for (const iss of this.ledger.issues) {
      if ((iss.id === sourceOrId || iss.source === sourceOrId) && iss.status !== "fixed") {
        iss.status = status;
        if (detail) iss.detail = detail;
        if (file) iss.file = file;
        if (status === "fixed") iss.resolvedAt = Date.now();
      }
    }
    this.ledger.updatedAt = Date.now();
  }

  resolveOpenIssuesBySource(source: WorkspaceDiagnosticIssue["source"]): void {
    this.updateIssueStatus(source, "fixed");
  }

  /**
   * Persists and returns the overarching primary goal of this workspace so every future
   * live edit, fix, debug, or test run remembers what product is being built.
   */
  async syncPrimaryGoal(candidateGoal?: string, forceOverwrite = false): Promise<string> {
    await this.ensureWorkspace();
    const goalFile = path.join(this.workspaceDir, ".senko-build", "goal.json");
    if (!this.ledger.primaryGoal && fs.existsSync(goalFile)) {
      try {
        const saved = JSON.parse(await fsp.readFile(goalFile, "utf8")) as { primaryGoal?: string };
        if (saved.primaryGoal) this.ledger.primaryGoal = saved.primaryGoal;
      } catch {
        /* ignore */
      }
    }
    const clean = candidateGoal?.trim();
    const isGenericAction =
      !clean ||
      /^(start the website|inspect all workspace|inspect the live rendered|write or update automated|run automated tests|fix this esbuild|fix the runtime|fix all assigned|upgrade the ui)/i.test(
        clean,
      );
    if (clean && (forceOverwrite || (!this.ledger.primaryGoal && !isGenericAction))) {
      this.ledger.primaryGoal = clean;
      try {
        await fsp.mkdir(path.dirname(goalFile), { recursive: true });
        await fsp.writeFile(goalFile, JSON.stringify({ primaryGoal: clean, updatedAt: Date.now() }, null, 2), "utf8");
      } catch {
        /* ignore */
      }
    }
    return this.ledger.primaryGoal || clean || "Build and verify a full-stack interactive web application";
  }

  /**
   * Compiles a TypeScript / TSX / JSX file (and its local imports) into a temporary `.mjs` bundle
   * inside `.senko-build/` using `esbuild` so Node.js can execute or test it on any Node version.
   */
  async bundleNodeScript(entryRelPath: string): Promise<string> {
    await this.ensureWorkspace();
    const { absPath: entryAbs, relPath } = resolveSafeWorkspacePath(this.workspaceDir, entryRelPath);
    const buildDir = path.join(this.workspaceDir, ".senko-build");
    await fsp.mkdir(buildDir, { recursive: true });
    const safeName = relPath.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/\.(ts|tsx|jsx)$/i, ".mjs");
    const outAbs = path.join(buildDir, safeName);

    const pkgAbs = path.join(this.workspaceDir, "package.json");
    if (fs.existsSync(pkgAbs)) {
      const rawPkg = await fsp.readFile(pkgAbs, "utf8").catch(() => "");
      const strippedPkg = rawPkg.replace(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n)+/, "").trim();
      if (strippedPkg && strippedPkg !== rawPkg.trim()) {
        await fsp.writeFile(pkgAbs, strippedPkg, "utf8").catch(() => {});
      }
    }

    const hostNodeModules = path.join(process.cwd(), "node_modules");
    const wsNodeModules = path.join(this.workspaceDir, "node_modules");
    const nodePaths = [wsNodeModules, hostNodeModules].filter((p) => fs.existsSync(p));

    await getEsbuild().build({
      entryPoints: [entryAbs],
      bundle: true,
      outfile: outAbs,
      format: "esm",
      platform: "node",
      target: ["node20"],
      jsx: "automatic",
      nodePaths,
      absWorkingDir: this.workspaceDir,
      logLevel: "silent",
    });

    return path.relative(this.workspaceDir, outAbs).replace(/\\/g, "/");
  }

  /**
   * Executes a real command inside the chat's isolated workspace directory and records
   * the authentic stdout, stderr, exit code, and test outcome in the VerificationLedger.
   */
  async runCommand(
    command: string,
    opts: {
      timeoutMs?: number;
      env?: Record<string, string>;
      approved?: boolean;
      signal?: AbortSignal;
      onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
    } = {},
  ): Promise<CommandExecutionRecord> {
    await this.ensureWorkspace();
    opts.signal?.throwIfAborted();
    const riskCheck = assessCommandRisk(command);
    const startedAt = Date.now();
    const id = `cmd_${startedAt}_${this.ledger.commands.length + 1}`;
    const category = classifyCommand(command);

    if (riskCheck.blocked || (riskCheck.requiresApproval && !opts.approved)) {
      const blockedReason =
        riskCheck.reason ||
        (riskCheck.requiresApproval ? "Command requires explicit user approval before execution." : "Command blocked by security policy.");
      const blockedRec: CommandExecutionRecord = {
        id,
        command,
        cwd: this.workspaceDir,
        category,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: blockedReason,
        durationMs: 0,
        startedAt,
        finishedAt: Date.now(),
        timedOut: false,
        crashed: false,
        blockedReason,
      };
      this.ledger.commands.push(blockedRec);
      if (category === "test" && this.ledger.testStatus === "not_run") {
        this.ledger.testStatus = "blocked";
      }
      this.ledger.updatedAt = Date.now();
      return blockedRec;
    }

    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 60_000, 1_000), 180_000);
    const childEnv = buildSanitizedChildEnv(opts.env);
    const binDirs = [
      path.join(this.workspaceDir, "node_modules", ".bin"),
      path.join(process.cwd(), "node_modules", ".bin"),
    ].filter((p) => fs.existsSync(p));
    if (binDirs.length > 0) {
      const sep = process.platform === "win32" ? ";" : ":";
      const curPath = childEnv.PATH || childEnv.Path || "";
      const nextPath = `${binDirs.join(sep)}${curPath ? `${sep}${curPath}` : ""}`;
      childEnv.PATH = nextPath;
      if (process.platform === "win32") childEnv.Path = nextPath;
    }

    // If the command runs a .ts or .tsx file directly with `node`, `tsx`, `npx tsx`, or `ts-node`,
    // or uses a Windows-unexpanded glob like `node --test "test/**/*.test.ts"`, pre-bundle it with esbuild
    // so full TypeScript/TSX syntax works seamlessly across all Node versions and OSes.
    let execCommand = command.trim();
    const globTestMatch = execCommand.match(/^(?:node|npx\s+tsx|tsx)\s+--test\s+["']?([^"']*\*[^"']*\.ts)["']?$/i);
    let globTestFiles: string[] | undefined;
    if (globTestMatch) {
      const files = await this.listFiles();
      const pattern = globTestMatch[1].replace(/\\/g, "/").replace(/^\.\//, "");
      const globRegex = new RegExp("^" + pattern.split("/").map((part) => {
        if (part === "**") return "(?:[^/]+/)*";
        return part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "/";
      }).join("").replace(/\/$/, "") + "$");
      globTestFiles = files.filter((f) => globRegex.test(f.path)).map((f) => f.path);
    }

    const nodeTsMatch = execCommand.match(
      /^(?:node|(?:npx\s+)?(?:tsx|ts-node))\s+(?:--experimental-strip-types\s+)?(--test\s+)?([^\s"']+\.(?:ts|tsx))(.*)$/i,
    );
    const multiNodeTests = execCommand.match(/^node\s+--test\s+((?:[\w./-]+\.(?:ts|tsx|js|mjs|cjs)\s*)+)$/i);
    const explicitTests = multiNodeTests?.[1].trim().split(/\s+/);
    if (nodeTsMatch || globTestFiles || explicitTests?.some((file) => /\.tsx?$/i.test(file))) {
      try {
        const testFlag = globTestFiles || explicitTests ? "--test " : nodeTsMatch![1] || "";
        const tsFiles = globTestFiles ?? explicitTests ?? [nodeTsMatch![2]];
        if (!tsFiles.length) throw new Error("No test files matched the requested pattern.");
        const restArgs = explicitTests ? "" : nodeTsMatch?.[3] || "";
        // Also pre-bundle server/server.ts if it exists so any test spawning server works
        if (fs.existsSync(path.join(this.workspaceDir, "server", "server.ts"))) {
          await this.bundleNodeScript("server/server.ts").catch(() => {});
        }
        const compiledFiles = [];
        for (const tsFile of tsFiles) compiledFiles.push(/\.tsx?$/i.test(tsFile) ? await this.bundleNodeScript(tsFile) : tsFile);
        execCommand = `node ${testFlag}${compiledFiles.join(" ")}${restArgs}`;
      } catch (e) {
        // Don't fall back to raw `node file.ts`: Node 20 can't run TypeScript and would hide the
        // real problem behind ERR_UNKNOWN_FILE_EXTENSION. Surface the esbuild error instead
        // (e.g. a missing local import) so the repair loop can fix the actual cause.
        // Written as a script file (not `node -e "..."`) because cmd.exe mangles quoted arguments.
        const reporter = path.join(this.workspaceDir, ".senko-build", "compile-error.cjs");
        await fsp.mkdir(path.dirname(reporter), { recursive: true }).catch(() => {});
        const msg = formatEsbuildError(e, nodeTsMatch?.[2] ?? globTestMatch?.[1] ?? explicitTests?.join(", ") ?? "tests");
        await fsp
          .writeFile(reporter, `process.stderr.write(${JSON.stringify(msg)});\nprocess.exitCode = 1;\n`, "utf8")
          .catch(() => {});
        execCommand = "node .senko-build/compile-error.cjs";
      }
    }

    return new Promise<CommandExecutionRecord>((resolve) => {
      const isWin = process.platform === "win32";
      const proc = spawn(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", execCommand] : ["-c", execCommand], {
        cwd: this.workspaceDir,
        env: childEnv,
        windowsHide: true,
        detached: !isWin,
      });

      let settled = false;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const MAX_BUF = 256 * 1024;

      const timer = setTimeout(() => {
        timedOut = true;
        void stopProcessTree(proc);
      }, timeoutMs);
      const onAbort = () => { void stopProcessTree(proc); };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = redactSecrets(chunk.toString("utf8"));
        if (stdout.length < MAX_BUF) stdout += text.slice(0, MAX_BUF - stdout.length);
        opts.onOutput?.("stdout", text);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = redactSecrets(chunk.toString("utf8"));
        if (stderr.length < MAX_BUF) stderr += text.slice(0, MAX_BUF - stderr.length);
        opts.onOutput?.("stderr", text);
      });

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null, errMessage?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (errMessage) stderr = (stderr ? `${stderr}\n` : "") + redactSecrets(errMessage);
        const finishedAt = Date.now();
        const durationMs = Math.max(1, finishedAt - startedAt);
        const crashed = timedOut || signal !== null || (exitCode !== null && exitCode > 128);

        const rec: CommandExecutionRecord = {
          id,
          command,
          cwd: this.workspaceDir,
          category,
          exitCode,
          signal: signal ? String(signal) : null,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          durationMs,
          startedAt,
          finishedAt,
          timedOut,
          crashed,
        };

        this.ledger.codeExecuted = true;
        this.ledger.commands.push(rec);

        if (category === "test") {
          const combined = `${rec.stdout}\n${rec.stderr}`;
          const { passedCount, failedCount } = parseTestCounts(combined, exitCode);
          const passed = exitCode === 0 && !timedOut;
          const runner: TestRunSummary["runner"] = /\bvitest\b/i.test(command)
            ? "vitest"
            : /\bjest\b/i.test(command)
              ? "jest"
              : /\bnode\s+--test\b/i.test(command)
                ? "node-test"
                : /\bnpm\s+(run\s+)?test\b/i.test(command)
                  ? "npm-test"
                  : "node-script";

          this.ledger.testRuns.push({
            commandId: id,
            command,
            runner,
            status: passed ? "passed" : "failed",
            exitCode,
            passedCount,
            failedCount: passed ? 0 : Math.max(1, failedCount),
            durationMs,
            stdout: rec.stdout,
            stderr: rec.stderr,
            timestamp: finishedAt,
          });
          this.ledger.testStatus = passed ? "passed" : "failed";
        }

        this.ledger.updatedAt = finishedAt;
        // Refresh tracked files in case the command generated or modified files on disk
        void this.listFiles().catch(() => {});
        resolve(rec);
      };

      proc.once("error", (err) => finish(null, null, err.message));
      proc.once("close", (code, sig) => finish(code, sig));
    });
  }

  /**
   * Bundles a React / TypeScript / JSX / JS frontend entry point (and any imported workspace files
   * or npm packages) into a self-contained HTML document using `esbuild`.
   */
  async bundleFrontendApp(entryRelPath?: string): Promise<{ html: string; entryPath: string; errors: string[] }> {
    await this.ensureWorkspace();
    const files = await this.listFiles();

    // Pick entry file if not explicitly provided
    const candidates = [
      entryRelPath,
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
      "src/main.ts",
      "src/index.ts",
      "index.ts",
    ].filter((c): c is string => Boolean(c));

    let chosen = candidates.find((c) => files.some((f) => f.path.toLowerCase() === c.toLowerCase()));
    if (!chosen) {
      chosen = files.find((f) => /\.(tsx|jsx)$/i.test(f.path) && !/\.(test|spec)\./i.test(f.path))?.path;
    }
    if (!chosen) {
      chosen = files.find((f) => /\.ts$/i.test(f.path) && !/\.(test|spec|d)\./i.test(f.path) && !/server/i.test(f.path))?.path;
    }
    if (!chosen) {
      return { html: "", entryPath: "", errors: ["No TypeScript/TSX/JSX entry file found in workspace."] };
    }

    const { absPath: entryAbs, relPath } = resolveSafeWorkspacePath(this.workspaceDir, chosen);
    const entryCode = await fsp.readFile(entryAbs, "utf8");
    const isReactFile = /\.(tsx|jsx)$/i.test(relPath) || /\bfrom\s+['"]react['"]/.test(entryCode);
    const mountsSelf = /\bcreateRoot\s*\(|\bReactDOM\.render\s*\(/.test(entryCode);

    // Collect workspace CSS files to inject automatically (stripping raw @tailwind directives)
    const cssFiles = files.filter((f) => /\.css$/i.test(f.path));
    const combinedCss = cssFiles
      .map((c) => `/* ${c.path} */\n${c.code.replace(/@tailwind\s+(?:base|components|utilities)\s*;/g, "").replace(/@import\s+["']tailwindcss["']\s*;/g, "")}`)
      .join("\n\n");

    const buildDir = path.join(this.workspaceDir, ".senko-build");
    await fsp.mkdir(buildDir, { recursive: true });
    let buildEntryAbs = entryAbs;

    if (isReactFile && !mountsSelf) {
      // Auto-mount exported default or named component onto #root
      const namedExportMatch = entryCode.match(/export\s+(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/);
      const hasDefaultExport = /\bexport\s+default\b/.test(entryCode);
      const importStmt = hasDefaultExport
        ? `import AppComponent from ${JSON.stringify(entryAbs.replace(/\\/g, "/"))};`
        : namedExportMatch
          ? `import { ${namedExportMatch[1]} as AppComponent } from ${JSON.stringify(entryAbs.replace(/\\/g, "/"))};`
          : `import * as Mod from ${JSON.stringify(entryAbs.replace(/\\/g, "/"))};\nconst AppComponent = (Mod as any).default || Object.values(Mod).find((v) => typeof v === "function") || (() => null);`;

      const bootCode = `import React from "react";
import { createRoot } from "react-dom/client";
${importStmt}

const rootEl = document.getElementById("root") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
createRoot(rootEl).render(React.createElement(AppComponent));
`;
      buildEntryAbs = path.join(buildDir, "__senko_entry.tsx");
      await fsp.writeFile(buildEntryAbs, bootCode, "utf8");
    }

    try {
      // Auto-sanitize package.json if it contains leading // comments on disk
      const pkgAbs = path.join(this.workspaceDir, "package.json");
      if (fs.existsSync(pkgAbs)) {
        const rawPkg = await fsp.readFile(pkgAbs, "utf8").catch(() => "");
        const strippedPkg = rawPkg.replace(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n)+/, "").trim();
        if (strippedPkg && strippedPkg !== rawPkg.trim()) {
          await fsp.writeFile(pkgAbs, strippedPkg, "utf8").catch(() => {});
        }
      }

      const hostNodeModules = path.join(process.cwd(), "node_modules");
      const wsNodeModules = path.join(this.workspaceDir, "node_modules");
      const nodePaths = [wsNodeModules, hostNodeModules].filter((p) => fs.existsSync(p));
      const result = await getEsbuild().build({
        entryPoints: [buildEntryAbs],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: ["es2020"],
        jsx: "automatic",
        // Resolve real installed packages; missing dependencies must fail visibly.
        outfile: "preview.js",
        loader: {
          ".ts": "ts",
          ".tsx": "tsx",
          ".js": "jsx",
          ".jsx": "jsx",
          ".css": "css",
          ".json": "json",
          ".svg": "dataurl",
          ".png": "dataurl",
        },
        nodePaths,
        absWorkingDir: this.workspaceDir,
        define: {
          "process.env.NODE_ENV": '"development"',
        },
        logLevel: "silent",
      });

      const jsOut = result.outputFiles?.find((f) => f.path.endsWith(".js") || !f.path.endsWith(".css"))?.text || "";
      const cssOut = result.outputFiles?.find((f) => f.path.endsWith(".css"))?.text || "";

      // Check if an index.html template exists in the workspace
      const htmlTemplate = files.find((f) => /(^|\/)index\.html?$/i.test(f.path));
      const titleMatch = htmlTemplate?.code.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch?.[1] || relPath;

      const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    ${OFFLINE_UTILITY_CSS}
    ${combinedCss}
    ${cssOut}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${jsOut.replace(/<\/script/gi, "<\\/script")}
  </script>
</body>
</html>`;

      return { html, entryPath: relPath, errors: [] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { html: "", entryPath: relPath, errors: [msg] };
    }
  }

  /**
   * Starts a real local HTTP server for the workspace:
   * - If `command` is provided (e.g. `node server.js`), spawns the process with `PORT=<freePort>` and waits until it accepts connections.
   * - If `command` is omitted or `"static"`, serves the workspace directory over a built-in Node `http.Server` (including on-the-fly TSX/TS/React bundling via esbuild).
   */
  async startServer(opts: { command?: string; port?: number; timeoutMs?: number; approved?: boolean } = {}): Promise<ManagedServerInfo> {
    await this.ensureWorkspace();
    if (opts.command && opts.command !== "static") {
      const risk = assessCommandRisk(opts.command);
      if (risk.blocked || (risk.requiresApproval && !opts.approved)) throw new WorkspaceSecurityError(risk.reason || "Server command requires approval.");
    }
    const port = opts.port || (await findFreePort());
    const id = `srv_${port}`;
    const chatKey = sanitizeWorkspaceId(this.chatId);
    const chatServers = activeServers.get(chatKey) ?? new Map<string, ActiveServerHandle>();
    activeServers.set(chatKey, chatServers);

    // Stop any previous server on the same id
    if (chatServers.has(id)) {
      await chatServers.get(id)!.stop().catch(() => {});
      chatServers.delete(id);
    }

    const url = `http://127.0.0.1:${port}`;
    const commandLabel = opts.command?.trim() || "static-workspace-server";

    if (!opts.command || opts.command.trim() === "static") {
      const mimeMap: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
      };

      const info: ManagedServerInfo = {
        id,
        command: commandLabel,
        port,
        url,
        status: "starting",
        stdout: "",
        stderr: "",
        exitCode: null,
        startedAt: Date.now(),
      };

      const httpServer = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", url);
          let relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, "");
          if (relPath === "favicon.ico") {
            const { absPath: favAbs } = resolveSafeWorkspacePath(this.workspaceDir, "favicon.ico");
            if (!fs.existsSync(favAbs)) {
              res.writeHead(204);
              res.end();
              return;
            }
          }
          const files = await this.listFiles();
          const hasReactOrTsEntry = files.some(
            (f) => /\.(tsx|jsx)$/i.test(f.path) && !/\.(test|spec)\./i.test(f.path),
          );

          if (!relPath || relPath.endsWith("/") || (relPath === "index.html" && hasReactOrTsEntry)) {
            const indexCandidate = relPath && relPath !== "index.html" ? `${relPath}index.html` : "index.html";
            const { absPath: idxAbs } = resolveSafeWorkspacePath(this.workspaceDir, indexCandidate);
            const idxExists = fs.existsSync(idxAbs);
            const idxContent = idxExists ? await fsp.readFile(idxAbs, "utf8").catch(() => "") : "";
            const referencesTsx = /\.(tsx|ts|jsx)\b/i.test(idxContent);

            if (hasReactOrTsEntry && (!idxExists || referencesTsx)) {
              const bundled = await this.bundleFrontendApp();
              if (bundled.html) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(bundled.html);
                info.stdout = (info.stdout + `GET / (bundled ${bundled.entryPath}) -> 200\n`).slice(-8192);
                return;
              }
            }

            if (idxExists) {
              relPath = indexCandidate;
            } else if (hasReactOrTsEntry) {
              const bundled = await this.bundleFrontendApp();
              if (bundled.html) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(bundled.html);
                info.stdout = (info.stdout + `GET / (bundled ${bundled.entryPath}) -> 200\n`).slice(-8192);
                return;
              }
            } else {
              const firstHtml = files.find((f) => /\.html?$/i.test(f.path));
              relPath = firstHtml ? firstHtml.path : "index.html";
            }
          }
          const { absPath } = resolveSafeWorkspacePath(this.workspaceDir, relPath);
          const data = await fsp.readFile(absPath);
          const ext = path.extname(absPath).toLowerCase();
          res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
          res.end(data);
          info.stdout = (info.stdout + `GET /${relPath} -> 200\n`).slice(-8192);
        } catch (err) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          info.stderr = (info.stderr + `404 ${req.url}: ${err instanceof Error ? err.message : String(err)}\n`).slice(-8192);
        }
      });

      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, "127.0.0.1", () => resolve());
      });

      info.status = "running";
      info.stdout += `Static workspace server listening on ${url}\n`;

      const handle: ActiveServerHandle = {
        info,
        httpServer,
        stop: async () => {
          info.status = "stopped";
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
      };
      chatServers.set(id, handle);
      this.ledger.servers = [...this.ledger.servers.filter((s) => s.id !== id), info];
      this.ledger.updatedAt = Date.now();
      return info;
    }

    // Spawn a real custom Node.js / TypeScript server process
    let serverExecCmd = commandLabel;
    // Vite and Next do not read PORT consistently (Vite ignores it). Pass the
    // managed port through their actual CLI so readiness probes target this server.
    const scriptMatch = commandLabel.match(/^npm\s+(?:run\s+)?(dev|start|serve|preview)$/);
    if (scriptMatch) {
      try {
        const pkg = JSON.parse(await fsp.readFile(path.join(this.workspaceDir, "package.json"), "utf8"));
        const script = pkg.scripts?.[scriptMatch[1]];
        if (typeof script === "string" && /^vite(?:\s|$)/.test(script.trim())) serverExecCmd += ` -- --port ${port} --host 127.0.0.1 --strictPort`;
        else if (typeof script === "string" && /^next\s+(dev|start)(?:\s|$)/.test(script.trim())) serverExecCmd += ` -- --port ${port} --hostname 127.0.0.1`;
      } catch { /* Missing package metadata: use the caller's command and PORT. */ }
    }
    const srvTsMatch = commandLabel.match(/^node\s+(?:--experimental-strip-types\s+)?([^\s"']+\.(?:ts|tsx))(.*)$/i);
    if (srvTsMatch) {
      try {
        const compiledRel = await this.bundleNodeScript(srvTsMatch[1]);
        serverExecCmd = `node ${compiledRel}${srvTsMatch[2] || ""}`;
      } catch {
        /* fall back to original command */
      }
    }
    const isWin = process.platform === "win32";
    const childEnv = buildSanitizedChildEnv({ PORT: String(port), HOST: "127.0.0.1" });
    const proc = spawn(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", serverExecCmd] : ["-c", serverExecCmd], {
      cwd: this.workspaceDir,
      env: childEnv,
      windowsHide: true,
      detached: !isWin,
    });

    const info: ManagedServerInfo = {
      id,
      command: commandLabel,
      port,
      url,
      status: "starting",
      pid: proc.pid,
      stdout: "",
      stderr: "",
      exitCode: null,
      startedAt: Date.now(),
    };

    proc.once("error", (error) => {
      info.status = "crashed";
      info.stderr = redactSecrets(error.message);
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      info.stdout = (info.stdout + redactSecrets(chunk.toString("utf8"))).slice(-16_384);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      info.stderr = (info.stderr + redactSecrets(chunk.toString("utf8"))).slice(-16_384);
    });
    proc.once("close", (code) => {
      info.exitCode = code;
      if (info.status !== "stopped") {
        info.status = "crashed";
      }
    });

    const ready = await waitForPortReady(port, "127.0.0.1", opts.timeoutMs ?? 8_000);
    if (ready && info.status !== "crashed") {
      info.status = "running";
      this.ledger.codeExecuted = true;
    } else if (info.status !== "stopped") {
      info.status = "crashed";
      await stopProcessTree(proc);
    }

    const handle: ActiveServerHandle = {
      info,
      proc,
      stop: async () => {
        info.status = "stopped";
        await stopProcessTree(proc);
      },
    };
    chatServers.set(id, handle);
    this.ledger.servers = [...this.ledger.servers.filter((s) => s.id !== id), info];
    this.ledger.updatedAt = Date.now();
    return info;
  }

  async stopAllServers(): Promise<void> {
    const chatKey = sanitizeWorkspaceId(this.chatId);
    const chatServers = activeServers.get(chatKey);
    if (!chatServers) return;
    for (const handle of chatServers.values()) {
      await handle.stop().catch(() => {});
    }
    chatServers.clear();
  }

  /**
   * Opens a live URL (such as a running localhost server) in real Playwright Chromium,
   * interacts with elements, captures screenshots, and inspects DOM, accessibility,
   * browser console errors, uncaught page exceptions, failed network requests, and layout defects.
   */
  async inspectWebsiteWithBrowser(opts: {
    url: string;
    interactions?: { action: "click" | "type" | "viewport"; selector?: string; text?: string; width?: number; height?: number }[];
    expectedText?: string[];
    requireMediaPlayback?: boolean;
  }): Promise<BrowserInspectionRecord> {
    const id = `insp_${Date.now()}_${this.ledger.browserInspections.length + 1}`;
    const consoleMessages: { type: string; text: string }[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: { url: string; reason: string; status?: number }[] = [];
    const interactions: BrowserInteractionCheck[] = [];

    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    page.on("console", (msg) => {
      const type = msg.type();
      const text = redactSecrets(msg.text());
      consoleMessages.push({ type, text });
      if (type === "error") consoleErrors.push(text);
    });

    page.on("pageerror", (err) => {
      pageErrors.push(redactSecrets(err.message || String(err)));
    });

    page.on("requestfailed", (req) => {
      const reason = req.failure()?.errorText || "Request failed";
      const reqUrl = req.url();
      const resType = req.resourceType();
      // Ignore normal browser stream/request cancellations (ERR_ABORTED) and favicons/media preloads
      if (
        reason.includes("ERR_ABORTED") ||
        reqUrl.endsWith("/favicon.ico") ||
        resType === "media"
      ) {
        return;
      }
      failedRequests.push({
        url: reqUrl,
        reason,
      });
    });

    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().endsWith("/favicon.ico")) {
        failedRequests.push({
          url: res.url(),
          reason: `HTTP ${res.status()}`,
          status: res.status(),
        });
      }
    });

    let httpStatus: number | null = null;
    try {
      const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      httpStatus = response?.status() ?? null;
      await page.waitForTimeout(350);

      // Check for bot / human verification walls honestly (never bypass)
      const challenge = await detectPageBotChallenge(page).catch(() => null);
      if (challenge) {
        const shot = await page.screenshot({ type: "jpeg", quality: 75 }).catch(() => null);
        const rec: BrowserInspectionRecord = {
          id,
          url: page.url(),
          httpStatus,
          title: await page.title().catch(() => ""),
          consoleMessages,
          consoleErrors,
          pageErrors,
          failedRequests,
          brokenImages: [],
          layoutIssues: [],
          elementsCount: 0,
          a11ySummary: "",
          visibleTextExcerpt: "",
          interactions,
          challengeDetected: {
            provider: challenge.provider,
            host: challenge.host,
            summary: challenge.summary,
          },
          screenshotBase64: shot ? shot.toString("base64") : undefined,
          passed: false,
          timestamp: Date.now(),
        };
        this.ledger.browserInspections.push(rec);
        await this.persistBrowserEvidence();
        this.ledger.updatedAt = Date.now();
        return rec;
      }

      // Perform any requested interactions (click buttons, fill inputs, test responsive viewports)
      if (opts.interactions && opts.interactions.length > 0) {
        for (const act of opts.interactions) {
          try {
            if (act.action === "viewport" && act.width && act.height) {
              await page.setViewportSize({ width: act.width, height: act.height });
              await page.waitForTimeout(150);
              interactions.push({
                action: "viewport",
                target: `${act.width}x${act.height}`,
                ok: true,
                detail: `Resized viewport to ${act.width}x${act.height}`,
              });
            } else if (act.action === "click" && act.selector) {
              const loc = page.locator(act.selector).first();
              await loc.click({ timeout: 4_000 });
              await page.waitForTimeout(200);
              interactions.push({
                action: "click",
                target: act.selector,
                ok: true,
                detail: `Clicked ${act.selector}`,
              });
            } else if (act.action === "type" && act.selector && act.text !== undefined) {
              const loc = page.locator(act.selector).first();
              await loc.fill(act.text, { timeout: 4_000 });
              await page.waitForTimeout(150);
              interactions.push({
                action: "type",
                target: act.selector,
                value: act.text,
                ok: true,
                detail: `Entered "${act.text}" into ${act.selector}`,
              });
            }
          } catch (err) {
            interactions.push({
              action: act.action,
              target: act.selector || "viewport",
              value: act.text,
              ok: false,
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else {
        // Automatic playability probe: find up to 2 safe interactive buttons and verify they respond without errors
        try {
          const btnLoc = page.locator("button:not([disabled])");
          const count = await btnLoc.count();
          const maxProbes = Math.min(count, opts.requireMediaPlayback ? 1 : 2);
          for (let i = 0; i < maxProbes; i++) {
            const btn = btnLoc.nth(i);
            const isVis = await btn.isVisible().catch(() => false);
            if (!isVis) continue;
            const label = ((await btn.innerText().catch(() => "")) || (await btn.getAttribute("aria-label").catch(() => "")) || `button #${i + 1}`)
              .trim()
              .slice(0, 40);
            if (/delete|remove|reset|clear|logout|sign\s*out/i.test(label)) continue;
            await btn.click({ timeout: 2_500 });
            await page.waitForTimeout(150);
            interactions.push({
              action: "click",
              target: `button ("${label || i + 1}")`,
              ok: true,
              detail: `Clicked "${label || i + 1}"; outcome requires separate assertions.`,
            });
          }
        } catch {
          /* ignore non-fatal auto-probe error */
        }
      }

      if (opts.requireMediaPlayback) {
        // A provider's own Play button may be inside a cross-origin iframe.
        // Use a real user gesture; never bypass autoplay policy or synthesize state.
        for (const frame of page.frames()) {
          let providerFrame = false;
          try { const url = new URL(frame.url()); providerFrame = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(url.hostname) && url.pathname.startsWith("/embed/"); } catch { /* Non-URL frame. */ }
          if (!providerFrame) continue;
          const alreadyPlaying = await frame.locator("video").evaluateAll((nodes) => nodes.some((node) => !(node as HTMLVideoElement).paused)).catch(() => false);
          if (alreadyPlaying) continue;
          const play = frame.locator(".ytp-large-play-button, .ytp-play-button[title^='Play']").first();
          if (await play.isVisible().catch(() => false)) {
            try {
              await play.click({ timeout: 3000 });
              interactions.push({ action: "click", target: "YouTube embedded Play control", ok: true, detail: "Clicked the provider's native control; media progression is checked separately." });
              await page.waitForTimeout(1500);
            } catch (error) { interactions.push({ action: "click", target: "YouTube embedded Play control", ok: false, detail: error instanceof Error ? error.message : String(error) }); }
          }
        }
      }

      // Inspect DOM, broken images, and layout issues
      const [dom, a11yNodes, health] = await Promise.all([
        observeDom(page).catch(() => ({ elements: [], images: [], text: "", atBottom: true })),
        observeAccessibilitySnapshot(page, 60).catch(() => []),
        page
          .evaluate(() => {
            const brokenImages: string[] = [];
            for (const img of Array.from(document.querySelectorAll("img"))) {
              const src = img.getAttribute("src") || "";
              if (!src || (img.complete && img.naturalWidth === 0)) {
                brokenImages.push(src || "(empty img src)");
              }
            }
            const layoutIssues: string[] = [];
            const docW = document.documentElement.scrollWidth;
            const winW = window.innerWidth;
            if (docW > winW + 48) {
              layoutIssues.push(`Horizontal overflow detected (scrollWidth ${docW}px > viewport ${winW}px)`);
            }
            const rootEl = document.getElementById("root");
            const bodyText = (document.body?.innerText || "").trim();
            if (rootEl && rootEl.children.length === 0 && !bodyText) {
              layoutIssues.push("React #root container rendered empty (0 child elements)");
            } else if (!bodyText && document.querySelectorAll("svg, canvas, img").length === 0) {
              layoutIssues.push("Rendered body has no visible text or graphics");
            }
            return { brokenImages, layoutIssues, bodyText: bodyText.slice(0, 2000), title: document.title || "" };
          })
          .catch((): { brokenImages: string[]; layoutIssues: string[]; bodyText: string; title: string } => ({
            brokenImages: [],
            layoutIssues: [],
            bodyText: "",
            title: "",
          })),
      ]);

      const expectedMissing = (opts.expectedText || []).filter(
        (needle) => !health.bodyText.toLowerCase().includes(needle.toLowerCase()),
      );
      if (expectedMissing.length > 0) {
        health.layoutIssues.push(`Missing expected rendered text: ${expectedMissing.join(", ")}`);
      }

      const mediaPlayback = opts.requireMediaPlayback ? await inspectMediaPlayback(page) : undefined;
      if (opts.requireMediaPlayback && !mediaPlayback?.some((media) => media.verified)) health.layoutIssues.push("Requested audio/video playback was not verified: no unmuted media advanced after interaction.");
      const shot = await page.screenshot({ type: "jpeg", quality: 78 }).catch(() => null);
      const passed =
        (httpStatus === null || (httpStatus >= 200 && httpStatus < 400)) &&
        consoleErrors.length === 0 &&
        pageErrors.length === 0 &&
        failedRequests.length === 0 &&
        health.brokenImages.length === 0 &&
        health.layoutIssues.length === 0 &&
        interactions.every((i) => i.ok);

      const rec: BrowserInspectionRecord = {
        mediaPlayback,
        id,
        url: page.url(),
        httpStatus,
        title: health.title,
        consoleMessages,
        consoleErrors,
        pageErrors,
        failedRequests,
        brokenImages: health.brokenImages,
        layoutIssues: health.layoutIssues,
        elementsCount: dom.elements.length,
        a11ySummary: a11yNodes
          .slice(0, 15)
          .map((n) => `${n.role}${n.name ? ` "${n.name}"` : ""}`)
          .join(", "),
        visibleTextExcerpt: health.bodyText.slice(0, 600),
        interactions,
        challengeDetected: null,
        screenshotBase64: shot ? shot.toString("base64") : undefined,
        passed,
        timestamp: Date.now(),
      };
      this.ledger.browserInspections.push(rec);
      await this.persistBrowserEvidence();
      this.ledger.updatedAt = Date.now();
      return rec;
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Probes DNS resolution, HTTP connectivity, and public egress IP / static egress configuration.
   */
  async probeNetwork(targetUrl = "https://api.ipify.org?format=json"): Promise<NetworkDiagnostics> {
    const start = Date.now();
    const staticIp = process.env.SENKO_STATIC_EGRESS_IP?.trim() || null;
    let dnsResolved = false;
    let resolvedAddresses: string[] = [];
    let httpReachable = false;
    let httpStatus: number | null = null;
    let publicEgressIp: string | null = null;
    let error: string | undefined;

    try {
      const host = new URL(targetUrl).hostname;
      if (host === "127.0.0.1" || host === "localhost") {
        dnsResolved = true;
        resolvedAddresses = ["127.0.0.1"];
      } else {
        const res = await dns.lookup(host, { all: true });
        resolvedAddresses = res.map((r) => r.address);
        dnsResolved = resolvedAddresses.length > 0;
      }

      const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(6_000) });
      httpStatus = resp.status;
      httpReachable = resp.ok;
      if (targetUrl.includes("ipify")) {
        const data = (await resp.json().catch(() => null)) as { ip?: string } | null;
        publicEgressIp = data?.ip || null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    return {
      online: dnsResolved && httpReachable,
      dnsResolved,
      resolvedAddresses,
      httpReachable,
      httpStatus,
      latencyMs: Math.max(1, Date.now() - start),
      publicEgressIp,
      staticEgressConfigured: Boolean(staticIp),
      staticEgressIp: staticIp,
      error,
    };
  }
}

/**
 * Authenticity Guard: Inspects an AI response and compares any test/execution claims against
 * the actual `VerificationLedger`. Prevents false claims of passing tests when tests were not
 * run or failed.
 */
export function verifyAndSanitizeCodingClaims(
  replyText: string,
  ledger: VerificationLedger,
): { sanitizedText: string; fabricatedClaimDetected: boolean; summaryMarkdown: string } {
  const claimsTestsPassed =
    /\b(all\s+tests?\s+pass(?:ed)?|tests?\s+succeeded|0\s+failures|everything\s+passed)\b/i.test(replyText);
  const fabricatedClaimDetected = claimsTestsPassed && ledger.testStatus !== "passed";

  let cleaned = replyText;
  if (fabricatedClaimDetected) {
    cleaned = cleaned.replace(
      /\b(all\s+tests?\s+pass(?:ed)?!?|tests?\s+succeeded!?)\b/gi,
      `[Verification note: test status is "${ledger.testStatus}"]`,
    );
  }

  const filesList = Object.keys(ledger.files);
  const lastTest = ledger.testRuns[ledger.testRuns.length - 1];
  const lastBrowser = ledger.browserInspections[ledger.browserInspections.length - 1];

  const lines: string[] = [
    "### Verification & Execution Report",
    `- **Files in workspace (${filesList.length})**: ${filesList.length ? filesList.map((f) => `\`${f}\``).join(", ") : "none"}`,
    `- **Code executed**: ${ledger.codeExecuted ? "yes" : "no"} (${ledger.commands.length} command${ledger.commands.length === 1 ? "" : "s"} run)`,
    `- **Test status**: **${ledger.testStatus.toUpperCase()}**`,
  ];

  if (lastTest) {
    lines.push(
      `- **Test command**: \`${lastTest.command}\` → exit code \`${lastTest.exitCode}\` (${lastTest.passedCount} passed, ${lastTest.failedCount} failed, ${lastTest.durationMs}ms)`,
    );
  }
  if (ledger.repairAttempts.length > 0) {
    lines.push(
      `- **Autonomous repairs**: ${ledger.repairAttempts.length} debugging cycle${ledger.repairAttempts.length === 1 ? "" : "s"} (${ledger.repairAttempts.filter((r) => r.resolved).length} resolved)`,
    );
  }
  if (lastBrowser) {
    lines.push(
      `- **Browser verification**: \`${lastBrowser.url}\` → ${lastBrowser.passed ? "PASSED" : "ISSUES DETECTED"} (HTTP ${lastBrowser.httpStatus ?? "n/a"}, ${lastBrowser.consoleErrors.length} console errors, ${lastBrowser.pageErrors.length} page exceptions, ${lastBrowser.failedRequests.length} failed requests)`,
    );
  }

  const summaryMarkdown = lines.join("\n");
  return {
    sanitizedText: fabricatedClaimDetected ? `${cleaned}\n\n${summaryMarkdown}` : cleaned,
    fabricatedClaimDetected,
    summaryMarkdown,
  };
}
