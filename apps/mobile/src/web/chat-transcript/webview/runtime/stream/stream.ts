import {applyTrustedHtml} from '@web/shared/ui/TrustedHtml';
import {escapeHtml} from '../util/html-escape';
import {state} from '../state/state';
import type {ToolCallRow} from '../state/state';
import {scheduleStickIfNearBottom} from '../scroll/scroll';
import {renderRows} from '../render/row-logic';
import {scheduleStreamRichUpgrade, streamRichUpgrade} from './stream-markdown';

export type StreamKind = 'text' | 'thinking';
export type StreamTailPhase = 'active' | 'waiting-first' | 'idle-after-content';

/**
 * 块级渲染态（spec §6）：收到首个 streamBlockCommit 后进入——body 内出现
 * 独立尾块容器（.stream-active-tail），尾块的纯文本增量 append / html
 * 替换 / 350ms 轻量升级全部收敛到该容器；容器之前的已提交块 DOM 只做
 * insertAdjacentHTML append，零重渲（增量岛约束继续有效）。
 * streamReset / streamCommit 时复位（新一轮流从全量模式重新进入）。
 */
const streamBlockRender = {
  active: false,
  /** 活跃尾块源文本 parts：块提交时重置为 [tailText]，delta push 追加；350ms 升级时物化。 */
  tailTextParts: {text: [] as string[], thinking: [] as string[]},
};

/**
 * 显示态累积数组（spec §5 低优先项）：per-delta `+=` 改数组追加，物化收敛
 * 到块提交 / 回退渲染 / batch 收尾等读点（applyStreamBatch 一批物化一次）。
 */
const streamDisplayParts: {text: string[]; thinking: string[]} = {
  text: [],
  thinking: [],
};

function materializeStreamDisplay(kind: StreamKind): void {
  const parts = streamDisplayParts[kind];
  if (parts.length === 0) {
    return;
  }
  const joined = parts.join('');
  parts.length = 0;
  if (kind === 'text') {
    state.stream.text += joined;
  } else {
    state.stream.thinking += joined;
  }
}

/**
 * 复位块级渲染态与显示态 parts（streamReset / streamCommit / 测试隔离）：
 * state.stream 由调用方整体替换，未物化的 parts 一并丢弃，避免残留字符
 * 混入下一轮流。
 */
export function resetStreamBlockRenderState(): void {
  streamBlockRender.active = false;
  streamBlockRender.tailTextParts.text = [];
  streamBlockRender.tailTextParts.thinking = [];
  streamDisplayParts.text = [];
  streamDisplayParts.thinking = [];
}

/** 活跃尾块源文本：块级模式下取尾块 parts（350ms 轻量升级的输入），否则回退显示态全量。 */
export function getStreamActiveTailText(kind: StreamKind): string {
  if (!streamBlockRender.active) {
    return String(
      (kind === 'text' ? state.stream.text : state.stream.thinking) || '',
    );
  }
  return streamBlockRender.tailTextParts[kind].join('');
}

export function getStreamActiveTailEl(
  body: Element | null | undefined,
): HTMLElement | null {
  if (!body) {
    return null;
  }
  return body.querySelector('.stream-active-tail') as HTMLElement | null;
}

/**
 * 取/建尾块容器：首次进入块级模式时 body 现有内容全部属于活跃尾块（尚无
 * 已提交块），整体搬进容器——已渲染 DOM 节点原样迁移，不重建（增量岛约束）。
 */
function ensureStreamActiveTail(body: Element): HTMLElement {
  let tailEl = getStreamActiveTailEl(body);
  if (tailEl) {
    return tailEl;
  }
  tailEl = document.createElement('div');
  tailEl.className = 'stream-active-tail';
  while (body.firstChild) {
    tailEl.appendChild(body.firstChild);
  }
  body.appendChild(tailEl);
  streamBlockRender.active = true;
  return tailEl;
}

/**
 * 流式渲染目标容器：块级模式下是尾块容器（已提交块零触碰），否则维持
 * 旧全量语义（直接写 body，回滚开关关闭时的形态）。
 */
