import { route, HttpError } from "@/lib/server/identity";
import { deleteSkill, loadSkills } from "@/lib/agent/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, who) => {
  const skills = await loadSkills(who.ownerId);
  return Response.json({ skills });
});

export const DELETE = route(async (req, who) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) throw new HttpError(400, "Missing skill id.");
  await loadSkills(who.ownerId);
  const removed = deleteSkill(who.ownerId, id);
  if (!removed) throw new HttpError(404, "Saved workflow not found.");
  return Response.json({ ok: true });
});
