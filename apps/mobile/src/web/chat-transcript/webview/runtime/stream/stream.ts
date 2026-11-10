import {applyTrustedHtml} from '@web/shared/ui/TrustedHtml';
import {escapeHtml} from '../util/html-escape';
import {state} from '../state/state';
import type {MessageRow, ToolCallRow} from '../state/state';
import {scheduleStickIfNearBottom} from '../scroll/scroll';
import {renderRows} from '../render/row-logic';
import {reconcileFinishedStreamingRows} from '../render/finished-stream-row-dom';
import {clearStreamRichUpgrade} from './stream-markdown';
import {scheduleStreamRichUpgrade} from './stream-markdown';
import {streamRichUpgrade} from './stream-markdown';
import {decideStreamDelta} from './stream-checkpoint';
import {post} from '../bridge';

export type StreamKind = 'text' | 'thinking';

/** 流式行相位：waiting-first（只有壳/生成中）| streaming-content（有内容）| finished（不再生成）。 */
type StreamingPhase = 'waiting-first' | 'streaming-content' | 'finished';

/** 同一 streamId 的 resync 请求最小间隔（snapshot 到达后仍保留 resyncSentAt 用于限流）。 */
const RESYNC_THROTTLE_MS = 100;

/**
 * 块级渲染态（spec §6）：收到首个 streamBlockCommit 后进入——body 内出现
 * 独立尾块容器（.stream-active-tail），尾块的纯文本增量 append / html
 * 替换 / 350ms 轻量升级全部收敛到该容器；容器之前的已提交块 DOM 只做
 * insertAdjacentHTML append，零重渲（增量岛约束继续有效）。
 * streamReset / 新 streamId / applySnapshot 换主时复位（新一轮流从全量模式重新进入）。
 */
const streamBlockRender = {
  active: false,
  /** 活跃尾块源文本 parts：块提交时重置为 [tailText]，delta push 追加；350ms 升级时物化。 */
  tailTextParts: {text: [] as string[], thinking: [] as string[]},
};

/** 活跃尾块容器类名（getStreamActiveTailEl 查询 / 纯文本降级目标判定同源）。 */
const STREAM_ACTIVE_TAIL_CLASS = 'stream-active-tail';

/**
 * 纯文本降级标记类（B-1）：尾块容器走「转义文本 append」路径时挂上，
 * CSS 单源（rich-content-styles）据此补 white-space: pre-wrap。
 * WHY 不摘 .rich：`.rich` 实际挂在 .bubble-body / .thinking-body 上，
 * 对尾块容器摘 `.rich` 是无效对象，body 的 white-space: normal 会继承
 * 下来把尾块换行/缩进全部折叠；改摘 body 的 `.rich` 又会把已提交块一并降级。
 */
const STREAM_TAIL_PLAIN_CLASS = 'stream-tail-plain';

/** 当前流式行：state.rows 最后一条且 status === 'streaming'（I1/I2 唯一真源）。 */
export function currentStreamingRow(): MessageRow | null {
  const rows = state.rows;
  if (rows.length === 0) {
    return null;
  }
  const last = rows[rows.length - 1];
  return last.kind === 'message' && last.status === 'streaming' ? last : null;
}

/** 按行 id 查 state.rows（流式行 id = streamId；DB 接管只补 messageId 不换 id）。 */
export function findRowById(id: string): MessageRow | null {
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    if (row.kind === 'message' && row.id === id) {
      return row;
    }
  }
  return null;
}

/**
 * 请求普通快照（上行 streamResync）：gap / 未知 streamId / 行不存在时调用。
 * 100ms 限流 + 同一 streamId 等待中不重复请求（snapshot 到达后清 resyncPending，
 * 但保留 resyncSentAt 继续限流——否则 snapshot 清空后 100ms 内的第二次 gap 会重复发）。
 */
export function requestResync(streamId: string, expectedSeq: number): void {
  if (state.resyncPending === streamId) {
    return;
  }
  const now = performance.now();
  if (
    state.resyncSentAt != null &&
    now - state.resyncSentAt < RESYNC_THROTTLE_MS
  ) {
    return;
  }
  post('streamResync', {streamId, expectedSeq});
  state.resyncPending = streamId;
  state.resyncSentAt = now;
}

