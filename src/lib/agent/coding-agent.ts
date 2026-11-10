// Autonomous 8-Step Node.js & Web Development Agent with Bounded Failure-Recovery Loop.
//
// Executes the complete software engineering lifecycle inside a real Node.js workspace:
//   1. Understand -> 2. Implement -> 3. Install -> 4. Execute ->
//   5. Test -> 6. Inspect (Playwright) -> 7. Repair -> 8. Verify

import fs from "node:fs";
import path from "node:path";
import { extractCodeArtifacts } from "@/components/assistant/workspace-artifacts";
import { artifactPath } from "@/components/assistant/workspace-files";
import { selectProjectContext } from "@/lib/code-job";
import { runCodingToolLoop, type CodingOperationEvent, type CodingTaskJournal } from "./coding-loop";
import { codingRequirements } from "./coding-playbooks";
import { complete, type LlmMessage } from "@/lib/llm";
import { InferenceRequestBudget } from "@/lib/llm/request-budget";
import {
  CodingWorkspaceRuntime,
  verifyAndSanitizeCodingClaims,
  type BrowserInspectionRecord,
  type CommandExecutionRecord,
  type RepairAttemptRecord,
  type VerificationLedger,
} from "./coding-runtime";

export interface WorkspaceFileOperation {
  action: "Analyzed" | "Created" | "Edited" | "Deleted";
  path: string;
  langBadge: string;
  linesRange?: string;
  added?: number;
  removed?: number;
}

export interface CodingAgentStepEvent {
  id: number;
  stage: "understand" | "implement" | "install" | "execute" | "test" | "inspect" | "repair" | "verify" | "research";
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  url?: string;
  fileOps?: WorkspaceFileOperation[];
}

/** Honest command summary: cwd, exit code, duration and the tail of real output. */
function commandDetail(rec: { exitCode: number | null; timedOut?: boolean; durationMs?: number; stdout?: string; stderr?: string }): string {
  const tail = (text: string | undefined) => (text || "").trim().slice(-1500);
  const out = [tail(rec.stdout), tail(rec.stderr)].filter(Boolean).join("\n");
  return ["cwd: .", `exit ${rec.exitCode ?? "null"}${rec.timedOut ? " (timed out)" : ""}${rec.durationMs !== undefined ? ` (${rec.durationMs}ms)` : ""}`, out].filter(Boolean).join("\n");
}

function fileLangBadge(filePath: string): string {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  if (ext === "tsx") return "TSX";
  if (ext === "ts") return "TS";
  if (ext === "jsx") return "JSX";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "JS";
  if (ext === "json") return "{}";
  if (ext === "css") return "CSS";
  if (ext === "html" || ext === "htm") return "HTML";
  return ext.toUpperCase() || "FILE";
}

export interface CodingWorkflowOptions {
  chatId: string;
  goal: string;
  /** Overarching product goal for this workspace so live edits/fixes never forget what is being built. */
  primaryGoal?: string;
  assistantDraft?: string;
  /** When true, instructs the LLM to live-edit or create workspace files for `goal` even if files already exist. */
  applyLiveInstruction?: boolean;
  provider?: string;
  baseDir?: string;
  maxRepairAttempts?: number;
  maxInferenceRequests?: number;
  inspectBrowser?: boolean;
  interactions?: { action: "click" | "type" | "viewport"; selector?: string; text?: string; width?: number; height?: number }[];
  expectedText?: string[];
  signal?: AbortSignal;
  onStep?: (step: CodingAgentStepEvent) => void;
  /** Optional custom repair function for deterministic testing or specialized repair hooks. */
  customRepair?: (ctx: {
    attempt: number;
    stage: "execute" | "test" | "browser";
    errorOutput: string;
    files: { path: string; code: string }[];
    runtime: CodingWorkspaceRuntime;
  }) => Promise<{ probableCause: string; modifiedFiles: string[] } | null>;
}

export interface CodingWorkflowResult {
  verified: boolean;
  ledger: VerificationLedger;
  filesCreatedOrModified: string[];
  commandsRun: CommandExecutionRecord[];
  testPassed: boolean;
  browserInspection: BrowserInspectionRecord | null;
  repairs: RepairAttemptRecord[];
  verificationReportMarkdown: string;
  sanitizedReply: string;
}

/**
 * Determines whether a user prompt is asking the agent to build, run, test, or debug
 * an executable Node.js project or web application using real backend verification.
 */
export function isExecutableCodingRequest(prompt: string): boolean {
  const q = prompt.trim().toLowerCase();
  if (
    /\b(run\s+tests?|write\s+tests?|unit\s+tests?|npm\s+test|node\s+test|execute\s+the\s+code|verify\s+it\s+works|debug\s+and\s+fix)\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(node\.?js|express|http\s+server|cli\s+tool|package\.json)\b/.test(q) && /\b(make|build|create|implement|write|code|develop|app|application|project|playlist|server|api)\b/.test(q)) {
    return true;
  }
  return false;
}

/**
 * Extracts explicit filename comments or fenced code blocks from an AI reply and writes them
 * into the real workspace on disk.
 */
