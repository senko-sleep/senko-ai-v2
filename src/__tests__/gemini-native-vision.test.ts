import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "GEMINI_API_KEY";
const saved = process.env[KEY];

beforeEach(() => {
  vi.resetModules();
  process.env[KEY] = "test-gemini-key";
  delete process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe("Gemini image input", () => {
  it("uses the native streaming API and inlineData instead of OpenAI image_url parts", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      if (requestUrl.endsWith("/models")) {
        return Response.json({ data: [{ id: "gemini-3.8-flash", active: true, architecture: { input_modalities: ["text", "image"] } }] });
      }
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body));
      const event = { candidates: [{ content: { parts: [{ text: "A red fox." }] }, finishReason: "STOP" }] };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const { complete } = await import("@/lib/llm");
    const result = await complete([{
      role: "user",
      content: "What is in this picture?",
      images: [{ mime: "image/png", data: "aGVsbG8=" }],
    }], { provider: "gemini", hedge: false, maxWaitMs: 0 });

    expect(result.text).toBe("A red fox.");
    expect(requestUrl).toContain("/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(requestHeaders?.get("x-goog-api-key")).toBe("test-gemini-key");
    expect(requestBody).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "What is in this picture?" }, { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] }],
    });
    expect(JSON.stringify(requestBody)).not.toContain("image_url");
  });
});
