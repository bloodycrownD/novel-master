/**
 * chat-conversation dock：自有下行 handler + UI 渲染（chat-webview-unify Step 3/4/5 web 半）。
 *
 * 覆盖三类职责：
 * 1. **dock 域下行**（`composerState` / `composerPaste` / `selectAll`）——不经旧
 *    runtime，合成包自有 handler 消费；
 * 2. **dock 域上行**（`dockAction` 六项）——经入口自建的 `createBoundPost(2)` 发出
 *    （v:2 只用于新包自有的 ready / dockAction，见 spec §合成 dispatcher 契约第 1 条）；
 * 3. **UI 渲染**——hintRow / error / chips 行 / typeahead 浮层 / toolbar。
 *
 * 结构与样式数值清单来自现网 RN 组件，逐项照搬（spec Step 4）：
 * - `AttachmentDraftChips` → chips 行（chat 走 `transparentRow` 变体）；
 * - `TypeaheadList` + `AtPathTypeahead` / `SkillTypeahead` → typeahead 浮层；
 * - `ChatComposer` 的 `styles.dock` / `styles.box` / `styles.hintRow` / `styles.error`
 *   与 `composerToolBtnStyle` → dock 容器与 toolbar。
 *
 * 纯渲染判定（`resolve*` 函数）单独导出，node 环境直测；DOM 装配在 `mount()`
 * 内（`createConversationDock` 本身不碰 DOM，便于无 DOM 环境构造 handler）。
 *
 * es2018 纪律：禁 ES2021+ 运行时 API 与 lookbehind 正则。
 */
import {formatStatusChipLabelFromAttachment} from '@novel-master/core/chat';
import {applyHostTheme} from '@web/shared/host-theme';
import type {BoundPost} from '@web/shared/post';
import {applyText} from '@web/composer-input/webview/runtime/editor';
import {post as postComposer} from '@web/composer-input/webview/runtime/bridge';
import {buildTokenInsertion} from '@/components/chat/composer-token-insert';
import type {ConversationDockRoute} from './dispatcher';
import type {
  ConversationComposerState,
  ConversationDockAction,
  ConversationTheme,
  MessageAttachment,
} from './model';
import {computeTypeaheadView, type TypeaheadView} from './typeahead';

/* ------------------------------------------------------------------ *
 * 纯判定层（node 环境直测）
 * ------------------------------------------------------------------ */

/** dock 底 padding 基准（对齐 `composerDockBottomPadding(safeAreaBottom, base = 8)`）。 */
export const DOCK_PADDING_BASE = 8;

/**
 * dock 底 padding：键盘弹起时归零，否则 `max(8, safeAreaBottom)`。
 *
 * 键盘态**不做 web 侧自判**（RN 侧经 `composerState.keyboardUp` 下发）：Android 的
 * `AndroidKeyboardClipBody` 以 marginBottom 裁切容器、键盘高度根本不进 WebView 视口，
 * `vv.height` 与 `innerHeight` 同步缩小、差值恒 0，自判判不出弹起；而「弹起时归零」
 * 正是现网已修的白条 bug 防线，自判等于把它带回来（spec §键盘定案）。
 */
export function resolveDockBottomPadding(
  keyboardUp: boolean,
  safeAreaBottom: number,
  base: number = DOCK_PADDING_BASE,
): number {
  return keyboardUp ? 0 : Math.max(base, safeAreaBottom);
}

/** 发送/终止钮形态：running 走 danger 底，sendDisabled 置灰，否则 primary。 */
export type SendButtonState = {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly variant: 'disabled' | 'danger' | 'primary';
  /** 上行动作（running 时是「终止」，否则「发送」）。 */
  readonly action: ConversationDockAction;
};

export function resolveSendButtonState(
  state: ConversationComposerState,
): SendButtonState {
  return {
    disabled: state.sendDisabled,
    running: state.running,
    variant: state.sendDisabled
      ? 'disabled'
      : state.running
      ? 'danger'
      : 'primary',
    action: state.running ? 'terminate' : 'send',
  };
}

/**
 * hintRow 显隐判据 = `!hasModel`（**不能**用 `inputDisabled`——它是 hasModel 的超集，
 * 运行态 / 末条纯文本态下会误显「请先选择工作区模型」）。
 */
export function resolveHintRowVisible(
  state: ConversationComposerState | null,
): boolean {
  return state != null && !state.hasModel;
}

/** error 行文案（空串 = 不渲染）。 */
export function resolveErrorText(state: ConversationComposerState | null): string {
  return state?.error ?? '';
}

