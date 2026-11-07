import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { editorLanguage, minimalDocumentChange, syntaxDiagnostics } from "@/components/assistant/workspace-editor-support";
import { filterWorkspacePaths } from "@/components/assistant/workspace-file-search";

describe("workspace editor", () => {
  it("parses real TypeScript and JSX without reporting valid type syntax as errors", () => {
    const state = EditorState.create({ doc: 'type Props = { title: string }; export default function App({title}: Props) { return <main>{title}</main>; }', extensions: [editorLanguage("src/App.tsx")] });
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("reports actual syntax errors in JavaScript and JSON", () => {
    for (const [path, doc] of [["src/broken.ts", "export const value = ;"], ["data.json", '{"key": }']]) {
      const state = EditorState.create({ doc, extensions: [editorLanguage(path)] });
      expect(syntaxDiagnostics(state).length).toBeGreaterThan(0);
    }
  });

  it("preserves the cursor and undo history when an external update appends code", () => {
    let state = EditorState.create({ doc: "const x = 1;\n", selection: { anchor: 6 }, extensions: [history()] });
    state = state.update({ changes: { from: 10, to: 11, insert: "2" } }).state;
    const before = state.doc.toString();
    const change = minimalDocumentChange(before, before + "const y = 3;\n");
    state = state.update({ changes: change!, annotations: Transaction.addToHistory.of(false) }).state;
    expect(state.selection.main.head).toBe(6);
    expect(undoDepth(state)).toBe(1);
    expect(state.doc.toString()).toContain("const y = 3;");
    expect(minimalDocumentChange(before, before)).toBeNull();
  });

  it("finds paths case-insensitively and ranks filename matches before directories", () => {
    expect(filterWorkspacePaths(["app/router.ts", "src/App.tsx", "test/app.test.ts"], "app")).toEqual(["src/App.tsx", "test/app.test.ts", "app/router.ts"]);
    expect(filterWorkspacePaths(["src/App.tsx", "src/api/client.ts"], "src\\api")).toEqual(["src/api/client.ts"]);
    expect(filterWorkspacePaths(["a.ts"], "absent")).toEqual([]);
  });
});
