/**
 * composer-input 编辑器核心（web 单引擎 overlay；纯 TS + 原生 DOM，不引框架）。
 *
 * 结构：高亮层 div（流内、document 高度真源、pointer-events:none）+ 透明 textarea
 * （absolute inset:0 上层）。滚动同步、高度测量全在同一内核内完成，无跨引擎时序差。
 *
 * 真源口径（对齐 code-editor 受控桥）：打字时 web 自持真源——input → 原子删拦截 →
 * `post('change')` 上报，RN 收 change 只更新草稿、**不回写**（v1.5.9 的 IME 防线）；
 * 只有外部变化（水化 / typeahead 点选 / chips 插入 / 发送清空 / 全屏回填）才走
 * `applyText`，内部 suppressChange 包裹 + 内容相同短路防回环。
 *
 * 兼容约束：老 Android WebView 解析期即报 SyntaxError，禁用 lookbehind 等 ES2018 之后
 * 的正则/语法特性；target es2018（build-webview.mjs）。
 */
import {
  composerTokenRanges,
  splitComposerTokenSegments,
} from '@/components/chat/composer-highlight';
import {
  tryAtomicRangeDelete,
  type AtomicDeleteRange,
} from '@/components/common/atomic-range-delete';
import {findWhitelistMacroRanges} from '@/components/agent/prompt-macro-input';
import {post} from './bridge';
import type {
  ComposerMetrics,
  ComposerMode,
  ComposerTheme,
  InitPayload,
} from './model';

/** 高度上报死区：变化不超过该值不发消息（防亚像素抖动刷消息）。 */
const HEIGHT_EPSILON = 0.5;

/** init 未达前的封顶兜底（metrics.maxHeight 缺省时回落）。 */
const DEFAULT_MAX_HEIGHT = 160;

/** init 未达前的兜底口径；init 一到即被宿主 metrics 覆盖。 */
const DEFAULT_METRICS: ComposerMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: DEFAULT_MAX_HEIGHT,
};

/* ------------------------------------------------------------------ *
 * 纯函数层（jest 直测；不触碰 DOM）
 * ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 高亮段统一形状（token 与宏两源归一，渲染只有一份）。 */
type HighlightSegment = {
  readonly highlighted: boolean;
  readonly text: string;
};

/** 按区间切分正文：区间外照原文，区间内标高亮（区间互不重叠且按序）。 */
function segmentsFromRanges(
  text: string,
  ranges: readonly AtomicDeleteRange[],
): HighlightSegment[] {
  if (ranges.length === 0) {
    return [{highlighted: false, text}];
  }
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({
        highlighted: false,
        text: text.slice(cursor, range.start),
      });
    }
    segments.push({
      highlighted: true,
      text: text.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({highlighted: false, text: text.slice(cursor)});
  }
  return segments;
}

/** 双模式分段来源：token 走 splitComposerTokenSegments，宏走 findWhitelistMacroRanges。 */
function highlightSegments(
  text: string,
  mode: ComposerMode,
): readonly HighlightSegment[] {
  if (mode === 'prompt-macro') {
    return segmentsFromRanges(text, findWhitelistMacroRanges(text));
  }
  return splitComposerTokenSegments(text).map(segment => ({
    highlighted: segment.kind === 'token',
    text: segment.text,
  }));
}

/**
 * 高亮层 HTML（桌面 `renderComposerAtPathHighlightHtml` / `renderPromptMacroHighlightHtml`
 * 逐项照搬，双模式仅分段来源不同）：非高亮段转义 + 高亮段 span；
 * 末尾换行在 pre-wrap 下需占位，否则与 textarea 高度错位；空串用零宽空格撑住行盒。
 */
export function renderHighlightHtml(text: string, mode: ComposerMode): string {
  if (text === '') {
    return '&#8203;';
  }
  let html = '';
  for (const segment of highlightSegments(text, mode)) {
    html += segment.highlighted
      ? `<span class="composer-input__token">${escapeHtml(segment.text)}</span>`
      : escapeHtml(segment.text);
  }
  if (text.endsWith('\n')) {
    html += '<br/>';
  }
  return html;
}

