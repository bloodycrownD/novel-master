import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {EditorView, drawSelection, keymap} from '@codemirror/view';
import {
  Compartment,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { languageExtensionForPath } from './language-for-path';
import { editorSyntaxHighlighting, editorTheme } from './theme';
import { post } from './post';

let view: EditorView | null = null;
let currentPath = '';
let suppressChange = false;

const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

function buildExtensions(path: string, readOnly: boolean): Extension[] {
  return [
    editorTheme,
    editorSyntaxHighlighting,
    EditorView.lineWrapping,
    drawSelection(),
    history(),
    languageCompartment.of(languageExtensionForPath(path)),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of(update => {
      if (suppressChange || !update.docChanged) return;
      post('change', { text: update.state.doc.toString() });
    }),
    EditorView.domEventHandlers({
      focus: () => {
        post('focus', {});
        return false;
      },
      blur: () => {
        post('blur', {});
        return false;
      },
    }),
  ];
}

export function mountEditor(
  parent: HTMLElement,
  text: string,
  path: string,
  readOnly = false,
): void {
  if (view) {
    destroyEditor();
  }
  currentPath = path;
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: buildExtensions(path, readOnly),
    }),
    parent,
  });
}

export function destroyEditor(): void {
  if (view) {
    view.destroy();
    view = null;
  }
  currentPath = '';
}

export function setDocument(text: string, path: string): void {
  if (!view) return;

  const current = view.state.doc.toString();
  const pathChanged = currentPath !== path;
  currentPath = path;

  if (current === text && !pathChanged) {
    return;
  }

  if (current === text && pathChanged) {
    view.dispatch({
      effects: languageCompartment.reconfigure(languageExtensionForPath(path)),
    });
    return;
  }

  suppressChange = true;
  try {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      effects: pathChanged
        ? languageCompartment.reconfigure(languageExtensionForPath(path))
        : undefined,
    });
  } finally {
    suppressChange = false;
  }
}

export function blurEditor(): void {
  view?.contentDOM.blur();
}

export function setReadOnly(readOnly: boolean): void {
  if (!view) return;
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}
