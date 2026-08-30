import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {EditorView, drawSelection, keymap} from '@codemirror/view';
import {Compartment, EditorState, type Extension} from '@codemirror/state';
import {languageExtensionForPath} from './language-for-path';
import {editorSyntaxHighlighting, editorTheme} from './theme';
import {post} from './post';

let view: EditorView | null = null;
let currentPath = '';
let suppressChange = false;

const languageCompartment = new Compartment();

function buildExtensions(path: string): Extension[] {
  return [
    editorTheme,
    editorSyntaxHighlighting,
    EditorView.lineWrapping,
    drawSelection(),
    history(),
    languageCompartment.of(languageExtensionForPath(path)),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of(update => {
      if (suppressChange || !update.docChanged) return;
      post('change', {text: update.state.doc.toString()});
    }),
    EditorView.domEventHandlers({
      focus: () => {
        post('focus', {});
        requestAnimationFrame(() => {
          scrollCaretIntoView();
        });
        return false;
      },
      blur: () => {
        post('blur', {});
        return false;
      },
    }),
  ];
}

function scrollCaretIntoView(): void {
  if (!view?.hasFocus) return;
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, {
      y: 'nearest',
    }),
  });
}

/** 只负责键盘/尺寸变化后滚光标；底部避让交给 RN 侧抬升/KAV，避免双重垫高。 */
function bindCaretRevealOnResize(): () => void {
  const apply = () => {
    requestAnimationFrame(() => {
      scrollCaretIntoView();
    });
  };
  apply();
  window.addEventListener('resize', apply);
  const vv = window.visualViewport;
  if (vv != null) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }
  return () => {
    window.removeEventListener('resize', apply);
    if (vv != null) {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    }
  };
}

let unbindCaretReveal: (() => void) | null = null;

export function mountEditor(
  parent: HTMLElement,
  text: string,
  path: string,
): void {
  if (view) {
    destroyEditor();
  }
  currentPath = path;
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: buildExtensions(path),
    }),
    parent,
  });
  unbindCaretReveal = bindCaretRevealOnResize();
}

export function destroyEditor(): void {
  if (unbindCaretReveal != null) {
    unbindCaretReveal();
    unbindCaretReveal = null;
  }
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
      changes: {from: 0, to: current.length, insert: text},
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
