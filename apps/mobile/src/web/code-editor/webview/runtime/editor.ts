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

/**
 * change 上行的 rAF 合帧（长按连删卡顿修，transcript-converge 后续轮）：
 * 长按删除键的 key repeat 约 25~30 次/秒，每键全文 toString + stringify
 * 跨桥会把 web/RN 两侧都刷爆。合帧后每渲染帧至多一条全文快照——last-wins
 * 天然无序可乱；IME 组合期 CM 不派发 docChanged，组合提交是一次正常 change，
 * 延后一帧无损。**不做定时 debounce**：定时延迟会让 RN 侧镜像欠账。
 *
 * 收口（flush）只有两处，都是同步的：
 * ① web 侧 blur handler（`EditorView.domEventHandlers` 的 blur）——失焦即
 *    flushPendingChange + post('blur')，RN 侧镜像不欠账；
 * ② RN 侧保存前主动 `codeEditorRef.current?.blur()`（FileEditorScreen
 *    handleSave / dismissEditor）——它跨桥落到同一个 blur handler，
 *    于是「工具栏按压」与「contenteditable 失焦」无论谁先到，
 *    vfs.write 读到的都是已收口的最新全文。
 * 另有两条作废路径：setDocument（丢弃挂起快照）与 destroyEditor（作废）。
 * 上述四条语义由 `__tests__/code-editor-webview-runtime.test.ts` 钉住。
 */
let changePendingThisFrame = false;
let changeRafId = 0;

function flushPendingChange(): void {
  if (!changePendingThisFrame) {
    return;
  }
  changePendingThisFrame = false;
  if (changeRafId !== 0) {
    cancelAnimationFrame(changeRafId);
    changeRafId = 0;
  }
  if (view == null) {
    return;
  }
  post('change', {text: view.state.doc.toString()});
}

function scheduleChangePost(): void {
  changePendingThisFrame = true;
  if (changeRafId !== 0) {
    return;
  }
  changeRafId = requestAnimationFrame(() => {
    changeRafId = 0;
    flushPendingChange();
  });
}

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
      // 合帧上行（见 scheduleChangePost 注释）：同帧多次按键合并为一条全文快照。
      scheduleChangePost();
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
        // 失焦即收口：挂起的合帧同步发出，RN 侧镜像不欠账。
        flushPendingChange();
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
  // 挂起的合帧作废：view 即将销毁，旧快照发出去只会污染 RN 镜像。
  changePendingThisFrame = false;
  if (changeRafId !== 0) {
    cancelAnimationFrame(changeRafId);
    changeRafId = 0;
  }
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

  // 外部替换前丢掉挂起的上行快照：它描述的是被替换前的旧文档，
  // 若放行会在替换后迟到、经 RN 镜像回环把旧内容吃回来。
  changePendingThisFrame = false;
  if (changeRafId !== 0) {
    cancelAnimationFrame(changeRafId);
    changeRafId = 0;
  }

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
