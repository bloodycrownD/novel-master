import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {EditorView, drawSelection, keymap} from '@codemirror/view';
import {Compartment, EditorState, type Extension} from '@codemirror/state';
import {languageExtensionForPath} from './language-for-path';
import {
  composerTokenEnabled,
  composerTokenHighlight,
} from './composer-tokens';
import {editorSyntaxHighlighting, editorTheme} from './theme';
import {post} from './post';

let view: EditorView | null = null;
let currentPath = '';
let suppressChange = false;

const languageCompartment = new Compartment();
/** composer-token 胶囊扩展按 path 启停（与语言同拍 reconfigure）。 */
const tokenCompartment = new Compartment();

function buildExtensions(path: string): Extension[] {
  return [
    editorTheme,
    editorSyntaxHighlighting,
    EditorView.lineWrapping,
    drawSelection(),
    history(),
    languageCompartment.of(languageExtensionForPath(path)),
    tokenCompartment.of(
      composerTokenEnabled(path) ? composerTokenHighlight : [],
    ),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of(update => {
      // 选区上报（typeahead 的活跃查询判定在 RN 侧，需要光标位置）。
      // 程序化 setSelection 的回声也走这里：宿主侧同值去重，无回环风险。
      // 仅 composer 伪路径上报（capsule/B-1）：胶囊扩展本就只挂该路径，选区上报
      // 与它同源同门。文件编辑不消费 selectionChange（无 onSelectionChange 消费方），
      // 无条件上报等于每步打字都白跨一次桥。
      if (update.selectionSet && composerTokenEnabled(currentPath)) {
        const sel = update.state.selection.main;
        post('selectionChange', {start: sel.from, end: sel.to});
      }
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

/** 外部受控选区（程序化写入一次落位；坐标为 plain 文本偏移）。 */
export type EditorSelectionRange = {
  readonly start: number;
  readonly end: number;
};

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.max(0, Math.min(Math.floor(value), length));
}

/** 转成 CM 选区 spec；无选区期望时返回 undefined（事务里等价于不设）。 */
function selectionSpec(
  text: string,
  selection?: EditorSelectionRange,
): {anchor: number; head: number} | undefined {
  if (selection == null) {
    return undefined;
  }
  return {
    anchor: clampIndex(selection.start, text.length),
    head: clampIndex(selection.end, text.length),
  };
}

/** path 变化时的两仓重配（语言 + 胶囊扩展）；无变化返回 undefined。 */
function reconfigureEffects(path: string) {
  return [
    languageCompartment.reconfigure(languageExtensionForPath(path)),
    tokenCompartment.reconfigure(
      composerTokenEnabled(path) ? composerTokenHighlight : [],
    ),
  ];
}

export function mountEditor(
  parent: HTMLElement,
  text: string,
  path: string,
  selection?: EditorSelectionRange,
): void {
  if (view) {
    destroyEditor();
  }
  currentPath = path;
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: buildExtensions(path),
      // 缺省选区按路径分流（capsule/B-3）：composer 伪路径默认落文末——全屏进屏
      // 不点编辑器直接按 @/$ 时，token 要插在草稿末尾而不是整篇开头（RN 侧
      // cursor 初值同步落文末，见 PromptEditorScreen）。
      // 文件编辑保持现状（不传 selection → CM 落 0），「文件编辑也落文末」待拍板。
      selection:
        selectionSpec(text, selection) ??
        (composerTokenEnabled(path) ? {anchor: text.length} : undefined),
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

export function setDocument(
  text: string,
  path: string,
  selection?: EditorSelectionRange,
): void {
  if (!view) return;

  const current = view.state.doc.toString();
  const pathChanged = currentPath !== path;
  currentPath = path;

  if (current === text && !pathChanged && selection == null) {
    return;
  }

  if (current === text) {
    if (pathChanged) {
      view.dispatch({effects: reconfigureEffects(path)});
    }
    const sel = selectionSpec(text, selection);
    if (sel != null) {
      view.dispatch({selection: sel});
    }
    return;
  }

  suppressChange = true;
  try {
    view.dispatch({
      changes: {from: 0, to: current.length, insert: text},
      selection: selectionSpec(text, selection),
      effects: pathChanged ? reconfigureEffects(path) : undefined,
    });
  } finally {
    suppressChange = false;
  }
}

export function blurEditor(): void {
  view?.contentDOM.blur();
}
