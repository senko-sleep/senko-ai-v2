import { NextRequest } from "next/server";
import { addMessage, getMessages, maybeTitle, requireChat, truncateMessagesFrom, updateMessage, type MessageMeta, type TruncateTarget } from "@/lib/server/chats";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { absorbMemories } from "@/lib/server/persona";
import { finishRun, registerRun, takePausedGoal, type RunEvent } from "@/lib/agent/runner";
import { runLayered } from "@/lib/agent/layers";
import { sessions } from "@/lib/agent/sessions";
import { loadCheckpoint, type Checkpoint } from "@/lib/agent/checkpoint";
import { forwardAgentRequest } from "@/lib/server/agent-forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// No task time limit of our own; this is just the platform's cap on one HTTP response.
export const maxDuration = 300;

/**
 * POST { goal, provider?, imageIds?, resume?, truncateFrom? } -> SSE of RunEvent.
 * Saves the request as a user message and the outcome as an assistant message.
 * resume: true continues a goal that was paused when you took control.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forwarded = await forwardAgentRequest(req);
  if (forwarded) return forwarded;
  let who;
  let chatId: string;
  let body: { goal?: string; provider?: string; imageIds?: string[]; resume?: boolean; truncateFrom?: TruncateTarget };
  try {
    who = await identify(req);
    chatId = (await params).id;
    await requireChat(who.ownerId, chatId);
    body = await req.json().catch(() => ({}));
  } catch (e) {
    return errorResponse(e);
  }

  let goal = String(body.goal || "").trim();
  let checkpoint: Checkpoint | null = null;
  let resumeNote: string | undefined;
  if (body.resume) {
    // The task's saved progress (plan, steps so far) survives restarts, so Resume continues
    // from the last step instead of starting over.
    const paused = takePausedGoal(chatId);
    checkpoint = await loadCheckpoint(chatId);
    if (checkpoint && paused && checkpoint.goal !== paused) checkpoint = null;
    const base = paused || checkpoint?.goal;
    if (!base && !goal) return errorResponse(new HttpError(409, "There's no paused task to continue."));
    if (base) goal = base;
    const note = paused ? "The user took manual control for a moment and may have changed the page. Continue from where the browser is now." : undefined;
    if (checkpoint) resumeNote = note;
    else if (note) goal = `${goal}\n\n(${note})`;
  }
  if (!goal) return errorResponse(new HttpError(400, "Tell the agent what to do."));

  if (body.truncateFrom && typeof body.truncateFrom === "object") {
    await truncateMessagesFrom(chatId, body.truncateFrom);
  }

  const history = await getMessages(chatId, 12);
  const context = history
    .filter((m) => m.content.trim())
    .slice(-8)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n");

  let userMessageId: string | undefined;
  if (!body.resume) {
    userMessageId = await addMessage(chatId, "user", goal, (body.imageIds || []).slice(0, 10));
    await maybeTitle(chatId, goal, body.provider);
  }
  const trail: { label: string; url?: string }[] = [];
  const meta: MessageMeta = { agent: { goal, status: "running", trail } };
  const replyId = await addMessage(chatId, "assistant", "", [], meta);

  const ctl = registerRun(chatId, goal);
  // Acquire before emitting any events; the run's own signal fences its cleanup.
  sessions.get(chatId)?.beginAgent(ctl.signal);
  req.signal.addEventListener("abort", () => {
    // Closing the page doesn't stop the agent; only the Stop button does.
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: RunEvent | { type: "start"; messageId: string; userMessageId?: string }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          open = false;
        }
      }, 10_000);
      send({ type: "start", messageId: replyId, userMessageId });

      let content = "";
      const imageIds: string[] = [];
      const emit = (e: RunEvent) => {
        if (["done", "error", "stopped", "paused"].includes(e.type)) {
          finishRun(chatId, ctl);
          sessions.get(chatId)?.endAgent(ctl.signal);
        }
        if (e.type === "step") trail[e.id - 1] = { label: e.label, url: e.url };
        if (e.type === "done") {
          content = e.answer;
          imageIds.push(...e.imageIds);
          meta.agent = { goal, status: "done", trail, url: e.url };
          if (e.url) meta.actions = [{ url: e.url, label: "Open on my device" }];
          if (e.provider) Object.assign(meta, { providerLabel: e.provider, model: e.model });
        }
        if (e.type === "error") {
          meta.error = e.message;
          meta.agent = { goal, status: "error", trail };
        }
        if (e.type === "stopped") meta.agent = { goal, status: "stopped", trail };
        if (e.type === "paused") {
          meta.agent = { goal, status: "paused", trail };
          content = e.reason;
        }
        send(e);
      };

      try {
        await runLayered({ chatId, ownerId: who.ownerId, goal, provider: body.provider, signal: ctl.signal, emit, context, checkpoint, resumeNote });
      } finally {
        clearInterval(ping);
        sessions.get(chatId)?.endAgent(ctl.signal);
        finishRun(chatId, ctl);
        if (meta.agent?.status === "running") meta.agent = { goal, status: "stopped", trail };
        content = await absorbMemories(who.ownerId, content).catch(() => content);
        if (!content && meta.agent?.status === "stopped") content = "Stopped. The browser is still open where I left off.";
        await updateMessage(replyId, content, meta, imageIds).catch((err) => console.error("[agent] save failed", err));
        open = false;
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
