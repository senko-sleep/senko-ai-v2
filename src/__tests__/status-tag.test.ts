import { describe, it, expect } from "vitest";
import { takeStatusTag } from "@/lib/server/persona";

describe("takeStatusTag", () => {
  it("pulls the mood out of the last line", () => {
    expect(takeStatusTag("Here you go!\n\n[STATUS:chill:just vibing]")).toEqual({ text: "Here you go!", mood: "just vibing" });
  });
  it("cleans tags a small model scattered through a list, keeping the last mood", () => {
    const r = takeStatusTag("1. **[STATUS:soft:warm]** *Show A* – nice\n2. **[STATUS:excited:fun]** *Show B* – great");
    expect(r.text).toBe("1.  *Show A* – nice\n2.  *Show B* – great");
    expect(r.mood).toBe("fun");
  });
  it("drops a half-written tag at the end and leaves normal text alone", () => {
    expect(takeStatusTag("Hello [STATUS:hap")).toEqual({ text: "Hello " });
    expect(takeStatusTag("No tags here").text).toBe("No tags here");
  });
});