/** 按 mode 取原子删候选区间：chat 链 = token 区间，宏链 = 白名单宏区间。 */
export function atomicDeleteRanges(
  text: string,
  mode: ComposerMode,
): readonly AtomicDeleteRange[] {
  return mode === 'prompt-macro'
    ? findWhitelistMacroRanges(text)
    : composerTokenRanges(text);
}

/**
 * 单次删除命中高亮区间时整段摘除（web 侧原子删，RN 侧零变换逻辑）。
 * @returns 整段删除后的新串；无需拦截时返回 null（走内核默认差分）
 */
export function resolveAtomicDelete(
  prev: string,
  next: string,
  mode: ComposerMode,
): string | null {
  return tryAtomicRangeDelete(prev, next, atomicDeleteRanges(prev, mode));
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) {
    index++;
  }
  return index;
}

/**
 * 原子删改写后的光标落点：删除窗起点与高亮区间起点取前。
 *
 * 两个公共前缀即可精确得到：`prev↔raw` 的前缀长 = 删除窗起点，
 * `prev↔resolved` 的前缀长 = 被摘除区间的起点（区间整段消失，差异必从此处开始）。
 * 命中区间时两者都合法，取前不会把光标推到被删内容右侧。
 */
export function resolveAtomicCaret(
  prev: string,
  raw: string,
  resolved: string,
): number {
  return Math.min(
    commonPrefixLength(prev, raw),
    commonPrefixLength(prev, resolved),
  );
}

/** change 上报闸门：suppressChange 期间、或文本与上次真源相同 → 短路（防回环）。 */
export function shouldReportChange(
  next: string,
  last: string,
  suppress: boolean,
): boolean {
  return !suppress && next !== last;
}

/**
 * 内容高度按 metrics 归一：封顶后 textarea 自身内滚。
 * @returns 需上报的高度；null 表示本帧不上报（maxHeight=null 的不限高模式
 * 无生产消费方，不下发）
 */
export function resolveReportedHeight(
  contentHeight: number,
  metrics: ComposerMetrics,
): number | null {
  if (metrics.maxHeight == null) {
    return null;
  }
  return Math.min(
    metrics.maxHeight,
    Math.max(metrics.minHeight, contentHeight),
  );
}

/* ------------------------------------------------------------------ *
 * DOM 层（webview 内单实例）
 * ------------------------------------------------------------------ */

type ComposerEditorState = {
  readonly root: HTMLDivElement;
  readonly highlight: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  mode: ComposerMode;
  /** 外部写入期间置位：input 一律不上报 change（程序化赋值本不触发 input，双保险）。 */
  suppressChange: boolean;
  metrics: ComposerMetrics;
  /** 上次真源（打字序列的对账基准）。 */
  lastText: string;
  /** 上次上报的高度；null = 尚未上报过（init 后首发一次）。 */
  lastHeight: number | null;
  /** 上次选区（去重：同一位置不重复上报）。 */
  lastSelection: {start: number; end: number} | null;
  measureScheduled: boolean;
  /** init 到齐后才测高上报：init 前是兜底口径，报出去只会多一次抖动。 */
  initialized: boolean;
};

let editor: ComposerEditorState | null = null;
let unbindStack: Array<() => void> = [];

