import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), status: vi.fn(), pause: vi.fn() }));
vi.mock("@/lib/agent/sessions", () => ({ sessions: mock, BrowserInputConflict: class extends Error {} }));
vi.mock("@/lib/agent/runner", () => ({ pauseAgentForTakeover: mock.pause }));
vi.mock("@/lib/server/chats", () => ({ requireChat: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/auth-token", () => ({ verifyLive: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/server/identity", () => ({
  route: (fn: (...args: unknown[]) => unknown) => (req: unknown, ctx: unknown) => fn(req, { ownerId: "owner" }, ctx),
  HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  errorResponse: (e: Error) => Response.json({ error: e.message }, { status: 500 }),
}));
import { POST as input } from "@/app/api/sessions/[chatId]/input/route";
import { POST as control } from "@/app/api/sessions/[chatId]/takeover/route";

const ctx = { params: Promise.resolve({ chatId: "chat" }) };
const req = (body: unknown, direct = false) => new NextRequest(`https://fixture.test/api/sessions/chat/input${direct ? "?t=signed" : ""}`, { method: "POST", headers: { "content-type": direct ? "text/plain" : "application/json" }, body: JSON.stringify(body) });
const session = () => {
  const s = { takeover: false, running: false, viewEpoch: 3, controlVersion: 7, inputBatch: vi.fn().mockResolvedValue(undefined), setTakeover: vi.fn((on: boolean) => { s.takeover = on; }) };
  return s;
};
beforeEach(() => vi.clearAllMocks());

describe("browser input endpoint", () => {
  it("repairs idle ownership and accepts the actual canvas pointer/text/wheel batch", async () => {
    const s = session(); mock.get.mockReturnValue(s);
    const events = [{ type: "down", x: 4, y: 8, button: "left" }, { type: "up", x: 4, y: 8, button: "left" }, { type: "text", text: "é漢🦊" }, { type: "wheel", dx: 0, dy: 140 }];
    const r = await input(req({ events, epoch: 3, protocol: 2 }), ctx);
    expect(r.status).toBe(200); expect(s.setTakeover).toHaveBeenCalledWith(true);
    expect(s.inputBatch).toHaveBeenCalledWith(events, 3, 7);
  });
  it("uses the same batch format for signed direct input without a preflight", async () => {
    const s = session(); s.takeover = true; mock.get.mockReturnValue(s);
    expect((await input(req({ events: [{ type: "key", key: "Control+Shift+ArrowLeft" }], epoch: 3 }, true), ctx)).status).toBe(200);
  });
  it("rejects invalid input before changing ownership or touching Playwright", async () => {
    const s = session(); mock.get.mockReturnValue(s);
    const r = await input(req({ events: [{ type: "move", x: null, y: 2 }] }), ctx);
    expect(r.status).toBe(400); expect((await r.json()).code).toBe("INVALID_INPUT");
    expect(s.inputBatch).not.toHaveBeenCalled(); expect(s.setTakeover).not.toHaveBeenCalled();
  });
  it("rejects old visual epochs and active agent ownership with recoverable codes", async () => {
    const s = session(); s.running = true; mock.get.mockReturnValue(s);
    const r = await input(req({ events: [{ type: "click", x: 1, y: 2 }], epoch: 2 }), ctx);
    expect(r.status).toBe(409); expect(await r.json()).toMatchObject({ code: "STALE_VIEW", epoch: 3 });
    const active = await input(req({ events: [{ type: "click", x: 1, y: 2 }], epoch: 3 }), ctx);
    expect((await active.json()).code).toBe("CONTROL_REQUIRED"); expect(s.inputBatch).not.toHaveBeenCalled();
  });
  it("restores a suspended session through its authenticated host route", async () => {
    const s = session(); mock.get.mockReturnValue(undefined); mock.status.mockResolvedValue({ status: "suspended" }); mock.open.mockResolvedValue(s);
    const r = await input(req({ events: [{ type: "text", text: "restored" }] }), ctx);
    expect(r.status).toBe(200); expect(mock.open).toHaveBeenCalledWith("chat", "owner");
  });
  it("Take control pauses the run and acknowledges the current epoch", async () => {
    const s = session(); s.running = true; mock.get.mockReturnValue(s);
    const r = await control(req({ on: true }), ctx);
    expect(mock.pause).toHaveBeenCalledWith("chat"); expect(s.takeover).toBe(true);
    expect(await r.json()).toMatchObject({ takeover: true, epoch: 3 });
  });
  it("a delayed recovery cannot take control away from a newer run", async () => {
    const s = session(); s.running = true; mock.get.mockReturnValue(s);
    const r = await control(req({ on: true, resetInput: true, control: 6 }), ctx);
    expect(r.status).toBe(409); expect((await r.json()).code).toBe("STALE_CONTROL");
    expect(mock.pause).not.toHaveBeenCalled(); expect(s.setTakeover).not.toHaveBeenCalled();
    const inputResponse = await input(req({ events: [{ type: "down", x: 1, y: 2, button: "left" }], control: 6 }), ctx);
    expect(inputResponse.status).toBe(409); expect(s.inputBatch).not.toHaveBeenCalled();
  });
  it("rejects old-host input even when its epoch and control counters happen to match", async () => {
    const s = session(); mock.get.mockReturnValue(s);
    const r = await input(req({ events: [{ type: "click", x: 1, y: 2 }], epoch: 3, control: 7, sessionId: "old-host-session" }), ctx);
    expect(r.status).toBe(409); expect((await r.json()).code).toBe("SESSION_CHANGED");
    expect(s.inputBatch).not.toHaveBeenCalled();
    const recovery = await control(req({ on: true, resetInput: true, control: 7, sessionId: "old-host-session" }), ctx);
    expect(recovery.status).toBe(409); expect(mock.pause).not.toHaveBeenCalled();
  });
});