export function streamRenderTarget(body: Element): Element {
  return streamBlockRender.active ? ensureStreamActiveTail(body) : body;
}

/**
 * 流式尾部相位、增量 DOM 与 batch/delta 提交（不含 stream-markdown）。
 * P0-2 / ISD **非债**：壳/相位在 ui/stream；本文件 body 子树的 createElement /
 * insertAdjacentHTML 为刻意增量岛屿，禁止本迭代迁 Preact。
 * 块级渲染（spec §6）：完成块经 streamBlockCommit append（见
 * applyStreamBlockCommit），活跃尾块收敛到 .stream-active-tail 容器；
 * 图表懒加载与批注锚点语义不变（只在 commit/历史路径触发）。
 * tool-invoking「生成中」条：有且仅有一条 Preact 路径（StreamTail → ToolInvokingBar）；
 * 本文件只改 state.stream.toolInvoking 并 renderRows，禁止 bubble 内 createElement 插条。
 */
export function streamHasContent(): boolean {
  return (
    String(state.stream.text || '').trim().length > 0 ||
    String(state.stream.thinking || '').trim().length > 0
  );
}

/** active | waiting-first | idle-after-content */
export function getStreamTailPhase(): StreamTailPhase {
  if (!state.stream.toolInvoking) {
    return 'active';
  }
  return streamHasContent() ? 'idle-after-content' : 'waiting-first';
}

export function shouldRenderStreamTail(): boolean {
  return streamHasContent() || state.stream.toolInvoking;
}

export function streamThinkingHtml(): string | null {
  if (state.flags.richText && state.stream.thinkingHtml) {
    return state.stream.thinkingHtml;
  }
  return null;
}

export function assistantBubbleExtraClasses(
  _textHtml: string | null | undefined,
  tools: ToolCallRow[] | null | undefined,
  text: unknown,
  thinking: unknown,
): string {
  let extra = '';
  const hasText = !!(text && String(text).trim());
  const hasThinking = !!(thinking && String(thinking).trim());
  const hasTools = !!(tools && tools.length > 0);
  if (!hasText && (hasThinking || hasTools)) {
    extra += ' bubble--fill-width';
  }
  return extra;
}

/**
 * 两步查询 stream thinking body（section → .thinking-body）。
 * 缺 section 或 body 均返回 null，供缺壳判断与增量路径共用。
 */
export function getStreamThinkingBody(bubble: Element): Element | null {
  const section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
  return section ? section.querySelector('.thinking-body') : null;
}

/**
 * 转义后追加纯文本 delta，并清除 rich class（禁止明文走 TrustedHtml）。
 */
export function appendEscapedDelta(el: Element, delta: string): void {
  el.insertAdjacentHTML('beforeend', escapeHtml(delta));
  setStreamBodyRichClass(el, false);
}

/**
 * 将当前 stream 状态同步进已有 bubble 的 body 挂载点（非整泡 innerHTML）。
 * 壳结构缺失时回退 renderRows，避免与 Preact VDOM 分叉。
 * 块级模式下目标是尾块容器——已提交块区不受回退路径影响（零重渲）。
 */
function syncStreamBodiesFromState(bubble: Element): void {
  const hasThinking = !!(
    state.stream.thinking && String(state.stream.thinking).trim()
  );
  const hasText = !!(state.stream.text && String(state.stream.text).trim());

  if (hasThinking) {
    const body = getStreamThinkingBody(bubble);
    if (!body) {
      renderRows();
      return;
    }
    const target = streamRenderTarget(body);
    const th = streamThinkingHtml();
    if (state.flags.richText && th) {
      applyTrustedHtml(target, th);
      setStreamBodyRichClass(body, true);
    } else {
      target.textContent = String(getStreamActiveTailText('thinking') || '');
      setStreamBodyRichClass(body, false);
    }
    if (hasText || getStreamTailPhase() === 'idle-after-content') {
      body.classList.add('thinking-body-divided');
    }
  }

  if (hasText || hasThinking) {
    const textBody = ensureStreamTextBody(bubble);
    const target = streamRenderTarget(textBody);
    if (state.flags.richText && state.stream.textHtml) {
      applyTrustedHtml(target, state.stream.textHtml);
      setStreamBodyRichClass(textBody, true);
    } else if (hasText) {
      target.textContent = String(getStreamActiveTailText('text') || '');
      setStreamBodyRichClass(textBody, false);
    }
  }
  // tool-invoking 条由 StreamTail/ToolInvokingBar 声明式产出，此处不碰
}

