const fs = require("fs");
const p = "src/components/assistant/workspace-panel.tsx";
let c = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
function rep(a, b) {
  if (!c.includes(a)) throw new Error("not found: " + a.slice(0, 60));
  c = c.replace(a, b);
}
// Goal banner: plain label, no filled badge
rep('className="shrink-0 rounded bg-[var(--sk-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--sk-accent-ink)]"', 'className="shrink-0 text-[10.5px] text-[var(--sk-muted)]"');
rep("                    Main Goal\n", "                    Goal\n");
rep('"Set the project goal to guide implementation and acceptance checks."', '"No goal set"');
rep('{editingGoal ? "Save Goal" : "Edit Goal"}', '{editingGoal ? "Save" : "Edit"}');
rep('placeholder="Describe the overarching goal of this workspace..."', 'placeholder="Project goal"');
// Primary agent action: same quiet style as the others
rep('className="sk-btn h-6.5 rounded-md border border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)] px-2 text-[11px] font-medium text-[var(--sk-accent-ink)] hover:bg-[var(--sk-accent)] hover:text-white"', 'className="sk-btn h-6.5 rounded-md border border-[var(--sk-line)] bg-[var(--sk-surface-2)] px-2 text-[11px] hover:border-[var(--sk-line-strong)]"');
rep("<span>Inspect & repair</span>", "<span>Inspect and repair</span>");
rep("<span>Add & Run Tests</span>", "<span>Add and run tests</span>");
// Prompt input
rep("<span>Apply Live</span>", "<span>Run</span>");
rep('? `Live edit ${file.path}, fix bugs, or add features in workspace…`', "? `Change ${file.path} or describe a task`");
rep('"Ask Workspace Agent to build, edit, fix, or debug live…"', '"Describe a task"');
// Assigned problems header: no shouting
rep('className="font-semibold uppercase tracking-wider text-amber-300"', 'className="font-medium text-amber-300"');
rep("Assigned Problems & Live Debug Queue (", "Problems (");
// Terminal tab: status pills -> one plain line
const start = c.indexOf('                <span className="font-medium text-[var(--sk-text)]">Verification Ledger:</span>');
if (start < 0) throw new Error("ledger start");
const endMarker = '                  Tests: {(ledger?.testStatus || "not_run").toUpperCase()}\n                </span>\n';
const end = c.indexOf(endMarker, start);
if (end < 0) throw new Error("ledger end");
c = c.slice(0, start) +
  '                <span className="text-[var(--sk-muted)]">\n                  Written: {ledger?.codeWritten || project.files.length > 0 ? "yes" : "no"} · Executed: {ledger?.codeExecuted ? "yes" : "no"} · Tests: <span className={ledger?.testStatus === "passed" ? "text-[var(--sk-ok)]" : ledger?.testStatus === "failed" ? "text-[var(--sk-danger)]" : ""}>{(ledger?.testStatus || "not_run").replace("_", " ")}</span>\n                </span>\n' +
  c.slice(end + endMarker.length);
rep("<span>Run Tests</span>", "<span>Run tests</span>");
fs.writeFileSync(p, c.replace(/\n/g, "\r\n"));
console.log("ok");