export async function materializeReplyFilesToWorkspace(
  runtime: CodingWorkspaceRuntime,
  messageId: string,
  replyContent: string,
): Promise<string[]> {
  const artifacts = extractCodeArtifacts([{ id: messageId, role: "assistant", content: replyContent }]);
  const written: string[] = [];

  // Also check for explicit markdown headings or bullet filenames right before code fences
  const fenceWithHeaderRe =
    /(?:(?:^|\n)(?:#+\s*|[-*]\s*|\*\*|`)([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?:\*\*|`)?\s*:?\s*\n)?```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const explicitPaths: (string | undefined)[] = [];
  while ((match = fenceWithHeaderRe.exec(replyContent)) !== null) {
    const lang = (match[2] || "").trim().toLowerCase();
    if (lang === "ui" || lang === "senko-ui" || lang === "widget") continue;
    const code = (match[3] || "").replace(/\n$/, "");
    if (code.trim().length < 16) continue;
    explicitPaths.push(match[1]?.trim());
  }

  for (let i = 0; i < artifacts.length; i++) {
    const art = artifacts[i];
    const headerPath = explicitPaths[i];
    const relPath = headerPath || artifactPath(art);
    if (!relPath) continue;
    // Strip redundant first-line path comment if it was only a marker
    await runtime.writeFile(relPath, art.code);
    written.push(relPath);
  }

  return written;
}

/**
 * Determines which test command to run based on workspace files and `package.json`.
 */
export async function detectWorkspaceTestCommand(runtime: CodingWorkspaceRuntime): Promise<string | null> {
  const files = await runtime.listFiles();
  const testFiles = files.filter((f) => /(^|\/)(test|tests|[\w.-]+\.(test|spec))\.(m?js|cjs|ts|tsx)$/i.test(f.path));
  const pkgFile = files.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.code) as { scripts?: Record<string, string> };
      const script = pkg.scripts?.test?.trim();
      if (script && !script.includes("no test specified")) {
        // Preserve runner/configuration and all test files. Only normalize direct Node tests
        // so the runtime can transpile TypeScript without replacing Vitest/Jest with Node.
        return /^node\s+--test\s+[^;&|]+$/.test(script) ? script : "npm test";
      }
    } catch { /* Invalid package JSON is reported by execution, not invented as a pass. */ }
  }
  const nodeTests = testFiles.filter((f) => /\bnode:test\b/.test(f.code));
  if (nodeTests.length) return `node --test ${nodeTests.map((f) => f.path).join(" ")}`;
  if (testFiles.length === 1) return `node ${testFiles[0].path}`;
  return null;
}

/**
 * Determines if the workspace has a runnable Node.js/TypeScript entry script, React/TSX app, or HTTP server.
 */