/**
 * 现网回退：增量失败时按状态刷新 body（对齐原 updateStreamBubble 语义）。
 * 不再整泡拼串 innerHTML，以免毁掉 Preact 壳与 StreamBodyHost。
 */
export function updateStreamBubble(tail: Element): void {
  let bubble = tail.querySelector('.bubble');
  const bubbleClass =
    'bubble assistant' +
    assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
    );
  const hasThinking = !!(
    state.stream.thinking && String(state.stream.thinking).trim()
  );
  if (!bubble) {
    renderRows();
    return;
  }
  if (hasThinking && !getStreamThinkingBody(bubble)) {
    // 缺 thinking section/body：整表建壳（BodyHost 带稳定 key，text body 可保留）
    renderRows();
    return;
  }
  bubble.className = bubbleClass;
  syncStreamBodiesFromState(bubble);
}

export function ensureStreamTextBody(bubble: Element): HTMLElement {
  let textBody = bubble.querySelector('.bubble-body') as HTMLElement | null;
  if (textBody) {
    return textBody;
  }
  textBody = document.createElement('div');
  textBody.className = 'bubble-body';
  textBody.setAttribute('data-text-shell', '1');
  bubble.appendChild(textBody);
  const thinkingBody = getStreamThinkingBody(bubble);
  if (thinkingBody) {
    thinkingBody.classList.add('thinking-body-divided');
  }
  return textBody;
}

export function setStreamBodyRichClass(
  el: Element | null | undefined,
  rich: boolean,
): void {
  if (!el) return;
  if (rich) {
    el.classList.add('rich');
  } else {
    el.classList.remove('rich');
  }
}

export function streamRichDomReady(bubble: Element, kind: StreamKind): boolean {
  if (kind === 'thinking') {
    const body = getStreamThinkingBody(bubble);
    const target = body ? streamRenderTarget(body) : null;
    return !!(
      target &&
      (target.innerHTML.length > 0 ||
        (target.textContent && target.textContent.length > 0))
    );
  }
  const textBody = bubble.querySelector('.bubble-body');
  const target = textBody ? streamRenderTarget(textBody) : null;
  return !!(
    target &&
    (target.innerHTML.length > 0 ||
      (target.textContent && target.textContent.length > 0))
  );
}

