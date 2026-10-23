// Runs before `npm run dev`: stops a leftover `next dev` for THIS project (e.g. from a crashed
// terminal) and clears its stale lock, so you don't get "port 3000 is in use" or
// "Unable to acquire lock at .next/dev/lock". Other projects' servers are never touched.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = path.join(root, ".next", "dev", "lock");
const norm = (s) => s.replace(/\//g, "\\").toLowerCase();

function listProcesses() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }
      );
      return out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const [pid, ...rest] = l.split("\t");
          return { pid: Number(pid), cmd: rest.join("\t") };
        });
    }
    const out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const m = /^\s*(\d+)\s+(.*)$/.exec(l);
        return m ? { pid: Number(m[1]), cmd: m[2] } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const here = norm(root);
const isOurNextDev = (cmd) => {
  const c = norm(cmd || "");
  return (
    c.includes(`${here}\\node_modules\\next\\dist\\server\\lib\\start-server.js`) ||
    (c.includes(`${here}\\node_modules\\next\\dist\\bin\\next`) && /\bdev\b/.test(c)) ||
    (c.includes(`${here}\\node_modules\\.bin\\`) && c.includes("next") && /\bdev\b/.test(c))
  );
};

const stale = listProcesses().filter((p) => p.pid !== process.pid && isOurNextDev(p.cmd));
for (const p of stale) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(p.pid, "SIGTERM");
    console.log(`[predev] Stopped a leftover Senko dev server (PID ${p.pid}).`);
  } catch {
    /* already gone */
  }
}

if (fs.existsSync(lock)) {
  // Give the stopped process a moment to release the file, then remove it.
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(lock, { force: true });
      console.log("[predev] Removed a stale .next/dev/lock.");
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}
