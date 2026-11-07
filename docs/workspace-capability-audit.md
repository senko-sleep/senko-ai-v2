# Coding workspace audit and implementation evidence

Date: November 6, 2026 (America/Indianapolis).

This is a source and runtime audit of the existing workspace. It is not evidence of VS Code superiority or Claude Code equivalence. The working tree already contained extensive changes before this task; unrelated work was preserved.

## Practical comparison

| Workflow | Repository before this pass | Implemented and checked | Remaining gap |
| --- | --- | --- | --- |
| Editing | Textarea, manual highlighting overlay | Locally bundled CodeMirror, JS/TS/TSX/JSON/HTML/CSS parsing, completion, folding, find/replace, bracket matching, indentation, soft wrap | No project language server, semantic type navigation, refactoring, general formatter, or extension host |
| Navigation and state | Explorer and file tabs | Ctrl/Cmd+P path search; per-file undo, selection and scroll; save shortcut; tab visibility after resize | No project-wide symbol index or references search |
| Terminal | Server commands plus a separate browser runner | Browser jobs can use the real server runtime without an open WebContainer tab; real output and exit codes; process-tree shutdown | Captured commands are not a full interactive PTY with stdin, shell tabs and debugging integration |
| Diagnostics and debugging | Test/browser records and bounded repairs | Syntax diagnostics; real compile/test/browser failures; stale verification invalidation and explicit incomplete status | No breakpoint/step debugger or semantic Problems panel |
| Agent orchestration | Live changes synthesized as one response; browser jobs trusted model completion | Validated operations, targeted exact-match edits, iterative read/edit/run/inspect, relevant context, recoverable capacity waits, journals, evidence-based completion | Model quality still materially affects results; native provider function calling is not used; some lookup tools remain unavailable in the server loop |
| Recovery | Diffs and in-memory history | Source checkpoints before agent tasks; manual snapshot/restore; automatic undo snapshot; persisted task context and browser-job checkpoints | Source snapshots are not database backups, Git branches, or transactional multi-file merges |
| Preview and layout | Split pane and bespoke UI | Real Chromium inspection, interactions and expected text; pointer/keyboard resizing; vertical layout below 1024px; responsive preview at 100%; actual design tokens enabled on standalone code route | Backend live preview URLs need remote-host routing before a hosted multi-user deployment |