/** chips 文案表：core 的 `formatStatusChipLabelFromAttachment` 是单一真源。 */
export function resolveChipLabels(
  chips: readonly MessageAttachment[] | undefined,
): string[] {
  if (chips == null) {
    return [];
  }
  return chips.map(chip => formatStatusChipLabelFromAttachment(chip));
}

/** typeahead 展开判据：`!inputDisabled`（现网 `open={activeAt != null && !inputDisabled}`）。 */
export function resolveTypeaheadEnabled(
  state: ConversationComposerState | null,
): boolean {
  return state != null && !state.inputDisabled;
}

/** toolbar 三个引用钮的禁用态：fullscreen 看 `fullscreenEnabled`，@/$ 看 `inputDisabled`。 */
export function resolveToolbarDisabled(state: ConversationComposerState | null): {
  readonly fullscreen: boolean;
  readonly atPicker: boolean;
  readonly skillPicker: boolean;
} {
  if (state == null) {
    return {fullscreen: true, atPicker: true, skillPicker: true};
  }
  return {
    fullscreen: !state.fullscreenEnabled,
    atPicker: state.inputDisabled,
    skillPicker: state.inputDisabled,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * DOM 层
 * ------------------------------------------------------------------ */

const COMPOSER_SELECTOR = '.composer-input__input';

function composerTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
}

/**
 * 程序化写入正文并**主动上行 change**。
 *
 * 走 composer runtime 的 `applyText`：内容相同短路 + `suppressChange` 包裹（防回环）
 * + 高亮层重渲 + 选区落位；因为 suppressChange 期间内核不上报 change，这里补发一条
 * （v:1 走 composer 模块单例，宿主宽容解析）让 RN 侧草稿落库——typeahead 点选与
 * 划词粘贴都是「web 自治写入」，RN 不再回写 setText，不补这条草稿就会丢掉这两个动作。
 */
function commitComposerText(next: string, cursor: number): void {
  const input = composerTextarea();
  if (input == null) {
    return;
  }
  const changed = input.value !== next;
  applyText(next, cursor);
  if (changed) {
    postComposer('change', {text: next});
  }
}

function isTextArea(node: unknown): node is HTMLTextAreaElement {
  return node != null && (node as {tagName?: string}).tagName === 'TEXTAREA';
}

export type ConversationDock = {
  /**
   * 装配 dock DOM 与事件。**必须在两 runtime 之后调**——textarea 由 composer
   * 挂出，dock 要绑它的事件源；壳元素未命中时静默跳过（与 composer 工厂的
   * null 守卫同口径，不抛）。
   */
  mount(): void;
  /** 消费一条 dock 域下行。 */
  applyRoute(route: ConversationDockRoute): void;
  /** `themeUpdate` 的第三份 fan-out（9 键超集一次写 documentElement）。 */
  applyTheme(theme: ConversationTheme): void;
  /** 拆事件绑定（换壳 / 测试复位用）。 */
  unmount(): void;
};

type DockElements = {
  readonly dock: HTMLElement;
  readonly hintRow: HTMLElement;
  readonly errorRow: HTMLElement;
  readonly chipsRow: HTMLElement;
  readonly typeahead: HTMLElement;
  readonly toolbar: HTMLElement;
};

function pickElements(): DockElements | null {
  const dock = document.getElementById('composer-dock');
  const hintRow = document.getElementById('composer-hint-row');
  const errorRow = document.getElementById('composer-error');
  const chipsRow = document.getElementById('composer-chips');
  const typeahead = document.getElementById('composer-typeahead');
  const toolbar = document.getElementById('composer-toolbar');
  if (
    dock == null ||
    hintRow == null ||
    errorRow == null ||
    chipsRow == null ||
    typeahead == null ||
    toolbar == null
  ) {
    return null;
  }
  return {dock, hintRow, errorRow, chipsRow, typeahead, toolbar};
}

const SEND_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M22 2L11 13" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

const TERMINATE_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<rect x="6" y="6" width="12" height="12" rx="2" fill="#fff"/>' +
  '</svg>';

export function createConversationDock(post: BoundPost): ConversationDock {
  let els: DockElements | null = null;
  let state: ConversationComposerState | null = null;
  let safeAreaBottom = 0;
  let unbind: Array<() => void> = [];

  const emit = (action: ConversationDockAction): void => {
    post('dockAction', {action});
  };

  /* ---- 渲染 ---- */

  const renderHintRow = (): void => {
    if (els == null) return;
    els.hintRow.hidden = !resolveHintRowVisible(state);
  };

  const renderError = (): void => {
    if (els == null) return;
    const text = resolveErrorText(state);
    els.errorRow.textContent = text;
    els.errorRow.hidden = text === '';
  };

  const renderChips = (): void => {
    if (els == null) return;
    const labels = resolveChipLabels(state?.chips);
    // 纯展示、不可点、**不随 inputDisabled 置灰**（现网 disabled 是死参数）
    els.chipsRow.innerHTML = labels
      .map(
        label =>
          '<span class="chip"><span class="chip__label">' +
          escapeHtml(label) +
          '</span></span>',
      )
      .join('');
    els.chipsRow.hidden = labels.length === 0;
  };

  const renderPadding = (): void => {
    if (els == null) return;
    els.dock.style.paddingBottom = `${resolveDockBottomPadding(
      state?.keyboardUp === true,
      safeAreaBottom,
    )}px`;
  };

  const renderInput = (): void => {
    const input = composerTextarea();
    if (input == null || state == null) return;
    input.readOnly = state.inputDisabled;
    input.placeholder = state.placeholder;
    const root = input.parentElement;
    if (root != null) {
      root.classList.toggle('composer-input--disabled', state.inputDisabled);
    }
  };

  const renderToolbar = (): void => {
    if (els == null || state == null) return;
    const disabled = resolveToolbarDisabled(state);
    const btn = (cls: string): HTMLButtonElement | null =>
      els?.toolbar.querySelector<HTMLButtonElement>(cls) ?? null;
    const fullscreenBtn = btn('.toolbar__fullscreen');
    const atBtn = btn('.toolbar__at');
    const skillBtn = btn('.toolbar__skill');
    if (fullscreenBtn != null) fullscreenBtn.disabled = disabled.fullscreen;
    if (atBtn != null) atBtn.disabled = disabled.atPicker;
    if (skillBtn != null) skillBtn.disabled = disabled.skillPicker;

    const send = btn('.toolbar__send');
    if (send == null) return;
    const view = resolveSendButtonState(state);
    send.disabled = view.disabled;
    send.className = `toolbar__send toolbar__send--${view.variant}`;
    send.setAttribute('aria-label', view.running ? '终止' : '发送');
    send.innerHTML = view.running ? TERMINATE_ICON : SEND_ICON;
  };

  const currentTypeaheadView = (): TypeaheadView | null => {
    const input = composerTextarea();
    if (input == null || state == null) {
      return null;
    }
    return computeTypeaheadView(
      input.value,
      input.selectionStart ?? input.value.length,
      state.typeahead ?? {files: [], skills: []},
      resolveTypeaheadEnabled(state),
    );
  };

  const renderTypeahead = (): void => {
    if (els == null) return;
    const view = currentTypeaheadView();
    if (view == null) {
      els.typeahead.hidden = true;
      els.typeahead.innerHTML = '';
      return;
    }
    els.typeahead.hidden = false;
    els.typeahead.setAttribute(
      'aria-label',
      view.trigger === '@' ? '文件路径建议' : '技能建议',
    );
    els.typeahead.innerHTML = view.items
      .map(item => {
        const tag =
          item.tag === ''
            ? ''
            : `<span class="typeahead__tag">${escapeHtml(item.tag)}</span>`;
        const rowCls =
          view.trigger === '$'
            ? 'typeahead__row typeahead__row--skill'
            : 'typeahead__row';
        return (
          `<div class="${rowCls}" data-testid="typeahead-row">` +
          `<span class="typeahead__label">${escapeHtml(item.label)}</span>` +
          tag +
          '</div>'
        );
      })
      .join('');
  };

  const renderAll = (): void => {
    renderHintRow();
    renderError();
    renderChips();
    renderPadding();
    renderInput();
    renderToolbar();
    renderTypeahead();
  };

  /* ---- typeahead 点选（web 自治，零跨桥） ---- */

  const selectTypeaheadItem = (index: number): void => {
    const input = composerTextarea();
    if (input == null || index < 0) return;
    const view = currentTypeaheadView();
    if (view == null) return;
    const item = view.items[index];
    if (item == null) return;
    const cursor = input.selectionStart ?? input.value.length;
    const insertion = buildTokenInsertion(input.value, cursor, view.start, item.token);
    commitComposerText(insertion.text, insertion.cursor);
    renderTypeahead();
  };

  /* ---- 装配 ---- */

  const buildToolbar = (root: DockElements): void => {
    const mk = (
      cls: string,
      label: string,
      glyph: string,
      fontSize: number,
      testId: string,
      onPress: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('data-testid', testId);
      btn.textContent = glyph;
      btn.style.fontSize = `${fontSize}px`;
      btn.addEventListener('click', onPress);
      return btn;
    };

    const spacer = document.createElement('div');
    spacer.className = 'toolbar__spacer';

    // 同排按钮风格一致：三个引用钮同款 36 圆钮 + hairline 描边（fullscreen 笔画细、字号 20）
    const fullscreen = mk(
      'toolbar__btn toolbar__fullscreen',
      '全屏编辑',
      '⛶',
      20,
      'composer-fullscreen',
      () => emit('fullscreen'),
    );
    const atBtn = mk(
      'toolbar__btn toolbar__at',
      '引用文件',
      '@',
      16,
      'composer-at-picker',
      () => emit('atPicker'),
    );
    const skillBtn = mk(
      'toolbar__btn toolbar__skill',
      '引用技能',
      '$',
      16,
      'composer-skill-picker',
      () => emit('skillPicker'),
    );

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'toolbar__send toolbar__send--primary';
    send.setAttribute('data-testid', 'composer-send');
    send.setAttribute('aria-label', '发送');
    send.innerHTML = SEND_ICON;
    send.addEventListener('click', () => {
      if (state == null) return;
      emit(resolveSendButtonState(state).action);
    });

    root.toolbar.appendChild(spacer);
    root.toolbar.appendChild(fullscreen);
    root.toolbar.appendChild(atBtn);
    root.toolbar.appendChild(skillBtn);
    root.toolbar.appendChild(send);
  };

  const bindEvents = (root: DockElements): Array<() => void> => {
    const off: Array<() => void> = [];
    const on = (
      target: EventTarget,
      type: string,
      fn: (event: Event) => void,
    ): void => {
      const listener = fn as EventListener;
      target.addEventListener(type, listener);
      off.push(() => target.removeEventListener(type, listener));
    };

    // hintRow：!hasModel 时可点 -> dockAction.needModel（现网 onNeedModel）
    on(root.hintRow, 'click', () => emit('needModel'));
    // typeahead 行点选：同文档插入，零跨桥
    on(root.typeahead, 'click', event => {
      const target = event.target as HTMLElement | null;
      const row =
        target != null && typeof target.closest === 'function'
          ? target.closest('.typeahead__row')
          : null;
      if (row == null) return;
      const rows = root.typeahead.querySelectorAll('.typeahead__row');
      selectTypeaheadItem(Array.prototype.indexOf.call(rows, row));
    });

    // typeahead 打开判据依赖 text + cursor（都在 web editor 手里）-> 自持刷新
    const input = composerTextarea();
    if (input != null) {
      on(input, 'input', () => renderTypeahead());
      on(input, 'keyup', () => renderTypeahead());
      on(input, 'click', () => renderTypeahead());
      on(input, 'select', () => renderTypeahead());
      on(document, 'selectionchange', () => {
        if (document.activeElement === input) {
          renderTypeahead();
        }
      });
    }
    return off;
  };

  return {
    mount(): void {
      if (els != null) {
        return;
      }
      const root = pickElements();
      if (root == null) {
        return;
      }
      els = root;
      buildToolbar(root);
      unbind = bindEvents(root);
      renderAll();
    },

    applyRoute(route: ConversationDockRoute): void {
      if (route.kind === 'init') {
        safeAreaBottom = route.safeAreaBottom;
        renderPadding();
        return;
      }
      if (route.kind === 'composerState') {
        state = route.state;
        renderAll();
        return;
      }
      if (route.kind === 'composerPaste') {
        const input = composerTextarea();
        if (input == null || route.text === '') {
          return;
        }
        // 聚焦则光标处插入，否则先聚焦再插入（现网长按粘贴的落点语义）
        if (document.activeElement !== input) {
          input.focus();
        }
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        commitComposerText(
          `${input.value.slice(0, start)}${route.text}${input.value.slice(end)}`,
          start + route.text.length,
        );
        renderTypeahead();
        return;
      }
      // selectAll：输入框选区 -> textarea.select()；否则整篇文档选区（划词菜单第三项）
      // `Selection.selectAll` 是非标准扩展（DOM lib 未收录），故显式取方法再调。
      const active = document.activeElement;
      if (isTextArea(active)) {
        active.select();
        return;
      }
      const selection = window.getSelection?.() as
        | {selectAll?: () => void}
        | undefined
        | null;
      if (selection != null && typeof selection.selectAll === 'function') {
        selection.selectAll();
      }
    },

    applyTheme(theme: ConversationTheme): void {
      // 9 键超集一次写 documentElement；与 transcript / composer 的 fan-out 共用同一份
      applyHostTheme(theme);
    },

    unmount(): void {
      for (const off of unbind) {
        off();
      }
      unbind = [];
      els = null;
    },
  };
}
