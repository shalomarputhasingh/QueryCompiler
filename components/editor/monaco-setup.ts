"use client";

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let configured = false;

/** Bundles Monaco locally (no CDN) and registers the app's themes. Idempotent. */
export function setupMonaco(): typeof monaco {
  if (configured) return monaco;
  configured = true;

  self.MonacoEnvironment = {
    getWorker() {
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" });
    },
  };
  loader.config({ monaco });

  monaco.editor.defineTheme("qc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "a5a9ff", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "a5a9ff", fontStyle: "bold" },
      { token: "operator.sql", foreground: "f0a0c8" },
      { token: "string.sql", foreground: "7ddba0" },
      { token: "number", foreground: "f2c36b" },
      { token: "comment", foreground: "6b7390", fontStyle: "italic" },
      { token: "predefined.sql", foreground: "73c0ff" },
    ],
    colors: {
      "editor.background": "#11141d",
      "editor.lineHighlightBackground": "#171b27",
      "editorLineNumber.foreground": "#4b5268",
      "editorLineNumber.activeForeground": "#9aa2bb",
      "editorGutter.background": "#11141d",
      "editor.selectionBackground": "#3a3f7a88",
    },
  });
  monaco.editor.defineTheme("qc-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "4338ca", fontStyle: "bold" },
      { token: "keyword.sql", foreground: "4338ca", fontStyle: "bold" },
      { token: "operator.sql", foreground: "a1306b" },
      { token: "string.sql", foreground: "117a3f" },
      { token: "number", foreground: "9a5b00" },
      { token: "comment", foreground: "7a8196", fontStyle: "italic" },
      { token: "predefined.sql", foreground: "0f62a8" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f3f4fa",
      "editorLineNumber.foreground": "#9aa2bb",
    },
  });
  return monaco;
}

export { monaco };