VS Code has documented IntelliSense and a fully featured integrated terminal. Those are useful comparison baselines, not features this implementation can claim to match. Sources: [VS Code IntelliSense](https://code.visualstudio.com/docs/editing/intellisense), [terminal](https://code.visualstudio.com/docs/terminal/basics). The tool/result feedback loop is an established agent pattern; its presence alone does not prove Claude Code-level performance: [Anthropic tool-use execution model](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works).

## Defects found and repaired

- Malformed tool operations were silently discarded and could coexist with `done:true`. Invalid operations now return actionable errors and reject completion.
- Browser coding jobs marked the step limit as done. They now remain unverified and can resume saved context.
- Coding-job commands depended on a runner tab that the current standalone workspace no longer booted. Authenticated server workspace execution is available as a fallback.
- Context used fixed first-file slices. Relevant error/task files are ranked, omitted paths are disclosed, and explicit reads return complete source. Targeted exact-match edits avoid rewriting large files; missing or ambiguous matches fail visibly.
- The installer skipped a hardcoded list of packages, including missing build/test dependencies. It now checks declared runtime and development packages against actual installations and runs the real project install command when needed.
- Test discovery selected the first TypeScript test before considering package scripts. Configured test runners are preserved; direct Node tests include every discovered file, with each TypeScript entry transpiled.
- Test success survived subsequent file changes. Writes, moves, deletes, and restores invalidate test status; browser repairs cause final tests to rerun.
- Workflow responses and the UI unconditionally advertised successful completion. The workflow now returns `verified`, and incomplete execution is displayed as incomplete/error.
- Windows shutdown killed the command shell while leaving its Node server alive. The actual process tree is now stopped; command cancellation is propagated and server startup failures are recorded.
- New-file path validation missed symlinked parent directories. The nearest existing ancestor is checked too. Task journals/checkpoints are excluded from model source-file access.
- Repeated model requests leaked abort listeners. Winning streams and failed/losing attempts now remove their listeners.
- Benchmark calls could silently use a fallback model. Explicit model pinning now filters candidates and reports an unavailable model rather than substituting one.
- The standalone workspace omitted the `.sk` design-system scope. Browser testing exposed default white borders and missing code-surface tokens; the scope and narrow-screen layout were repaired.

## Reproducible evidence

Offline integration tests use explicitly labelled deterministic model adapters. They execute real files, commands, HTTP servers, Chromium interactions and disk persistence. They test the engineering system; they do not measure model intelligence.

Commands:

```powershell
npx vitest run --maxWorkers=1
npx tsc --noEmit
npm run build
npx vitest run --config vitest.live.config.ts src/__live__/coding-models.live.test.ts
```

The full-stack integration fixture writes a real backend, validation module, tests and frontend through the tool loop; runs Node tests; starts the server; types a note and clicks Save in Chromium; asserts the visible result; and reads the resulting JSON file from disk. Other tests cover failed-test repair, multi-file checkpoint restoration, unchanged unrelated files, all-test discovery, current-revision completion gates, request validation, symlink escape prevention, model pinning, and abort-listener cleanup.

Manual browser checks covered quick-open, find/replace, undo across file switches, disk save, source checkpoint creation/restoration, soft wrap, and desktop/tablet/mobile layout. Screenshots are in `artifacts/workspace-{desktop,tablet,mobile}.png`. Independent design review passed after a second layout refinement. This was a same-provider independent review; no cross-provider design score is claimed.

The first combined build/test run exhausted Windows memory and also caught a malformed prompt literal, which was corrected. The checks were rerun sequentially with a single test worker. A parser regression added while an earlier test process was running failed in that process and passed in a fresh isolated run; the final suite uses a fresh process.

## Live model evidence and limitations

Live benchmark artifacts are retained under `artifacts/coding-model-benchmark*.json`. They record the requested/actual model, task, completion status, latency, Node-process peak RSS, commands, test status, browser results and failure feedback. One task/run does not establish a general model ranking; RSS excludes browser and child-process memory.

Actual runs exposed a rate-limited/empty Groq response, a Gemini model that the provider rejected as unavailable to new users, and a small Cloudflare model repeatedly returning malformed tool JSON. These are incomplete runs, not successes. The parser now safely accepts a document that is JSON-escaped once only when both JSON decodes succeed; it never evaluates code or guesses missing content.

The retired Cloudflare default returned HTTP 410. The default was changed to the catalogued `@cf/meta/llama-3.2-3b-instruct`, preserving environment overrides. The catalog also lists a planned November 20, 2026 deprecation, so the default needs another catalog review before that date. Sources: [retired models](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/), [current model catalog entry](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/). Configuration/discovery is not a successful inference probe; provider availability in settings remains a capability hint.

No VS Code or Claude Code performance baseline was executed. Authentication, database migrations, WebSockets, external integrations and deployments were not independently benchmarked in this pass. The loop can use real files and commands for those tasks, but that does not certify autonomous delivery of every application type.

Local commands run as host processes in per-chat directories with sanitized environments and command risk checks. This is not an OS security sandbox. Arbitrary application code can use host APIs; it must be moved into an actual container/microVM boundary before serving untrusted multi-user workloads. Host package fallback in the preview is also not a substitute for installing a project's pinned dependencies for release.

The task journal is durable source/task context, not a durable distributed worker queue. In-flight commands do not survive a server restart, and simultaneous edits to the same workspace are not transactionally merged. These remain production-hardening work.


## Files changed in this pass

- `src/lib/code-job.ts`: tool protocol, argument validation, exact edits, context selection, completion gates.
- `src/lib/agent/coding-loop.ts`: real iterative tool loop, durable journal and model-independent evidence handling.
- `src/lib/agent/workspace-checkpoints.ts`: real source snapshot creation and reversible restore.
- `src/lib/agent/coding-agent.ts`: live tool-loop integration, dependency/test detection, relevant repair context, cancellation and final verification.
- `src/lib/agent/coding-runtime.ts`: stale verification invalidation, file reconciliation, ancestor-path validation, managed-server failure handling, command cancellation and process-tree shutdown.
- `src/lib/llm/index.ts`: exact model pinning, cache identity, abort-listener cleanup and retired default replacement.
- `src/app/api/code/step/route.ts` and `src/app/api/chats/[id]/workspace/route.ts`: request validation, checkpoint/server actions and honest completion status.
- `src/components/assistant/code-job-client.ts` and `code-job-card.tsx`: server fallback, persisted progress, real browser checks, targeted edits and incomplete/resume states.
- `src/components/assistant/workspace-panel.tsx`, `workspace-code-editor.tsx`, `workspace-editor-support.ts`, `workspace-file-search.ts`: editor, quick-open, diagnostics, responsive panes, source-history controls and truthful status.
- `src/app/code/[chatId]/workspace.tsx`: design-system scope.
- `package.json`, `package-lock.json`: local CodeMirror dependencies.
- `next.config.mjs`: configurable default of two build/page workers after observed memory exhaustion.
- `src/__tests__/coding-infrastructure.test.ts`, `coding-fullstack.test.ts`, `workspace-editor.test.ts`, `llm-refusal-routing.test.ts`: real execution and contract regressions.
- `src/__live__/coding-models.live.test.ts`: explicitly pinned live model comparison with measured outcomes.
- `artifacts/`: genuine model reports and desktop/tablet/mobile screenshots.

Final regression run: `npx vitest run --maxWorkers=1` ? **578 passed across 43 files**, exit 0. A fresh `npx tsc --noEmit` passed. Final targeted lint and production build results are recorded in the task's final report.

Final production build: `npm run build` — **passed**, exit 0, with two page workers. Final targeted ESLint — **passed**, exit 0. The earlier memory-exhausted build attempt is superseded by this sequential successful build; live model benchmark failures remain failures and are not superseded by offline regression results.
