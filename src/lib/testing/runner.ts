// Runs test scenarios in the background and keeps their results for the Test Panel.
// Tests run under their own owner id, so they never clutter your real chat history.
import { SCENARIOS, scenario, type TestStatus } from "./scenarios";
import { newId } from "@/lib/server/db";

export const TEST_OWNER = "o_testrunner";

export interface TestRun {
  id: string;
  scenarioId: string;
  title: string;
  state: "running" | "finished";
  status?: TestStatus;
  summary?: string;
  startedAt: number;
  finishedAt?: number;
  logs: { at: number; text: string }[];
  shots: { label: string; mime: string; data: string }[];
}

const g = globalThis as unknown as { __testRuns?: Map<string, TestRun>; __testCtl?: Map<string, AbortController> };
const runs = (g.__testRuns ??= new Map());
const ctls = (g.__testCtl ??= new Map());

export function listRuns(): TestRun[] {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
}

export function getRun(id: string) {
  return runs.get(id);
}

export function cancelRun(id: string) {
  ctls.get(id)?.abort();
}

/** Start a scenario in the background; returns immediately. */
export function startRun(scenarioId: string, fixtureBase: string, params: Record<string, string> = {}): TestRun {
  const sc = scenario(scenarioId);
  if (!sc) throw new Error(`Unknown test "${scenarioId}"`);
  const run: TestRun = { id: newId("t_"), scenarioId, title: sc.title, state: "running", startedAt: Date.now(), logs: [], shots: [] };
  runs.set(run.id, run);
  const ctl = new AbortController();
  ctls.set(run.id, ctl);
  void execute(run, fixtureBase, params, ctl.signal).finally(() => ctls.delete(run.id));
  return run;
}

export async function execute(run: TestRun, fixtureBase: string, params: Record<string, string>, signal: AbortSignal) {
  const sc = scenario(run.scenarioId)!;
  try {
    const r = await sc.run({
      ownerId: TEST_OWNER,
      signal,
      params,
      log: (text) => run.logs.push({ at: Date.now(), text }),
      shot: (label, buf, mime = "image/jpeg") => {
        if (buf.length) run.shots.push({ label, mime, data: buf.toString("base64") });
      },
      fixtureUrl: (name, query) => `${fixtureBase.replace(/\/$/, "")}/test-fixtures/${name}${query ? `?${query}` : ""}`,
    });
    run.status = r.status;
    run.summary = r.summary;
  } catch (e) {
    run.status = "fail";
    run.summary = e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e);
    run.logs.push({ at: Date.now(), text: `Error: ${e instanceof Error ? e.stack || e.message : e}` });
  } finally {
    run.state = "finished";
    run.finishedAt = Date.now();
  }
  return run;
}

export function scenarioList() {
  return SCENARIOS.map(({ id, group, title, description, expected }) => ({ id, group, title, description, expected }));
}
