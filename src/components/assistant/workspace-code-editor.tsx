"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { diagnosticCount, lintGutter, linter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { editorLanguage, minimalDocumentChange, syntaxDiagnostics } from "./workspace-editor-support";

export interface WorkspaceEditorSession {
  documents: Map<string, { state: EditorState; scrollTop: number; scrollLeft: number }>;
}

export interface WorkspaceEditorStatus {
  line: number;
  column: number;
  diagnostics: number;
}

interface Props {
  path: string;
  code: string;
  session: WorkspaceEditorSession;
  wrapLines: boolean;
  onChange: (code: string) => void;
  onSave: (code: string) => void;
  onStatus: (status: WorkspaceEditorStatus) => void;
}

/** Local CodeMirror runtime. Completion is syntax/local-scope based, not a TypeScript language server. */
export function WorkspaceCodeEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const applyingExternal = useRef(false);
  const wrapping = useRef(new Compartment());
  const { path, session } = props;

  useEffect(() => {
    if (!host.current) return;
    const publishStatus = (editor: EditorView) => {
      const selection = editor.state.selection.main;
      const line = editor.state.doc.lineAt(selection.head);
      latest.current.onStatus({ line: line.number, column: selection.head - line.from + 1, diagnostics: diagnosticCount(editor.state) });
    };
    const extensions = [
      basicSetup,
      oneDark,
      editorLanguage(path),
      wrapping.current.of(latest.current.wrapLines ? EditorView.lineWrapping : []),
      lintGutter(),
      linter((editor) => syntaxDiagnostics(editor.state), { delay: 350 }),
      keymap.of([
        indentWithTab,
        { key: "Mod-s", run: (editor) => { latest.current.onSave(editor.state.doc.toString()); return true; } },
      ]),
      EditorView.contentAttributes.of({ "aria-label": `Editor for ${path}`, spellcheck: "false", autocapitalize: "off" }),
      Prec.highest(EditorView.theme({
        "&": { height: "100%", backgroundColor: "var(--sk-code-bg)", color: "var(--sk-text)", fontSize: "12.5px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Consolas, monospace", lineHeight: "1.65" },
        ".cm-content": { padding: "12px 0", caretColor: "var(--sk-accent-ink)" },
        ".cm-gutters": { backgroundColor: "var(--sk-code-bg)", borderRight: "1px solid var(--sk-line)", color: "var(--sk-faint)" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#ffffff06" },
        ".cm-panels": { backgroundColor: "var(--sk-surface-1)", color: "var(--sk-text)", borderColor: "var(--sk-line)" },
        ".cm-search": { display: "flex", flexWrap: "wrap", gap: "4px", padding: "8px" },
        ".cm-textfield": { backgroundColor: "var(--sk-code-bg)", borderColor: "var(--sk-line-strong)", color: "var(--sk-text)" },
        ".cm-tooltip": { backgroundColor: "var(--sk-surface-1)", borderColor: "var(--sk-line-strong)" },
        "&.cm-focused": { outline: "none" },
      })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !applyingExternal.current) latest.current.onChange(update.state.doc.toString());
        publishStatus(update.view);
      }),
      EditorView.domEventHandlers({ blur: (_event, editor) => { latest.current.onSave(editor.state.doc.toString()); } }),
    ];
    const saved = session.documents.get(path);
    const state = saved
      ? saved.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: latest.current.code, extensions });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    const change = minimalDocumentChange(editor.state.doc.toString(), latest.current.code);
    if (change) {
      applyingExternal.current = true;
      editor.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
      applyingExternal.current = false;
    }
    if (saved) {
      editor.scrollDOM.scrollTop = saved.scrollTop;
      editor.scrollDOM.scrollLeft = saved.scrollLeft;
    }
    publishStatus(editor);
    editor.focus();
    return () => {
      session.documents.set(path, { state: editor.state, scrollTop: editor.scrollDOM.scrollTop, scrollLeft: editor.scrollDOM.scrollLeft });
      editor.destroy();
      view.current = null;
    };
  }, [path, session]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const change = minimalDocumentChange(editor.state.doc.toString(), props.code);
    if (!change) return;
    applyingExternal.current = true;
    editor.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
    applyingExternal.current = false;
  }, [props.code]);

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.current.reconfigure(props.wrapLines ? EditorView.lineWrapping : []) });
  }, [props.wrapLines]);

  return <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden" data-workspace-editor="codemirror" />;
}