/**
 * 复位块级渲染态（streamReset / 新 streamId / applySnapshot 换主 / 全量重写前）：
 * 块模式退出、尾块 parts 清空。finished 时不调用（避免清掉已提交块 DOM）。
 */
export function resetStreamBlockRenderState(): void {
  streamBlockRender.active = false;
  streamBlockRender.tailTextParts.text = [];
  streamBlockRender.tailTextParts.thinking = [];
}

/** 活跃尾块源文本：块级模式下取尾块 parts（350ms 轻量升级的输入），否则取当前流式行全量。 */
export function getStreamActiveTailText(kind: StreamKind): string {
  if (streamBlockRender.active) {
    return streamBlockRender.tailTextParts[kind].join('');
  }
  const row = currentStreamingRow();
  return String((kind === 'text' ? row?.text : row?.thinking) || '');
}

/** 可空 DOM 元素（查询/建壳/类名写入路径的公共输入形态）。 */
type NullableEl = Element | null | undefined;

export function getStreamActiveTailEl(body: NullableEl): HTMLElement | null {
  if (!body) {
    return null;
  }
  const selector = '.' + STREAM_ACTIVE_TAIL_CLASS;
  return body.querySelector(selector) as HTMLElement | null;
}

/**
 * 纯文本降级标记：plain=true 挂标记类（CSS 单源补 pre-wrap），false 移除
 * （HTML 替换成功后调用）。
 */
export function setStreamTailPlainClass(el: NullableEl, plain: boolean): void {
  if (!el) return;
  if (plain) {
    el.classList.add(STREAM_TAIL_PLAIN_CLASS);
  } else {
    el.classList.remove(STREAM_TAIL_PLAIN_CLASS);
  }
}

/**
 * 纯文本渲染目标落标记（B-1）：目标是尾块容器时只挂标记类、不动 body 的
 * `.rich`（摘了会把已提交块一并降级为纯文本样式）；非块级模式目标是
 * body 自身，维持旧语义（摘自身 `.rich`，回到基础样式的 pre-wrap）。
 */
