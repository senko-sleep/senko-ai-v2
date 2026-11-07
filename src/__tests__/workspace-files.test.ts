import { describe, expect, it } from "vitest";
import { buildTree, bundlePage, deletePath, emptyProject, mergeArtifacts, normalizePath, previewEntry, renamePath } from "@/components/assistant/workspace-files";
import { extractCodeArtifacts } from "@/components/assistant/workspace-artifacts";

const reply = (id: string, content: string) => ({ id, role: "assistant" as const, content });

describe("chat project workspace", () => {
  const msgs = [
    reply("m1", "```html\n<!-- index.html -->\n<html><head><link rel=\"stylesheet\" href=\"css/style.css\"></head><body><script src=\"js/app.js\"></script></body></html>\n```\n```css\n/* css/style.css */\nbody { color: red; }\n```\n```js\n// js/app.js\nconsole.log('hi there');\n```"),
  ];

  it("turns code blocks with path comments into files in folders", () => {
    const p = mergeArtifacts(emptyProject(), extractCodeArtifacts(msgs));
    expect(p.files.map((f) => f.path).sort()).toEqual(["css/style.css", "index.html", "js/app.js"]);
    const tree = buildTree(p);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(["folder:css", "folder:js", "file:index.html"]);
  });

  it("inlines linked css and js into the preview", () => {
    const p = mergeArtifacts(emptyProject(), extractCodeArtifacts(msgs));
    const page = bundlePage(p, previewEntry(p, "js/app.js")!);
    expect(page).toContain("body { color: red; }");
    expect(page).toContain("console.log('hi there');");
    expect(page).not.toContain('href="css/style.css"');
  });

  it("updates a file from a newer reply but keeps the user's hand edits", () => {
    let p = mergeArtifacts(emptyProject(), extractCodeArtifacts(msgs));
    const newer = [...msgs, reply("m2", "```css\n/* css/style.css */\nbody { color: blue; }\n```")];
    p = mergeArtifacts(p, extractCodeArtifacts(newer));
    expect(p.files.find((f) => f.path === "css/style.css")!.code).toContain("blue");
    p = { ...p, files: p.files.map((f) => (f.path === "js/app.js" ? { ...f, code: "mine", edited: true } : f)) };
    p = mergeArtifacts(p, extractCodeArtifacts([...newer, reply("m3", "```js\n// js/app.js\nconsole.log('theirs');\n```")]));
    expect(p.files.find((f) => f.path === "js/app.js")!.code).toBe("mine");
  });

  it("renames and deletes folders with their contents, and cleans paths", () => {
    let p = mergeArtifacts(emptyProject(), extractCodeArtifacts(msgs));
    p = renamePath(p, "css", "styles");
    expect(p.files.some((f) => f.path === "styles/style.css")).toBe(true);
    p = deletePath(p, "styles");
    expect(p.files.some((f) => f.path.startsWith("styles/"))).toBe(false);
    expect(normalizePath("\\..\\a//b/../c.js")).toBe("a/b/c.js");
  });
});


it("rejects renames that would duplicate file identities or turn files into folders", () => {
  const project = { files: [{ path: "a.ts", code: "a" }, { path: "b.ts", code: "b" }], folders: [] };
  expect(renamePath(project, "a.ts", "b.ts")).toBe(project);
  expect(renamePath(project, "a.ts", "b.ts/child.ts")).toBe(project);
});
