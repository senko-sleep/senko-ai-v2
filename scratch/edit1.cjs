const fs = require("fs");
const p = "src/components/assistant/workspace-panel.tsx";
let c = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
function cut(startMarker, endMarker, replacement) {
  const s = c.indexOf(startMarker);
  if (s < 0) throw new Error("start not found: " + startMarker.slice(0, 50));
  const e = c.indexOf(endMarker, s);
  if (e < 0) throw new Error("end not found: " + endMarker.slice(0, 50));
  c = c.slice(0, s) + replacement + c.slice(e + endMarker.length);
}
// 1. slogan subtitle
cut('                  <span className="ml-2 text-[11px] text-[var(--sk-muted)]">\n                    Live edits', "</span>\n", "");
// 2. filler "Polish UI" chip
cut('                <button\n                  type="button"\n                  disabled={agentBusy || !chatId}\n                  onClick={() =>\n                    void runWorkspaceAgentTask(\n                      "Improve typography', "<span>Polish UI</span>\n                </button>\n", "");
// 3. file list that duplicates the Files tab
cut("              {project.files.length > 0 && (\n                <details\n                  open\n", "                </details>\n              )}\n\n", "");
// 4. empty-state card
cut('                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-6 text-center', "                </div>\n              )}\n            </div>\n\n            {/* Workspace Agent Live Prompt Input */}",
  '                <p className="text-[11.5px] text-[var(--sk-muted)]">No agent runs yet.</p>\n              )}\n            </div>\n\n            {/* Workspace Agent Live Prompt Input */}');
fs.writeFileSync(p, c.replace(/\n/g, "\r\n"));
console.log("ok");