function markStreamPlainTarget(el: Element): void {
  if (!el.classList.contains(STREAM_ACTIVE_TAIL_CLASS)) {
    setStreamBodyRichClass(el, false);
  }
  setStreamTailPlainClass(el, true);
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
  tailEl.className = STREAM_ACTIVE_TAIL_CLASS;
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
 * 流式行派生增量 / status / 块提交（不含 stream-markdown）。
 * P0-2 / ISD **非债**：壳/相位在 ui；本文件 body 子树的 createElement /
 * insertAdjacentHTML 为刻意增量岛屿，禁止本迭代迁 Preact。
 * 块级渲染（spec §6）：完成块经 streamBlockCommit append（见
 * applyStreamBlockCommit），活跃尾块收敛到 .stream-active-tail 容器；
 * 图表懒加载与批注锚点语义不变（只在 commit/历史路径触发）。
 * tool-invoking「生成中」条：有且仅有一条 Preact 路径（StreamingMessageRow →
 * ToolInvokingBar），本文件不碰该条——状态由行 status 驱动。
 */
/** 相位判定：必须在 row.text/tools 变异之前求值（首包建壳规则依赖它）。 */
export function getStreamingPhase(row: MessageRow): StreamingPhase {
  if (row.status !== 'streaming') {
    return 'finished';
  }
  // 有内容判定（原 streamHasContent 内联）：boot-script 源断言依赖这条连续
  // `String(...).trim().length > 0 || ...` 的 minify 形态。
  return String(row.text || '').trim().length > 0 ||
    String(row.thinking || '').trim().length > 0 ||
    !!(row.tools && row.tools.length > 0)
    ? 'streaming-content'
    : 'waiting-first';
}

type BubbleClassRow = {
  textHtml?: string | null;
  tools?: readonly ToolCallRow[] | null;
  text?: unknown;
  thinking?: unknown;
};

export function assistantBubbleExtraClasses(row: BubbleClassRow): string {
  const {text, thinking, tools} = row;
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
 * 转义后追加纯文本 delta（禁止明文走 TrustedHtml）。
 * 纯文本降级走标记类补 pre-wrap（B-1）：尾块容器不摘 `.rich`，非块级模式
 * （目标是 body）摘自身 `.rich` 维持旧行为。
 */
export function appendEscapedDelta(el: Element, delta: string): void {
  el.insertAdjacentHTML('beforeend', escapeHtml(delta));
  markStreamPlainTarget(el);
}

/**
 * 将当前流式行同步进已有 bubble 的 body 挂载点（非整泡 innerHTML）。
 * 壳结构缺失时回退 renderRows，避免与 Preact VDOM 分叉。
 * 调用方保证块级态已复位：全量 html 只能写 body 自身，禁止落进尾容器。
 *
 * nm-style: keep-local — 块级渲染不变量（增量岛）的唯一收口：thinking/text
 * 两条同步链都必须经 streamRenderTarget 决定落点，禁止直写 body 全量 html。
 * chat-transcript-stream-block.test.ts 按 `function syncStreamBodiesFromState`
 * 源码切片钉住这两个 target 路由（测试在本组之外，内联会让契约失去锚点）。
 */
function syncStreamBodiesFromState(bubble: Element): void {
  const row = currentStreamingRow();
  if (row == null) {
    return;
  }
  const hasThinking = !!(row.thinking && String(row.thinking).trim());
  const hasText = !!(row.text && String(row.text).trim());

  if (hasThinking) {
    const body = getStreamThinkingBody(bubble);
    if (!body) {
      renderRows();
      return;
    }
    if (state.flags.richText && row.thinkingHtml) {
      applyTrustedHtml(body, row.thinkingHtml);
      setStreamTailPlainClass(body, false);
      setStreamBodyRichClass(body, true);
    } else {
      body.textContent = String(getStreamActiveTailText('thinking') || '');
      // B-1：目标即尾块容器时不动 body 的 .rich（已提交块保持 rich）。
      markStreamPlainTarget(body);
    }
    if (hasText || (row.tools && row.tools.length > 0)) {
      body.classList.add('thinking-body-divided');
    }
  }

  if (hasText || hasThinking) {
    const textBody = ensureStreamTextBody(bubble);
    if (state.flags.richText && row.textHtml) {
      applyTrustedHtml(textBody, row.textHtml);
      setStreamTailPlainClass(textBody, false);
      setStreamBodyRichClass(textBody, true);
    } else if (hasText) {
      textBody.textContent = String(getStreamActiveTailText('text') || '');
      // B-1：同上，尾块容器只落纯文本标记，不摘 body 的 .rich。
      markStreamPlainTarget(textBody);
    }
  }
}

/**
 * 增量失败回退（沿用 baseline `appendStreamDeltaCore` 的 `!incremental` 分支）：
 * 按当前流式行刷新 body；rich 下补一次 350ms 升级。仅非 text 走这里——text
 * 增量失败时整泡重建会连带 thinking DOM 副作用（baseline 同口径）。
 */
function fallbackStreamBubble(tail: Element, kind: StreamKind): void {
  updateStreamBubble(tail);
  scheduleStreamRichUpgrade(kind);
}

/**
 * 现网回退：增量失败时按当前流式行刷新 body。
 * 块级态先复位——否则全量 html 会被写进尾容器，复制已提交块（P1-4）。
 */
export function updateStreamBubble(tail: Element): void {
  const row = currentStreamingRow();
  if (row == null) {
    return;
  }
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    renderRows();
    return;
  }
  if (
    row.thinking &&
    String(row.thinking).trim() &&
    !getStreamThinkingBody(bubble)
  ) {
    // 缺 thinking section/body：整表建壳（BodyHost 带稳定 key，text body 可保留）
    renderRows();
    return;
  }
  if (streamBlockRender.active) {
    resetStreamBlockRenderState();
  }
  bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(row);
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

/** 取 kind 对应的 body 挂载点：thinking section 的 .thinking-body 或 text 壳。 */
function streamBodyFor(bubble: Element, kind: StreamKind): Element | null {
  if (kind === 'thinking') return getStreamThinkingBody(bubble);
  return ensureStreamTextBody(bubble);
}

export function setStreamBodyRichClass(el: NullableEl, rich: boolean): void {
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

/**
 * 块级增量写尾容器（tailHtml 专用）：已提交块零触碰。
 * html 缺失时按转义纯文本 append；禁止回落全量 html（会复制已提交块）。
 */
// nm style 要求签名单行；四参签名超过 prettier 默认宽度，用忽略标记保留单行。
// prettier-ignore
export function appendStreamDeltaIncremental(tail: Element, kind: StreamKind, delta: string, html: string): boolean {
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
      const target = streamRenderTarget(ensureStreamTextBody(bubble));
      appendEscapedDelta(target, delta);
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
      const target = streamRenderTarget(body);
      applyTrustedHtml(target, html);
      // HTML 替换成功：清纯文本降级标记（B-1），避免富文本被 pre-wrap 影响。
      setStreamTailPlainClass(target, false);
      setStreamBodyRichClass(body, true);
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
      const target = streamRenderTarget(textBody);
      applyTrustedHtml(target, html);
      setStreamTailPlainClass(target, false);
      setStreamBodyRichClass(textBody, true);
      return true;
    }
    if (!delta) {
      return false;
    }
    // WHY: text 从 0->1 仅更新 class/展示，不触发 thinking 重建。
    appendEscapedDelta(streamRenderTarget(textBody), delta);
    return true;
  }
  return false;
}

export type BlockCommitPayload = {
  streamId?: string;
  /** 本块提交对应的 delta seq（只做对账，不推进 checkpoint）。 */
  seq?: number;
  /** 块身份：`<streamId>:<kind>:<commitOrdinal>`；Web 用已应用集合去重。 */
  blockKey?: string;
  kind?: string;
  html?: string;
  text?: string;
  tailHtml?: string;
  tailText?: string;
};

/**
 * 块提交（spec §6）：完成块 append 到已提交块区（尾块容器之前的
 * insertAdjacentHTML，append-only 零重渲），尾块容器重置为 RN 下发的尾块
 * 态。**不把 tailHtml 写回行**：delta 已携带全量 html，行上的 textHtml
 * 永远是全量（写回尾块会把 full 截成 tail）。
 * 检查顺序固定：streamId 匹配 → streaming → seq 对账 → blockKey 去重 →
 * fullReplaceOnly；任一不满足直接 return（finished 后的迟到 commit 不得
 * 触发 renderRows 回退）。
 * 不触发图表懒加载（其只在历史/快照路径，T-MT2 契约）。
 */
export function applyStreamBlockCommit(payload: BlockCommitPayload): void {
  const cp = state.streamCheckpoint;
  if (payload.streamId == null || cp == null || cp.id !== payload.streamId) {
    return;
  }
  if (cp.status !== 'streaming') {
    return;
  }
  if (typeof payload.seq !== 'number' || payload.seq > cp.seq) {
    return;
  }
  if (
    payload.blockKey != null &&
    state.appliedBlockKeys.has(payload.blockKey)
  ) {
    return;
  }
  if (state.fullReplaceOnly === payload.streamId) {
    return;
  }
  const kind: StreamKind = payload.kind === 'thinking' ? 'thinking' : 'text';
  const blockHtml = payload.html || '';
  const blockText = String(payload.text || '');
  const tailHtml = payload.tailHtml || '';
  const tailText = String(payload.tailText || '');
  const hasTailPayload = payload.tailHtml != null || payload.tailText != null;
  const tail = document.getElementById('stream-tail');
  if (!tail) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    // 相位建壳缺失：整表重建（与增量路径回退同口径）
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const body = streamBodyFor(bubble, kind);
  if (!body) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const tailEl = ensureStreamActiveTail(body);
  // 完成块 append：插在尾块容器之前，已提交块区只增不改
  const blockContent = blockHtml ? blockHtml : escapeHtml(blockText);
  tailEl.insertAdjacentHTML('beforebegin', blockContent);
  // 尾块重置：tailHtml 有值走信任边界替换，否则按源文本降级纯文本
  if (hasTailPayload) {
    if (tailHtml) {
      applyTrustedHtml(tailEl, tailHtml);
      // HTML 分支成功：清纯文本降级标记（B-1）
      setStreamTailPlainClass(tailEl, false);
      setStreamBodyRichClass(body, true);
    } else {
      tailEl.textContent = tailText;
      // 无 tailHtml 分支（B-1）：与增量纯文本路径同口径落标记类补 pre-wrap
      markStreamPlainTarget(tailEl);
    }
    streamBlockRender.tailTextParts[kind] = tailText ? [tailText] : [];
  }
  if (payload.blockKey != null) {
    state.appliedBlockKeys.add(payload.blockKey);
  }
  const row = currentStreamingRow();
  if (row != null) {
    bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(row);
  }
  scheduleStickIfNearBottom();
}

type BodyWrite = {
  kind: StreamKind;
  html?: string;
  delta: string;
};

/** 全量 html 写 body 自身（禁止经 streamRenderTarget：块模式会落进尾容器）。 */
function writeStreamBodyFull(tail: Element, write: BodyWrite): boolean {
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    return false;
  }
  const body = streamBodyFor(bubble, write.kind);
  if (!body) {
    return false;
  }
  if (write.html) {
    applyTrustedHtml(body, write.html);
    setStreamTailPlainClass(body, false);
    setStreamBodyRichClass(body, true);
    return true;
  }
  if (write.delta) {
    appendEscapedDelta(body, write.delta);
    return true;
  }
  return false;
}

