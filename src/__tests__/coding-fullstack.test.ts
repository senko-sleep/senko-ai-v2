import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { runCodingToolLoop } from "@/lib/agent/coding-loop";

// Deterministic model adapter: this tests engineering infrastructure, not model intelligence.
it("builds and verifies real browser → API → persistent-storage integration through the tool loop", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "senko-fullstack-"));
  const runtime = new CodingWorkspaceRuntime("notes", base);
  const server = `const http = require('node:http');
const fs = require('node:fs');
const { validate } = require('./validation.cjs');
http.createServer(async(req,res) => {
 if(req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
 if(req.url === '/') { res.setHeader('Content-Type','text/html'); return res.end(fs.readFileSync('index.html')); }
 if(req.url === '/api/notes' && req.method === 'POST') {
  let raw=''; for await(const part of req) raw+=part;
  const body=JSON.parse(raw); const note=validate(body.text);
  const notes=fs.existsSync('notes.json')?JSON.parse(fs.readFileSync('notes.json','utf8')):[];
  notes.push(note); fs.writeFileSync('notes.json',JSON.stringify(notes));
  res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({count:notes.length}));
 }
 res.writeHead(404); res.end('Not found');
}).listen(Number(process.env.PORT),'127.0.0.1');`;
  const index = `<!doctype html><html><head><meta charset="utf-8"><title>Notes integration fixture</title></head><body>
<h1>Persistent notes</h1><label>Note<input id="note"></label><button id="save">Save</button><p id="status">Ready</p>
<script>document.querySelector('#save').onclick=async()=>{const r=await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:document.querySelector('#note').value})});const data=await r.json();document.querySelector('#status').textContent='Saved '+data.count;};</script></body></html>`;
  let step = 0;
  const began = performance.now();
  try {
    const result = await runCodingToolLoop({ runtime, goal: "Build a full-stack notes app: save a note through the UI to a real API and persist it on disk. Test validation and the browser flow.", maxSteps: 5,
      modelCall: async () => {
        const responses = [
          { ops: [{ op: "write", path: "index.html", content: index }, { op: "write", path: "server.js", content: server },
            { op: "write", path: "validation.cjs", content: "exports.validate = (text) => { if(typeof text !== 'string' || !text.trim()) throw Error('Empty note'); return text.trim(); };" },
            { op: "write", path: "validation.test.cjs", content: "const test=require('node:test');const assert=require('node:assert/strict');const {validate}=require('./validation.cjs');test('rejects empty',()=>assert.throws(()=>validate('')));test('trims note',()=>assert.equal(validate(' hello '),'hello'));" }] },
          { ops: [{ op: "run", cmd: "node --test validation.test.cjs" }, { op: "run", cmd: "node server.js" }] },
          { ops: [{ op: "inspect", interactions: [{ action: "type", selector: "#note", text: "Verified note" }, { action: "click", selector: "#save" }], expectedText: ["Saved 1"] }], done: true, summary: "Saved a note through the actual API and verified the rendered result." },
        ];
        return { model: "deterministic-fullstack-test-adapter", text: JSON.stringify(responses[step++]) };
      },
    });
    expect(result.task.status).toBe("verified");
    expect(JSON.parse(await fs.readFile(path.join(runtime.workspaceDir, "notes.json"), "utf8"))).toEqual(["Verified note"]);
    expect(runtime.ledger.browserInspections.at(-1)?.passed).toBe(true);
    expect(runtime.ledger.browserInspections.at(-1)?.interactions).toHaveLength(2);
    expect(runtime.ledger.testStatus).toBe("passed");
    console.log(JSON.stringify({ scenario: "real-fullstack-tool-integration", model: "deterministic-test-adapter", verified: true, durationMs: Math.round(performance.now() - began), modelCalls: step, commands: runtime.ledger.commands.length, browserInspections: runtime.ledger.browserInspections.length }));
  } finally {
    await runtime.stopAllServers();
    await fs.rm(base, { recursive: true, force: true });
  }
}, 60_000);
