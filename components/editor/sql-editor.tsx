"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SchemaResponse } from "@/lib/api/contracts";
import type { Diagnostic, Range } from "@/lib/compiler/diagnostics";
import { SUPPORTED_KEYWORDS } from "@/lib/compiler/tokens";
import { Spinner } from "@/components/ui/spinner";
import { monaco, setupMonaco } from "./monaco-setup";

setupMonaco();

type Mon = typeof monaco;
type CodeEditor = ReturnType<Mon["editor"]["create"]>;

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  diagnostics: Diagnostic[];
  schema: SchemaResponse | null;
  onAnalyze: () => void;
  onExecute: () => void;
  /** Called with a function that reveals and selects a range inside the editor. */
  onRevealReady: (reveal: ((range: Range) => void) | null) => void;
}

const SEVERITY = (m: Mon, s: Diagnostic["severity"]) => (s === "error" ? m.MarkerSeverity.Error : s === "warning" ? m.MarkerSeverity.Warning : m.MarkerSeverity.Info);

export default function SqlEditor({ value, onChange, diagnostics, schema, onAnalyze, onExecute, onRevealReady }: SqlEditorProps) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<CodeEditor | null>(null);
  const monacoRef = useRef<Mon | null>(null);
  const schemaRef = useRef<SchemaResponse | null>(schema);
  const handlers = useRef({ onAnalyze, onExecute });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  schemaRef.current = schema;
  handlers.current = { onAnalyze, onExecute };

  // If Monaco cannot start (blocked worker, very old browser), fall back to a plain textarea.
  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setFailed(true), 15_000);
    return () => window.clearTimeout(t);
  }, [ready]);

  const onMount: OnMount = useCallback(
    (editor, m) => {
      editorRef.current = editor;
      monacoRef.current = m;
      setReady(true);

      editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => handlers.current.onAnalyze());
      editor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.Enter, () => handlers.current.onExecute());

      onRevealReady((range) => {
        const r = new m.Range(range.start.line, range.start.column, range.end.line, Math.max(range.end.column, range.start.column + 1));
        editor.setSelection(r);
        editor.revealRangeInCenterIfOutsideViewport(r);
        editor.focus();
      });

      const completion = m.languages.registerCompletionItemProvider("sql", {
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          const items: import("monaco-editor").languages.CompletionItem[] = [];
          for (const kw of SUPPORTED_KEYWORDS) items.push({ label: kw, kind: m.languages.CompletionItemKind.Keyword, insertText: kw, range });
          for (const fn of ["COUNT", "SUM", "AVG", "MIN", "MAX"]) items.push({ label: fn, kind: m.languages.CompletionItemKind.Function, insertText: `${fn}(`, range });
          for (const t of schemaRef.current?.tables ?? []) {
            items.push({ label: t.name, kind: m.languages.CompletionItemKind.Struct, insertText: t.name, detail: `table · ${t.rowCount} rows`, range });
            for (const c of t.columns) items.push({ label: c.name, kind: m.languages.CompletionItemKind.Field, insertText: c.name, detail: `${t.name}.${c.name} · ${c.type}`, range });
          }
          return { suggestions: items };
        },
      });
      editor.onDidDispose(() => completion.dispose());
    },
    [onRevealReady],
  );

  useEffect(() => () => onRevealReady(null), [onRevealReady]);

  // Show diagnostics as editor markers at their real source locations.
  useEffect(() => {
    const m = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!m || !model) return;
    m.editor.setModelMarkers(
      model,
      "querycompiler",
      diagnostics.map((d) => {
        const sameSpot = d.range.start.line === d.range.end.line && d.range.start.column === d.range.end.column;
        return {
          severity: SEVERITY(m, d.severity),
          message: d.hint ? `${d.message}\n${d.hint}` : d.message,
          code: d.code,
          source: d.phase,
          startLineNumber: d.range.start.line,
          startColumn: sameSpot ? Math.max(1, d.range.start.column - 1) : d.range.start.column,
          endLineNumber: d.range.end.line,
          endColumn: sameSpot ? d.range.start.column + 1 : d.range.end.column,
        };
      }),
    );
  }, [diagnostics, ready]);

  if (failed && !ready) {
    return (
      <textarea
        aria-label="SQL query"
        className="h-full w-full resize-none bg-card p-3 font-mono text-[13px] outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    );
  }

  return (
    <Editor
      height="100%"
      language="sql"
      theme={resolvedTheme === "light" ? "qc-light" : "qc-dark"}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={onMount}
      loading={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading editor…
        </span>
      }
      options={{
        minimap: { enabled: false },
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 14,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: "line",
        ariaLabel: "SQL query editor",
        fixedOverflowWidgets: true,
        scrollbar: { alwaysConsumeMouseWheel: false },
      }}
    />
  );
}
