import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATA_DIR = ":memory:";
  delete process.env.DATABASE_URL;
  process.env.APP_ACCESS_KEY = "test-key-123";
});

describe("device tokens", () => {
  it("signs and verifies, rejects tampering", async () => {
    const { signDevice, verifyDeviceToken } = await import("@/lib/auth-token");
    const id = "dev_abcdefghijklmnop";
    const tok = await signDevice(id);
    expect(await verifyDeviceToken(tok)).toBe(id);
    expect(await verifyDeviceToken(tok.slice(0, -2) + "xx")).toBeNull();
    expect(await verifyDeviceToken("other_abcdefghijklmn." + tok.split(".")[1])).toBeNull();
    expect(await verifyDeviceToken(undefined)).toBeNull();
  });
});

// Booting the embedded database takes a few seconds, more when other test files run in parallel.
describe("identity + linking", { timeout: 30_000 }, () => {
  it("creates a device, rejects requests without the key cookie, links a second device", async () => {
    const { ensureDevice, identify, authCookies } = await import("@/lib/server/identity");
    const { q, q1 } = await import("@/lib/server/db");

    const pc = await ensureDevice("pc_device_1234567890");
    expect(pc.ownerId).toMatch(/^o_/);

    await expect(identify(new Request("http://x/api/chats"))).rejects.toThrow(/access key/);

    const cookies = (await authCookies(pc.deviceId, false)).map((c) => c.split(";")[0]).join("; ");
    const who = await identify(new Request("http://x/api/chats", { headers: { cookie: cookies } }));
    expect(who).toEqual(pc);

    // Phone links to the PC's owner and brings its own chat along.
    const phone = await ensureDevice("phone_device_123456789");
    await q("INSERT INTO chats (id, owner_id, title) VALUES ('c_phone', $1, 'phone chat')", [phone.ownerId]);
    await q("INSERT INTO link_codes (code, owner_id, expires_at) VALUES ('ABC234', $1, now() + interval '10 minutes')", [pc.ownerId]);

    const { POST } = await import("@/app/api/link/claim/route");
    const res = await POST(
      new Request("http://x/api/link/claim", {
        method: "POST",
        body: JSON.stringify({ code: "abc-234", deviceId: phone.deviceId }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("senko_auth=");

    const linked = await ensureDevice(phone.deviceId);
    expect(linked.ownerId).toBe(pc.ownerId);
    const chat = await q1<{ owner_id: string }>("SELECT owner_id FROM chats WHERE id = 'c_phone'");
    expect(chat?.owner_id).toBe(pc.ownerId);
  });
});