type BodyDelta = {
  kind: StreamKind;
  delta: string;
  html?: string;
  tailHtml?: string;
};

/**
 * 四态表写 DOM（P0-3）：
 * - plain：始终 appendEscapedDelta 增量（忽略 html/tailHtml）；
 * - rich + fullReplaceOnly：全量 html 替换 body；html 缺失回落增量；
 * - rich + 块模式激活：tailHtml 走尾容器增量；tail 缺失回落增量（禁止全量）；
 * - rich + 块模式未激活：全量 html 替换 body；html 缺失回落增量。
 */
function applyStreamBodyDelta(tail: Element, d: BodyDelta): void {
  const {kind, delta, html} = d;
  const tailHtml = d.tailHtml || '';
  if (!state.flags.richText) {
    if (!delta) {
      return;
    }
    const bubble = tail.querySelector('.bubble');
    if (!bubble) {
      return;
    }
    const body = streamBodyFor(bubble, kind);
    if (body) {
      appendEscapedDelta(streamRenderTarget(body), delta);
    } else if (kind !== 'text') {
      // thinking 在已有 text 壳之后首次到达（无 .thinking-body）：增量无从
      // 落笔，回退建壳，否则该拍思考内容整拍丢失。
      fallbackStreamBubble(tail, kind);
    }
    return;
  }
  const streamId = state.streamCheckpoint?.id;
  // 空拍（tools-only 等）：无 delta/html 可写，不进入任何写路径——否则
  // 「无输入」会被误判成增量失败而触发整 body 回退。
  if (!delta && !html && !tailHtml) {
    return;
  }
  if (streamId != null && state.fullReplaceOnly === streamId) {
    writeStreamBodyFull(tail, {kind, delta, html});
    return;
  }
  if (streamBlockRender.active) {
    // chat-transcript-stream-block.test.ts 源断言钉住第 4 实参显式是 tailHtml
    // （不是全量 textHtml）；prettier-ignore 保住该单行形态与尾逗号。
    // prettier-ignore
    const incremental = appendStreamDeltaIncremental(tail, kind, delta, tailHtml || '',);
    if (!incremental && kind !== 'text') {
      fallbackStreamBubble(tail, kind);
    }
    return;
  }
  const written = writeStreamBodyFull(tail, {kind, delta, html});
  if (!written && kind !== 'text') {
    fallbackStreamBubble(tail, kind);
  }
}

