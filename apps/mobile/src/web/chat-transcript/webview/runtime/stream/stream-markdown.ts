import {decodeLiteralHtmlEntities} from '@web/shared/decode-entities';
import {applyTrustedHtml} from '@web/shared/ui/TrustedHtml';
import {escapeHtmlRaw} from '../util/html-escape';
import {state} from '../state/state';
import {scheduleStickIfNearBottom} from '../scroll/scroll';
import {
  assistantBubbleExtraClasses,
  ensureStreamTextBody,
  getStreamActiveTailText,
  getStreamThinkingBody,
  setStreamBodyRichClass,
  setStreamTailPlainClass,
  streamRenderTarget,
  type StreamKind,
} from './stream';

export const STREAM_RICH_UPGRADE_MS = 350;

export type StreamRichUpgradeState = {
  timer: ReturnType<typeof setTimeout> | null;
  kinds: {text: boolean; thinking: boolean};
  plainMode: {text: boolean; thinking: boolean};
};

export const streamRichUpgrade: StreamRichUpgradeState = {
  timer: null,
  kinds: {text: false, thinking: false},
  plainMode: {text: true, thinking: true},
};

export function renderStreamingInline(s: string): string {
  const escaped = escapeHtmlRaw(s);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderStreamingMarkdown(text: unknown): string {
  const normalized = decodeLiteralHtmlEntities(String(text || '').trim());
  if (!normalized) return '';
  const lines = normalized.split(/\n/);
  let html = '';
  let inList: false | 'ul' | 'ol' = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html += '<ul>';
        inList = 'ul';
      } else if (inList === 'ol') {
        html += '</ol><ul>';
        inList = 'ul';
      }
      html += '<li>' + renderStreamingInline(bullet[1]) + '</li>';
      continue;
    }
    if (ordered) {
      if (!inList) {
        html += '<ol>';
        inList = 'ol';
      } else if (inList === 'ul') {
        html += '</ul><ol>';
        inList = 'ol';
      }
      html += '<li>' + renderStreamingInline(ordered[1]) + '</li>';
      continue;
    }
    if (inList) {
      html += inList === 'ul' ? '</ul>' : '</ol>';
      inList = false;
    }
    // 空行保留为等高占位段：plain 态（pre-wrap）里空行占一行高，轻量渲染
    // 若直接丢弃，350ms 升级瞬间行数突变、整块高度跳一下——流式期间的
    // 「一闪一闪」主源之一（2026-10-02 真机实测反馈）。<br> 撑起一行高且
    // 不产生文本内容（选择/拷贝零偏移）。
    if (line.trim() === '') {
      html += '<p class="stream-blank"><br></p>';
      continue;
    }
    html += '<p>' + renderStreamingInline(line) + '</p>';
  }
  if (inList) html += inList === 'ul' ? '</ul>' : '</ol>';
  return html;
}

export function clearStreamRichUpgrade(): void {
  if (streamRichUpgrade.timer != null) {
    clearTimeout(streamRichUpgrade.timer);
    streamRichUpgrade.timer = null;
  }
  streamRichUpgrade.kinds.text = false;
  streamRichUpgrade.kinds.thinking = false;
  streamRichUpgrade.plainMode.text = true;
  streamRichUpgrade.plainMode.thinking = true;
}

export function paintStreamRichKind(tail: Element, kind: StreamKind): void {
  const bubble = tail.querySelector('.bubble');
  if (!bubble) return;
  if (kind === 'thinking') {
    const body = getStreamThinkingBody(bubble);
    if (!body) return;
    // 块级模式下只对活跃尾块做轻量升级（已提交块零重渲）；旧模式仍为
    // 全量显示态（回滚开关关闭时的形态）
    const thinkingHtml = renderStreamingMarkdown(
      getStreamActiveTailText('thinking'),
    );
    if (!thinkingHtml) return;
    const target = streamRenderTarget(body);
    applyTrustedHtml(target, thinkingHtml);
    // 轻量升级落富文本：清纯文本降级标记（B-1）
    setStreamTailPlainClass(target, false);
    setStreamBodyRichClass(body, true);
    state.stream.thinkingHtml = thinkingHtml;
  } else {
    const textBody = ensureStreamTextBody(bubble);
    const textHtml = renderStreamingMarkdown(getStreamActiveTailText('text'));
    if (!textHtml) return;
    const target = streamRenderTarget(textBody);
    applyTrustedHtml(target, textHtml);
    setStreamTailPlainClass(target, false);
    setStreamBodyRichClass(textBody, true);
    state.stream.textHtml = textHtml;
  }
  bubble.className =
    'bubble assistant' +
    assistantBubbleExtraClasses(
      state.stream.textHtml,
      [],
      state.stream.text,
      state.stream.thinking,
    );
}

export function flushStreamRichUpgrade(): void {
  streamRichUpgrade.timer = null;
  const tail = document.getElementById('stream-tail');
  if (!tail) return;
  if (streamRichUpgrade.kinds.text) {
    paintStreamRichKind(tail, 'text');
    streamRichUpgrade.kinds.text = false;
    streamRichUpgrade.plainMode.text = false;
  }
  if (streamRichUpgrade.kinds.thinking) {
    paintStreamRichKind(tail, 'thinking');
    streamRichUpgrade.kinds.thinking = false;
    streamRichUpgrade.plainMode.thinking = false;
  }
  scheduleStickIfNearBottom();
}

export function scheduleStreamRichUpgrade(kind: StreamKind): void {
  if (!state.flags.richText) return;
  streamRichUpgrade.kinds[kind] = true;
  if (streamRichUpgrade.timer != null) return;
  streamRichUpgrade.timer = setTimeout(
    flushStreamRichUpgrade,
    STREAM_RICH_UPGRADE_MS,
  );
}
