import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodingWorkspaceRuntime, resolveSafeWorkspacePath } from "./coding-runtime";

export interface WorkspaceCheckpoint { id: string; label: string; createdAt: number; files: { path: string; code: string }[] }
const directory = (runtime: CodingWorkspaceRuntime) => path.join(runtime.workspaceDir, ".senko", "checkpoints");

export async function createWorkspaceCheckpoint(runtime: CodingWorkspaceRuntime, label: string): Promise<WorkspaceCheckpoint> {
  const files = await runtime.listFiles();
  if (files.reduce((n, f) => n + f.sizeBytes, 0) > 20 * 1024 * 1024) throw new Error("Source checkpoint exceeds the 20 MB limit.");
  const checkpoint = { id: randomUUID(), label: label.slice(0, 200), createdAt: Date.now(), files: files.map(({ path, code }) => ({ path, code })) };
  await fs.mkdir(directory(runtime), { recursive: true });
  await fs.writeFile(path.join(directory(runtime), `${checkpoint.id}.json`), JSON.stringify(checkpoint), "utf8");
  return checkpoint;
}

export async function listWorkspaceCheckpoints(runtime: CodingWorkspaceRuntime): Promise<Omit<WorkspaceCheckpoint, "files">[]> {
  const names = await fs.readdir(directory(runtime)).catch(() => []);
  const checkpoints = [];
  for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
    try {
      const { id, label, createdAt } = JSON.parse(await fs.readFile(path.join(directory(runtime), name), "utf8")) as WorkspaceCheckpoint;
      checkpoints.push({ id, label, createdAt });
    } catch { /* A corrupt checkpoint is unavailable, never treated as a successful restore. */ }
  }
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreWorkspaceCheckpoint(runtime: CodingWorkspaceRuntime, id: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid checkpoint id.");
  const checkpoint = JSON.parse(await fs.readFile(path.join(directory(runtime), `${id}.json`), "utf8")) as WorkspaceCheckpoint;
  if (!Array.isArray(checkpoint.files) || !checkpoint.files.every((f) => typeof f.path === "string" && typeof f.code === "string")) throw new Error("Invalid checkpoint contents.");
  // Validate every destination before touching any source files.
  for (const file of checkpoint.files) resolveSafeWorkspacePath(runtime.workspaceDir, file.path);
  await createWorkspaceCheckpoint(runtime, `Before restoring ${id}`);
  await runtime.stopAllServers();
  const wanted = new Set(checkpoint.files.map((f) => f.path));
  for (const file of await runtime.listFiles()) if (!wanted.has(file.path)) await runtime.deleteFile(file.path);
  for (const file of checkpoint.files) await runtime.writeFile(file.path, file.code);
  runtime.ledger.testStatus = "not_run";
  runtime.ledger.codeExecuted = false;
  await runtime.listFiles();
}