export type StreamDeltaPayload = {
  streamId: string;
  /** 1 起连续；本条应用后 Web 的 appliedSeq 应等于 seq。 */
  seq: number;
  segments?: ReadonlyArray<{kind: StreamKind; delta: string}>;
  /** 全量正文 HTML（richText 时；committed 块 + 活跃尾块）。 */
  textHtml?: string;
  thinkingHtml?: string;
  /** 活跃尾块 HTML（块级增量 DOM 专用；非块级/未激活时忽略）。 */
  tailHtml?: string;
  thinkingTailHtml?: string;
  /** 完整 tool 数组快照（仅 tool 状态变化时携带）。 */
  tools?: readonly ToolCallRow[];
};

/**
 * streamDelta 唯一入口（spec §3.5）：seq 判定 → 行派生 → 检查点推进 → 四态 DOM。
 * 行对象原地更新不触发 renderRows；只有建壳 / 工具卡变化才整表刷新
 * （StreamBodyHost.shouldComponentUpdate=false 保证正文不重建）。
 *
 * nm-style: keep-public — bridge.ts 的 wire 分发入口（每条消息 1 个生产
 * 调用点），协议对账面必须保持命名与单测入口。
 */
export function applyStreamDelta(payload: StreamDeltaPayload): void {
  const streamId = String(payload.streamId || '');
  const seq = typeof payload.seq === 'number' ? payload.seq : -1;
  const decision = decideStreamDelta(state.streamCheckpoint, streamId, seq);
  if (decision === 'ignore') {
    return;
  }
  if (decision === 'resync') {
    requestResync(streamId, state.streamCheckpoint?.seq ?? 0);
    return;
  }
  const row = findRowById(streamId);
  if (row == null || row.status !== 'streaming') {
    // 行不存在/已收尾：不推进 checkpoint，请求普通快照对账。
    requestResync(streamId, state.streamCheckpoint?.seq ?? 0);
    return;
  }
  // 相位必须在 row.text/tools 变异之前求值（首包建壳规则）。
  const phase = getStreamingPhase(row);
  const segments = payload.segments || [];
  let textDelta = '';
  let thinkingDelta = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === 'text') {
      textDelta += seg.delta || '';
    } else {
      thinkingDelta += seg.delta || '';
    }
  }
  row.text = String(row.text || '') + textDelta;
  row.thinking = String(row.thinking || '') + thinkingDelta;
  // 全量 html 只在携带时覆盖；plain 下清空（rich 缺失时也清，防 reconcile 按旧 html 渲染）。
  if (payload.textHtml != null) {
    row.textHtml = payload.textHtml;
  } else if (!state.flags.richText) {
    row.textHtml = '';
  }
  if (payload.thinkingHtml != null) {
    row.thinkingHtml = payload.thinkingHtml;
  } else if (!state.flags.richText) {
    row.thinkingHtml = '';
  }
  const toolsChanged = payload.tools != null && payload.tools !== row.tools;
  if (payload.tools != null) {
    row.tools = payload.tools as ToolCallRow[];
  }
  // 检查点先推进：任何早退（建壳）都不能让下一条 delta 被判 gap。
  state.streamCheckpoint = {id: streamId, seq, status: 'streaming'};
  const tail = document.getElementById('stream-tail');
  if (!tail || phase === 'waiting-first' || !tail.querySelector('.bubble')) {
    // 建壳一次：显示态已由 row.text 更新，不进入四态表。
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const thinkingArg: BodyDelta = {
    kind: 'thinking',
    delta: thinkingDelta,
    html: payload.thinkingHtml,
    tailHtml: payload.thinkingTailHtml,
  };
  applyStreamBodyDelta(tail, thinkingArg);
  const textArg: BodyDelta = {
    kind: 'text',
    delta: textDelta,
    html: payload.textHtml,
    tailHtml: payload.tailHtml,
  };
  applyStreamBodyDelta(tail, textArg);
  // 350ms 轻量升级的源文本（spec §3.5）：块级模式下 delta 必须同步进尾块 parts，
  // 否则升级读到的是上次块提交的旧 tailText，会用旧文本覆盖刚 append 的增量。
  if (streamBlockRender.active) {
    if (textDelta) {
      streamBlockRender.tailTextParts.text.push(textDelta);
    }
    if (thinkingDelta) {
      streamBlockRender.tailTextParts.thinking.push(thinkingDelta);
    }
  }
  const bubble = tail.querySelector('.bubble');
  if (bubble) {
    bubble.className = 'bubble assistant' + assistantBubbleExtraClasses(row);
  }
  if (toolsChanged) {
    // 工具卡在 body 岛外：整表刷新刷卡片；正文由 StreamBodyHost 保持。
    renderRows();
  }
  scheduleStickIfNearBottom();
}

