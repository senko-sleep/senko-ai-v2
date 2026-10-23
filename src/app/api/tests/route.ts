import { route } from "@/lib/server/identity";
import { listRuns, scenarioList } from "@/lib/testing/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> all test scenarios + recent runs (without screenshots).
export const GET = route(async () =>
  Response.json({
    scenarios: scenarioList(),
    runs: listRuns().map(({ shots, logs, ...r }) => ({ ...r, shotCount: shots.length, logCount: logs.length })),
  })
);
