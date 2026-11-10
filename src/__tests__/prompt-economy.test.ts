import { describe, expect, it } from "vitest";
import { CODE_SYSTEM, buildProjectBrief, buildStepPrompt } from "@/lib/code-job";

describe("project brief", () => {
  it("tells the model to create everything at once for an empty project", () => {
    expect(buildProjectBrief([])).toMatch(/first reply/);
  });

  it("summarizes stack, scripts, entry points, tests and undeclared imports from real files", () => {
    const brief = buildProjectBrief([
      { path: "package.json", content: JSON.stringify({ name: "shop", scripts: { dev: "vite", test: "vitest run" }, dependencies: { react: "^19" }, devDependencies: { vite: "^6", vitest: "^3" } }) },
      { path: "src/main.jsx", content: "import React from 'react';\nimport confetti from 'canvas-confetti';\nimport fs from 'node:fs';" },
      { path: "src/cart.test.js", content: "import { test } from 'vitest';" },
      { path: "index.html", content: "<html></html>" },
    ]);
    expect(brief).toContain("scripts: dev=vite; test=vitest run");
    expect(brief).toContain("stack: Vite, React, Vitest");
    expect(brief).toContain("entry points: index.html, src/main.jsx");
    expect(brief).toContain("tests (1): src/cart.test.js");
    expect(brief).toContain("imported but not declared in package.json: canvas-confetti");
    expect(brief).not.toContain("node:fs");
  });

  it("flags an unparsable manifest instead of guessing", () => {
    expect(buildProjectBrief([{ path: "package.json", content: "{oops" }])).toContain("not valid JSON");
  });

  it("is bounded", () => {
    const files = Array.from({ length: 400 }, (_, i) => ({ path: `d${i}/f.js`, content: "" }));
    expect(buildProjectBrief(files, 500).length).toBeLessThanOrEqual(504);
  });
});

describe("prompt economy", () => {
  it("instructs batching and forbids one-file-per-reply behavior", () => {
    expect(CODE_SYSTEM).toMatch(/fewest replies/);
    expect(CODE_SYSTEM).toMatch(/one reply that writes every file, installs dependencies, runs the tests/);
    expect(CODE_SYSTEM).not.toMatch(/small operation under 1000 tokens/);
  });

  it("includes environment and brief ahead of the file list", () => {
    const prompt = buildStepPrompt({ goal: "g", files: [], history: [], canRun: true, step: 1, maxSteps: 8, environment: "win32, Node v20", brief: "stack: Vite" });
    expect(prompt.indexOf("ENVIRONMENT:")).toBeLessThan(prompt.indexOf("BRIEF:"));
    expect(prompt.indexOf("BRIEF:")).toBeLessThan(prompt.indexOf("FILES:"));
  });
});
