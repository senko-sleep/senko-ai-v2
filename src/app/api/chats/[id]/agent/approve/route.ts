import { requireChat } from "@/lib/server/chats";
import { route, HttpError } from "@/lib/server/identity";
import { denyApproval, getPendingApproval, grantApproval, loadAuditLog } from "@/lib/agent/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  -> the pending approval (if any) and this task's audit log.
// POST { key, approve } -> approve or deny exactly the pending action. Approving does not resume
// the task by itself; the client then resumes it, and the resumed run consumes the approval once.
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  return Response.json({ pending: getPendingApproval(id) ?? null, audit: await loadAuditLog(id) });
});

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, who, { params }) => {
  const { id } = await params;
  await requireChat(who.ownerId, id);
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; approve?: unknown };
  if (typeof body.key !== "string" || !body.key) throw new HttpError(400, "Missing approval key.");
  const ok = body.approve === true ? grantApproval(id, body.key) : denyApproval(id, body.key);
  if (!ok) throw new HttpError(409, "That approval request is no longer pending.");
  return Response.json({ ok: true, approved: body.approve === true });
});
