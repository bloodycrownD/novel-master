import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

/** Matches shell.css tokens via CSS variables (light/dark). */
export const novelEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--editor-bg)",
      color: "var(--text)",
      fontSize: "14px",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily:
        'ui-monospace, "Cascadia Code", Consolas, monospace',
      lineHeight: "1.6",
    },
    ".cm-content": {
      padding: "8px 0",
      caretColor: "var(--primary)",
    },
    ".cm-line": {
      padding: "0 4px 0 8px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftWidth: "2px",
      borderLeftColor: "var(--primary)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--editor-gutter-bg)",
      color: "var(--text-tertiary)",
      border: "none",
      borderRight: "1px solid var(--editor-gutter-border)",
    },
    ".cm-gutter.cm-lineNumbers .cm-gutterElement": {
      padding: "0 12px 0 8px",
      minWidth: "3em",
      textAlign: "right",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text-secondary)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--editor-active-line)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--editor-selection) !important",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "var(--editor-selection)",
      outline: "1px solid var(--primary-ring)",
    },
  },
  { dark: false },
);

const novelHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "var(--primary)", fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--primary)", textDecoration: "underline" },
  {
    tag: t.monospace,
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  },
  { tag: t.string, color: "var(--success)" },
  { tag: t.number, color: "var(--warning)" },
  { tag: t.keyword, color: "var(--primary)" },
  { tag: t.comment, color: "var(--text-tertiary)", fontStyle: "italic" },
]);

export const novelSyntaxHighlighting = syntaxHighlighting(
  novelHighlightStyle,
  { fallback: true },
);