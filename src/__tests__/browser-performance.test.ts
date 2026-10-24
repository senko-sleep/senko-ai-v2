import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameDecoder } from "@/lib/live-frame";
import { appendInput, createInputChannel, deliverInputBatch, isBrowserInput, pagePoint, type BrowserInput } from "@/lib/live-input";
import { createLiveStream } from "@/lib/server/live-stream";
import { createFramePublisher } from "@/lib/agent/frame-publisher";
import { BrowserSession, type BusEvent } from "@/lib/agent/sessions";

vi.mock("@/lib/server/db", () => ({ json: vi.fn(), newId: vi.fn(), q: vi.fn(), q1: vi.fn(), toBuffer: vi.fn() }));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("live decode lifecycle", () => {
  it("decodes only the newest waiting frame and keeps its geometry", async () => {
    const first = deferred<string>();
    const decode = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("newest");
    const ready = vi.fn();
    const decoder = createFrameDecoder(decode, ready, vi.fn());
    decoder.push({ data: "one", width: 1280 });
    decoder.push({ data: "two", width: 640 });
    decoder.push({ data: "three", width: 1920 });
    expect(decode).toHaveBeenCalledTimes(1);
    first.resolve("first"); await settle();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenLastCalledWith("newest", { data: "three", width: 1920 });
  });

  it.each(["reset", "dispose"] as const)("closes an in-flight bitmap after %s without painting it", async action => {
    const first = deferred<string>();
    const ready = vi.fn(), close = vi.fn();
    const decoder = createFrameDecoder(() => first.promise, ready, close);
    decoder.push("old"); decoder[action](); first.resolve("bitmap"); await settle();
    expect(ready).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledWith("bitmap");
  });

  it("recovers from a corrupt frame", async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error("corrupt")).mockResolvedValue("ok");
    const ready = vi.fn();
    const decoder = createFrameDecoder(decode, ready, vi.fn());
    decoder.push("bad"); decoder.push("good"); await settle();
    expect(ready).toHaveBeenCalledWith("ok", "good");
  });
});