export type StreamStatusPayload = {
  streamId: string;
  status?: string;
  messageId?: string;
  /** DB 接管/收尾时的完整终态行（id 必须等于 streamId，status=finished）。 */
  row?: MessageRow;
};

/**
 * 收尾只改 status（I6）：文本只增不减，textHtml/thinkingHtml 与 text/thinking
 * 成对采用（incoming 更短时本地 text+html 成对保留，防 reconcile 按短 html 洗短 body）。
 *
 * nm-style: keep-public — bridge.ts 的 wire 分发入口（每条消息 1 个生产
 * 调用点），协议对账面必须保持命名与单测入口。
 */
export function applyStreamStatus(payload: StreamStatusPayload): void {
  const cp = state.streamCheckpoint;
  const row = findRowById(payload.streamId);
  if (row == null) {
    // 当前流式行丢失 → 请求普通快照；旧 step 的迟到 status（行已被快照收走）直接忽略。
    if (cp == null || cp.id === payload.streamId) {
      requestResync(payload.streamId, cp?.seq ?? 0);
    }
    return;
  }
  const incoming = payload.row;
  if (
    incoming != null &&
    incoming.kind === 'message' &&
    incoming.id === payload.streamId &&
    incoming.role === 'assistant' &&
    incoming.status === 'finished'
  ) {
    const prevText = typeof row.text === 'string' ? row.text : '';
    const prevThinking = typeof row.thinking === 'string' ? row.thinking : '';
    const inText = typeof incoming.text === 'string' ? incoming.text : '';
    const rawThinking = incoming.thinking;
    const inThinking = typeof rawThinking === 'string' ? rawThinking : '';
    const useIncomingText = inText.length >= prevText.length;
    const useIncomingThinking = inThinking.length >= prevThinking.length;
    const text = useIncomingText ? inText : prevText;
    const thinking = useIncomingThinking ? inThinking : prevThinking;
    const textHtml = useIncomingText ? incoming.textHtml : row.textHtml;
    const prevHtml = row.thinkingHtml;
    const thinkingHtml = useIncomingThinking ? incoming.thinkingHtml : prevHtml;
    Object.assign(row, {
      ...incoming,
      id: payload.streamId,
      text,
      thinking,
      textHtml,
      thinkingHtml,
      messageId: incoming.messageId ?? row.messageId,
    });
  }
  row.status = 'finished';
  if (payload.messageId != null) {
    row.messageId = payload.messageId;
  }
  // 空行收尾（首字前失败/空 step，且尚未被 DB 接管）：直接移除，避免空 assistant 气泡。
  if (
    payload.messageId == null &&
    !row.text &&
    !row.thinking &&
    !(row.tools && row.tools.length > 0)
  ) {
    state.rows = state.rows.filter(r => r.id !== payload.streamId);
    if (cp?.id === payload.streamId) {
      state.streamCheckpoint = null;
    }
    renderRows();
    return;
  }
  // 只收掉「当前 checkpoint 就是这条」的情况；旧 step 的 status 不动机器，
  // 也不清当前流的升级 timer。
  if (cp?.id === payload.streamId) {
    state.streamCheckpoint = {
      id: payload.streamId,
      seq: cp.seq,
      status: 'finished',
    };
    clearStreamRichUpgrade();
  }
  renderRows(); // 壳重渲：bar 消失/菜单行出现；body host 不更新
  reconcileFinishedStreamingRows();
  scheduleStickIfNearBottom();
}

