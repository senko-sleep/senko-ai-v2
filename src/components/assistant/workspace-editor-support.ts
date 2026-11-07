import { type EditorState, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import type { Diagnostic } from "@codemirror/lint";

export function editorLanguage(path: string): Extension {
  if (/\.[cm]?[jt]sx?$/i.test(path)) return javascript({ jsx: /\.[jt]sx$/i.test(path), typescript: /\.[cm]?tsx?$/i.test(path) });
  if (/\.(json|jsonc)$/i.test(path)) return json();
  if (/\.(html?|svg)$/i.test(path)) return html();
  if (/\.css$/i.test(path)) return css();
  return [];
}

/** Parser diagnostics identify syntax errors only; project type/build diagnostics come from the terminal. */
export function syntaxDiagnostics(state: EditorState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.type.isError && diagnostics.length < 100) {
      diagnostics.push({ from: node.from, to: Math.min(state.doc.length, Math.max(node.to, node.from + 1)), severity: "error", message: "Syntax error: check this expression or the preceding delimiter.", source: "Syntax parser" });
    }
  } });
  return diagnostics;
}

/** Preserve selections and undo history by replacing just the changed span of external updates. */
export function minimalDocumentChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

