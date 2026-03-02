import { describe, it, expect } from "vitest";
import {
  ICON_COLOR_MAP,
  parseStatusTag,
  buildStatus,
  extractStatusFromContent,
  getPhaseStatus,
  inferStatusFromContent,
} from "@/lib/status-utils";

describe("parseStatusTag", () => {
  it("parses a valid [STATUS:icon:text] tag", () => {
    const result = parseStatusTag("Hello [STATUS:happy:feeling great!] world");
    expect(result).toEqual({ icon: "happy", text: "feeling great!" });
  });

  it("returns null when no status tag present", () => {
    expect(parseStatusTag("Just a normal message")).toBeNull();
  });

  it("handles case-insensitive parsing", () => {
    const result = parseStatusTag("[STATUS:EXCITED:Wow!!]");
    expect(result).toEqual({ icon: "excited", text: "Wow!!" });
  });

  it("returns null for malformed tags", () => {
    expect(parseStatusTag("[STATUS:]")).toBeNull();
    expect(parseStatusTag("[STATUS:happy]")).toBeNull();
    expect(parseStatusTag("STATUS:happy:text")).toBeNull();
  });
});

describe("buildStatus", () => {
  it("returns a SenkoStatus with correct color from map", () => {
    const status = buildStatus("happy", "Feeling great!");
    expect(status.icon).toBe("happy");
    expect(status.text).toBe("Feeling great!");
    expect(status.color).toBe(ICON_COLOR_MAP.happy);
  });

  it("uses default color for unknown icons", () => {
    const status = buildStatus("unknown_mood", "test");
    expect(status.color).toBe("#a78bfa"); // Default
  });
});

describe("extractStatusFromContent", () => {
  it("extracts status from content with a tag", () => {
    const status = extractStatusFromContent("Hi there! [STATUS:chill:Just vibing~]");
    expect(status).not.toBeNull();
    expect(status!.icon).toBe("chill");
    expect(status!.text).toBe("Just vibing~");
    expect(status!.color).toBe(ICON_COLOR_MAP.chill);
  });

  it("returns null when no tag in content", () => {
    expect(extractStatusFromContent("No status here")).toBeNull();
  });
});

describe("getPhaseStatus", () => {
  it("returns null for idle phase", () => {
    expect(getPhaseStatus("idle")).toBeNull();
  });

  it("returns a status for searching phase", () => {
    const status = getPhaseStatus("searching");
    expect(status).not.toBeNull();
    expect(status!.icon).toBe("thinking");
    expect(status!.color).toBe(ICON_COLOR_MAP.thinking);
  });

  it("returns a status for generating phase", () => {
    const status = getPhaseStatus("generating");
    expect(status).not.toBeNull();
    expect(status!.icon).toBe("fire");
  });

  it("returns a status for scraping phase", () => {
    const status = getPhaseStatus("scraping");
    expect(status).not.toBeNull();
    expect(status!.icon).toBe("sparkle");
  });

  it("returns a status for browsing phase", () => {
    const status = getPhaseStatus("browsing");
    expect(status).not.toBeNull();
  });

  it("returns error status for error phase", () => {
    const status = getPhaseStatus("error");
    expect(status).not.toBeNull();
    expect(status!.icon).toBe("sad");
  });
});

describe("inferStatusFromContent", () => {
  it("detects excited mood from content", () => {
    const status = inferStatusFromContent("OMG that's so cool!! XD");
    expect(status.icon).toBe("excited");
  });

  it("detects flustered mood from content", () => {
    const status = inferStatusFromContent("W-what?! >////<");
    expect(status.icon).toBe("flustered");
  });

  it("detects sad mood from content", () => {
    const status = inferStatusFromContent("That's really sad ;w;");
    expect(status.icon).toBe("sad");
  });

  it("detects sleepy mood from content", () => {
    const status = inferStatusFromContent("I'm so eepy right now...");
    expect(status.icon).toBe("sleepy");
  });

  it("detects gaming mood from content", () => {
    const status = inferStatusFromContent("Let me tell you about this RPG game I played");
    expect(status.icon).toBe("gaming");
  });

  it("detects love mood from content", () => {
    const status = inferStatusFromContent("That's so adorable and wholesome <3");
    expect(status.icon).toBe("love");
  });

  it("detects music mood from content", () => {
    const status = inferStatusFromContent("Here's a great song from that album");
    expect(status.icon).toBe("music");
  });

  it("defaults to chill for neutral content", () => {
    const status = inferStatusFromContent("The answer to your question is 42.");
    expect(status.icon).toBe("chill");
  });

  it("always returns a valid SenkoStatus with color", () => {
    const status = inferStatusFromContent("anything");
    expect(status).toHaveProperty("icon");
    expect(status).toHaveProperty("text");
    expect(status).toHaveProperty("color");
    expect(status.color).toBeTruthy();
  });
});

describe("ICON_COLOR_MAP", () => {
  it("has entries for all expected icons", () => {
    const expected = [
      "happy", "sad", "angry", "excited", "sleepy", "hungry",
      "flustered", "scared", "chill", "thinking", "love", "gaming",
      "music", "sparkle", "fire", "crying", "shocked",
    ];
    for (const icon of expected) {
      expect(ICON_COLOR_MAP[icon]).toBeTruthy();
    }
  });

  it("all colors are valid hex colors", () => {
    for (const color of Object.values(ICON_COLOR_MAP)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