describe("display-paced frame delivery", () => {
  it("sends the first update immediately and the final state even when motion stops", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const publisher = createFramePublisher(publish, () => 120);
    publisher.push("first"); publisher.push("obsolete"); publisher.push("final");
    expect(publish.mock.calls).toEqual([["first"]]);
    await vi.advanceTimersByTimeAsync(9);
    expect(publish.mock.calls).toEqual([["first"], ["final"]]);
    publisher.push("after-stop"); publisher.dispose(); await vi.runAllTimersAsync();
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe("live stream backpressure", () => {
  it("replaces stale frames instead of replaying a growing backlog", async () => {
    let emit!: (e: { type: string; id: number }) => void;
    const unsubscribe = vi.fn();
    const stream = createLiveStream(fn => { emit = fn; return unsubscribe; }, new AbortController().signal);
    for (let id = 0; id < 1000; id++) emit({ type: "frame", id });
    const reader = stream.getReader();
    const parse = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    expect((await parse()).id).toBe(0);
    expect((await parse()).id).toBe(999);
    await reader.cancel(); expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("retains clicks and status but clears stale transient state on reset", async () => {
    type E = { type: string; id?: number; kind?: string };
    let emit!: (e: E) => void;
    const stream = createLiveStream<E>(fn => { emit = fn; return () => {}; }, new AbortController().signal);
    emit({ type: "status", id: 1 }); emit({ type: "frame", id: 2 }); emit({ type: "cursor", id: 3 });
    emit({ type: "reset" }); emit({ type: "cursor", kind: "click", id: 4 }); emit({ type: "frame", id: 5 });
    const reader = stream.getReader();
    const received = [];
    for (let i = 0; i < 4; i++) received.push(JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6)));
    expect(received.map(e => e.id || e.type)).toEqual([1, "reset", 4, 5]);
    await reader.cancel();
  });

  it("keeps executed cursor waypoints in order before the click", async () => {
    type E = { type: string; id?: number; kind?: string };
    let emit!: (e: E) => void;
    const stream = createLiveStream<E>(fn => { emit = fn; return () => {}; }, new AbortController().signal);
    emit({ type: "cursor", kind: "move", id: 1 });
    emit({ type: "cursor", kind: "move", id: 2 });
    emit({ type: "cursor", kind: "click", id: 3 });
    emit({ type: "frame", id: 4 });
    const reader = stream.getReader();
    const received = [];
    for (let i = 0; i < 4; i++) received.push(JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6)));
    expect(received.map(e => e.id)).toEqual([1, 2, 3, 4]);
    await reader.cancel();
  });

  it("disconnects a stalled viewer with too much reliable history", async () => {
    let emit!: (e: { type: string }) => void;
    const unsubscribe = vi.fn();
    const stream = createLiveStream(fn => { emit = fn; return unsubscribe; }, new AbortController().signal);
    for (let i = 0; i < 515; i++) emit({ type: "step" });
    await expect(stream.getReader().read()).rejects.toThrow("too slow");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("ordered input batching", () => {
  it("batches a typing burst into one round trip while preserving every key", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = createInputChannel(send, vi.fn());
    for (const key of "abcdefghijklmnopqrst") channel.push({ type: "key", key });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls.flatMap(([events]) => events).map(e => e.key).join("")).toBe("abcdefghijklmnopqrst");
    channel.dispose();
  });

  it("keeps pointer actions immediate", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = createInputChannel(send, vi.fn());
    channel.push({ type: "click", x: 12, y: 24 });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith([{ type: "click", x: 12, y: 24 }], expect.any(AbortSignal));
    channel.dispose();
  });

  it("coalesces continuous input without crossing clicks or keys", () => {
    const queue: BrowserInput[] = [];
    appendInput(queue, { type: "move", x: 1, y: 1 }); appendInput(queue, { type: "move", x: 2, y: 2 });
    appendInput(queue, { type: "key", key: "Enter" });
    appendInput(queue, { type: "wheel", dy: 4 }); appendInput(queue, { type: "wheel", dy: 6 });
    expect(queue).toEqual([{ type: "move", x: 2, y: 2 }, { type: "key", key: "Enter" }, { type: "wheel", dx: 0, dy: 10 }]);
  });

  it("drops pending old-chat input and aborts the transport when disposed", async () => {
    const first = deferred<void>();
    const send = vi.fn(() => first.promise);
    const channel = createInputChannel(send, vi.fn());
    channel.push({ type: "key", key: "a" }); channel.push({ type: "key", key: "b" });
    await new Promise(resolve => setTimeout(resolve, 8));
    channel.dispose(); first.resolve(); await settle();
    expect(send).toHaveBeenCalledOnce();
    expect((send.mock.calls[0] as unknown as [unknown, AbortSignal])[1].aborted).toBe(true);
  });

  it("does not retry ambiguous transport failures", async () => {
    const error = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error("response lost"));
    const channel = createInputChannel(send, error);
    channel.push({ type: "key", key: "a" }); channel.push({ type: "key", key: "b" });
    await new Promise(resolve => setTimeout(resolve, 8)); await settle();
    expect(send).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce();
  });

  it.each([{ type: "move", x: NaN, y: 1 }, { type: "key", key: 1 }, { type: "down", x: 1, y: 2, button: "invalid" }, { type: "wheel", dy: Infinity }, { type: "nav", action: "invalid" }])("rejects malformed input: %j", input => {
    expect(isBrowserInput(input)).toBe(false);
  });
});

function fakeSession() {
  const page = { title: vi.fn().mockResolvedValue("fixture"), url: () => "https://fixture.test", viewportSize: () => ({ width: 1280, height: 800 }),
    goto: vi.fn().mockResolvedValue(undefined),
    mouse: { move: vi.fn().mockResolvedValue(undefined), click: vi.fn().mockResolvedValue(undefined), wheel: vi.fn().mockResolvedValue(undefined), down: vi.fn().mockResolvedValue(undefined), up: vi.fn().mockResolvedValue(undefined) },
    keyboard: { press: vi.fn().mockResolvedValue(undefined), insertText: vi.fn().mockResolvedValue(undefined) } };
  let frame!: (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => void;
  const cdp = { on: vi.fn((_: string, fn: typeof frame) => { frame = fn; }), send: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined) };
  const context = { newCDPSession: vi.fn().mockResolvedValue(cdp) };
  const session = new BrowserSession("fixture", "owner");
  session.context = context as never; session.pages = [page as never]; session.status = "active"; session.takeover = true;
  return { session, page, context, cdp, frame: () => frame };
}

describe("browser session performance and concurrency", () => {
  it("bounds reconnect replay during long runs and stores the latest step state", () => {
    const { session } = fakeSession();
    session.emit({ type: "plan", steps: ["Long task"] });
    for (let id = 0; id < 1000; id++) {
      session.emit({ type: "step", id, label: "Step", status: "running", at: id });
      session.emit({ type: "step", id, label: "Step", status: "done", at: id });
    }
    expect(session.replay).toHaveLength(256);
    expect(session.replay[0].type).toBe("plan");
    expect(session.replay.at(-1)).toMatchObject({ id: 999, status: "done" });
  });
  it("applies scrolling in one command without animation delays", async () => {
    const { session, page } = fakeSession();
    await session.input({ type: "wheel", dx: 0, dy: 800, x: 100, y: 200 });
    expect(page.mouse.wheel.mock.calls).toEqual([[0, 800]]);
  });

  it("serializes batches from simultaneous viewers", async () => {
    const { session, page } = fakeSession();
    const first = deferred<void>(); page.keyboard.press.mockReturnValueOnce(first.promise);
    const a = session.inputBatch([{ type: "key", key: "a" }, { type: "key", key: "b" }]);
    const b = session.input({ type: "key", key: "c" });
    await settle(); expect(page.keyboard.press.mock.calls).toEqual([["a"]]);
    first.resolve(); await Promise.all([a, b]);
    expect(page.keyboard.press.mock.calls).toEqual([["a"], ["b"], ["c"]]);
  });

  it("keeps accepting input while a navigation waits on the network", async () => {
    const { session, page } = fakeSession();
    const navigation = deferred<void>(); page.goto.mockReturnValueOnce(navigation.promise);
    await session.inputBatch([{ type: "goto", url: "example.test" }, { type: "key", key: "Escape" }]);
    expect(page.goto).toHaveBeenCalledWith("https://example.test", expect.objectContaining({ waitUntil: "commit" }));
    expect(page.keyboard.press).toHaveBeenCalledWith("Escape");
    navigation.resolve();
  });

  it("doesn't apply queued old-tab input to the newly selected page", async () => {
    const { session, page } = fakeSession();
    const first = deferred<void>(); page.keyboard.press.mockReturnValueOnce(first.promise);
    const work = session.inputBatch([{ type: "key", key: "a" }, { type: "key", key: "b" }]);
    await settle(); session.pages = [fakeSession().page as never]; first.resolve(); await expect(work).rejects.toMatchObject({ code: "STALE_VIEW" });
    expect(page.keyboard.press.mock.calls).toEqual([["a"]]);
  });

  it("rejects delayed input from a previous visual epoch", async () => {
    const { session, page } = fakeSession();
    session.viewEpoch = 2;
    await expect(session.inputBatch([{ type: "key", key: "Enter" }], 1)).rejects.toMatchObject({ code: "STALE_VIEW" });
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });

  it("cancels queued input when control changes, even if handed back before execution", async () => {
    const { session, page } = fakeSession();
    const first = deferred<void>(); page.keyboard.press.mockReturnValueOnce(first.promise);
    const work = session.inputBatch([{ type: "key", key: "a" }, { type: "key", key: "b" }]);
    await settle(); session.setTakeover(false); session.setTakeover(true); first.resolve(); await expect(work).rejects.toMatchObject({ code: "STALE_VIEW" });
    expect(page.keyboard.press.mock.calls).toEqual([["a"]]);
  });

  it("releases a drag if takeover ends during an in-flight press", async () => {
    const { session, page } = fakeSession();
    const first = deferred<void>(); page.mouse.down.mockReturnValueOnce(first.promise);
    const work = session.input({ type: "down", x: 10, y: 10, button: "left" });
    await settle(); session.setTakeover(false); first.resolve(); await work;
    expect(page.mouse.up).toHaveBeenCalledWith({ button: "left" });
  });

  it("avoids duplicate CDP capture sessions and ACKs frames immediately", async () => {
    const { session, context, cdp, frame } = fakeSession();
    const events: BusEvent[] = [];
    const unsubscribe = session.subscribe(e => events.push(e), 120);
    await Promise.all([session.startCast(), session.startCast()]);
    expect(context.newCDPSession).toHaveBeenCalledOnce();
    frame()({ data: "frame", sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 800 } });
    expect(cdp.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 7 });
    expect(events.some(e => e.type === "frame")).toBe(true);
    session.running = true; unsubscribe(); await session.stopCast();
    expect(cdp.detach).toHaveBeenCalledOnce();
  });
});

