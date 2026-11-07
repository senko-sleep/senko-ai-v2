import { describe, expect, it } from "vitest";
import { buildStepPrompt, parseStep, writablePath } from "@/lib/code-job";
import { stripLiveTags } from "@/components/assistant/lib";

describe("coding job steps", () => {
  it("parses ops from fenced or chatty JSON and drops malformed ones", () => {
    const step = parseStep('Sure:\n```json\n{"thought":"set up","ops":[{"op":"write","path":"index.html","content":"<h1>x</h1>"},{"op":"run","cmd":"npm install"},{"op":"write","path":"no-content"},{"op":"bogus"}],"done":false}\n```');
    expect(step?.ops).toEqual([
      { op: "write", path: "index.html", content: "<h1>x</h1>" },
      { op: "run", cmd: "npm install" },
    ]);
    expect(parseStep("no json here")).toBeNull();
    expect(parseStep('{"ops":[],"done":true,"summary":"Built it."}')?.summary).toBe("Built it.");
  });

  it("keeps the model out of node_modules, lockfiles and parent folders", () => {
    expect(writablePath("src/app.js")).toBe(true);
    expect(writablePath("node_modules/x/index.js")).toBe(false);
    expect(writablePath("package-lock.json")).toBe(false);
    expect(writablePath("../etc/passwd")).toBe(false);
  });

  it("tells the model when Node can't run", () => {
    const p = buildStepPrompt({ goal: "todo app", files: [], history: [], canRun: false, step: 1, maxSteps: 24 });
    expect(p).toContain("RUN is DISABLED");
    expect(p).toContain("(empty project)");
  });

  it("hides the [[code: ...]] hand-off tag while a reply streams", () => {
    expect(stripLiveTags("On it!\n[[code: build a todo app with React]]")).toBe("On it!\n");
  });
});

import { stripCodeBlocks, wantsCodeJob } from "@/lib/code-intent";
describe("sending build requests to a coding job", () => {
  it("catches build requests and project follow-ups, not questions", () => {
    expect(wantsCodeJob("code me a playlist make sure the songs work for anime", false)).toBe(true);
    expect(wantsCodeJob("build me a todo app with react", false)).toBe(true);
    expect(wantsCodeJob("run test and make sure it actually works, should be fullstack", true)).toBe(true);
    expect(wantsCodeJob("run test and make sure it actually works", false)).toBe(false);
    expect(wantsCodeJob("how do I make a react app?", false)).toBe(false);
    expect(wantsCodeJob("what's your favorite anime?", false)).toBe(false);
  });
  it("drops code the model wrote anyway", () => {
    expect(stripCodeBlocks("Building it!\n```tsx\nconst a = 1;\n```\nDone soon.")).toBe("Building it!\n\nDone soon.");
  });
  it("parses lookup ops", () => {
    const s = parseStep('{"ops":[{"op":"youtube","query":"LiSA Gurenge"},{"op":"fetch","url":"https://api.jikan.moe/v4/anime?q=x"},{"op":"fetch","url":"file:///etc"},{"op":"search","query":"anime api"}]}');
    expect(s?.ops.map((o) => o.op)).toEqual(["youtube", "fetch", "search"]);
  });
});