function listen(
  target: EventTarget,
  type: string,
  handler: (event: Event) => void,
): () => void {
  const listener = handler as EventListener;
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** payload 宽松取值：坏字段回落兜底，不让宿主一处笔误打挂输入区。 */
function coerceMetrics(value: unknown): ComposerMetrics {
  const raw = (value ?? {}) as Partial<ComposerMetrics>;
  return {
    fontSize: finiteOr(raw.fontSize, DEFAULT_METRICS.fontSize),
    lineHeight: finiteOr(raw.lineHeight, DEFAULT_METRICS.lineHeight),
    paddingH: finiteOr(raw.paddingH, DEFAULT_METRICS.paddingH),
    paddingV: finiteOr(raw.paddingV, DEFAULT_METRICS.paddingV),
    minHeight: finiteOr(raw.minHeight, DEFAULT_METRICS.minHeight),
    // null = 不限高（全屏）为显式语义，只在字段缺失时才回落默认封顶
    maxHeight:
      raw.maxHeight === null
        ? null
        : finiteOr(raw.maxHeight, DEFAULT_MAX_HEIGHT),
  };
}

/** 高亮重渲：内容与滚动位置一起对齐（渲染后行宽可能变化）。 */
function renderHighlight(state: ComposerEditorState): void {
  state.highlight.innerHTML = renderHighlightHtml(
    state.input.value,
    state.mode,
  );
  syncScroll(state);
}

/** 同引擎滚动同步：高亮层跟随 textarea（零跨引擎时序差）。 */
function syncScroll(state: ComposerEditorState): void {
  state.highlight.scrollTop = state.input.scrollTop;
}

function measureByClamp(state: ComposerEditorState): void {
  if (!state.initialized) {
    return;
  }
  const reported = resolveReportedHeight(
    state.highlight.scrollHeight,
    state.metrics,
  );
  if (reported == null) {
    return;
  }
  if (
    state.lastHeight != null &&
    Math.abs(reported - state.lastHeight) <= HEIGHT_EPSILON
  ) {
    return;
  }
  state.lastHeight = reported;
  post('heightChange', {height: reported});
}

/** rAF 合并测高：一帧内多次内容变化只测量一次。 */
function scheduleMeasure(state: ComposerEditorState): void {
  if (state.measureScheduled) {
    return;
  }
  state.measureScheduled = true;
  requestAnimationFrame(() => {
    state.measureScheduled = false;
    if (editor === state) {
      measureByClamp(state);
    }
  });
}

/** 记录当前 DOM 选区但不上报（外部写入时宿主已知，避免回环）。 */
function rememberSelection(state: ComposerEditorState): void {
  state.lastSelection = {
    start: state.input.selectionStart,
    end: state.input.selectionEnd,
  };
}

function reportSelection(state: ComposerEditorState): void {
  const next = {
    start: state.input.selectionStart,
    end: state.input.selectionEnd,
  };
  const last = state.lastSelection;
  if (last != null && last.start === next.start && last.end === next.end) {
    return;
  }
  state.lastSelection = next;
  post('selectionChange', next);
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(Math.floor(value), length));
}

/* ---- host 下行应用的对外入口 ---- */

/** 不限高模式（当前无生产消费方，保留为协议能力）：容器铺满视口（CSS 类），textarea 与高亮层去掉封顶。 */
export function resolveUnbounded(metrics: ComposerMetrics): boolean {
  return metrics.maxHeight == null;
}

export function applyMetrics(metrics: ComposerMetrics): void {
  const state = editor;
  if (state == null) {
    return;
  }
  state.metrics = metrics;
  state.root.style.fontSize = `${metrics.fontSize}px`;
  state.root.style.lineHeight = `${metrics.lineHeight}px`;
  const padding = `${metrics.paddingV}px ${metrics.paddingH}px`;
  state.highlight.style.padding = padding;
  state.input.style.padding = padding;
  state.highlight.style.minHeight = `${metrics.minHeight}px`;
  // 不限高（全屏）时交给 flex 全高容器：去掉封顶，textarea 自身仍可内滚
  state.highlight.style.maxHeight =
    metrics.maxHeight == null ? 'none' : `${metrics.maxHeight}px`;
  // 容器高度=内容高度的流式布局在限高模式正确；全屏须显式撑满视口，否则
  // 触摸区只到内容底部（`.composer-input` 默认无高度，靠 CSS 类补 height:100%）。
  state.root.classList.toggle(
    'composer-input--unbounded',
    resolveUnbounded(metrics),
  );
  scheduleMeasure(state);
}