describe("ownership lifecycle", () => {
  it("starts idle sessions under user control", () => {
    expect(new BrowserSession("new", "owner").takeover).toBe(true);
  });

  it.each(["done", "failed", "stopped", "takeover"])("releases ownership after a %s task and accepts input", async () => {
    const { session, page } = fakeSession();
    const ctl = new AbortController();
    session.beginAgent(ctl.signal);
    expect(session.takeover).toBe(false);
    ctl.abort(); session.endAgent(ctl.signal);
    expect(session.running).toBe(false); expect(session.takeover).toBe(true);
    await session.input({ type: "text", text: "hello" });
    expect(page.keyboard.insertText).toHaveBeenCalledWith("hello");
  });

  it("ignores an old task's cleanup after a replacement takes ownership", () => {
    const { session } = fakeSession();
    const old = new AbortController(), next = new AbortController();
    session.beginAgent(old.signal); session.beginAgent(next.signal); session.endAgent(old.signal);
    expect(session.running).toBe(true); expect(session.takeover).toBe(false);
    session.endAgent(next.signal); expect(session.takeover).toBe(true);
  });

  it("keeps repeated take-control requests idempotent while input is in flight", async () => {
    const { session, page } = fakeSession();
    const first = deferred<void>(); page.keyboard.press.mockReturnValueOnce(first.promise);
    const work = session.inputBatch([{ type: "key", key: "a" }, { type: "key", key: "b" }]);
    await settle(); session.setTakeover(true); first.resolve(); await work;
    expect(page.keyboard.press.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("survives many user/agent handoffs", async () => {
    const { session, page } = fakeSession();
    for (let i = 0; i < 15; i++) {
      const ctl = new AbortController(); session.beginAgent(ctl.signal);
      ctl.abort("takeover"); session.setTakeover(true);
      await session.input({ type: "key", key: "ArrowRight" }); session.endAgent(ctl.signal);
    }
    expect(page.keyboard.press).toHaveBeenCalledTimes(15); expect(session.running).toBe(false);
  });

  it("releases held buttons during recovery and rejects late input from the failed lease", async () => {
    const { session, page } = fakeSession();
    const old = session.controlVersion;
    await session.input({ type: "down", x: 10, y: 10, button: "left" });
    session.setTakeover(true, true); await settle();
    expect(page.mouse.up).toHaveBeenCalledWith({ button: "left" });
    await expect(session.inputBatch([{ type: "down", x: 10, y: 10, button: "left" }], session.viewEpoch, old)).rejects.toMatchObject({ code: "STALE_VIEW" });
    expect(page.mouse.down).toHaveBeenCalledOnce();
    await session.input({ type: "text", text: "recovered" });
    expect(page.keyboard.insertText).toHaveBeenCalledWith("recovered");
  });
});

describe("input recovery transport", () => {
  const events: BrowserInput[] = [{ type: "click", x: 20, y: 30 }];
  const signal = new AbortController().signal;
  const transport = () => ({ epoch: () => 2, setEpoch: vi.fn(), claim: vi.fn().mockResolvedValue({ takeover: true, epoch: 2 }), request: vi.fn().mockResolvedValue(Response.json({ ok: true })) });

  it("claims once after a pre-execution rejection, then sends the same gesture once", async () => {
    const t = transport(); t.request.mockResolvedValueOnce(Response.json({ code: "CONTROL_REQUIRED" }, { status: 409 }));
    await deliverInputBatch(events, signal, t);
    expect(t.claim).toHaveBeenCalledOnce(); expect(t.request).toHaveBeenCalledTimes(2);
  });

  it("never replays an old-page click after control is acquired on a new view", async () => {
    const t = transport(); t.request.mockResolvedValueOnce(Response.json({ code: "CONTROL_REQUIRED" }, { status: 409 }));
    t.claim.mockResolvedValue({ takeover: true, epoch: 3 });
    await expect(deliverInputBatch(events, signal, t)).rejects.toMatchObject({ code: "STALE_VIEW", epoch: 3 });
    expect(t.request).toHaveBeenCalledOnce(); expect(t.setEpoch).toHaveBeenCalledWith(3);
  });

  it("does not retry a partial stale batch or an ambiguous network failure", async () => {
    const t = transport(); t.request.mockResolvedValueOnce(Response.json({ code: "STALE_VIEW", epoch: 3 }, { status: 409 }));
    await expect(deliverInputBatch(events, signal, t)).rejects.toMatchObject({ code: "STALE_VIEW" });
    expect(t.claim).not.toHaveBeenCalled(); expect(t.request).toHaveBeenCalledOnce();
    t.request.mockReset().mockRejectedValue(new Error("response lost"));
    await expect(deliverInputBatch(events, signal, t)).rejects.toThrow("response lost");
    expect(t.request).toHaveBeenCalledOnce();
  });

  it("bounds recovery even when the server still refuses ownership", async () => {
    const t = transport(); t.request.mockImplementation(async () => Response.json({ code: "CONTROL_REQUIRED" }, { status: 409 }));
    await expect(deliverInputBatch(events, signal, t)).rejects.toMatchObject({ code: "CONTROL_REQUIRED" });
    expect(t.claim).toHaveBeenCalledOnce(); expect(t.request).toHaveBeenCalledTimes(2);
  });

  it("maps letterboxed coordinates and clamps captured drags to page edges", () => {
    const fit = { x: 50, y: 0, w: 400, h: 250 }, vp = { w: 1280, h: 800 };
    expect(pagePoint(250, 125, fit, vp)).toEqual({ x: 640, y: 400 });
    expect(pagePoint(10, 10, fit, vp)).toBeNull();
    expect(pagePoint(500, 300, fit, vp, true)).toEqual({ x: 1279, y: 799 });
    expect(pagePoint(1, 1, { ...fit, w: 0 }, vp)).toBeNull();
  });
});
