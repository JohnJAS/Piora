"use client";

import { json } from "@codemirror/lang-json";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as codeMirrorPlaceholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type JsonEditorShortcut = "close" | "cycle-backward" | "cycle-forward" | "format" | "new" | "paste-new" | "toggle-lock";

export interface JsonCodeEditorHandle {
  focusRange: (start: number, end?: number) => void;
  getSelection: () => { end: number; start: number };
}

interface Props {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  onPasteText: (text: string) => string | null;
  onShortcut: (shortcut: JsonEditorShortcut) => void;
  placeholder: string;
  value: string;
  wrap: boolean;
}

export const JsonCodeEditor = forwardRef<JsonCodeEditorHandle, Props>(function JsonCodeEditor({
  ariaLabel,
  className,
  onChange,
  onPasteText,
  onShortcut,
  placeholder,
  value,
  wrap,
}, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef(false);
  const callbacksRef = useRef({ onChange, onPasteText, onShortcut });
  const initialValueRef = useRef(value);
  const initialOptionsRef = useRef({ ariaLabel, placeholder, wrap });
  const [optionsCompartment] = useState(() => new Compartment());

  callbacksRef.current = { onChange, onPasteText, onShortcut };

  const editorOptions = (next: { ariaLabel: string; placeholder: string; wrap: boolean }) => [
    next.wrap ? EditorView.lineWrapping : [],
    codeMirrorPlaceholder(next.placeholder),
    EditorView.contentAttributes.of({ "aria-label": next.ariaLabel, "aria-multiline": "true", spellcheck: "false" }),
  ];

  useImperativeHandle(forwardedRef, () => ({
    focusRange(start, end = start) {
      const view = viewRef.current;
      if (!view) return;
      const length = view.state.doc.length;
      const anchor = Math.max(0, Math.min(start, length));
      const head = Math.max(0, Math.min(end, length));
      view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
      view.focus();
    },
    getSelection() {
      const selection = viewRef.current?.state.selection.main;
      return selection ? { end: selection.to, start: selection.from } : { end: 0, start: 0 };
    },
  }), []);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const runShortcut = (shortcut: JsonEditorShortcut) => () => {
      callbacksRef.current.onShortcut(shortcut);
      return true;
    };
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          keymap.of([
            { key: "Mod-Enter", run: runShortcut("format") },
            { key: "Mod-t", run: runShortcut("new") },
            { key: "Mod-n", run: runShortcut("paste-new") },
            { key: "Mod-Tab", run: runShortcut("cycle-forward") },
            { key: "Shift-Mod-Tab", run: runShortcut("cycle-backward") },
            { key: "Mod-l", run: runShortcut("toggle-lock") },
            { key: "Mod-q", run: runShortcut("close") },
          ]),
          basicSetup,
          json(),
          optionsCompartment.of(editorOptions(initialOptionsRef.current)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) callbacksRef.current.onChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event, currentView) {
              const text = event.clipboardData?.getData("text") ?? "";
              if (!text) return false;
              const replacement = callbacksRef.current.onPasteText(text);
              if (replacement === null) return false;
              event.preventDefault();
              const selection = currentView.state.selection.main;
              currentView.dispatch({
                changes: { from: selection.from, to: selection.to, insert: replacement },
                selection: { anchor: selection.from + replacement.length },
                scrollIntoView: true,
              });
              return true;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [optionsCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: optionsCompartment.reconfigure(editorOptions({ ariaLabel, placeholder, wrap })) });
  }, [ariaLabel, optionsCompartment, placeholder, wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const selection = view.state.selection.main;
    const anchor = Math.min(selection.head, value.length);
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value }, selection: { anchor } });
    syncingRef.current = false;
  }, [value]);

  return <div ref={containerRef} className={className} data-wrap={wrap ? "true" : "false"} />;
});