export function appendStreamDeltaIncremental(
  tail: Element,
  kind: StreamKind,
  delta: string,
  html: string,
): boolean {
  // 主线程卡顿验证：增量 DOM 更新路径；耗时由 appendStreamDelta 外层 delta_trace 汇总
  if (!delta && !html) {
    return false;
  }
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    return false;
  }
  // 块级模式下渲染目标收敛到尾块容器：html 替换 / 纯文本 append 都不再
  // 碰已提交块区（append-only，spec §6）。
  if (state.flags.richText && !html) {
    if (!delta) {
      return false;
    }
    if (kind === 'thinking') {
      if (!streamRichDomReady(bubble, kind)) {
        return false;
      }
      if (!streamRichUpgrade.plainMode.thinking) {
        scheduleStreamRichUpgrade(kind);
        return true;
      }
      const thinkBody = getStreamThinkingBody(bubble);
      if (!thinkBody) {
        return false;
      }
      appendEscapedDelta(streamRenderTarget(thinkBody), delta);
    } else if (kind === 'text') {
      // WHY: richText=true 且 html 缺失时，text 首包必须稳定走 delta append，
      // 不能被 DOM-ready 门槛拦截，否则 appendStreamDeltaIncremental 会返回 false 且 text 分支禁止整泡重建。
      appendEscapedDelta(
        streamRenderTarget(ensureStreamTextBody(bubble)),
        delta,
      );
    } else {
      return false;
    }
    scheduleStreamRichUpgrade(kind);
    return true;
  }
  if (kind === 'thinking') {
    const body = getStreamThinkingBody(bubble);
    if (!body) {
      return false;
    }
    if (html && state.flags.richText) {
      applyTrustedHtml(streamRenderTarget(body), html);
      setStreamBodyRichClass(body, true);
      bubble.className =
        'bubble assistant' +
        assistantBubbleExtraClasses(
          state.stream.textHtml,
          [],
          state.stream.text,
          state.stream.thinking,
        );
      return true;
    }
    if (!delta) {
      return false;
    }
    appendEscapedDelta(streamRenderTarget(body), delta);
    return true;
  }
  if (kind === 'text') {
    const textBody = ensureStreamTextBody(bubble);
    if (html && state.flags.richText) {
      // WHY: 保持与 RN prepareStreamTailHtml 的 rich 复用语义一致：
      // 有 html 且 rich 打开时直接信任边界替换（块级模式下 html 只覆盖
      // 活跃尾块，替换目标即尾块容器）；否则走 delta 增量追加，避免整泡重建。
      applyTrustedHtml(streamRenderTarget(textBody), html);
      setStreamBodyRichClass(textBody, true);
      bubble.className =
        'bubble assistant' +
        assistantBubbleExtraClasses(
          state.stream.textHtml,
          [],
          state.stream.text,
          state.stream.thinking,
        );
      return true;
    }
    if (!delta) {
      return false;
    }
    // WHY: text 从 0->1 仅更新 class/展示，不触发 thinking 重建。
    appendEscapedDelta(streamRenderTarget(textBody), delta);
    bubble.className =
      'bubble assistant' +
      assistantBubbleExtraClasses(
        state.stream.textHtml,
        [],
        state.stream.text,
        state.stream.thinking,
      );
    return true;
  }
  return false;
}

/**
 * 更新 toolInvoking 并经 Preact 壳刷新「生成中」条（单路径）。
 * 不在 bubble 内 createElement；StreamBodyHost 稳定 key + shouldComponentUpdate=false
 * 保证 renderRows 不会毁掉 P0-2 body 增量岛。
 */
export function setStreamToolInvokingDom(active: boolean): void {
  state.stream.toolInvoking = !!active;
  renderRows();
  scheduleStickIfNearBottom();
}

export type StreamBlockCommitPayload = {
  kind?: string;
  html?: string;
  text?: string;
  tailHtml?: string;
  tailText?: string;
};

/**
 * 块提交（spec §6）：完成块 append 到已提交块区（尾块容器之前的
 * insertAdjacentHTML，append-only 零重渲），尾块容器重置为 RN 下发的尾块
 * 态——delta 先行携带的已完成块字符在重置中被洗掉，最终态无重复。
 * 块 html 缺失（单块超 12k 降级 / sanitize 失败）时按转义纯文本 append。
 * 不触发图表懒加载（其只在 streamCommit / 历史路径，现状保持——T-MT2 契约）。
 */
