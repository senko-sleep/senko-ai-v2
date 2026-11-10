const fs = require("fs");
function patch(file, fn) {
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  let c = raw.replace(/\r\n/g, "\n");
  c = fn(c);
  fs.writeFileSync(file, crlf ? c.replace(/\n/g, "\r\n") : c);
}
function rep(c, a, b) {
  if (!c.includes(a)) throw new Error("not found: " + a.slice(0, 70));
  return c.replace(a, b);
}

patch("src/lib/code-job.ts", (c) => {
  // 1. Batch-first instructions
  c = rep(c, "- Plan the file layout first, then write several files per step. Keep files focused and well named.",
`- Efficiency is a hard requirement. Every reply costs a model request and the provider rate-limits them. Finish the whole task in the fewest replies: ideally one reply that writes every file, installs dependencies, runs the tests and starts the app, in that order (ops execute in order; a later op sees earlier results on disk). Use further replies only to fix real failures or to read files you were not given.
- Do not write one file per reply, do not narrate, and do not read files already shown under OPEN FILES or summarized in BRIEF. Use edit ops, not rewrites, for small changes to existing files.
- Plan the layout first, then emit all files together. Keep files focused and well named. Make every file complete: no TODOs, stubs or placeholders.`);
  c = rep(c, "You work in steps and reply with JSON only.", "You reply with JSON only. Batch as much work per reply as is safe.");
  // 2. Environment + brief in the prompt
  c = rep(c, "  step: number;\n  maxSteps: number;\n}", "  step: number;\n  maxSteps: number;\n  /** Verified facts about where commands run (platform, Node, cwd), supplied by the host. */\n  environment?: string;\n  /** Deterministic summary of the project (stack, scripts, dependencies, entry points). */\n  brief?: string;\n}");
  c = rep(c, "    `FILES:\\n${files}`,", "    r.environment && `ENVIRONMENT:\\n${r.environment}`,\n    r.brief && `BRIEF:\\n${r.brief}`,\n    `FILES:\\n${files}`,");
  c += `
/**
 * Deterministic project summary built locally (no model call). It replaces the exploratory
 * reads a model would otherwise spend requests on: stack, scripts, dependencies, entry points
 * and test layout. Everything reported is read from the files; nothing is inferred beyond that.
 */
export function buildProjectBrief(files: { path: string; content: string }[], limit = 2400): string {
  if (!files.length) return "Empty project: nothing exists yet. Create the full project in your first reply.";
  const lines: string[] = [];
  const manifest = files.find((f) => f.path === "package.json");
  let deps: string[] = [];
  if (manifest) {
    try {
      const pkg = JSON.parse(manifest.content) as { name?: string; type?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
      lines.push(\`package: \${pkg.name || "(unnamed)"}\${pkg.type ? \`, module type \${pkg.type}\` : ""}\`);
      const scripts = Object.entries(pkg.scripts || {}).map(([name, cmd]) => \`\${name}=\${cmd}\`);
      if (scripts.length) lines.push(\`scripts: \${scripts.join("; ")}\`);
      if (deps.length) lines.push(\`declared dependencies: \${deps.join(", ")}\`);
    } catch { lines.push("package.json exists but is not valid JSON: fix it first."); }
  }
  const has = (name: string) => deps.includes(name);
  const stack = [
    has("next") && "Next.js", has("vite") && "Vite", has("react") && "React", has("express") && "Express", has("hono") && "Hono",
    has("vitest") && "Vitest", has("jest") && "Jest", has("typescript") && "TypeScript",
    files.some((f) => /\\.test\\.[cm]?[jt]s$/.test(f.path)) && !has("vitest") && !has("jest") && "node:test files",
  ].filter(Boolean);
  if (stack.length) lines.push(\`stack: \${stack.join(", ")}\`);
  const entries = files.filter((f) => /^(index\\.html|server\\.[cm]?[jt]s|src\\/(main|index)\\.[jt]sx?|app\\/(page|layout)\\.[jt]sx?|src\\/app\\/(page|layout)\\.[jt]sx?)$/.test(f.path)).map((f) => f.path);
  if (entries.length) lines.push(\`entry points: \${entries.join(", ")}\`);
  const tests = files.filter((f) => /(^|\\/)(__tests__|tests?)\\/|\\.(test|spec)\\./.test(f.path)).map((f) => f.path);
  if (tests.length) lines.push(\`tests (\${tests.length}): \${tests.slice(0, 8).join(", ")}\${tests.length > 8 ? ", ..." : ""}\`);
  const imported = new Set<string>();
  for (const f of files) for (const m of f.content.matchAll(/(?:from\\s+|require\\()["']([^"'./][^"']*)["']/g)) imported.add(m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0]);
  const builtin = new Set(["fs", "path", "os", "http", "https", "net", "url", "util", "crypto", "stream", "events", "child_process", "assert", "zlib", "readline", "buffer"]);
  const undeclared = [...imported].filter((name) => !name.startsWith("node:") && !builtin.has(name) && !deps.includes(name));
  if (manifest && undeclared.length) lines.push(\`imported but not declared in package.json: \${undeclared.slice(0, 12).join(", ")}\`);
  const dirs = new Map<string, number>();
  for (const f of files) { const top = f.path.includes("/") ? f.path.split("/")[0] : "."; dirs.set(top, (dirs.get(top) || 0) + 1); }
  lines.push(\`layout: \${[...dirs].map(([dir, count]) => \`\${dir} (\${count})\`).join(", ")}\`);
  const out = lines.join("\\n");
  return out.length > limit ? out.slice(0, limit) + "\\n..." : out;
}
`;
  return c;
});

patch("src/lib/agent/coding-loop.ts", (c) => {
  c = rep(c, 'import { CODE_SYSTEM, buildStepPrompt,', 'import { CODE_SYSTEM, buildProjectBrief, buildStepPrompt,');
  c = rep(c, "        canRun: true, step, maxSteps };", "        brief: buildProjectBrief(files.filter((f) => !f.binary).map((f) => ({ path: f.path, content: f.code }))),\n        environment: `${process.platform}, Node ${process.version}. Commands run with the project folder as the working directory and return the tail of stdout/stderr with the exit code. Dependencies are not installed until a run op installs them. Dev/start commands keep running in the background and report their first output.`,\n        canRun: true, step, maxSteps };");
  c = rep(c, "Use one small operation under 1000 tokens; do not repeat the previous oversized batch.", "If the reply was cut off by length, send only the files that were not yet written, ordered by dependency, and do not resend files already on disk.");
  return c;
});
console.log("ok");
