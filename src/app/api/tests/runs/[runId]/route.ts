import { HttpError, route } from "@/lib/server/identity";
import { cancelRun, getRun } from "@/lib/testing/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

// GET -> full result of one run, including logs and screenshots.
export const GET = route<Ctx>(async (_req, _who, { params }) => {
  const run = getRun((await params).runId);
  if (!run) throw new HttpError(404, "Test run not found (results are kept in memory until the server restarts).");
  return Response.json({ run });
});

// DELETE -> cancel a running test.
export const DELETE = route<Ctx>(async (_req, _who, { params }) => {
  cancelRun((await params).runId);
  return Response.json({ ok: true });
});
