const fs = require("fs");
const p = "src/components/assistant/workspace-panel.tsx";
let c = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const log = [];
function rep(a, b, label) {
  if (!c.includes(a)) throw new Error("not found: " + (label || a.slice(0, 70)));
  c = c.split(a).join(b);
  log.push(label || a.slice(0, 40));
}
function cut(start, end, replacement, label) {
  const s = c.indexOf(start);
  if (s < 0) throw new Error("start not found: " + (label || start.slice(0, 60)));
  const e = c.indexOf(end, s);
  if (e < 0) throw new Error("end not found: " + (label || end.slice(0, 60)));
  c = c.slice(0, s) + replacement + c.slice(e + end.length);
  log.push(label || start.slice(0, 40));
}

// 1. Decorative accent-coloured icons inside tabs and chips
const iconLine = /^[ \t]*<(Eye|Bot|Terminal|Compass|Code2|FileCode2|Files|FolderTree) className="h-3\.5 w-3\.5 text-\[var\(--sk-accent-ink\)\]" \/>\n/gm;
const removed = [...c.matchAll(iconLine)].map((m) => m[1]);
c = c.replace(iconLine, "");
log.push("tab icons removed: " + removed.join(","));

// 2. Count pills become plain muted text
rep('className="sk-tabular rounded-full bg-white/[0.06] px-1.5 text-[10px] text-[var(--sk-muted)]"', 'className="sk-tabular text-[10.5px] text-[var(--sk-muted)]"', "plain counts");
rep('className={`sk-tabular rounded-full px-1.5 text-[10px] ${', 'className={`sk-tabular text-[10.5px] ${', "terminal count");
rep('? "bg-[var(--sk-ok-soft)] text-[var(--sk-ok)]"\n                    : ledger.testStatus === "failed"\n                      ? "bg-[var(--sk-danger-soft)] text-[var(--sk-danger)]"\n                      : "bg-white/[0.06] text-[var(--sk-muted)]"', '? "text-[var(--sk-ok)]"\n                    : ledger.testStatus === "failed"\n                      ? "text-[var(--sk-danger)]"\n                      : "text-[var(--sk-muted)]"', "terminal count colors");
rep('{ledger.testStatus === "passed" ? "PASS" : ledger.testStatus === "failed" ? "FAIL" : ledger.commands.length}', '{ledger.testStatus === "passed" ? "pass" : ledger.testStatus === "failed" ? "fail" : ledger.commands.length}', "pass/fail text");
// Spinner in the Agent tab -> plain word
rep('<Loader2 className="h-3 w-3 sk-spin text-[var(--sk-accent-ink)]" />\n            ) : agentRuns.length > 0', '<span className="text-[10.5px] text-[var(--sk-muted)]">running</span>\n            ) : agentRuns.length > 0', "agent tab spinner");

// 3. Preview toolbar: remove the animated badge and icon decorations
cut('            {(agentBusy || inspectBusy) && (\n              <span className="hidden items-center gap-1 rounded-full border border-[var(--sk-accent-line)]', "</span>\n            )}\n", "", "inspecting badge");
rep('                {agentBusy || inspectBusy ? (\n                  <Loader2 className="h-3 w-3 sk-spin" />\n                ) : (\n                  <Wrench className="h-3 w-3" />\n                )}\n                <span className="hidden sm:inline">AI Inspect & Fix</span>', '                <span>{agentBusy || inspectBusy ? "Working" : "Inspect and repair"}</span>', "inspect button");
rep('                <Eye className="h-3 w-3" />\n                <span className="hidden md:inline">{showAiVision ? "Live App" : "AI Vision"}</span>', '                <span className="hidden md:inline">{showAiVision ? "Live app" : "Screenshot"}</span>', "vision button");

// 4. Editor toolbar: drop buttons that duplicate the tab bar, drop icon from the diff toggle
cut('                    <button\n                      type="button"\n                      className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 text-[11px] font-medium text-[var(--sk-text)] hover:border-[var(--sk-accent-line)]"\n                      title="Open Workspace Coding Agent', '<span className="hidden sm:inline">Live Agent</span>\n                    </button>\n', "", "Live Agent button");
cut('                    {entry && !splitPreview && (\n                      <button\n                        type="button"\n                        className="sk-btn h-6.5 rounded-md border border-[var(--sk-accent-line)]', '<span>Preview</span>\n                      </button>\n                    )}\n', "", "editor Preview button");
rep('                        <GitCompare className="h-3 w-3" />\n', "", "diff icon");

// 5. Agent tab chips and prompt bar: text only
rep('                  <Wrench className="h-3 w-3" />\n', "", "chip wrench");
rep('                  <Play className="h-3 w-3 text-emerald-400" />\n', "", "chip play");
rep('                    <Square className="h-3 w-3" />\n', "", "stop square");
rep('                  <Send className="h-3 w-3" />\n', "", "send icon");
rep('              <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--sk-accent-ink)]" />\n', "", "prompt bot");

// 6. Filled accent styling becomes a neutral selected state
rep("border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]", "border-[var(--sk-line-strong)] bg-[var(--sk-surface-2)] text-[var(--sk-text)]", "neutral selected");

fs.writeFileSync(p, c.replace(/\n/g, "\r\n"));
console.log(log.join("\n"));
