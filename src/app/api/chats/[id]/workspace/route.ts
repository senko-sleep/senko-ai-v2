import { NextRequest } from "next/server";
import { getMessages, requireChat } from "@/lib/server/chats";
import { errorResponse, HttpError, identify } from "@/lib/server/identity";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";
import { runAutonomousCodingWorkflow } from "@/lib/agent/coding-agent";
import { createWorkspaceCheckpoint, listWorkspaceCheckpoints, restoreWorkspaceCheckpoint } from "@/lib/agent/workspace-checkpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function derivePrimaryGoalForChat(chatId: string, chatTitle?: string): Promise<string | undefined> {
  try {
    const msgs = await getMessages(chatId, 30);
    const codeTasks = msgs
      .map((m) => m.meta?.codeTask?.trim())
      .filter((t): t is string => Boolean(t));
    const userPrompts = msgs
      .filter((m) => m.role === "user" && m.content.trim().length > 3)
      .map((m) => m.content.trim());
    if (codeTasks.length > 0 && userPrompts.length > 0) {
      const first = userPrompts[0];
      const task = codeTasks[codeTasks.length - 1];
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      // Avoid "X — X" when the code task just repeats the user's prompt.
      if (norm(task).includes(norm(first))) return task;
      if (norm(first).includes(norm(task))) return first;
      return `${first} — ${task}`;
    }
    if (codeTasks.length > 0) return codeTasks[codeTasks.length - 1];
    if (userPrompts.length > 0) return userPrompts.slice(0, 3).join(" | ");
    if (chatTitle && chatTitle !== "New chat") return chatTitle;
  } catch {
    /* ignore */
  }
  return undefined;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const who = await identify(req);
    const chatId = (await params).id;
    const chat = await requireChat(who.ownerId, chatId);
    const ws = new CodingWorkspaceRuntime(chatId);
    await ws.listFiles();
    await ws.refreshPersistedEvidence();
    const derivedGoal = await derivePrimaryGoalForChat(chatId, chat.title);
    await ws.syncPrimaryGoal(derivedGoal);
    return Response.json({ ledger: ws.ledger, checkpoints: await listWorkspaceCheckpoints(ws) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const who = await identify(req);
    const chatId = (await params).id;
    const chat = await requireChat(who.ownerId, chatId);
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      path?: string;
      fromPath?: string;
      toPath?: string;
      content?: string;
      command?: string;
      approved?: boolean;
      goal?: string;
      primaryGoal?: string;
      assistantDraft?: string;
      applyLiveInstruction?: boolean;
      stream?: boolean;
      inspectBrowser?: boolean;
      url?: string;
      interactions?: { action: "click" | "type" | "viewport"; selector?: string; text?: string; width?: number; height?: number }[];
      checkpointId?: string;
      expectedText?: string[];
      requireMediaPlayback?: boolean;
    };

    const ws = new CodingWorkspaceRuntime(chatId);
    const derivedGoal = await derivePrimaryGoalForChat(chatId, chat.title);
    await ws.syncPrimaryGoal(body.primaryGoal || derivedGoal);

    switch (body.action) {
      case "checkpoint": {
        const checkpoint = await createWorkspaceCheckpoint(ws, body.goal || "Manual checkpoint");
        return Response.json({ ok: true, checkpoint: { id: checkpoint.id, label: checkpoint.label, createdAt: checkpoint.createdAt } });
      }
      case "restore_checkpoint": {
        if (!body.checkpointId) throw new HttpError(400, "checkpointId is required.");
        await restoreWorkspaceCheckpoint(ws, body.checkpointId);
        return Response.json({ ok: true, ledger: ws.ledger });
      }
      case "set_primary_goal": {
        if (typeof body.primaryGoal !== "string" || !body.primaryGoal.trim()) {
          throw new HttpError(400, "primaryGoal is required.");
        }
        await ws.syncPrimaryGoal(body.primaryGoal.trim(), true);
        await ws.listFiles();
        return Response.json({ ok: true, ledger: ws.ledger });
      }
      case "write_file": {
        if (!body.path || typeof body.content !== "string") {
          throw new HttpError(400, "Both path and content are required.");
        }
        const diff = await ws.writeFile(body.path, body.content);
        await ws.listFiles();
        return Response.json({ ok: true, diff, ledger: ws.ledger });
      }

      case "move_file": {
        if (!body.fromPath || !body.toPath) {
          throw new HttpError(400, "Both fromPath and toPath are required.");
        }
        const diff = await ws.moveFile(body.fromPath, body.toPath);
        await ws.listFiles();
        return Response.json({ ok: true, diff, ledger: ws.ledger });
      }

      case "delete_file": {
        if (!body.path) throw new HttpError(400, "File path is required.");
        await ws.deleteFile(body.path);
        await ws.listFiles();
        return Response.json({ ok: true, ledger: ws.ledger });
      }

      case "run_command": {
        if (!body.command?.trim()) throw new HttpError(400, "Command is required.");
        const record = await ws.runCommand(body.command.trim(), { approved: Boolean(body.approved) });
        await ws.listFiles();
        return Response.json({ ok: record.exitCode === 0, record, ledger: ws.ledger });
      }

      case "start_server": {
        if (!body.command?.trim()) throw new HttpError(400, "Command is required.");
        const server = await ws.startServer({ command: body.command, approved: Boolean(body.approved) });
        return Response.json({ ok: server.status === "running", server, ledger: ws.ledger });
      }

      case "stop_servers": {
        await ws.stopAllServers();
        return Response.json({ ok: true, ledger: ws.ledger });
      }

      case "inspect_browser": {
        let targetUrl = body.url?.trim() || "";
        let startedTempServer = false;
        if (!targetUrl) {
          const srv = await ws.startServer({ command: "static" });
          targetUrl = srv.url;
          startedTempServer = true;
        }
        try {
          const inspection = await ws.inspectWebsiteWithBrowser({
            url: targetUrl,
            interactions: body.interactions,
            expectedText: body.expectedText,
            requireMediaPlayback: body.requireMediaPlayback,
          });
          return Response.json({ ok: inspection.passed, inspection, ledger: ws.ledger });
        } finally {
          if (startedTempServer) {
            await ws.stopAllServers().catch(() => {});
          }
        }
      }

      case "bundle_preview": {
        const bundled = await ws.bundleFrontendApp(body.path);
        return Response.json({
          ok: bundled.errors.length === 0 && Boolean(bundled.html),
          html: bundled.html,
          entryPath: bundled.entryPath,
          errors: bundled.errors,
          ledger: ws.ledger,
        });
      }

      case "probe_network": {
        const diagnostics = await ws.probeNetwork(body.url);
        return Response.json({ ok: diagnostics.online, diagnostics, ledger: ws.ledger });
      }

      case "run_workflow":
      case "agent_chat": {
        const applyLiveInstruction = body.action === "agent_chat" || Boolean(body.applyLiveInstruction);
        if (body.stream) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              const send = (payload: unknown) => {
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                } catch {
                  /* stream closed */
                }
              };
              try {
                const result = await runAutonomousCodingWorkflow({
                  chatId,
                  goal: body.goal || "Build, execute, and verify workspace project",
                  primaryGoal: ws.ledger.primaryGoal,
                  assistantDraft: body.assistantDraft,
                  applyLiveInstruction,
                  inspectBrowser: body.inspectBrowser,
                  interactions: body.interactions,
                  signal: req.signal,
                  onStep: (step) => {
                    send({ type: "step", step, ledger: ws.ledger });
                  },
                });
                send({ type: "done", ok: result.verified, result, ledger: result.ledger });
              } catch (err) {
                send({
                  type: "error",
                  error: err instanceof Error ? err.message : String(err),
                  ledger: ws.ledger,
                });
              } finally {
                try {
                  controller.close();
                } catch {
                  /* ignore */
                }
              }
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        }

        const result = await runAutonomousCodingWorkflow({
          chatId,
          goal: body.goal || "Build, execute, and verify workspace project",
          primaryGoal: ws.ledger.primaryGoal,
          assistantDraft: body.assistantDraft,
          applyLiveInstruction,
          inspectBrowser: body.inspectBrowser,
          interactions: body.interactions,
          signal: req.signal,
        });
        return Response.json({ ok: result.verified, result, ledger: result.ledger });
      }

      default:
        throw new HttpError(400, `Unsupported workspace action: "${body.action || ""}"`);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
