import { route } from "@/lib/server/identity";
import { complete } from "@/lib/llm";
import { CODE_SYSTEM, buildStepPrompt, parseStep, validateStepRequest } from "@/lib/code-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST one step of a coding job. The project lives in the user's browser; the client sends
// the file list (and the files the model asked to read) plus the last command output, and gets
// back file writes, commands to run, or "done" with a summary.
export const POST = route(async (req) => {
  const body: unknown = await req.json().catch(() => null);
  if (!validateStepRequest(body)) {
    return Response.json({ error: "Invalid coding step: check goal, files, history, step bounds and context size." }, { status: 400 });
  }
  const res = await complete(
    [
      { role: "system", content: CODE_SYSTEM },
      { role: "user", content: buildStepPrompt(body) },
    ],
    { signal: req.signal, maxTokens: 16000, temperature: 0.2, priority: "background", maxWaitMs: 90_000, strong: true },
  );
  const step = parseStep(res.text);
  if (!step) return Response.json({ error: "The model's reply wasn't usable. Retrying usually works.", raw: res.text.slice(0, 400) }, { status: 502 });
  return Response.json({ ...step, model: res.model }, { headers: { "Cache-Control": "no-store" } });
});
