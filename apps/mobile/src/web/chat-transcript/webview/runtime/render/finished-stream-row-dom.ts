/**
 * finished 流式行的正文校正与快照 seed DOM 写入口。
 *
 * 从 snapshot.ts 拆出：stream.ts 收尾（applyStreamStatus）要 reconcile，而
 * snapshot.ts 又需要 stream.ts 的 requestResync；两边互相 import 会成环
 * （spec §3.6）。本模块只依赖 state 与 TrustedHtml，两个方向都向下。
 */
import {applyTrustedHtml} from '@web/shared/ui/TrustedHtml';
import {state} from '../state/state';
import type {MessageRow} from '../state/state';

/** 按行 id 找窗口内的行元素（窗口外未渲染 → null）。 */
function findRowElement(id: string): Element | null {
  if (typeof document.querySelector !== 'function') {
    return null;
  }
  return document.querySelector('[data-id="' + id + '"]');
}

type BodySeed = {
  html?: string;
  text?: string;
};

/** 全量写 body 自身（不是 .stream-active-tail）：rich 用 html，plain 用纯文本。 */
function writeBodyFull(body: Element, seed: BodySeed): void {
  if (state.flags.richText && seed.html) {
    applyTrustedHtml(body, seed.html);
    body.classList.remove('stream-tail-plain');
    body.classList.add('rich');
    return;
  }
  body.textContent = String(seed.text || '');
}

/**
 * gap 恢复/快照 seed 的唯一 DOM 写入口（P0-2）：按 data-id 找行，把
 * `.bubble-body/.thinking-body` 自身一次性重写为行内完整 text/thinking/html。
 * 无壳直接 return（壳已由本次 renderRows 建好，这里不再 renderRows）。
 *
 * nm-style: keep-public — applySnapshot 的快照 seed/gap 恢复唯一 DOM 写入口
 * （spec P0-2），与 reconcile 共用 writeBodyFull；移出 snapshot 是为了断开
 * stream.ts ↔ snapshot.ts 的循环依赖（spec §3.6）。
 */
export function reseedStreamingRow(row: MessageRow): void {
  const el = findRowElement(row.id);
  if (!el) {
    return;
  }
  const bubble = el.querySelector('.bubble');
  if (!bubble) {
    return;
  }
  const textBody = bubble.querySelector('.bubble-body');
  if (textBody) {
    writeBodyFull(textBody, {html: row.textHtml, text: row.text});
  }
  const thinkingBody = bubble.querySelector('.thinking-body');
  if (thinkingBody) {
    writeBodyFull(thinkingBody, {html: row.thinkingHtml, text: row.thinking});
  }
}

type StreamRenderSignature = {
  text: string;
  thinking: string;
  textHtml: string;
  thinkingHtml: string;
};

const lastStreamRenderSignature = new Map<string, StreamRenderSignature>();

/**
 * finished 流式行的正文校正：只处理窗口内命中的 `[data-id]`，签名（四个
 * 字符串全等）未变直接跳过；无壳跳过；**不调用 renderRows**；只写
 * `.bubble-body/.thinking-body` 自身（不经 streamRenderTarget，块模式会把
 * 全量 html 写进尾容器复制已提交块）。
 */
export function reconcileFinishedStreamingRows(): void {
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    if (row.kind !== 'message' || row.status !== 'finished') {
      continue;
    }
    const el = findRowElement(row.id);
    if (!el) {
      continue;
    }
    const next: StreamRenderSignature = {
      text: String(row.text || ''),
      thinking: String(row.thinking || ''),
      textHtml: String(row.textHtml || ''),
      thinkingHtml: String(row.thinkingHtml || ''),
    };
    const prev = lastStreamRenderSignature.get(row.id);
    if (
      prev != null &&
      prev.text === next.text &&
      prev.thinking === next.thinking &&
      prev.textHtml === next.textHtml &&
      prev.thinkingHtml === next.thinkingHtml
    ) {
      continue;
    }
    const bubble = el.querySelector('.bubble');
    if (!bubble) {
      continue;
    }
    const textBody = bubble.querySelector('.bubble-body');
    if (textBody) {
      writeBodyFull(textBody, {html: row.textHtml, text: row.text});
    }
    const thinkingBody = bubble.querySelector('.thinking-body');
    if (thinkingBody) {
      writeBodyFull(thinkingBody, {html: row.thinkingHtml, text: row.thinking});
    }
    lastStreamRenderSignature.set(row.id, next);
  }
}