export async function detectWorkspaceEntryCommand(
  runtime: CodingWorkspaceRuntime,
): Promise<{ kind: "server" | "script" | "static-web" | "none"; command?: string; htmlEntry?: string }> {
  const files = await runtime.listFiles();
  const tsxOrReactFile = files.find((f) => /\.(tsx|jsx)$/i.test(f.path) && !/\.(test|spec)\./i.test(f.path));
  const serverFile = files.find(
    (f) =>
      /(^|\/)(server|app|index)\.(m?js|cjs|ts)$/i.test(f.path) &&
      /\b(createServer|app\.listen|server\.listen|express\s*\()\b/.test(f.code),
  );

  // If the workspace has a React/TSX frontend, serve it via the built-in esbuild static-web server
  // unless the custom server explicitly serves index.html on `/`.
  if (tsxOrReactFile && (!serverFile || !/index\.html/i.test(serverFile.code))) {
    return { kind: "static-web", htmlEntry: "index.html" };
  }

  if (serverFile) {
    const isTs = /\.ts$/i.test(serverFile.path);
    return { kind: "server", command: `node ${isTs ? "--experimental-strip-types " : ""}${serverFile.path}` };
  }

  if (tsxOrReactFile) {
    return { kind: "static-web", htmlEntry: "index.html" };
  }

  const htmlFile = files.find((f) => /\.html?$/i.test(f.path));
  if (htmlFile) {
    return { kind: "static-web", htmlEntry: htmlFile.path };
  }

  const scriptFile = files.find(
    (f) =>
      /\.(m?js|cjs|ts)$/i.test(f.path) &&
      !/test|spec|\.d\.ts$/i.test(f.path) &&
      f.path !== "package.json",
  );
  if (scriptFile) {
    const isTs = /\.ts$/i.test(scriptFile.path);
    return { kind: "script", command: `node ${isTs ? "--experimental-strip-types " : ""}${scriptFile.path}` };
  }

  return { kind: "none" };
}

/**
 * Uses the configured LLM to synthesize or live-edit a full-stack TypeScript / React / Node.js project
 * when `runAutonomousCodingWorkflow` is invoked with a `goal` (from the Workspace Agent or `[[code: ...]]`).
 */
async function llmGenerateWorkspaceFiles(opts: {
  requestBudget: InferenceRequestBudget;
  goal: string;
  primaryGoal?: string;
  existingFiles: { path: string; code: string }[];
  recentErrors?: string;
  provider?: string;
  signal?: AbortSignal;
  runtime: CodingWorkspaceRuntime;
  onProgress?: (task: CodingTaskJournal) => void;
  onOperation?: (event: CodingOperationEvent) => void;
}): Promise<{ summary: string; files: { path: string; code: string }[]; complete: boolean }> {
  const result = await runCodingToolLoop({
    runtime: opts.runtime, goal: opts.goal, primaryGoal: opts.primaryGoal,
    provider: opts.provider, signal: opts.signal,
    requestBudget: opts.requestBudget,
    onProgress: opts.onProgress,
    onOperation: opts.onOperation,
  });
  return { summary: result.summary, files: result.changedFiles, complete: result.task.status === "verified" };
}

/**
 * Uses the configured LLM to diagnose a real execution/test/browser error and produce updated file contents.
 */
async function llmRepairWorkspaceFiles(opts: {
  requestBudget: InferenceRequestBudget;
  goal: string;
  primaryGoal?: string;
  stage: "execute" | "test" | "browser";
  errorOutput: string;
  files: { path: string; code: string }[];
  provider?: string;
  signal?: AbortSignal;
}): Promise<{ probableCause: string; patches: { path: string; code: string }[]; failure?: string }> {
  const fail = (failure: string) => ({ probableCause: "", patches: [] as { path: string; code: string }[], failure });
  const selected = selectProjectContext(opts.files.map((f) => ({ path: f.path, content: f.code })), `${opts.goal} ${opts.errorOutput}`);
  const filesContext = selected.files.map((f) => `=== FILE: ${f.path} ===\n${f.content}`).join("\n\n") +
    (selected.omitted.length ? `\nOmitted files (request a focused follow-up if needed): ${selected.omitted.join(", ")}` : "");

  const systemPrompt = `You are an autonomous Node.js & Web debugging engineer.
A real execution, bundle, test, or browser check failed in the workspace.
Inspect the error output, the overarching workspace product goal, and the current workspace files, identify the root cause, and output your fix.

You may output EITHER:
1. A brief 1-sentence root-cause explanation followed by complete corrected files in fenced code blocks with the exact file path on the first line (preferred for TypeScript/TSX/React files):
\`\`\`tsx
// src/App.tsx
...complete corrected file...
\`\`\`
OR
2. Raw JSON:
{
  "probableCause": "concise 1-sentence root cause explanation",
  "patches": [
    { "path": "relative/path.ts", "code": "complete corrected file content" }
  ]
}

Rules:
- If the error says \`Could not resolve "./..."\` or \`Cannot find module\`, the imported workspace file is missing: create it with a real implementation that satisfies the test (a \`.js\` import specifier may be backed by a \`.ts\` file).
- Never fake test results or delete assertions to make tests pass. Install required dependencies or report unsupported runtimes honestly; preserve the behavior being tested.
- For Node.js tests in TypeScript, use \`import { test } from "node:test"; import assert from "node:assert/strict";\` and import server functions directly instead of spawning external \`tsx\` CLI processes.
- Preserve the requested domain and existing architecture; never invent API records, URLs, or fallback data.`;

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Primary Workspace Goal: ${opts.primaryGoal || opts.goal}\nCurrent Task: ${opts.goal}\nFailed stage: ${opts.stage}\n\nError output:\n${opts.errorOutput.slice(0, 4000)}\n\nCurrent workspace files:\n${filesContext}`,
    },
  ];

  try {
    const res = await complete(messages, {
      provider: opts.provider,
      requestBudget: opts.requestBudget,
      hedge: false,
      maxTokens: 6000,
      temperature: 0.15,
      signal: opts.signal,
    });
    const raw = res.text.trim();

    // First check if the model returned fenced code blocks
    const artifacts = extractCodeArtifacts([{ id: `rep_${Date.now()}`, role: "assistant", content: raw }]);
    const fencePatches = artifacts
      .map((a) => ({ path: artifactPath(a), code: a.code }))
      .filter((f) => Boolean(f.path) && !/^snippet-\d+/i.test(f.path) && !/^(tsx|ts|jsx|js|sh|bash|json|txt)$/i.test(f.path));

    if (fencePatches.length > 0) {
      const firstFenceIdx = raw.indexOf("```");
      const cause = (firstFenceIdx > 0 ? raw.slice(0, firstFenceIdx) : "")
        .replace(/^[#*\-\s]+/, "")
        .trim()
        .split("\n")[0]
        ?.slice(0, 220);
      return {
        probableCause: cause || `Patched ${fencePatches.map((p) => p.path).join(", ")} to resolve ${opts.stage} error.`,
        patches: fencePatches,
      };
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fail(`Repair model replied without file patches: "${raw.slice(0, 160)}"`);
    const parsed = JSON.parse(jsonMatch[0]) as {
      probableCause?: string;
      patches?: { path?: string; code?: string }[];
    };
    const patches = (parsed.patches || []).filter(
      (p): p is { path: string; code: string } =>
        typeof p.path === "string" &&
        typeof p.code === "string" &&
        !/^snippet-\d+/i.test(p.path) &&
        !/^(tsx|ts|jsx|js|sh|bash|json|txt)$/i.test(p.path),
    );
    if (!patches.length) return fail("Repair model returned JSON with no usable file patches.");
    return {
      probableCause: parsed.probableCause || "Fixed implementation defect identified from error output.",
      patches,
    };
  } catch (e) {
    return fail(`Repair model call failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Executes the full 8-step autonomous coding workflow on a chat's `CodingWorkspaceRuntime`.
 */
let repairSeq = 0;
/** Stable unique id for a repair record; attempt numbers alone repeat across workflow runs. */
function nextRepairId(): string {
  repairSeq = (repairSeq + 1) % 1_000_000;
  return `rep_${Date.now().toString(36)}_${repairSeq.toString(36)}`;
}

export async function runAutonomousCodingWorkflow(opts: CodingWorkflowOptions): Promise<CodingWorkflowResult> {
  const requestBudget = new InferenceRequestBudget(opts.maxInferenceRequests ?? 24);
  const runtime = new CodingWorkspaceRuntime(opts.chatId, opts.baseDir);
  await runtime.ensureWorkspace();
  opts.signal?.throwIfAborted();
  runtime.ledger.testStatus = "not_run";
  let implementationComplete = true;
  const primaryGoal = await runtime.syncPrimaryGoal(opts.primaryGoal || opts.goal);

  let stepCounter = 0;
  const emitStep = (
    stage: CodingAgentStepEvent["stage"],
    label: string,
    status: CodingAgentStepEvent["status"],
    detail?: string,
    url?: string,
    fileOps?: WorkspaceFileOperation[],
  ): number => {
    const id = ++stepCounter;
    opts.onStep?.({ id, stage, label, status, detail, url, fileOps });
    return id;
  };
  const updateStep = (
    id: number,
    stage: CodingAgentStepEvent["stage"],
    label: string,
    status: CodingAgentStepEvent["status"],
    detail?: string,
    url?: string,
    fileOps?: WorkspaceFileOperation[],
  ) => {
    opts.onStep?.({ id, stage, label, status, detail, url, fileOps });
  };

  // Maps real tool-loop operations onto streamed activity steps (one step per operation).
  const operationSteps = new Map<number, number>();
  const reportOperation = (event: CodingOperationEvent) => {
    const { op } = event;
    const stage: CodingAgentStepEvent["stage"] =
      op.op === "run" ? "execute" : op.op === "search" || op.op === "fetch" || op.op === "youtube" ? "research" : op.op === "inspect" ? "inspect" : op.op === "read" ? "understand" : "implement";
    const label =
      op.op === "run" ? `$ ${op.cmd}` : op.op === "search" ? `search: ${op.query}` : op.op === "youtube" ? `youtube search: ${op.query}` : op.op === "fetch" ? `fetch ${op.url}` :
      op.op === "inspect" ? `browser inspection${op.url ? ` ${op.url}` : ""}` : `${op.op} ${op.path}`;
    const detail = [event.detail, ...(event.sources?.map((s) => `source: ${s.title ? `${s.title} ` : ""}${s.url}`) || [])].filter(Boolean).join("\n") || undefined;
    const fileOps: WorkspaceFileOperation[] | undefined = op.op === "write" || op.op === "edit" || op.op === "delete"
      ? [{ action: op.op === "write" ? "Created" : op.op === "edit" ? "Edited" : "Deleted", path: op.path, langBadge: fileLangBadge(op.path) }]
      : undefined;
    const existing = operationSteps.get(event.id);
    if (existing === undefined) operationSteps.set(event.id, emitStep(stage, label, event.status, detail, op.op === "fetch" ? op.url : undefined, fileOps));
    else updateStep(existing, stage, label, event.status, detail, op.op === "fetch" ? op.url : undefined, fileOps);
  };
  // ── Step 1: Understand the project ──────────────────────────────────────────
  const s1 = emitStep("understand", "Inspecting workspace & project structure", "running");
  const initialFiles = await runtime.listFiles();
  const analyzedOps: WorkspaceFileOperation[] = initialFiles.map((f) => ({
    action: "Analyzed",
    path: f.path,
    langBadge: fileLangBadge(f.path),
    linesRange: `#L1-${Math.max(1, f.code.split("\n").length)}`,
  }));
  updateStep(
    s1,
    "understand",
    "Inspecting workspace & project structure",
    "done",
    initialFiles.length ? `${initialFiles.length} existing file(s)` : "Clean workspace initialized",
    undefined,
    analyzedOps,
  );

  // ── Step 2: Implement (materialize files from AI draft or generate via LLM) ─
  if (opts.assistantDraft) {
    const s2 = emitStep("implement", "Writing project files to workspace", "running");
    const written = await materializeReplyFilesToWorkspace(runtime, `msg_${Date.now()}`, opts.assistantDraft);
    const draftOps: WorkspaceFileOperation[] = written.map((p) => {
      const latestDiff = [...runtime.ledger.diffs].reverse().find((d) => d.path === p);
      return {
        action: latestDiff?.status === "created" ? "Created" : "Edited",
        path: p,
        langBadge: fileLangBadge(p),
        added: latestDiff?.addedLines ?? 0,
        removed: latestDiff?.removedLines ?? 0,
      };
    });
    updateStep(
      s2,
      "implement",
      "Writing project files to workspace",
      "done",
      written.length ? `Wrote ${written.join(", ")}` : "Workspace files ready",
      undefined,
      draftOps,
    );
  }

  let currentFiles = await runtime.listFiles();
  let agentSummary = "";
  if ((currentFiles.length === 0 || opts.applyLiveInstruction) && opts.goal && !opts.assistantDraft) {
    const label = currentFiles.length > 0
      ? `Applying live workspace edits (${opts.goal.slice(0, 60)})`
      : "Synthesizing TypeScript / React / Node.js project files";
    const sGen = emitStep("implement", label, "running");
    const lastCmdErr = runtime.ledger.commands
      .filter((c) => c.exitCode !== 0)
      .slice(-2)
      .map((c) => `$ ${c.command}\n${c.stderr || c.stdout}`)
      .join("\n\n");
    // With no app source yet, a generic step like "write unit tests" would only produce a test
    // file importing modules that don't exist. Build the whole product from the main goal first.
    const hasSourceFiles = currentFiles.some(
      (f) => /\.(m?js|cjs|ts|tsx|jsx)$/i.test(f.path) && !/(^|\/)(test|tests)\/|\.(test|spec)\./i.test(f.path),
    );
    const genGoal =
      !hasSourceFiles && primaryGoal && primaryGoal !== opts.goal
        ? `${primaryGoal}\n\nThe workspace has no application source yet. Build the complete working project (all source files, index.html entry, package.json) AND its tests. Secondary task: ${opts.goal}`
        : opts.goal;
    const generated = await llmGenerateWorkspaceFiles({
      requestBudget,
      runtime,
      goal: genGoal,
      primaryGoal,
      existingFiles: currentFiles,
      recentErrors: lastCmdErr || undefined,
      provider: opts.provider,
      signal: opts.signal,
      onOperation: (event) => reportOperation(event),
      onProgress: (task) => updateStep(sGen, "implement", `Tool step ${task.step}: ${task.activity || task.status}`, task.status === "incomplete" ? "error" : task.status === "verified" ? "done" : "running", task.history.at(-1)?.slice(-1200)),
    });
    opts.signal?.throwIfAborted();
    implementationComplete = generated.complete;
    agentSummary = generated.summary;
    const writtenPaths: string[] = [];
    const implOps: WorkspaceFileOperation[] = [];
    for (const gf of generated.files) {
      const diff = await runtime.writeFile(gf.path, gf.code);
      writtenPaths.push(gf.path);
      implOps.push({
        action: diff.status === "created" ? "Created" : "Edited",
        path: gf.path,
        langBadge: fileLangBadge(gf.path),
        added: diff.addedLines,
        removed: diff.removedLines,
      });
    }
    updateStep(
      sGen,
      "implement",
      label,
      generated.complete ? "done" : "error",
      writtenPaths.length ? `Updated ${writtenPaths.join(", ")}` : generated.summary || "No files modified",
      undefined,
      implOps,
    );
    currentFiles = await runtime.listFiles();
  }

  // Ensure package.json exists if JS/TS/TSX files are present without one
  const hasCodeFiles = currentFiles.some((f) => /\.(m?js|cjs|ts|tsx|jsx)$/i.test(f.path));
  const hasPkgJson = currentFiles.some((f) => f.path === "package.json");
  if (hasCodeFiles && !hasPkgJson) {
    const testCandidate = currentFiles.find((f) => /(^|\/)(test|tests|[\w.-]+\.(test|spec))\.(m?js|cjs|ts|tsx)$/i.test(f.path));
    const isTsTest = testCandidate ? /\.(ts|tsx)$/i.test(testCandidate.path) : false;
    const usesEsm = currentFiles.some((f) => /\b(import\s+.*from|export\s+(default|function|class|const|interface|type))\b/.test(f.code));
    // Only synthesize scripts.test in package.json for plain JS tests; TypeScript tests run via `detectWorkspaceTestCommand` -> `runCommand` (esbuild)
    const pkgContent = JSON.stringify(
      {
        name: `senko-workspace-${opts.chatId.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "app"}`,
        version: "1.0.0",
        private: true,
        ...(usesEsm ? { type: "module" } : {}),
        ...(!isTsTest && testCandidate
          ? {
              scripts: {
                test: /\bnode:test\b/.test(testCandidate.code)
                  ? `node --test ${testCandidate.path}`
                  : `node ${testCandidate.path}`,
              },
            }
          : {}),
      },
      null,
      2,
    );
    await runtime.writeFile("package.json", pkgContent);
    currentFiles = await runtime.listFiles();
  }

  // ── Step 3: Install dependencies if package.json declares any ───────────────
  const pkgFile = currentFiles.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.code) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      // Check actual installations, including build/test tools. Never pretend a package exists.
      const hostNodeModules = path.join(process.cwd(), "node_modules");
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const missingDeps = deps.filter((d) =>
        !fs.existsSync(path.join(runtime.workspaceDir, "node_modules", d)) &&
        !fs.existsSync(path.join(hostNodeModules, d)));
      if (missingDeps.length > 0) {
        const s3 = emitStep("install", `Installing dependencies (${missingDeps.join(", ")})`, "running");
        const installRec = await runtime.runCommand(
          "npm install --no-audit --no-fund --prefer-offline",
          { timeoutMs: 45_000 },
        );
        updateStep(
          s3,
          "install",
          `Installing dependencies (${missingDeps.join(", ")})`,
          installRec.exitCode === 0 ? "done" : "error",
          commandDetail(installRec),
        );
      }
    } catch {
      /* ignore */
    }
  }

  const maxRepairs = opts.maxRepairAttempts ?? 3;
  let localRepairs = 0;
  const attemptedSignatures = new Set<string>();

  const attemptBoundedRepair = async (
    stage: "execute" | "test" | "browser",
    verificationCommand: string,
    errorOutput: string,
    issueSource?: "bundle" | "test" | "runtime" | "browser" | "layout" | "interaction",
  ): Promise<boolean> => {
    if (localRepairs >= maxRepairs) return false;
    const firstErrorLine =
      errorOutput
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /error|fail|assert|exception|referenceerror|typeerror|syntaxerror|empty|missing|overflow/i.test(l)) ||
      errorOutput.slice(0, 120);
    const signature = `${stage}:${verificationCommand}:${firstErrorLine}`;
    if (attemptedSignatures.has(signature)) {
      // Never repeat the exact same failing state without new changes
      return false;
    }
    attemptedSignatures.add(signature);
    localRepairs++;

    const srcKey = issueSource || (stage === "test" ? "test" : stage === "browser" ? "browser" : "runtime");
    runtime.updateIssueStatus(srcKey, "debugging", `Diagnosing: ${firstErrorLine.slice(0, 140)}`);

    const attemptNum = localRepairs;
    const sRepair = emitStep("repair", `Debugging ${stage} failure (attempt ${attemptNum}/${maxRepairs})`, "running", firstErrorLine);

    const filesSnapshot = await runtime.listFiles();
    let probableCause = "";
    let modifiedFiles: string[] = [];
    const repairOps: WorkspaceFileOperation[] = [];

    if (opts.customRepair) {
      const customRes = await opts.customRepair({
        attempt: attemptNum,
        stage,
        errorOutput,
        files: filesSnapshot,
        runtime,
      });
      if (customRes && customRes.modifiedFiles.length > 0) {
        probableCause = customRes.probableCause;
        modifiedFiles = customRes.modifiedFiles;
        for (const p of modifiedFiles) {
          const latestDiff = [...runtime.ledger.diffs].reverse().find((d) => d.path === p);
          repairOps.push({
            action: latestDiff?.status === "created" ? "Created" : "Edited",
            path: p,
            langBadge: fileLangBadge(p),
            added: latestDiff?.addedLines ?? 0,
            removed: latestDiff?.removedLines ?? 0,
          });
        }
      }
    }

    let repairFailure = "";
    if (modifiedFiles.length === 0) {
      runtime.updateIssueStatus(srcKey, "editing", `Applying live code patch for ${stage} issue...`);
      const llmRes = await llmRepairWorkspaceFiles({
        requestBudget,
        goal: opts.goal,
        primaryGoal,
        stage,
        errorOutput,
        files: filesSnapshot,
        provider: opts.provider,
        signal: opts.signal,
      });
      if (llmRes.failure) repairFailure = llmRes.failure;
      if (llmRes.patches.length > 0) {
        probableCause = llmRes.probableCause;
        for (const patch of llmRes.patches) {
          const diff = await runtime.writeFile(patch.path, patch.code);
          modifiedFiles.push(patch.path);
          repairOps.push({
            action: diff.status === "created" ? "Created" : "Edited",
            path: patch.path,
            langBadge: fileLangBadge(patch.path),
            added: diff.addedLines,
            removed: diff.removedLines,
          });
        }
      }
    }

    if (modifiedFiles.length === 0) {
      const reason = repairFailure || "No automated patch found";
      updateStep(sRepair, "repair", `Debugging ${stage} failure (attempt ${attemptNum})`, "error", reason);
      // Leave the issue visibly unresolved with the real reason instead of a stuck "editing" state.
      runtime.updateIssueStatus(srcKey, "assigned", `Repair failed: ${reason.slice(0, 160)}`);
      runtime.ledger.repairAttempts.push({
        id: nextRepairId(),
        attempt: attemptNum,
        signature,
        stage,
        errorOutput: errorOutput.slice(0, 1000),
        probableCause: repairFailure || "Could not synthesize a safe patch automatically.",
        filesModified: [],
        verificationCommand,
        resolved: false,
        timestamp: Date.now(),
      });
      return false;
    }

    runtime.updateIssueStatus(srcKey, "editing", probableCause, modifiedFiles.join(", "));
    updateStep(
      sRepair,
      "repair",
      `Applied fix to ${modifiedFiles.join(", ")}`,
      "done",
      probableCause,
      undefined,
      repairOps,
    );
    runtime.ledger.repairAttempts.push({
        id: nextRepairId(),
      attempt: attemptNum,
      signature,
      stage,
      errorOutput: errorOutput.slice(0, 1000),
      probableCause,
      filesModified: modifiedFiles,
      verificationCommand,
      resolved: false, // Updated to true once re-verification succeeds
      timestamp: Date.now(),
    });
    return true;
  };

  // ── Step 4a: Frontend Bundle & Compile Verification Loop (for TSX/JSX apps) ──
  currentFiles = await runtime.listFiles();
  const hasFrontendTsx = currentFiles.some((f) => /\.(tsx|jsx)$/i.test(f.path) && !/\.(test|spec)\./i.test(f.path));
  if (hasFrontendTsx) {
    for (let cycle = 0; cycle <= maxRepairs; cycle++) {
      opts.signal?.throwIfAborted();
      const sBundle = emitStep("execute", "Bundling TypeScript / React frontend with esbuild", "running");
      const bundled = await runtime.bundleFrontendApp();
      if (bundled.errors.length === 0 && bundled.html) {
        runtime.resolveOpenIssuesBySource("bundle");
        updateStep(
          sBundle,
          "execute",
          `Bundled ${bundled.entryPath} cleanly`,
          "done",
          "0 bundle errors",
        );
        break;
      }
      const errText = bundled.errors.join("\n") || "Frontend bundle produced empty output.";
      runtime.assignIssue({
        source: "bundle",
        severity: "critical",
        title: `Frontend Compile Error (${bundled.entryPath || "App.tsx"})`,
        detail: errText.slice(0, 220),
        file: bundled.entryPath || undefined,
        status: "assigned",
      });
      updateStep(sBundle, "execute", `Assigned bundle problem in ${bundled.entryPath || "frontend"}`, "error", errText.slice(0, 120));
      const patched = await attemptBoundedRepair("execute", "esbuild-frontend-bundle", errText, "bundle");
      if (!patched) break;
    }
  }

  // ── Step 4b & 5: Execute & Run Automated Tests with Bounded Repair Loop ──────
  let testCmd = await detectWorkspaceTestCommand(runtime);
  if (testCmd) {
    let testResolved = false;
    for (let cycle = 0; cycle <= maxRepairs; cycle++) {
      opts.signal?.throwIfAborted();
      const sTest = emitStep("test", `Running automated tests (${testCmd})`, "running");
      const rec = await runtime.runCommand(testCmd, { signal: opts.signal });
      const passed = rec.exitCode === 0 && !rec.timedOut;
      updateStep(
        sTest,
        "test",
        `Running automated tests (${testCmd})`,
        passed ? "done" : "error",
        commandDetail(rec),
      );

      if (passed) {
        testResolved = true;
        runtime.resolveOpenIssuesBySource("test");
        const lastRepair = runtime.ledger.repairAttempts[runtime.ledger.repairAttempts.length - 1];
        if (lastRepair && lastRepair.stage === "test") lastRepair.resolved = true;
        break;
      }

      const combinedErr = `${rec.stderr}\n${rec.stdout}`.trim();
      const firstLine =
        combinedErr
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /error|fail|assert|not ok/i.test(l)) || combinedErr.slice(0, 140);
      runtime.assignIssue({
        source: "test",
        severity: "critical",
        title: `Unit Test Failure (${testCmd})`,
        detail: firstLine,
        status: "assigned",
      });
      const patched = await attemptBoundedRepair("test", testCmd, combinedErr, "test");
      if (!patched) break;
      testCmd = (await detectWorkspaceTestCommand(runtime)) || testCmd;
    }
    void testResolved;
  } else {
    // If no test script exists, run the entry script if it's a CLI/Node script
    const entry = await detectWorkspaceEntryCommand(runtime);
    if (entry.kind === "script" && entry.command) {
      for (let cycle = 0; cycle <= maxRepairs; cycle++) {
      opts.signal?.throwIfAborted();
        const sExec = emitStep("execute", `Executing ${entry.command}`, "running");
        const rec = await runtime.runCommand(entry.command, { signal: opts.signal });
        const ok = rec.exitCode === 0 && !rec.timedOut;
        updateStep(sExec, "execute", `Executing ${entry.command}`, ok ? "done" : "error", commandDetail(rec));
        if (ok) {
          runtime.resolveOpenIssuesBySource("runtime");
          const lastRepair = runtime.ledger.repairAttempts[runtime.ledger.repairAttempts.length - 1];
          if (lastRepair && lastRepair.stage === "execute") lastRepair.resolved = true;
          break;
        }
        const errOut = `${rec.stderr}\n${rec.stdout}`.trim();
        runtime.assignIssue({
          source: "runtime",
          severity: "critical",
          title: `Runtime Execution Error (${entry.command})`,
          detail: errOut.slice(0, 180),
          status: "assigned",
        });
        const patched = await attemptBoundedRepair("execute", entry.command, errOut, "runtime");
        if (!patched) break;
      }
    }
  }

  // ── Step 6: Real Browser Automation & Visual Website Inspection ─────────────
  let browserInspection: BrowserInspectionRecord | null = null;
  const entry = await detectWorkspaceEntryCommand(runtime);
  const shouldInspectBrowser =
    opts.inspectBrowser !== false && (entry.kind === "server" || entry.kind === "static-web");

  if (shouldInspectBrowser) {
    for (let cycle = 0; cycle <= maxRepairs; cycle++) {
      opts.signal?.throwIfAborted();
      const sSrv = emitStep(
        "execute",
        entry.kind === "server" ? `Starting server (${entry.command})` : "Starting local workspace HTTP server",
        "running",
      );
      const srv = await runtime.startServer({
        command: entry.kind === "server" ? entry.command : "static",
      });
      if (srv.status !== "running") {
        const srvErr = srv.stderr || "Port did not become ready";
        runtime.assignIssue({
          source: "runtime",
          severity: "critical",
          title: "Server Startup Failure",
          detail: srvErr.slice(0, 180),
          status: "assigned",
        });
        updateStep(sSrv, "execute", `Server failed to start`, "error", srvErr);
        const patched = await attemptBoundedRepair("execute", srv.command, `${srv.stderr}\n${srv.stdout}`.trim(), "runtime");
        if (!patched) break;
        continue;
      }
      updateStep(sSrv, "execute", `Server listening on ${srv.url}`, "done", srv.url, srv.url);

      const targetUrl =
        entry.kind === "static-web" && entry.htmlEntry && entry.htmlEntry !== "index.html"
          ? `${srv.url}/${entry.htmlEntry}`
          : srv.url;

      const sInsp = emitStep("inspect", `Inspecting rendered website & playability in Chromium (${targetUrl})`, "running", undefined, targetUrl);
      try {
        browserInspection = await runtime.inspectWebsiteWithBrowser({
          url: targetUrl,
          interactions: opts.interactions,
          expectedText: opts.expectedText,
          requireMediaPlayback: codingRequirements(`${primaryGoal}\n${opts.goal}`).playback,
        });
        updateStep(
          sInsp,
          "inspect",
          `Browser inspection ${browserInspection.passed ? "passed — website verified playable" : "assigned problems to fix"}`,
          browserInspection.passed ? "done" : "error",
          `${browserInspection.consoleErrors.length} console errors, ${browserInspection.pageErrors.length} exceptions, ${browserInspection.interactions.filter((i) => i.ok).length} playable control(s) verified`,
          targetUrl,
        );

        if (browserInspection.passed) {
          runtime.resolveOpenIssuesBySource("browser");
          runtime.resolveOpenIssuesBySource("layout");
          runtime.resolveOpenIssuesBySource("interaction");
          const lastRepair = runtime.ledger.repairAttempts[runtime.ledger.repairAttempts.length - 1];
          if (lastRepair && lastRepair.stage === "browser") lastRepair.resolved = true;
          break;
        }

        // Assign every detected browser/UI/playability problem into the ledger
        for (const pe of browserInspection.pageErrors) {
          runtime.assignIssue({
            source: "browser",
            severity: "critical",
            title: "Uncaught Page Exception in Browser",
            detail: pe.slice(0, 200),
            status: "assigned",
          });
        }
        for (const ce of browserInspection.consoleErrors) {
          runtime.assignIssue({
            source: "browser",
            severity: "critical",
            title: "Browser Console Error",
            detail: ce.slice(0, 200),
            status: "assigned",
          });
        }
        for (const li of browserInspection.layoutIssues) {
          runtime.assignIssue({
            source: "layout",
            severity: "critical",
            title: "Website Render / Layout Issue",
            detail: li.slice(0, 200),
            status: "assigned",
          });
        }
        for (const fi of browserInspection.interactions.filter((i) => !i.ok)) {
          runtime.assignIssue({
            source: "interaction",
            severity: "critical",
            title: `Broken Interactive Control (${fi.target})`,
            detail: fi.detail.slice(0, 200),
            status: "assigned",
          });
        }

        const browserErrSummary = [
          ...browserInspection.pageErrors.map((e) => `PageError: ${e}`),
          ...browserInspection.consoleErrors.map((e) => `ConsoleError: ${e}`),
          ...browserInspection.failedRequests.map((r) => `FailedRequest: ${r.url} (${r.reason})`),
          ...browserInspection.brokenImages.map((img) => `BrokenImage: ${img}`),
          ...browserInspection.layoutIssues.map((l) => `LayoutIssue: ${l}`),
          ...browserInspection.interactions.filter((i) => !i.ok).map((i) => `InteractionFailed (${i.target}): ${i.detail}`),
        ].join("\n");

        const patched = await attemptBoundedRepair("browser", targetUrl, browserErrSummary, "browser");
        if (!patched) break;
      } catch (err) {
        updateStep(
          sInsp,
          "inspect",
          "Browser inspection unavailable",
          "error",
          err instanceof Error ? err.message : String(err),
        );
        break;
      } finally {
        await runtime.stopAllServers().catch(() => {});
      }
    }
  }

  // ── Step 8: Verify & Produce Authentic Report ───────────────────────────────
  const sVerify = emitStep("verify", "Verifying execution ledger & test outcomes", "running");
  const finalFiles = await runtime.listFiles();
  // Browser repairs can change source after the earlier tests. Recheck the resulting files.
  if (runtime.ledger.testStatus === "not_run") {
    const finalTest = await detectWorkspaceTestCommand(runtime);
    if (finalTest) await runtime.runCommand(finalTest, { signal: opts.signal });
  }
  const needsBrowser = opts.inspectBrowser !== false && finalFiles.some((f) => /\.(html?|tsx|jsx)$/i.test(f.path));
  const finalTestStatus = runtime.ledger.testStatus as VerificationLedger["testStatus"];
  const verified = implementationComplete && finalFiles.length > 0 &&
    finalTestStatus !== "failed" && finalTestStatus !== "blocked" &&
    (needsBrowser ? browserInspection?.passed === true : runtime.ledger.codeExecuted) &&
    !(runtime.ledger.issues || []).some((i) => i.severity === "critical" && i.status !== "fixed");
  const check = verifyAndSanitizeCodingClaims(opts.assistantDraft || agentSummary || "", runtime.ledger);
  updateStep(
    sVerify,
    "verify",
    `${verified ? "Verified" : "Verification incomplete"}: tests ${runtime.ledger.testStatus}`,
    verified ? "done" : "error",
    `${finalFiles.length} files, ${runtime.ledger.commands.length} command(s)`,
  );

  return {
    verified,
    ledger: runtime.ledger,
    filesCreatedOrModified: finalFiles.map((f) => f.path),
    commandsRun: runtime.ledger.commands,
    testPassed: finalTestStatus === "passed",
    browserInspection,
    repairs: runtime.ledger.repairAttempts,
    verificationReportMarkdown: check.summaryMarkdown,
    sanitizedReply: check.sanitizedText,
  };
}
