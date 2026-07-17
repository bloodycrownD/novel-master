import { applyTrustedHtml } from '../../../../shared/ui/TrustedHtml';
import { escapeHtml } from '../util/html-escape';
import { state } from '../state/state';
import type { ToolCallRow } from '../state/state';
import { scheduleStickIfNearBottom } from '../scroll/scroll';
import { renderRows } from '../render/row-logic';
import { renderToolInvokingBar } from '../render/tool-logic';
import { scheduleStreamRichUpgrade, streamRichUpgrade } from './stream-markdown';

export type StreamKind = 'text' | 'thinking';
export type StreamTailPhase = 'active' | 'waiting-first' | 'idle-after-content';

/**
 * 流式尾部相位、增量 DOM 与 batch/delta 提交（不含 stream-markdown）。
 * P0-2：壳/相位在 ui/stream；本文件只写 body 子树与相位 DOM 辅助。
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
 * 将当前 stream 状态同步进已有 bubble 的 body 挂载点（非整泡 innerHTML）。
 * 壳结构缺失时回退 renderRows，避免与 Preact VDOM 分叉。
 */
function syncStreamBodiesFromState(bubble: Element): void {
  const hasThinking = !!(
    state.stream.thinking && String(state.stream.thinking).trim()
  );
  const hasText = !!(state.stream.text && String(state.stream.text).trim());

  if (hasThinking) {
    const section = bubble.querySelector(
      '[data-thinking-key="stream:thinking"]',
    );
    const body = section ? section.querySelector('.thinking-body') : null;
    if (!body) {
      renderRows();
      return;
    }
    const th = streamThinkingHtml();
    if (state.flags.richText && th) {
      applyTrustedHtml(body, th);
      setStreamBodyRichClass(body, true);
    } else {
      body.textContent = String(state.stream.thinking || '');
      setStreamBodyRichClass(body, false);
    }
    if (hasText || getStreamTailPhase() === 'idle-after-content') {
      body.classList.add('thinking-body-divided');
    }
  }

  if (hasText || hasThinking) {
    const textBody = ensureStreamTextBody(bubble);
    if (state.flags.richText && state.stream.textHtml) {
      applyTrustedHtml(textBody, state.stream.textHtml);
      setStreamBodyRichClass(textBody, true);
    } else if (hasText) {
      textBody.textContent = String(state.stream.text || '');
      setStreamBodyRichClass(textBody, false);
    }
  }

  const showIdleBar = getStreamTailPhase() === 'idle-after-content';
  const existing = bubble.querySelector('.tool-invoking-bar');
  if (showIdleBar && !existing) {
    const holder = document.createElement('div');
    holder.innerHTML = renderToolInvokingBar();
    const bar = holder.firstElementChild;
    if (bar) {
      const textBody = bubble.querySelector('.bubble-body');
      if (textBody) {
        textBody.insertAdjacentElement('afterend', bar);
      } else {
        bubble.appendChild(bar);
      }
    }
  } else if (!showIdleBar && existing) {
    existing.remove();
  }
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
  if (
    hasThinking &&
    !bubble.querySelector('[data-thinking-key="stream:thinking"]')
  ) {
    // 缺 thinking 壳：整表建壳（BodyHost 带稳定 key，text body 可保留）
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
  const thinkingBody = bubble.querySelector(
    '[data-thinking-key="stream:thinking"] .thinking-body',
  );
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
    const section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
    const body = section ? section.querySelector('.thinking-body') : null;
    return !!(
      body &&
      (body.innerHTML.length > 0 ||
        (body.textContent && body.textContent.length > 0))
    );
  }
  const textBody = bubble.querySelector('.bubble-body');
  return !!(
    textBody &&
    (textBody.innerHTML.length > 0 ||
      (textBody.textContent && textBody.textContent.length > 0))
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
  // richText + 无 html：走 UAUA plain-mode 增量路径；有 html 时交由后续分支做 DOM 替换。
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
      const thinkSection = bubble.querySelector(
        '[data-thinking-key="stream:thinking"]',
      );
      const thinkBody = thinkSection
        ? thinkSection.querySelector('.thinking-body')
        : null;
      if (!thinkBody) {
        return false;
      }
      thinkBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
      setStreamBodyRichClass(thinkBody, false);
    } else if (kind === 'text') {
      // WHY: richText=true 且 html 缺失时，text 首包必须稳定走 delta append，
      // 不能被 DOM-ready 门槛拦截，否则 appendStreamDeltaIncremental 会返回 false 且 text 分支禁止整泡重建。
      const streamTextBody = ensureStreamTextBody(bubble);
      streamTextBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
      setStreamBodyRichClass(streamTextBody, false);
    } else {
      return false;
    }
    scheduleStreamRichUpgrade(kind);
    return true;
  }
  if (kind === 'thinking') {
    const section = bubble.querySelector('[data-thinking-key="stream:thinking"]');
    const body = section ? section.querySelector('.thinking-body') : null;
    if (!body) {
      return false;
    }
    if (html && state.flags.richText) {
      applyTrustedHtml(body, html);
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
    body.insertAdjacentHTML('beforeend', escapeHtml(delta));
    setStreamBodyRichClass(body, false);
    return true;
  }
  if (kind === 'text') {
    const textBody = ensureStreamTextBody(bubble);
    if (html && state.flags.richText) {
      // WHY: 保持与 RN prepareStreamTailHtml 的 rich 复用语义一致：
      // 有 html 且 rich 打开时直接信任边界替换；否则走 delta 增量追加，避免整泡重建。
      applyTrustedHtml(textBody, html);
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
    textBody.insertAdjacentHTML('beforeend', escapeHtml(delta));
    setStreamBodyRichClass(textBody, false);
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

export function setStreamToolInvokingDom(active: boolean): void {
  state.stream.toolInvoking = !!active;
  const tail = document.getElementById('stream-tail');
  if (!tail) {
    if (shouldRenderStreamTail()) {
      renderRows();
      scheduleStickIfNearBottom();
    }
    return;
  }
  const isWaitingShell = tail.classList.contains('stream--waiting-first');
  const phase = getStreamTailPhase();
  if (isWaitingShell && phase !== 'waiting-first') {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  if (!isWaitingShell && phase === 'waiting-first') {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  if (phase === 'waiting-first') {
    if (!active && !streamHasContent()) {
      renderRows();
      scheduleStickIfNearBottom();
    }
    return;
  }
  const bubble = tail.querySelector('.bubble');
  if (!bubble) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const existing = bubble.querySelector('.tool-invoking-bar');
  if (active) {
    if (!existing) {
      const holder = document.createElement('div');
      holder.innerHTML = renderToolInvokingBar();
      const bar = holder.firstElementChild;
      if (bar) {
        const textBody = bubble.querySelector('.bubble-body');
        if (textBody) {
          textBody.insertAdjacentElement('afterend', bar);
        } else {
          bubble.appendChild(bar);
        }
      }
    }
  } else if (existing) {
    existing.remove();
  }
  if (!shouldRenderStreamTail()) {
    renderRows();
    scheduleStickIfNearBottom();
  }
}

export function appendStreamDelta(
  kind: StreamKind,
  delta: string,
  html?: string,
): void {
  if (kind === 'text') {
    state.stream.text += delta;
    if (html) {
      state.stream.textHtml = html;
    } else if (state.flags.richText) {
      state.stream.textHtml = '';
    }
  } else {
    state.stream.thinking += delta;
    if (html) {
      state.stream.thinkingHtml = html;
    } else if (state.flags.richText) {
      state.stream.thinkingHtml = '';
    }
  }
  const tail = document.getElementById('stream-tail');
  if (!tail) {
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  if (
    tail.classList.contains('stream--waiting-first') ||
    !tail.querySelector('.bubble')
  ) {
    // 相位建壳：允许一次整表 Preact；非 delta 热路径上的内容根 remount
    renderRows();
    scheduleStickIfNearBottom();
    return;
  }
  const incremental = appendStreamDeltaIncremental(tail, kind, delta, html || '');
  if (!incremental && kind !== 'text') {
    // WHY: 正文 text 不能在增量失败时整泡重建（会触发 thinking DOM 相关副作用）。
    // 非 text：对齐现网 updateStreamBubble 回退（非一律 renderRows）。
    updateStreamBubble(tail);
    if (state.flags.richText) {
      scheduleStreamRichUpgrade(kind);
    }
  }
  scheduleStickIfNearBottom();
}

export type StreamBatchPayload = {
  segments?: Array<{ kind: StreamKind; delta: string }>;
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
    appendStreamDelta(seg.kind, seg.delta, html);
  }
  scheduleStickIfNearBottom();
}
