import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

/** Theme via CSS variables set from RN tokens. */
export const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg, var(--bg, #fff))',
      color: 'var(--text, #111)',
      fontSize: '14px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily:
        'ui-monospace, "Cascadia Code", Consolas, monospace',
      lineHeight: '1.6',
    },
    '.cm-content': {
      padding: '8px 0',
      caretColor: 'var(--primary, #007aff)',
    },
    '.cm-line': {
      padding: '0 4px 0 8px',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftWidth: '2px',
      borderLeftColor: 'var(--primary, #007aff)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-gutter-bg, var(--surface, #f2f2f7))',
      color: 'var(--text-secondary, #666)',
      border: 'none',
      borderRight: '1px solid var(--editor-gutter-border, var(--border, #e5e5ea))',
    },
    '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 8px',
      minWidth: '3em',
      textAlign: 'right',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-secondary, #666)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--editor-active-line, rgba(0, 0, 0, 0.04))',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--editor-selection, rgba(0, 122, 255, 0.25)) !important',
    },
  },
  { dark: false },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.heading, color: 'var(--primary, #007aff)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--primary, #007aff)', textDecoration: 'underline' },
  {
    tag: t.monospace,
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  },
  { tag: t.string, color: 'var(--primary, #007aff)' },
  { tag: t.number, color: 'var(--text-secondary, #666)' },
  { tag: t.keyword, color: 'var(--primary, #007aff)' },
  { tag: t.comment, color: 'var(--text-secondary, #666)', fontStyle: 'italic' },
]);

export const editorSyntaxHighlighting = syntaxHighlighting(highlightStyle, {
  fallback: true,
});

export function applyTheme(theme: import('./model').HostTheme | null | undefined): void {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.background) {
    root.style.setProperty('--bg', theme.background);
    root.style.setProperty('--editor-bg', theme.background);
  }
  if (theme.text) root.style.setProperty('--text', theme.text);
  if (theme.textSecondary) {
    root.style.setProperty('--text-secondary', theme.textSecondary);
  }
  if (theme.primary) root.style.setProperty('--primary', theme.primary);
  if (theme.surface) {
    root.style.setProperty('--surface', theme.surface);
    root.style.setProperty('--editor-gutter-bg', theme.surface);
  }
  if (theme.borderLight) {
    root.style.setProperty('--border', theme.borderLight);
    root.style.setProperty('--editor-gutter-border', theme.borderLight);
  }
}