export function applyTheme(theme: ComposerTheme | null | undefined): void {
  const state = editor;
  if (state == null || theme == null) {
    return;
  }
  const root = document.documentElement;
  if (theme.background) {
    root.style.setProperty('--bg', theme.background);
  }
  if (theme.text) {
    root.style.setProperty('--text', theme.text);
  }
  if (theme.textSecondary) {
    root.style.setProperty('--text-secondary', theme.textSecondary);
  }
  if (theme.primary) {
    root.style.setProperty('--primary', theme.primary);
  }
  // primaryMuted / selection 不在 shared/host-theme 的 HostTheme 超集里
  // （胶囊与选区底色是本包专有消费），按同一「条件式写入 + CSS 兜底」口径直写
  if (theme.primaryMuted) {
    root.style.setProperty('--primary-muted', theme.primaryMuted);
  }
  if (theme.selection) {
    root.style.setProperty('--selection', theme.selection);
  }
}

export function applyDisabled(disabled: boolean): void {
  const state = editor;
  if (state == null) {
    return;
  }
  // readOnly 而非 disabled：文本仍可选中/滚动，光标与键盘链路保持现状
  state.input.readOnly = disabled;
  state.root.classList.toggle('composer-input--disabled', disabled);
}

export function applyPlaceholder(placeholder: string | null | undefined): void {
  const state = editor;
  if (state == null) {
    return;
  }
  state.input.placeholder = typeof placeholder === 'string' ? placeholder : '';
}

export function applyMode(mode: ComposerMode): void {
  const state = editor;
  if (state == null) {
    return;
  }
  state.mode = mode === 'prompt-macro' ? 'prompt-macro' : 'composer-token';
  renderHighlight(state);
}

/**
 * 外部写入（水化 / 点选 / chips / 清空 / 回填）：内容相同短路，suppressChange 包裹。
 * @param selectionStart 省略则保持内核写值后的光标位置
 */
export function applyText(
  text: string,
  selectionStart?: number,
  selectionEnd?: number,
): void {
  const state = editor;
  if (state == null) {
    return;
  }
  const next = typeof text === 'string' ? text : '';
  if (state.input.value !== next) {
    state.suppressChange = true;
    try {
      state.input.value = next;
    } finally {
      state.suppressChange = false;
    }
    state.lastText = next;
    renderHighlight(state);
    scheduleMeasure(state);
  }
  if (selectionStart != null) {
    applySelection(selectionStart, selectionEnd ?? selectionStart);
  } else {
    rememberSelection(state);
  }
}

/** 纯光标设置（value 不动；宏链挂载置顶 {0,0} 一拍）。 */
export function applySelection(start: number, end: number): void {
  const state = editor;
  if (state == null) {
    return;
  }
  const length = state.input.value.length;
  const from = clampIndex(start, length);
  const to = clampIndex(end, length);
  state.input.setSelectionRange(from, Math.max(from, to));
  rememberSelection(state);
}

export function applyInit(
  payload: Partial<InitPayload> | null | undefined,
): void {
  const state = editor;
  if (state == null) {
    return;
  }
  const init = payload ?? {};
  applyMetrics(coerceMetrics(init.metrics));
  applyTheme(init.theme);
  applyPlaceholder(init.placeholder);
  applyDisabled(init.disabled === true);
  applyMode(init.mode === 'prompt-macro' ? 'prompt-macro' : 'composer-token');
  state.initialized = true;
  // 首发高度：init 之前只有兜底口径（报出去反而多一次抖动），init 到齐后主动测一次
  scheduleMeasure(state);
}

export function blurComposerInput(): void {
  editor?.input.blur();
}

/* ---- 事件装配 ---- */

