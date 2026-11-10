import { describe, it, expect } from "vitest";
import { lastSubject, resolveSubject } from "@/lib/server/subject-context";
import { detectCollageRequest, detectImageIntentQuery } from "@/lib/server/images";

const profileReply = "```ui\n" + JSON.stringify({ type: "stack", children: [{ type: "profile", name: "Anya Forger", series: "Spy × Family" }] }) + "\n```";

describe("follow-up image requests", () => {
  it("treats 'images of her as a collage now' as a collage of her", () => {
    const c = detectCollageRequest("i want images of her as a collage now");
    expect(c?.query).toBe("her");
  });

  it("detects other loose collage phrasings", () => {
    expect(detectCollageRequest("pics of goku in a mosaic")?.query).toBe("goku");
    expect(detectCollageRequest("make a collage of Yor Forger")?.query).toBe("Yor Forger");
  });

  it("finds the subject from an earlier UI reply", () => {
    const s = lastSubject([
      { role: "user", content: "who is anya forger us ui" },
      { role: "assistant", content: profileReply },
    ]);
    expect(s).toEqual({ name: "Anya Forger", context: "Spy × Family" });
  });

  it("falls back to the subject a user named earlier", () => {
    expect(lastSubject([{ role: "user", content: "who is Loid Forger" }, { role: "assistant", content: "He's a spy." }])?.name).toBe("Loid Forger");
  });

  it("replaces pronouns and drops layout words", () => {
    const s = { name: "Anya Forger", context: "Spy × Family" };
    expect(resolveSubject("her", s)).toEqual({ query: "Anya Forger Spy × Family", label: "Anya Forger" });
    expect(resolveSubject("her as a collage now", s).label).toBe("Anya Forger");
    expect(resolveSubject("her smiling", s).label).toBe("Anya Forger smiling");
    expect(resolveSubject("Bond Forger", s).query).toBe("Bond Forger");
  });

  it("resolves plain image follow-ups too", () => {
    const q = detectImageIntentQuery("show me pics of her");
    expect(resolveSubject(q!, { name: "Anya Forger" }).query).toBe("Anya Forger");
  });
});