export function applyStreamBlockCommit(
  payload: StreamBlockCommitPayload,
): void {
  const kind: StreamKind = payload.kind === 'thinking' ? 'thinking' : 'text';
  const blockHtml = payload.html || '';
  const blockText = String(payload.text || '');
  const tailHtml = payload.tailHtml || '';
  const tailText = String(payload.tailText || '');
  const tail = document.getElementById('stream-tail');
  if (!tail) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    // 相位建壳缺失：整表重建（与 appendStreamDelta 回退同口径）
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const body =
    kind === 'thinking'
      ? getStreamThinkingBody(bubble)
      : ensureStreamTextBody(bubble);
  if (!body) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const tailEl = ensureStreamActiveTail(body);
  // 完成块 append：插在尾块容器之前，已提交块区只增不改
  tailEl.insertAdjacentHTML(
    'beforebegin',
    blockHtml ? blockHtml : escapeHtml(blockText),
  );
  // 尾块重置：tailHtml 有值走信任边界替换，否则按源文本降级纯文本
  if (tailHtml) {
    applyTrustedHtml(tailEl, tailHtml);
    setStreamBodyRichClass(body, true);
    if (kind === 'text') {
      state.stream.textHtml = tailHtml;
    } else {
      state.stream.thinkingHtml = tailHtml;
    }
  } else {
    tailEl.textContent = tailText;
  }
  streamBlockRender.tailTextParts[kind] = tailText ? [tailText] : [];
  materializeStreamDisplay(kind);
  bubble.className =
    'bubble assistant' +
    assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
    );
  scheduleStickIfNearBottom();
}

function appendStreamDeltaCore(
  kind: StreamKind,
  delta: string,
  html?: string,
): void {
  // 显示态：数组追加（spec §5），物化收敛到出口 / 回退渲染 / 块提交
  streamDisplayParts[kind].push(delta);
  if (kind === 'text') {
    if (html) {
      state.stream.textHtml = html;
    } else if (state.flags.richText) {
      state.stream.textHtml = '';
    }
  } else {
    if (html) {
      state.stream.thinkingHtml = html;
    } else if (state.flags.richText) {
      state.stream.thinkingHtml = '';
    }
  }
  const tail = document.getElementById('stream-tail');
  if (!tail) {
    materializeStreamDisplay(kind);
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  if (
    tail.classList.contains('stream--waiting-first') ||
    !tail.querySelector('.bubble')
  ) {
    // 相位建壳：允许一次整表 Preact；非 delta 热路径上的内容根 remount
    materializeStreamDisplay(kind);
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const incremental = appendStreamDeltaIncremental(
    tail,
    kind,
    delta,
    html || '',
  );
  if (!incremental && kind !== 'text') {
    // WHY: 正文 text 不能在增量失败时整泡重建（会触发 thinking DOM 相关副作用）。
    // 非 text：对齐现网 updateStreamBubble 回退（非一律 renderRows）。
    materializeStreamDisplay(kind);
    updateStreamBubble(tail);
    if (state.flags.richText) {
      scheduleStreamRichUpgrade(kind);
    }
  }
  // 块级模式下尾块源文本 parts 跟随 delta（350ms 升级输入）
  streamBlockRender.tailTextParts[kind].push(delta);
}

export function appendStreamDelta(
  kind: StreamKind,
  delta: string,
  html?: string,
): void {
  appendStreamDeltaCore(kind, delta, html);
  // 单 delta 出口物化：外部读点（Preact UI / streamHasContent）保持新鲜
  materializeStreamDisplay(kind);
  scheduleStickIfNearBottom();
}

export type StreamBatchPayload = {
  segments?: Array<{kind: StreamKind; delta: string}>;
  textHtml?: string;
  thinkingHtml?: string;
};

export function applyStreamBatch(payload: StreamBatchPayload): void {
  const segments = payload.segments || [];
  let lastTextIdx = -1;
  let lastThinkIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].kind === 'text') {
      lastTextIdx = i;
    } else {
      lastThinkIdx = i;
    }
  }
  for (let j = 0; j < segments.length; j++) {
    const seg = segments[j];
    let html: string | undefined;
    if (seg.kind === 'text' && j === lastTextIdx) {
      html = state.flags.richText ? payload.textHtml || '' : undefined;
    } else if (seg.kind === 'thinking' && j === lastThinkIdx) {
      html = state.flags.richText ? payload.thinkingHtml || '' : undefined;
    }
    appendStreamDeltaCore(seg.kind, seg.delta, html);
  }
  // 一批物化一次（spec §5：显示态数组追加、物化收敛到读点）
  materializeStreamDisplay('text');
  materializeStreamDisplay('thinking');
  scheduleStickIfNearBottom();
}