function bindEditorEvents(state: ComposerEditorState): Array<() => void> {
  const {input, highlight} = state;
  const unbind: Array<() => void> = [];

  const onInput = () => {
    const prev = state.lastText;
    const raw = input.value;
    const resolved = resolveAtomicDelete(prev, raw, state.mode);
    if (resolved != null) {
      const caret = resolveAtomicCaret(prev, raw, resolved);
      input.value = resolved;
      input.setSelectionRange(caret, caret);
    }
    const text = resolved ?? raw;
    state.lastText = text;
    renderHighlight(state);
    if (shouldReportChange(text, prev, state.suppressChange)) {
      post('change', {text});
    }
    reportSelection(state);
    scheduleMeasure(state);
  };

  const onFocus = () => {
    post('focus', {});
  };
  const onBlur = () => {
    // 失焦清去重基准：下次聚焦的同位置选区仍需上报
    state.lastSelection = null;
    post('blur', {});
  };
  const onScroll = () => {
    syncScroll(state);
  };

  unbind.push(
    listen(input, 'input', onInput),
    listen(input, 'focus', onFocus),
    listen(input, 'blur', onBlur),
    listen(input, 'scroll', onScroll),
    // select/keyup/click 与 document 级 selectionchange（IME 与点选）共同驱动上报；
    // reportSelection 内部去重，重复触发不会刷消息
    listen(input, 'select', () => reportSelection(state)),
    listen(input, 'keyup', () => reportSelection(state)),
    listen(input, 'click', () => reportSelection(state)),
    listen(document, 'selectionchange', () => {
      if (document.activeElement === input) {
        reportSelection(state);
      }
    }),
  );

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => scheduleMeasure(state));
    observer.observe(highlight);
    unbind.push(() => observer.disconnect());
  }
  return unbind;
}

/**
 * 键盘/视口变化的保守光标可见策略。
 *
 * textarea 不暴露「滚动到光标」API，插入符可见性由内核自身保证（spike 双轨已验）；
 * 这里只做一件不抢滚动的事：内核重排（键盘起落引发的高度变化）偶尔把 scrollTop
 * 归零，导致光标被滚出可视区——「焦点仍在 + 高度刚变 + 之前确在滚动位置」三条件
 * 同时成立时复原 scrollTop。其余情况完全交给内核，不主动 scrollIntoView。
 */
function bindViewportCaretGuard(state: ComposerEditorState): Array<() => void> {
  let lastScrollTop = state.input.scrollTop;
  let lastClientHeight = state.input.clientHeight;
  let pending = false;

  const apply = () => {
    if (pending) {
      return;
    }
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (editor !== state) {
        return;
      }
      const {input} = state;
      const heightChanged = input.clientHeight !== lastClientHeight;
      if (
        heightChanged &&
        document.activeElement === input &&
        input.scrollTop === 0 &&
        lastScrollTop > 0
      ) {
        input.scrollTop = lastScrollTop;
      }
      lastScrollTop = input.scrollTop;
      lastClientHeight = input.clientHeight;
      syncScroll(state);
      measureByClamp(state);
    });
  };

  const unbind = [
    listen(window, 'resize', apply),
    listen(window, 'orientationchange', apply),
  ];
  const viewport = window.visualViewport;
  if (viewport != null) {
    unbind.push(
      listen(viewport, 'resize', apply),
      listen(viewport, 'scroll', apply),
    );
  }
  return unbind;
}

/* ---- 生命周期 ---- */

/** 装配高亮层 + 透明 textarea（单实例；重复调用先拆旧实例）。 */
export function mountComposerEditor(parent: HTMLElement): void {
  destroyComposerEditor();

  const root = document.createElement('div');
  root.className = 'composer-input';

  const highlight = document.createElement('div');
  highlight.className = 'composer-input__highlight';
  highlight.setAttribute('aria-hidden', 'true');

  const input = document.createElement('textarea');
  input.className = 'composer-input__input';
  // e2e 直采选择器（变更 13：WEBVIEW context 内 textarea[data-testid="composer-input"]）
  input.setAttribute('data-testid', 'composer-input');
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocomplete', 'off');

  root.appendChild(highlight);
  root.appendChild(input);
  parent.appendChild(root);

  const state: ComposerEditorState = {
    root,
    highlight,
    input,
    mode: 'composer-token',
    suppressChange: false,
    metrics: DEFAULT_METRICS,
    lastText: '',
    lastHeight: null,
    lastSelection: null,
    measureScheduled: false,
    initialized: false,
  };
  editor = state;

  applyMetrics(DEFAULT_METRICS);
  renderHighlight(state);
  unbindStack = [...bindEditorEvents(state), ...bindViewportCaretGuard(state)];
}

export function destroyComposerEditor(): void {
  for (const off of unbindStack) {
    off();
  }
  unbindStack = [];
  if (editor != null) {
    editor.root.remove();
    editor = null;
  }
}
