import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { CodingWorkspaceRuntime } from "@/lib/agent/coding-runtime";

describe("TS test runner", () => {
  it("reports the real compile error instead of ERR_UNKNOWN_FILE_EXTENSION", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "senko-ts-"));
    const rt = new CodingWorkspaceRuntime("c_tsmissing", base);
    await rt.ensureWorkspace();
    await rt.writeFile("package.json", JSON.stringify({ name: "x", type: "module" }));
    await rt.writeFile(
      "test/scraper.test.ts",
      `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { scrape } from "../src/scraper.js";\ntest("x", () => assert.equal(scrape(), 1));\n`,
    );
    const bad = await rt.runCommand("node --test test/scraper.test.ts");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).not.toMatch(/ERR_UNKNOWN_FILE_EXTENSION/);
    expect(bad.stderr).toMatch(/Could not resolve "\.\.\/src\/scraper\.js"/);

    await rt.writeFile("src/scraper.ts", `export function scrape(): number { return 1; }\n`);
    const good = await rt.runCommand("node --test test/scraper.test.ts");
    expect(good.exitCode).toBe(0);
  }, 60_000);
});

describe("missing dependencies", () => {
  it("reports a missing HTML parser instead of substituting a partial implementation", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "senko-ts-"));
    const rt = new CodingWorkspaceRuntime("c_jsdomshim", base);
    await rt.ensureWorkspace();
    await rt.writeFile("package.json", JSON.stringify({ name: "x", type: "module" }));
    await rt.writeFile(
      "test/dom.test.ts",
      `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { JSDOM } from "jsdom";\n` +
        `test("imgs", () => {\n  const d = new JSDOM('<div class="reading-content"><img src="a.jpg"><img data-src="b.jpg"></div>');\n` +
        `  const imgs = [...d.window.document.querySelectorAll(".reading-content img")];\n  assert.equal(imgs.length, 2);\n});\n`,
    );
    const r = await rt.runCommand("node --test test/dom.test.ts");
    expect(r.stderr).not.toMatch(/octal escape/i);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Could not resolve "jsdom"');
  }, 60_000);
});


describe("execution authenticity regressions", () => {
  it("runs every matching TypeScript test, including a failing nested test", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "senko-glob-"));
    const rt = new CodingWorkspaceRuntime("glob", base);
    await rt.writeFile("test/a.test.ts", 'import test from "node:test"; test("first", () => {});');
    await rt.writeFile("test/nested/b.test.ts", 'import test from "node:test"; test("second", () => { throw new Error("nested failure"); });');
    const result = await rt.runCommand('node --test "test/**/*.test.ts"');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("nested failure");
    expect(rt.ledger.testStatus).toBe("failed");
  });

  it("fails preview compilation for an unavailable dependency", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "senko-preview-"));
    const rt = new CodingWorkspaceRuntime("missing", base);
    await rt.writeFile("src/App.tsx", 'import Widget from "senko-missing-package-regression"; export default function App() { return <Widget />; }');
    const result = await rt.bundleFrontendApp();
    expect(result.html).toBe("");
    expect(result.errors.join("\n")).toContain("senko-missing-package-regression");
  });

  it("keeps API requests intact without injecting fabricated records", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "senko-preview-"));
    const rt = new CodingWorkspaceRuntime("api", base);
    await rt.writeFile("src/App.tsx", 'export default function App() { return <button onClick={() => fetch("/api/items")}>Load</button>; }');
    const result = await rt.bundleFrontendApp();
    expect(result.errors).toEqual([]);
    expect(result.html).toContain("/api/items");
    expect(result.html).not.toContain("mockApiResponse");
    expect(result.html).not.toContain("window.fetch =");
    expect(result.html).not.toContain("Mixed Nuts");
  });
});