type StreamResetPayload = {
  streamIds?: readonly string[];
  generation?: number;
};

/**
 * 消息操作（rollback/fork）清流：`streamIds` 给出要删的行 id（streaming/finished
 * 均可），空数组 = 什么都不删；仅缺省时回落删除最后一条 streaming 行。
 * 分片代次作废由 bridge 在本函数之前调用 snapshot.invalidateSnapshotPipeline
 * （本文件不 import snapshot.ts，避免循环依赖）。
 *
 * nm-style: keep-public — bridge.ts 的 wire 分发入口（每条消息 1 个生产
 * 调用点），协议对账面必须保持命名与单测入口。
 */
export function applyStreamReset(payload: StreamResetPayload): void {
  const ids = payload.streamIds;
  if (ids == null) {
    for (let i = state.rows.length - 1; i >= 0; i--) {
      if (state.rows[i].status === 'streaming') {
        state.rows = state.rows.filter((_, j) => j !== i);
        break;
      }
    }
  } else {
    const drop = new Set(ids);
    if (drop.size > 0) {
      state.rows = state.rows.filter(row => !drop.has(row.id));
    }
  }
  const cp = state.streamCheckpoint;
  if (cp != null && !state.rows.some(row => row.id === cp.id)) {
    state.streamCheckpoint = null;
  }
  state.fullReplaceOnly = null;
  state.appliedBlockKeys = new Set();
  state.resyncPending = null;
  resetStreamBlockRenderState();
  clearStreamRichUpgrade();
  renderRows();
}
